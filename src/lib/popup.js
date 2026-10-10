// The panel button and its popup: search, filters, list, footer.

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {gettext as _, pgettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Kind, oneLine, parseColor, rgbToHex} from './kinds.js';
import {KIND_ICON, entryTitle, makeIcon, relativeTime} from './util.js';
import {animationsEnabled, noPopupAnimation, onKeyPress, scrollToActor, vbox} from './compat.js';
import {PreviewCard} from './preview.js';
import {EditDialog, ConfirmDialog} from './dialogs.js';
import {Sound, SoundPlayer} from './sounds.js';

const MAX_ROWS = 200;
// Rows that fade in when the popup opens; the rest appear at once.
const STAGGER_ROWS = 8;
const STAGGER_STEP_MS = 14;
const LAYOUT_WIDTH = {default: 390, spotlight: 440, cards: 500, compact: 360};
// cards layout: popup width - list padding (2 × 7) - gap (10), two columns
const CARD_WIDTH = (LAYOUT_WIDTH.cards - 14 - 10) / 2;

function filters() {
    return [
        {id: Kind.IMAGE, icon: KIND_ICON[Kind.IMAGE], label: _('Images'), chip: true},
        {id: Kind.LINK, icon: KIND_ICON[Kind.LINK], label: _('Links'), chip: true},
        {id: Kind.CODE, icon: KIND_ICON[Kind.CODE], label: _('Code'), chip: true},
        {id: Kind.COLOR, icon: KIND_ICON[Kind.COLOR], label: _('Colors'), chip: false},
        {id: 'pinned', icon: 'view-pin-symbolic', label: pgettext('filter', 'Pinned'), chip: true},
        {id: Kind.FILE, icon: KIND_ICON[Kind.FILE], label: _('Files'), chip: false},
        {id: Kind.TEXT, icon: KIND_ICON[Kind.TEXT], label: _('Text'), chip: false},
    ];
}

export const ClipboardButton = GObject.registerClass(
class ClipboardButton extends PanelMenu.Button {
    _init(extension, settings, store, service) {
        super._init(0.5, 'Clipboard+', false);
        this._ext = extension;
        this._settings = settings;
        this._store = store;
        this._service = service;
        this._path = extension.path;

        this._query = '';
        this._token = null;          // active filter id
        this._engaged = false;       // user interacted with the search field
        this._selected = -1;
        this._entries = [];          // entries in display order
        this._rows = [];
        this._timeouts = new Set();
        this._previewTimeout = 0;
        this._lastKeyboardPointer = null;

        this._icon = new St.Icon({style_class: 'system-status-icon cbp-panel-icon'});
        this.add_child(this._icon);
        this._updateIcon();

        this.menu.actor.add_style_class_name('cbp-boxpointer');
        this.menu.box.add_style_class_name('cbp-menu');

        this._section = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._section);
        this._buildUi();

        this._preview = new PreviewCard(this._store, this._path, () => this._motion(), this._settings);
        this._sounds = new SoundPlayer(this._settings, GLib.build_filenamev([this._path, 'sounds']));

        // With animations turned off, the popup itself opens and closes
        // without its slide / fade too.
        const open = this.menu.open.bind(this.menu);
        const close = this.menu.close.bind(this.menu);
        this.menu.open = params => open(this._motion() ? params : noPopupAnimation(this.menu));
        this.menu.close = params => close(this._motion() ? params : noPopupAnimation(this.menu));

        this._storeChangedId = this._store.connectChanged(() => {
            if (this.menu.isOpen)
                this._refresh();
        });

        this._settingsIds = [
            this._settings.connect('changed::private-mode', () => this._updatePrivate()),
            this._settings.connect('changed::layout', () => this._applyLayout()),
            this._settings.connect('changed::enable-animations', () => this._applyMotion()),
        ];

        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._accentId = this._interface.settings_schema.has_key('accent-color')
            ? this._interface.connect('changed::accent-color', () => this._applyAccent())
            : 0;
        this._applyAccent();
        this._applyLayout();
        this._applyMotion();
        this._updatePrivate();

        this.menu.connect('open-state-changed', (_m, open) => {
            if (open)
                this._onOpen();
            else
                this._onClose();
        });
    }

    // ---------------------------------------------------------------- UI

    _buildUi() {
        this._root = vbox({style_class: 'cbp-root', reactive: true});
        this._section.actor.add_child(this._root);

        // Search field: [icon] [token] [entry]
        this._searchBox = new St.BoxLayout({style_class: 'cbp-search', x_expand: true, reactive: true});
        this._searchBox.add_child(new St.Icon({
            icon_name: 'edit-find-symbolic',
            style_class: 'cbp-search-icon',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._tokenButton = new St.Button({style_class: 'cbp-token', visible: false, y_align: Clutter.ActorAlign.CENTER});
        this._tokenBox = new St.BoxLayout();
        this._tokenIcon = new St.Icon({style_class: 'cbp-token-icon'});
        this._tokenLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this._tokenBox.add_child(this._tokenIcon);
        this._tokenBox.add_child(this._tokenLabel);
        this._tokenButton.set_child(this._tokenBox);
        this._tokenButton.connect('clicked', () => this._setToken(null));
        this._searchBox.add_child(this._tokenButton);

        this._entry = new St.Entry({
            style_class: 'cbp-entry',
            hint_text: _('Search'),
            can_focus: true,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._searchBox.add_child(this._entry);
        this._root.add_child(this._searchBox);

        const text = this._entry.clutter_text;
        text.connect('text-changed', () => {
            this._query = this._entry.get_text();
            if (this._query)
                this._setEngaged(true);
            this._refresh();
        });
        this._entry.connect('button-press-event', () => {
            this._setEngaged(true);
            return Clutter.EVENT_PROPAGATE;
        });
        this._searchBox.connect('button-press-event', () => {
            this._setEngaged(true);
            this._entry.grab_key_focus();
            return Clutter.EVENT_PROPAGATE;
        });
        this._disconnectKeys = onKeyPress(text, (sym, state) => this._onKey(sym, state));

        // Filter chips (only while the user is searching)
        this._chips = new St.BoxLayout({style_class: 'cbp-chips', visible: false});
        this._root.add_child(this._chips);
        this._hint = new St.Label({style_class: 'cbp-hint', visible: false});
        this._root.add_child(this._hint);

        // List
        this._scroll = new St.ScrollView({
            style_class: 'cbp-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            overlay_scrollbars: true,
            x_expand: true,
        });
        this._list = vbox({style_class: 'cbp-list', x_expand: true});
        if (this._scroll.set_child)
            this._scroll.set_child(this._list);
        else
            this._scroll.add_actor(this._list);
        this._root.add_child(this._scroll);

        this._empty = vbox({style_class: 'cbp-empty', visible: false, x_expand: true});
        this._emptyIcon = new St.Icon({style_class: 'cbp-empty-icon', x_align: Clutter.ActorAlign.CENTER});
        this._emptyLabel = new St.Label({style_class: 'cbp-empty-label', x_align: Clutter.ActorAlign.CENTER});
        this._emptySub = new St.Label({style_class: 'cbp-empty-sub', x_align: Clutter.ActorAlign.CENTER});
        this._empty.add_child(this._emptyIcon);
        this._empty.add_child(this._emptyLabel);
        this._empty.add_child(this._emptySub);
        this._root.add_child(this._empty);

        // Footer: [eye] Private Mode [switch] ........ [trash] [gear]
        const footer = new St.BoxLayout({style_class: 'cbp-footer', x_expand: true});
        this._privateButton = new St.Button({style_class: 'cbp-private', can_focus: false});
        const pbox = new St.BoxLayout({style_class: 'cbp-private-box'});
        pbox.add_child(new St.Icon({icon_name: 'view-conceal-symbolic', style_class: 'cbp-footer-icon', y_align: Clutter.ActorAlign.CENTER}));
        pbox.add_child(new St.Label({text: _('Private Mode'), style_class: 'cbp-private-label', y_align: Clutter.ActorAlign.CENTER}));
        this._switch = new PopupMenu.Switch(this._settings.get_boolean('private-mode'));
        this._switch.add_style_class_name('cbp-switch');
        // Since GNOME 51 the switch handles clicks and drags itself and
        // would flip without changing the setting. It only mirrors the
        // setting; the whole button toggles it.
        this._switch.reactive = false;
        this._switch.can_focus = false;
        pbox.add_child(this._switch);
        this._privateButton.set_child(pbox);
        this._privateButton.connect('clicked', () =>
            this._settings.set_boolean('private-mode', !this._settings.get_boolean('private-mode')));
        footer.add_child(this._privateButton);
        footer.add_child(new St.Widget({x_expand: true}));

        this._clearButton = this._iconButton('user-trash-symbolic', _('Clear History'), () => this.clearHistory());
        footer.add_child(this._clearButton);
        footer.add_child(this._iconButton('emblem-system-symbolic', _('Settings'), () => {
            this.menu.close();
            this._ext.openPreferences();
        }));
        this._root.add_child(footer);
    }

    _iconButton(iconName, accessibleName, callback, styleClass = 'cbp-icon-button') {
        const button = new St.Button({
            style_class: styleClass,
            accessible_name: accessibleName,
            can_focus: false,
            child: new St.Icon({gicon: makeIcon(iconName, this._path)}),
        });
        button.connect('clicked', () => {
            callback();
            return Clutter.EVENT_STOP;
        });
        return button;
    }

    _applyAccent() {
        let accent = 'blue';
        if (this._accentId)
            accent = this._interface.get_string('accent-color') || 'blue';
        for (const c of this._root.get_style_class_name()?.split(' ') ?? []) {
            if (c.startsWith('cbp-accent-'))
                this._root.remove_style_class_name(c);
        }
        this._root.add_style_class_name(`cbp-accent-${accent}`);
        this._preview?.setAccent(accent);
    }

    _applyLayout() {
        this._layout = this._settings.get_string('layout');
        for (const l of Object.keys(LAYOUT_WIDTH))
            this._root.remove_style_class_name(`cbp-layout-${l}`);
        this._root.add_style_class_name(`cbp-layout-${this._layout}`);
        this._root.set_width(LAYOUT_WIDTH[this._layout] ?? LAYOUT_WIDTH.default);
        if (this.menu.isOpen)
            this._refresh();
    }

    /** @returns {boolean} whether to animate (our setting and the system's) */
    _motion() {
        return this._settings.get_boolean('enable-animations') && animationsEnabled();
    }

    _applyMotion() {
        // CSS transitions (selection highlight, hover) follow the setting too.
        if (this._settings.get_boolean('enable-animations'))
            this._root.remove_style_class_name('cbp-no-anim');
        else
            this._root.add_style_class_name('cbp-no-anim');
    }

    _updateIcon() {
        const priv = this._settings.get_boolean('private-mode');
        this._icon.gicon = makeIcon(priv ? 'clipboard-plus-off' : 'clipboard-plus', this._path);
        this._icon.opacity = priv ? 140 : 255;
    }

    _updatePrivate() {
        this._updateIcon();
        const priv = this._settings.get_boolean('private-mode');
        if (this._switch.state !== priv)
            this._switch.state = priv;
    }

    /** Briefly pulse the panel icon when something is copied. */
    pulse() {
        if (!this._settings.get_boolean('blink-icon') || !this._motion())
            return;
        this._icon.remove_all_transitions();
        this._icon.set_pivot_point(0.5, 0.5);
        this._icon.ease({
            scale_x: 0.8,
            scale_y: 0.8,
            duration: 90,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this._icon.ease({
                scale_x: 1,
                scale_y: 1,
                duration: 160,
                mode: Clutter.AnimationMode.EASE_OUT_BACK,
            }),
        });
    }

    // ---------------------------------------------------------------- open / close

    /** Open or close the popup from the global shortcut. */
    toggleFromShortcut() {
        if (this.menu.isOpen) {
            this.menu.close();
            return;
        }
        if (!this.mapped || !this.reactive)
            return;
        this.menu.open();
    }

    _onOpen() {
        this._query = '';
        this._token = null;
        this._engaged = false;
        this._selected = -1;
        this._activating = false;
        this._entry.set_text('');
        this._tokenButton.hide();
        this._setEngaged(false);
        this._refresh();
        this._sounds.prepare();
        this._sounds.play(Sound.OPEN);
        if (this._motion())
            this._staggerRows();
        // Keep keyboard focus in the search field so typing just works,
        // while arrow keys move the selection.
        this._later(0, () => {
            this._entry.grab_key_focus();
            if (this._entries.length)
                this._select(0, 'open');
        });
    }

    /** Let the first rows drift in one after another. */
    _staggerRows() {
        this._list.get_children().slice(0, STAGGER_ROWS).forEach((actor, i) => {
            actor.opacity = 0;
            actor.translation_y = -6;
            actor.ease({
                opacity: 255,
                translation_y: 0,
                delay: i * STAGGER_STEP_MS,
                duration: 180,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        });
    }

    _onClose() {
        this._clearPreviewTimeout();
        this._sounds?.done();
        // Also reached from _onDestroy() when disabled while open.
        this._preview?.hide();
    }

    _later(ms, fn) {
        const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeouts.delete(id);
            fn();
            return GLib.SOURCE_REMOVE;
        });
        this._timeouts.add(id);
        return id;
    }

    // ---------------------------------------------------------------- search & filters

    _setEngaged(engaged) {
        this._engaged = engaged;
        if (engaged)
            this._searchBox.add_style_class_name('engaged');
        else
            this._searchBox.remove_style_class_name('engaged');
        this._updateChips();
    }

    _suggestions() {
        if (this._token)
            return [];
        const word = this._query.trim().split(/\s+/).pop()?.replace(/^\//, '').toLocaleLowerCase() ?? '';
        if (word.length < 2)
            return [];
        return filters().filter(f =>
            f.label.toLocaleLowerCase().startsWith(word) || f.id.startsWith(word));
    }

    _updateChips() {
        this._chips.destroy_all_children();
        const suggestions = this._suggestions();
        let list;
        if (this._token || !this._engaged)
            list = [];
        else if (this._query.trim())
            list = suggestions;
        else
            list = filters().filter(f => f.chip);

        for (const f of list) {
            const active = suggestions.includes(f);
            const chip = new St.Button({style_class: `cbp-chip${active ? ' active' : ''}`, can_focus: false});
            const box = new St.BoxLayout();
            box.add_child(new St.Icon({gicon: makeIcon(f.icon, this._path), style_class: 'cbp-chip-icon', y_align: Clutter.ActorAlign.CENTER}));
            box.add_child(new St.Label({text: f.label, y_align: Clutter.ActorAlign.CENTER}));
            chip.set_child(box);
            chip.connect('clicked', () => this._applyFilter(f));
            this._chips.add_child(chip);
        }
        this._chips.visible = list.length > 0;

        if (suggestions.length === 1 && this._engaged) {
            this._hint.text = _('Press Tab to filter by %s').format(suggestions[0].label);
            this._hint.show();
        } else {
            this._hint.hide();
        }
    }

    _applyFilter(f) {
        // Remove the partially typed filter word from the query
        const words = this._query.trim().split(/\s+/);
        const last = words[words.length - 1]?.replace(/^\//, '').toLocaleLowerCase() ?? '';
        if (last && (f.label.toLocaleLowerCase().startsWith(last) || f.id.startsWith(last)))
            words.pop();
        this._setToken(f.id);
        this._entry.set_text(words.join(' '));
        this._entry.grab_key_focus();
        this._entry.clutter_text.set_cursor_position(-1);
    }

    _setToken(id) {
        this._token = id;
        const f = filters().find(x => x.id === id);
        if (f) {
            this._tokenIcon.gicon = makeIcon(f.icon, this._path);
            this._tokenLabel.text = f.label;
            this._tokenButton.show();
        } else {
            this._tokenButton.hide();
        }
        this._refresh();
        this._entry.grab_key_focus();
    }

    _matcher() {
        const q = this._query.trim();
        if (!q)
            return () => true;
        const caseSensitive = this._settings.get_boolean('case-sensitive-search');
        if (this._settings.get_boolean('regex-search')) {
            try {
                const re = new RegExp(q, caseSensitive ? '' : 'i');
                return s => re.test(s);
            } catch {}
        }
        const needle = caseSensitive ? q : q.toLocaleLowerCase();
        return s => (caseSensitive ? s : s.toLocaleLowerCase()).includes(needle);
    }

    _filteredEntries() {
        let items = this._store.items;
        let kind = this._token;
        let query = this._query;

        // While a single filter is suggested and nothing else is typed,
        // preview that filter's results (Tab makes it permanent).
        const sugg = this._suggestions();
        if (!kind && sugg.length === 1 && this._query.trim().split(/\s+/).length === 1) {
            kind = sugg[0].id;
            query = '';
        }
        if (kind === 'pinned')
            items = items.filter(e => e.pinned);
        else if (kind)
            items = items.filter(e => e.kind === kind);

        if (query.trim()) {
            const saved = this._query;
            this._query = query;
            const match = this._matcher();
            this._query = saved;
            items = items.filter(e => match(e.text ?? '') || (e.tag && match(e.tag)) ||
                (e.kind === Kind.IMAGE && e.app && match(e.app)));
        }
        return [...items.filter(e => e.pinned), ...items.filter(e => !e.pinned)];
    }

    // ---------------------------------------------------------------- list

    _refresh() {
        const prevId = this._entries[this._selected]?.id;
        this._entries = this._filteredEntries().slice(0, MAX_ROWS);
        this._list.destroy_all_children();
        this._rows = [];
        this._updateChips();

        const searching = !!(this._query.trim() || this._token);
        const pinnedCount = this._entries.filter(e => e.pinned).length;
        const showSections = !searching && this._layout !== 'cards' && pinnedCount > 0;

        const container = this._list;
        let gridRow = null;
        this._entries.forEach((entry, i) => {
            if (showSections && i === 0)
                this._list.add_child(this._sectionLabel(_('Pinned')));
            if (showSections && i === pinnedCount)
                this._list.add_child(this._sectionLabel(_('History')));
            const row = this._makeRow(entry, i);
            this._rows.push(row);
            if (this._layout === 'cards') {
                if (i % 2 === 0) {
                    gridRow = new St.BoxLayout({style_class: 'cbp-card-row', x_expand: true});
                    container.add_child(gridRow);
                }
                gridRow.add_child(row);
            } else {
                container.add_child(row);
            }
        });

        const empty = this._entries.length === 0;
        this._scroll.visible = !empty;
        this._empty.visible = empty;
        if (empty) {
            const nothing = this._store.items.length === 0;
            this._emptyIcon.gicon = makeIcon(nothing ? 'clipboard-plus' : 'edit-find-symbolic', this._path);
            this._emptyLabel.text = nothing ? _('Nothing copied yet') : _('No results');
            this._emptySub.text = nothing
                ? (this._settings.get_boolean('private-mode')
                    ? _('Private Mode is on — copies are not recorded')
                    : _('Copied text and images will appear here'))
                : _('Try a different search or filter');
        }

        let sel = this._entries.findIndex(e => e.id === prevId);
        if (sel < 0)
            sel = this._entries.length ? 0 : -1;
        this._selected = -1;
        if (sel >= 0)
            this._select(sel, searching ? 'keyboard' : 'refresh');
        else
            this._preview.hide();
    }

    _sectionLabel(text) {
        return new St.Label({text, style_class: 'cbp-section'});
    }

    _makeBadge(entry, styleClass = 'cbp-badge') {
        const badge = new St.Bin({style_class: `${styleClass} kind-${entry.kind}`, y_align: Clutter.ActorAlign.CENTER});
        if (entry.kind === Kind.IMAGE && entry.thumb) {
            const path = this._store.imagePath(entry, 'thumb');
            badge.add_style_class_name('has-image');
            badge.set_style(`background-image: url("${path}");`);
        } else if (entry.kind === Kind.COLOR) {
            const rgb = parseColor(entry.text);
            if (rgb)
                badge.set_style(`background-color: ${rgbToHex(rgb)};`);
        } else {
            badge.set_child(new St.Icon({gicon: makeIcon(KIND_ICON[entry.kind], this._path), style_class: 'cbp-badge-icon'}));
        }
        return badge;
    }

    _makeRow(entry, index) {
        const layout = this._layout;
        const row = new St.BoxLayout({
            style_class: `cbp-row${layout === 'cards' ? ' cbp-card' : ''}`,
            reactive: true,
            track_hover: true,
            x_expand: true,
        });
        if (layout === 'cards') {
            row.add_style_class_name(`kind-${entry.kind}`);
            row.x_expand = false;
            row.set_width(CARD_WIDTH);
        }

        const main = new St.Button({style_class: 'cbp-row-main', x_expand: true, can_focus: false});
        main.connect('clicked', () => this._activate(index));
        row.add_child(main);

        let content;
        if (layout === 'cards')
            content = this._cardContent(entry);
        else
            content = this._rowContent(entry, layout);
        main.set_child(content.actor);

        // Hover actions: [folder], pin, delete (replace the time label while hovered)
        const actions = new St.BoxLayout({style_class: 'cbp-actions', visible: false, y_align: Clutter.ActorAlign.CENTER});
        const filePath = this._filePath(entry);
        if (filePath) {
            actions.add_child(this._iconButton('folder-open-symbolic', _('Show in Folder'),
                () => this._showInFolder(filePath), 'cbp-action'));
        }
        const pin = this._iconButton('view-pin-symbolic', entry.pinned ? _('Unpin') : _('Pin'),
            () => this._store.togglePin(entry), 'cbp-action');
        if (entry.pinned)
            pin.add_style_class_name('active');
        actions.add_child(pin);
        actions.add_child(this._iconButton('user-trash-symbolic', _('Delete'), () => this._delete(entry), 'cbp-action'));
        row.add_child(actions);

        row.connect('notify::hover', () => {
            actions.visible = row.hover;
            if (content.trailing)
                content.trailing.visible = !row.hover;
            if (row.hover && this._pointerMoved())
                this._select(index, 'pointer');
        });
        row._entry = entry;
        return row;
    }

    _rowContent(entry, layout) {
        const box = new St.BoxLayout({style_class: 'cbp-row-content', x_expand: true});
        if (layout !== 'compact' || entry.kind === Kind.IMAGE || entry.kind === Kind.COLOR)
            box.add_child(this._makeBadge(entry, layout === 'compact' ? 'cbp-badge compact' : 'cbp-badge'));

        const titleClass = `cbp-title${entry.kind === Kind.CODE ? ' mono' : ''}`;
        const title = new St.Label({text: entryTitle(entry), style_class: titleClass, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        if (layout === 'spotlight') {
            const texts = vbox({x_expand: true, y_align: Clutter.ActorAlign.CENTER});
            texts.add_child(title);
            const sub = [entry.app, relativeTime(entry.time), entry.tag].filter(Boolean).join(' · ');
            texts.add_child(new St.Label({text: sub, style_class: 'cbp-subtitle'}));
            box.add_child(texts);
        } else {
            box.add_child(title);
        }

        let trailing = null;
        if (entry.pinned) {
            trailing = new St.Icon({icon_name: 'view-pin-symbolic', style_class: 'cbp-pin-mark', y_align: Clutter.ActorAlign.CENTER});
        } else if (layout !== 'spotlight' && (entry.tag || this._settings.get_boolean('show-time'))) {
            trailing = new St.Label({
                text: entry.tag ? entry.tag : relativeTime(entry.time),
                style_class: entry.tag ? 'cbp-tag' : 'cbp-time',
                y_align: Clutter.ActorAlign.CENTER,
            });
        }
        if (trailing)
            box.add_child(trailing);
        return {actor: box, trailing};
    }

    _cardContent(entry) {
        const box = vbox({style_class: 'cbp-card-content', x_expand: true});
        if (entry.kind === Kind.IMAGE && entry.preview) {
            const img = new St.Widget({style_class: 'cbp-card-image', x_expand: true});
            img.set_style(`background-image: url("${this._store.imagePath(entry, 'preview')}");`);
            box.add_child(img);
        } else if (entry.kind === Kind.COLOR) {
            const rgb = parseColor(entry.text);
            const sw = new St.Bin({style_class: 'cbp-card-swatch', x_expand: true});
            if (rgb) {
                sw.set_style(`background-color: ${rgbToHex(rgb)};`);
                const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
                sw.set_child(new St.Label({
                    text: entry.text.trim(),
                    style_class: `cbp-card-swatch-label${lum > 0.6 ? ' dark' : ''}`,
                    x_align: Clutter.ActorAlign.START,
                    y_align: Clutter.ActorAlign.END,
                    x_expand: true,
                    y_expand: true,
                }));
            }
            box.add_child(sw);
        } else {
            const label = new St.Label({
                text: entry.kind === Kind.IMAGE || entry.kind === Kind.FILE ? entryTitle(entry) : oneLine(entry.text, 120),
                style_class: `cbp-card-text${entry.kind === Kind.CODE ? ' mono' : ''}${entry.kind === Kind.LINK ? ' link' : ''}`,
                y_expand: true,
            });
            label.clutter_text.line_wrap = true;
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            box.add_child(label);
            const meta = new St.BoxLayout({style_class: 'cbp-card-meta'});
            meta.add_child(new St.Icon({gicon: makeIcon(KIND_ICON[entry.kind], this._path), style_class: 'cbp-card-meta-icon'}));
            meta.add_child(new St.Label({text: [entry.app, relativeTime(entry.time)].filter(Boolean).join(' · '), y_align: Clutter.ActorAlign.CENTER}));
            if (entry.pinned)
                meta.add_child(new St.Icon({icon_name: 'view-pin-symbolic', style_class: 'cbp-pin-mark'}));
            box.add_child(meta);
        }
        return {actor: box, trailing: null};
    }

    // ---------------------------------------------------------------- selection

    _pointerMoved() {
        // Rows can move under a still pointer while scrolling with the
        // keyboard; only follow the pointer when it actually moved.
        const [x, y] = global.get_pointer();
        if (this._lastKeyboardPointer &&
            this._lastKeyboardPointer[0] === x && this._lastKeyboardPointer[1] === y)
            return false;
        this._lastKeyboardPointer = null;
        return true;
    }

    /**
     * @param {number} index row index
     * @param {string} source 'keyboard', 'pointer', 'open' or 'refresh'
     */
    _select(index, source) {
        if (index < 0 || index >= this._rows.length)
            return;
        if (source === 'keyboard')
            this._lastKeyboardPointer = global.get_pointer().slice(0, 2);
        const changed = index !== this._selected;
        this._rows[this._selected]?.remove_style_class_name('selected');
        this._selected = index;
        const row = this._rows[index];
        row.add_style_class_name('selected');
        if (source === 'keyboard')
            scrollToActor(this._scroll, row);
        // Also when the row did not change: hovering the row that was
        // selected on opening must still bring up its preview.
        if (changed || source === 'refresh' || source === 'open' || !this._preview.visible)
            this._schedulePreview(source);
    }

    _clearPreviewTimeout() {
        if (this._previewTimeout) {
            GLib.source_remove(this._previewTimeout);
            this._timeouts.delete(this._previewTimeout);
            this._previewTimeout = 0;
        }
    }

    _schedulePreview(source) {
        this._clearPreviewTimeout();
        if (!this._settings.get_boolean('show-preview'))
            return;
        // Opening the popup should stay calm: no card until the user moves.
        if (source === 'open' || source === 'refresh') {
            if (!this._preview.visible)
                return;
        }
        const delay = source === 'pointer'
            ? this._settings.get_int('preview-delay-pointer')
            : this._settings.get_int('preview-delay-keyboard');
        if (delay === 0) {
            this._showPreview();
            return;
        }
        this._previewTimeout = this._later(delay, () => {
            this._previewTimeout = 0;
            this._showPreview();
        });
    }

    _showPreview() {
        const row = this._rows[this._selected];
        if (!row || !this.menu.isOpen)
            return;
        this._preview.show(row._entry, this.menu.box, row);
    }

    _move(delta) {
        if (!this._rows.length)
            return;
        let i = this._selected < 0 ? 0 : this._selected + delta;
        i = Math.max(0, Math.min(this._rows.length - 1, i));
        this._select(i, 'keyboard');
    }

    // ---------------------------------------------------------------- actions

    _activate(index) {
        const entry = this._entries[index];
        if (!entry || this._activating)
            return;
        this._sounds.play(Sound.SELECT);

        const finish = () => {
            this._activating = false;
            const paste = this._settings.get_boolean('paste-on-select');
            // Close first: the paste must reach the window, not the popup.
            this.menu.close();
            this._service.setEntry(entry, () => {
                if (paste)
                    this._service.paste();
            });
            this._store.use(entry);
        };

        const row = this._rows[index];
        if (!row || !this._motion()) {
            finish();
            return;
        }
        // A short press on the chosen row, then the popup fades out.
        this._activating = true;
        row.set_pivot_point(0.5, 0.5);
        row.ease({
            scale_x: 0.96,
            scale_y: 0.96,
            duration: 70,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: finish,
        });
    }

    _delete(entry) {
        const i = this._entries.indexOf(entry);
        this._store.remove(entry);
        if (this._rows.length)
            this._select(Math.min(i, this._rows.length - 1), 'keyboard');
    }

    _editSelected(mode) {
        const entry = this._entries[this._selected];
        if (!entry || (mode === 'edit' && entry.kind === Kind.IMAGE))
            return;
        this.menu.close();
        const dialog = new EditDialog(mode, mode === 'edit' ? entry.text : entry.tag ?? '', value => {
            if (mode === 'edit')
                this._store.setText(entry, value);
            else
                this._store.setTag(entry, value);
        });
        dialog.open();
    }

    clearHistory() {
        const doClear = () => this._store.clear(true);
        this.menu.close();
        if (!this._store.unpinned.length)
            return;
        if (this._settings.get_boolean('confirm-clear')) {
            new ConfirmDialog(
                _('Clear clipboard history?'),
                _('All entries except pinned ones will be deleted. This cannot be undone.'),
                _('Clear'),
                doClear).open();
        } else {
            doClear();
        }
    }

    /** @returns {boolean} whether Space opens links and files */
    _openWithSpace() {
        return this._settings.get_string('open-key') === 'space';
    }

    _canOpen(entry) {
        return entry?.kind === Kind.LINK || entry?.kind === Kind.FILE;
    }

    /**
     * @param {object} entry history entry
     * @returns {string|null} the local file behind an entry: a copied file,
     *   or the file a copied image (e.g. a screenshot) was saved to
     */
    _filePath(entry) {
        let path = null;
        if (entry.kind === Kind.IMAGE) {
            path = entry.source ?? null;
        } else if (entry.kind === Kind.FILE) {
            const first = entry.text.trim().split('\n')[0].trim();
            if (first.startsWith('file://'))
                path = Gio.File.new_for_uri(first).get_path();
            else if (first.startsWith('/') || first.startsWith('~'))
                path = first.replace(/^~/, GLib.get_home_dir());
        }
        return path && GLib.file_test(path, GLib.FileTest.EXISTS) ? path : null;
    }

    /** Open the folder that holds a file, with the file selected. */
    _showInFolder(path) {
        this.menu.close();
        const uri = Gio.File.new_for_path(path).get_uri();
        Gio.DBus.session.call('org.freedesktop.FileManager1', '/org/freedesktop/FileManager1',
            'org.freedesktop.FileManager1', 'ShowItems', new GLib.Variant('(ass)', [[uri], '']),
            null, Gio.DBusCallFlags.NONE, -1, null, (conn, res) => {
                try {
                    conn.call_finish(res);
                } catch {
                    // No file manager implements the interface: open the folder.
                    try {
                        const parent = Gio.File.new_for_path(path).get_parent().get_uri();
                        Gio.AppInfo.launch_default_for_uri(parent, global.create_app_launch_context(0, -1));
                    } catch (e) {
                        Main.notifyError(_('Could not open'), e.message);
                    }
                }
            });
    }

    _openLink() {
        const entry = this._entries[this._selected];
        if (!this._canOpen(entry))
            return;
        let uri = entry.text.trim().split('\n')[0];
        if (entry.kind === Kind.LINK && !/^[a-z]+:/i.test(uri))
            uri = `https://${uri}`;
        if (entry.kind === Kind.FILE && !uri.startsWith('file://'))
            uri = Gio.File.new_for_path(uri.replace(/^~/, GLib.get_home_dir())).get_uri();
        try {
            Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
        } catch (e) {
            Main.notifyError(_('Could not open'), e.message);
        }
        this.menu.close();
    }

    // ---------------------------------------------------------------- keyboard

    _onKey(sym, state) {
        const ctrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const emptyQuery = this._entry.get_text() === '';

        switch (sym) {
        case Clutter.KEY_Down:
        case Clutter.KEY_KP_Down:
            this._move(1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
        case Clutter.KEY_KP_Up:
            this._move(-1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Down:
            this._move(8);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Page_Up:
            this._move(-8);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
        case Clutter.KEY_ISO_Enter:
            if (ctrl && !this._openWithSpace())
                this._openLink();
            else
                this._activate(this._selected);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Tab:
        case Clutter.KEY_ISO_Left_Tab: {
            const s = this._suggestions();
            if (s.length)
                this._applyFilter(s[0]);
            return Clutter.EVENT_STOP;
        }
        case Clutter.KEY_BackSpace:
            if (emptyQuery && this._token) {
                this._setToken(null);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        case Clutter.KEY_Delete:
        case Clutter.KEY_KP_Delete:
            if (emptyQuery || ctrl) {
                const e = this._entries[this._selected];
                if (e)
                    this._delete(e);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        case Clutter.KEY_space:
            if (emptyQuery && this._rows.length) {
                if (this._openWithSpace() && this._canOpen(this._entries[this._selected])) {
                    this._openLink();
                    return Clutter.EVENT_STOP;
                }
                this._clearPreviewTimeout();
                if (!this._preview.visible)
                    this._showPreview();
                this._preview.toggleLarge();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        case Clutter.KEY_Escape:
            if (this._preview.large) {
                this._preview.toggleLarge();
                return Clutter.EVENT_STOP;
            }
            if (!emptyQuery || this._token) {
                this._entry.set_text('');
                this._setToken(null);
                this._setEngaged(false);
                return Clutter.EVENT_STOP;
            }
            this.menu.close();
            return Clutter.EVENT_STOP;
        }

        if (ctrl) {
            const e = this._entries[this._selected];
            switch (sym) {
            case Clutter.KEY_p:
            case Clutter.KEY_P:
                if (e)
                    this._store.togglePin(e);
                return Clutter.EVENT_STOP;
            case Clutter.KEY_e:
            case Clutter.KEY_E:
                this._editSelected('edit');
                return Clutter.EVENT_STOP;
            case Clutter.KEY_t:
            case Clutter.KEY_T:
                this._editSelected('tag');
                return Clutter.EVENT_STOP;
            case Clutter.KEY_f:
            case Clutter.KEY_F:
                this._setEngaged(true);
                return Clutter.EVENT_STOP;
            }
            if (sym >= Clutter.KEY_1 && sym <= Clutter.KEY_9) {
                this._activate(sym - Clutter.KEY_1);
                return Clutter.EVENT_STOP;
            }
        }
        return Clutter.EVENT_PROPAGATE;
    }

    // ---------------------------------------------------------------- cleanup

    _onDestroy() {
        for (const id of this._timeouts)
            GLib.source_remove(id);
        this._timeouts.clear();
        this._previewTimeout = 0;
        this._disconnectKeys?.();
        this._sounds.destroy();
        this._sounds = null;
        this._store.disconnectChanged(this._storeChangedId);
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        if (this._accentId)
            this._interface.disconnect(this._accentId);
        this._interface = null;
        this._preview.destroy();
        this._preview = null;
        super._onDestroy();
    }
});
