// Clipboard+ preferences (GTK 4 / libadwaita).

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const LAYOUTS = [
    ['default', () => _('Default'), () => _('Calm single-line list')],
    ['spotlight', () => _('Spotlight'), () => _('Source app and time')],
    ['cards', () => _('Cards'), () => _('Large visual previews')],
    ['compact', () => _('Compact'), () => _('Most entries, least space')],
];

const CLEAR_INTERVALS = [
    [0, () => _('Never')],
    [30, () => _('Every 30 minutes')],
    [60, () => _('Every hour')],
    [360, () => _('Every 6 hours')],
    [1440, () => _('Every day')],
    [10080, () => _('Every week')],
];

const SHORTCUTS = [
    ['toggle-menu', () => _('Open clipboard')],
    ['next-entry', () => _('Copy older entry')],
    ['prev-entry', () => _('Copy newer entry')],
    ['clear-history', () => _('Clear history')],
    ['toggle-private-mode', () => _('Toggle Private Mode')],
];

export default class ClipboardPlusPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(680, 760);
        window.search_enabled = true;
        window._settings = settings;

        window.add(this._generalPage(settings));
        window.add(this._appearancePage(settings));
        window.add(this._privacyPage(settings, window));
        window.add(this._shortcutsPage(settings, window));
        window.add(this._aboutPage());
    }

    // ------------------------------------------------------------ helpers

    _switch(settings, key, title, subtitle = '') {
        const row = new Adw.SwitchRow({title, subtitle});
        settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _spin(settings, key, title, subtitle, lower, upper, step) {
        const row = new Adw.SpinRow({
            title,
            subtitle,
            adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 10}),
        });
        settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    // ------------------------------------------------------------ pages

    _generalPage(settings) {
        const page = new Adw.PreferencesPage({title: _('General'), icon_name: 'preferences-system-symbolic'});

        const behavior = new Adw.PreferencesGroup({title: _('Behavior')});
        behavior.add(this._switch(settings, 'paste-on-select', _('Paste on Select'),
            _('Paste into the active window after choosing an entry')));
        behavior.add(this._switch(settings, 'move-to-top', _('Move Used Entries to Top')));
        behavior.add(this._switch(settings, 'strip-whitespace', _('Trim Whitespace'),
            _('Remove spaces and line breaks around copied text')));
        behavior.add(this._spin(settings, 'history-size', _('History Size'),
            _('Pinned entries do not count'), 5, 500, 5));
        page.add(behavior);

        const feedback = new Adw.PreferencesGroup({title: _('Feedback')});
        feedback.add(this._switch(settings, 'blink-icon', _('Animate Panel Icon'),
            _('A short pulse when something is copied')));
        feedback.add(this._switch(settings, 'notify-on-copy', _('Notification on Copy')));
        page.add(feedback);

        const search = new Adw.PreferencesGroup({title: _('Search')});
        search.add(this._switch(settings, 'case-sensitive-search', _('Case Sensitive')));
        search.add(this._switch(settings, 'regex-search', _('Regular Expressions')));
        page.add(search);
        return page;
    }

    _appearancePage(settings) {
        const page = new Adw.PreferencesPage({title: _('Appearance'), icon_name: 'applications-graphics-symbolic'});

        const layoutGroup = new Adw.PreferencesGroup({
            title: _('Layout'),
            description: _('How the clipboard popup looks'),
        });
        const grid = new Gtk.Grid({column_spacing: 12, row_spacing: 12, column_homogeneous: true, margin_top: 6});
        let group = null;
        const buttons = {};
        LAYOUTS.forEach(([id, title, subtitle], i) => {
            const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8});
            const pic = Gtk.Picture.new_for_filename(GLib.build_filenamev([this.path, 'media', `layout-${id}.png`]));
            pic.content_fit = Gtk.ContentFit.COVER;
            pic.height_request = 170;
            pic.add_css_class('card');
            pic.overflow = Gtk.Overflow.HIDDEN;
            box.append(pic);
            const label = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2});
            const t = new Gtk.Label({label: title(), xalign: 0});
            t.add_css_class('heading');
            const s = new Gtk.Label({label: subtitle(), xalign: 0});
            s.add_css_class('dim-label');
            s.add_css_class('caption');
            label.append(t);
            label.append(s);
            const head = new Gtk.Box({spacing: 8});
            const check = new Gtk.CheckButton({valign: Gtk.Align.CENTER});
            if (group)
                check.set_group(group);
            else
                group = check;
            head.append(check);
            head.append(label);
            box.append(head);

            const button = new Gtk.Button({child: box, has_frame: false});
            button.add_css_class('flat');
            button.connect('clicked', () => settings.set_string('layout', id));
            check.connect('toggled', () => {
                if (check.active)
                    settings.set_string('layout', id);
            });
            buttons[id] = check;
            grid.attach(button, i % 2, Math.floor(i / 2), 1, 1);
        });
        const sync = () => {
            const id = settings.get_string('layout');
            if (buttons[id] && !buttons[id].active)
                buttons[id].active = true;
        };
        settings.connect('changed::layout', sync);
        sync();
        layoutGroup.add(grid);
        page.add(layoutGroup);

        const details = new Adw.PreferencesGroup({title: _('Details')});
        details.add(this._switch(settings, 'show-time', _('Show Time'),
            _('How long ago each entry was copied')));
        page.add(details);

        const preview = new Adw.PreferencesGroup({
            title: _('Preview Card'),
            description: _('A large preview of the selected entry next to the popup'),
        });
        preview.add(this._switch(settings, 'show-preview', _('Show Preview Card')));
        const p1 = this._spin(settings, 'preview-delay-pointer', _('Delay with Mouse'), _('Milliseconds'), 0, 2000, 50);
        const p2 = this._spin(settings, 'preview-delay-keyboard', _('Delay with Arrow Keys'), _('Milliseconds'), 0, 2000, 50);
        settings.bind('show-preview', p1, 'sensitive', Gio.SettingsBindFlags.GET);
        settings.bind('show-preview', p2, 'sensitive', Gio.SettingsBindFlags.GET);
        preview.add(p1);
        preview.add(p2);
        page.add(preview);
        return page;
    }

    _privacyPage(settings, window) {
        const page = new Adw.PreferencesPage({title: _('Privacy'), icon_name: 'channel-secure-symbolic'});

        const priv = new Adw.PreferencesGroup({title: _('Privacy')});
        priv.add(this._switch(settings, 'private-mode', _('Private Mode'),
            _('Nothing is recorded while this is on')));
        page.add(priv);

        // Excluded apps
        const addButton = new Gtk.Button({
            icon_name: 'list-add-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Add Application'),
        });
        addButton.add_css_class('flat');
        const excluded = new Adw.PreferencesGroup({
            title: _('Excluded Applications'),
            description: _('Copies made in these apps are never recorded. Password managers are excluded by default.'),
            header_suffix: addButton,
        });
        page.add(excluded);
        let rows = [];
        const apps = Gio.AppInfo.get_all();
        const rebuild = () => {
            for (const r of rows)
                excluded.remove(r);
            rows = [];
            const ids = settings.get_strv('excluded-apps');
            for (const id of ids) {
                const info = apps.find(a => a.get_id() === `${id}.desktop`) ?? null;
                const row = new Adw.ActionRow({
                    title: GLib.markup_escape_text(info?.get_name() ?? id, -1),
                    subtitle: info ? GLib.markup_escape_text(id, -1) : '',
                });
                const icon = new Gtk.Image({gicon: info?.get_icon() ?? new Gio.ThemedIcon({name: 'application-x-executable-symbolic'}), pixel_size: 32});
                row.add_prefix(icon);
                const remove = new Gtk.Button({icon_name: 'user-trash-symbolic', valign: Gtk.Align.CENTER, tooltip_text: _('Remove')});
                remove.add_css_class('flat');
                remove.connect('clicked', () =>
                    settings.set_strv('excluded-apps', settings.get_strv('excluded-apps').filter(x => x !== id)));
                row.add_suffix(remove);
                excluded.add(row);
                rows.push(row);
            }
            if (!ids.length) {
                const row = new Adw.ActionRow({title: _('No excluded applications')});
                row.add_css_class('dim-label');
                excluded.add(row);
                rows.push(row);
            }
        };
        settings.connect('changed::excluded-apps', rebuild);
        rebuild();
        addButton.connect('clicked', () => this._chooseApp(window, id => {
            const list = settings.get_strv('excluded-apps');
            if (!list.includes(id))
                settings.set_strv('excluded-apps', [...list, id]);
        }));

        const storage = new Adw.PreferencesGroup({title: _('Storage')});
        storage.add(this._switch(settings, 'cache-history', _('Remember History'),
            _('Keep entries after logging out or restarting')));
        const pinnedOnly = this._switch(settings, 'cache-pinned-only', _('Remember Only Pinned Entries'));
        settings.bind('cache-history', pinnedOnly, 'sensitive', Gio.SettingsBindFlags.GET);
        storage.add(pinnedOnly);
        storage.add(this._switch(settings, 'cache-images', _('Record Images')));
        const imgSize = this._spin(settings, 'max-image-size', _('Largest Image'), _('Megabytes'), 1, 100, 1);
        settings.bind('cache-images', imgSize, 'sensitive', Gio.SettingsBindFlags.GET);
        storage.add(imgSize);
        page.add(storage);

        const cleanup = new Adw.PreferencesGroup({title: _('Automatic Cleanup'), description: _('Pinned entries are always kept')});
        cleanup.add(this._switch(settings, 'clear-on-boot', _('Clear After Restart')));
        const model = new Gtk.StringList();
        for (const [, label] of CLEAR_INTERVALS)
            model.append(label());
        const combo = new Adw.ComboRow({title: _('Clear History'), model});
        const syncCombo = () => {
            const v = settings.get_int('clear-interval');
            let i = CLEAR_INTERVALS.findIndex(([m]) => m === v);
            if (i < 0)
                i = 0;
            if (combo.selected !== i)
                combo.selected = i;
        };
        syncCombo();
        combo.connect('notify::selected', () => {
            const v = CLEAR_INTERVALS[combo.selected]?.[0] ?? 0;
            if (settings.get_int('clear-interval') !== v)
                settings.set_int('clear-interval', v);
        });
        settings.connect('changed::clear-interval', syncCombo);
        cleanup.add(combo);
        cleanup.add(this._switch(settings, 'confirm-clear', _('Ask Before Clearing')));
        page.add(cleanup);
        return page;
    }

    _chooseApp(window, onChosen) {
        const dialog = new Adw.Dialog({title: _('Add Application'), content_width: 420, content_height: 560});
        const view = new Adw.ToolbarView();
        view.add_top_bar(new Adw.HeaderBar());
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 12, margin_start: 12, margin_end: 12, margin_bottom: 12});
        const search = new Gtk.SearchEntry({placeholder_text: _('Search applications')});
        box.append(search);
        const list = new Gtk.ListBox({selection_mode: Gtk.SelectionMode.NONE});
        list.add_css_class('boxed-list');
        const apps = Gio.AppInfo.get_all()
            .filter(a => a.should_show() && a.get_id())
            .sort((a, b) => a.get_name().localeCompare(b.get_name()));
        for (const app of apps) {
            const row = new Adw.ActionRow({
                title: GLib.markup_escape_text(app.get_name(), -1),
                activatable: true,
            });
            row.add_prefix(new Gtk.Image({gicon: app.get_icon() ?? new Gio.ThemedIcon({name: 'application-x-executable-symbolic'}), pixel_size: 32}));
            row._name = app.get_name().toLowerCase();
            row.connect('activated', () => {
                onChosen(app.get_id().replace(/\.desktop$/, ''));
                dialog.close();
            });
            list.append(row);
        }
        list.set_filter_func(row => !search.text || row._name.includes(search.text.toLowerCase()));
        search.connect('search-changed', () => list.invalidate_filter());
        box.append(new Gtk.ScrolledWindow({child: list, vexpand: true, hscrollbar_policy: Gtk.PolicyType.NEVER}));
        view.set_content(box);
        dialog.set_child(view);
        dialog.present(window);
    }

    _shortcutsPage(settings, window) {
        const page = new Adw.PreferencesPage({title: _('Shortcuts'), icon_name: 'input-keyboard-symbolic'});

        const global = new Adw.PreferencesGroup({title: _('Global Shortcuts')});
        global.add(this._switch(settings, 'enable-keybindings', _('Enable Shortcuts')));
        for (const [key, title] of SHORTCUTS) {
            const row = new Adw.ActionRow({title: title(), activatable: true});
            const label = new Gtk.Label({valign: Gtk.Align.CENTER});
            label.add_css_class('dim-label');
            const update = () => {
                const accel = settings.get_strv(key)[0];
                let text = _('Disabled');
                if (accel) {
                    const [ok, keyval, mods] = Gtk.accelerator_parse(accel);
                    if (ok !== false && keyval)
                        text = Gtk.accelerator_get_label(keyval, mods);
                }
                label.label = text;
            };
            update();
            settings.connect(`changed::${key}`, update);
            row.add_suffix(label);
            row.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
            row.connect('activated', () => this._captureShortcut(window, title(), accel =>
                settings.set_strv(key, accel ? [accel] : [])));
            settings.bind('enable-keybindings', row, 'sensitive', Gio.SettingsBindFlags.GET);
            global.add(row);
        }
        page.add(global);

        const inside = new Adw.PreferencesGroup({title: _('Inside the Popup')});
        const keys = [
            ['↑ ↓', _('Move selection — the preview card follows')],
            ['Enter', _('Copy (and paste, if enabled)')],
            ['Ctrl+Enter', _('Open link or file')],
            [_('Type'), _('Search instantly')],
            ['Tab', _('Apply the suggested filter')],
            ['Space', _('Enlarge preview')],
            ['Ctrl+P', _('Pin / unpin')],
            ['Ctrl+E', _('Edit text')],
            ['Ctrl+T', _('Add a tag')],
            ['Delete', _('Delete entry')],
            ['Ctrl+1…9', _('Copy entry 1–9')],
            ['Esc', _('Clear search, then close')],
        ];
        for (const [k, desc] of keys) {
            const row = new Adw.ActionRow({title: desc});
            const l = new Gtk.Label({label: k, valign: Gtk.Align.CENTER});
            l.add_css_class('dim-label');
            l.add_css_class('monospace');
            row.add_suffix(l);
            inside.add(row);
        }
        page.add(inside);
        return page;
    }

    _captureShortcut(window, title, onDone) {
        const dialog = new Adw.Dialog({title, content_width: 420});
        const view = new Adw.ToolbarView();
        view.add_top_bar(new Adw.HeaderBar());
        const status = new Adw.StatusPage({
            icon_name: 'input-keyboard-symbolic',
            title: _('Press a Shortcut'),
            description: _('Esc to cancel · Backspace to disable'),
        });
        status.add_css_class('compact');
        view.set_content(status);
        dialog.set_child(view);

        const controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_c, keyval, keycode, state) => {
            const mods = state & Gtk.accelerator_get_default_mod_mask();
            const lower = Gdk.keyval_to_lower(keyval);
            if (!mods && lower === Gdk.KEY_Escape) {
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            if (!mods && lower === Gdk.KEY_BackSpace) {
                onDone(null);
                dialog.close();
                return Gdk.EVENT_STOP;
            }
            const isModifier = [Gdk.KEY_Shift_L, Gdk.KEY_Shift_R, Gdk.KEY_Control_L, Gdk.KEY_Control_R,
                Gdk.KEY_Alt_L, Gdk.KEY_Alt_R, Gdk.KEY_Super_L, Gdk.KEY_Super_R, Gdk.KEY_Meta_L,
                Gdk.KEY_Meta_R, Gdk.KEY_ISO_Level3_Shift].includes(keyval);
            const isFn = lower >= Gdk.KEY_F1 && lower <= Gdk.KEY_F12;
            if (isModifier || (!mods && !isFn) || !Gtk.accelerator_valid(lower, mods))
                return Gdk.EVENT_STOP;
            onDone(Gtk.accelerator_name_with_keycode(null, lower, keycode, mods));
            dialog.close();
            return Gdk.EVENT_STOP;
        });
        dialog.add_controller(controller);
        dialog.present(window);
    }

    _aboutPage() {
        const page = new Adw.PreferencesPage({title: _('About'), icon_name: 'help-about-symbolic'});
        const group = new Adw.PreferencesGroup();
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6, margin_top: 24, margin_bottom: 12, halign: Gtk.Align.CENTER});
        const icon = new Gtk.Image({
            gicon: Gio.icon_new_for_string(GLib.build_filenamev([this.path, 'icons', 'clipboard-plus-symbolic.svg'])),
            pixel_size: 72,
        });
        icon.add_css_class('accent');
        box.append(icon);
        const name = new Gtk.Label({label: 'Clipboard+', margin_top: 12});
        name.add_css_class('title-1');
        box.append(name);
        const version = this.metadata['version-name'] ?? String(this.metadata.version ?? '');
        const ver = new Gtk.Label({label: _('Version %s').replace('%s', version)});
        ver.add_css_class('dim-label');
        box.append(ver);
        const by = new Gtk.Label({label: _('Made by Dukha')});
        by.add_css_class('heading');
        by.margin_top = 6;
        box.append(by);
        group.add(box);
        page.add(group);

        const links = new Adw.PreferencesGroup();
        const url = this.metadata.url;
        for (const [title, link] of [[_('Website and Source Code'), url], [_('Report a Problem'), `${url}/issues`]]) {
            const row = new Adw.ActionRow({title, activatable: true});
            row.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
            row.connect('activated', () => new Gtk.UriLauncher({uri: link}).launch(row.get_root(), null, null));
            links.add(row);
        }
        page.add(links);

        const power = new Adw.PreferencesGroup({
            title: _('Battery Friendly'),
            description: _('Clipboard+ never polls. It only wakes up when the clipboard changes, builds its list only when you open it, and writes to disk at most once every two seconds.'),
        });
        page.add(power);
        return page;
    }
}
