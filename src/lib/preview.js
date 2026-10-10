// The large preview card shown next to the popup for the selected entry.

import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Kind, formatSize, parseColor, rgbToHex, rgbToHslString, splitUrl} from './kinds.js';
import {KIND_ICON, makeIcon, relativeTime} from './util.js';
import {animationsEnabled, vbox} from './compat.js';

const GAP = 12;
const MARGIN = 12;
const FADE_MS = 120;

export class PreviewCard {
    constructor(store, path) {
        this._store = store;
        this._path = path;
        this._entry = null;
        this._menuBox = null;
        this._row = null;
        this.large = false;

        this._actor = vbox({style_class: 'cbp-preview', reactive: false, visible: false});
        Main.layoutManager.uiGroup.add_child(this._actor);
    }

    get visible() {
        return this._actor.visible;
    }

    setAccent(accent) {
        for (const c of this._actor.get_style_class_name()?.split(' ') ?? []) {
            if (c.startsWith('cbp-accent-'))
                this._actor.remove_style_class_name(c);
        }
        this._actor.add_style_class_name(`cbp-accent-${accent}`);
    }

    /**
     * @param {object} entry history entry
     * @param {Clutter.Actor} menuBox the popup content box
     * @param {Clutter.Actor} row the row of the entry
     */
    show(entry, menuBox, row) {
        const wasVisible = this._actor.visible;
        this._entry = entry;
        this._menuBox = menuBox;
        this._row = row;
        this._build();
        this._position();

        Main.layoutManager.uiGroup.set_child_above_sibling(this._actor, null);
        if (!wasVisible) {
            this._actor.opacity = animationsEnabled() ? 0 : 255;
            this._actor.show();
            if (animationsEnabled()) {
                this._actor.ease({
                    opacity: 255,
                    duration: FADE_MS,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        }
    }

    hide() {
        this.large = false;
        this._entry = null;
        this._row = null;
        this._actor.remove_all_transitions();
        this._actor.hide();
        this._actor.destroy_all_children();
    }

    toggleLarge() {
        if (!this._entry)
            return;
        this.large = !this.large;
        this._build();
        this._position();
    }

    destroy() {
        this._actor.destroy();
        this._actor = null;
    }

    // ------------------------------------------------------------------

    _monitor() {
        const m = this._menuBox ? Main.layoutManager.findMonitorForActor(this._menuBox) : null;
        return m ?? Main.layoutManager.primaryMonitor;
    }

    _width() {
        const e = this._entry;
        const mon = this._monitor();
        if (e.kind === Kind.IMAGE)
            return this._imageSize()[0] + 24;
        if (!this.large)
            return 400;
        return Math.min(640, Math.round(mon.width * 0.6));
    }

    /** @returns {number[]} [width, height] of the image area */
    _imageSize() {
        const e = this._entry;
        const mon = this._monitor();
        const ratio = e.width && e.height ? e.height / e.width : 10 / 16;
        let maxW, maxH;
        if (this.large) {
            // Never upscale beyond the image's own size.
            maxW = Math.min(Math.round(mon.width * 0.7), 1100, e.width || 1100);
            maxH = Math.round(mon.height * 0.75);
        } else {
            maxW = 416;
            maxH = 380;
        }
        let w = maxW, h = Math.round(maxW * ratio);
        if (h > maxH) {
            h = maxH;
            w = Math.round(h / ratio);
        }
        // Keep the card wide enough for its caption.
        return [Math.max(w, this.large ? 320 : 280), h];
    }

    _build() {
        const e = this._entry;
        const a = this._actor;
        a.destroy_all_children();
        a.set_width(this._width());
        a.remove_style_class_name('large');
        if (this.large)
            a.add_style_class_name('large');

        switch (e.kind) {
        case Kind.IMAGE:
            this._buildImage(e);
            break;
        case Kind.COLOR:
            this._buildColor(e);
            break;
        case Kind.LINK:
            this._buildLink(e);
            break;
        default:
            this._buildText(e);
        }
    }

    _meta(parts, hint) {
        const box = new St.BoxLayout({style_class: 'cbp-preview-meta', x_expand: true});
        box.add_child(new St.Label({
            text: parts.filter(Boolean).join('  ·  '),
            style_class: 'cbp-preview-meta-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        if (hint) {
            box.add_child(new St.Label({
                text: hint,
                style_class: 'cbp-preview-hint',
                y_align: Clutter.ActorAlign.CENTER,
            }));
        }
        return box;
    }

    _when(e) {
        const t = relativeTime(e.time);
        return t === _('now') ? t : _('%s ago').format(t);
    }

    _enlargeHint() {
        return this.large ? _('Esc  Close') : _('Space  Enlarge');
    }

    _buildImage(e) {
        const [iw, ih] = this._imageSize();
        const img = new St.Widget({
            style_class: 'cbp-preview-image',
            width: iw,
            height: ih,
            x_align: Clutter.ActorAlign.CENTER,
        });
        const path = this._store.imagePath(e, 'preview') ?? this._store.imagePath(e);
        img.set_style(`background-image: url("${path}");`);
        this._actor.add_child(img);

        const head = new St.BoxLayout({style_class: 'cbp-preview-head', x_expand: true});
        head.add_child(new St.Label({text: e.tag || _('Image'), style_class: 'cbp-preview-title', x_expand: true}));
        head.add_child(new St.Label({text: this._enlargeHint(), style_class: 'cbp-preview-hint', y_align: Clutter.ActorAlign.CENTER}));
        this._actor.add_child(head);
        this._actor.add_child(this._meta([
            e.width ? `${e.width} × ${e.height}` : null,
            e.size ? formatSize(e.size) : null,
            e.app,
            this._when(e),
        ]));
    }

    _buildText(e) {
        const maxLines = this.large ? 40 : 14;
        const maxChars = this.large ? 5000 : 1200;
        const all = e.text.replace(/\t/g, '    ');
        let lines = all.split('\n');
        let truncated = false;
        if (lines.length > maxLines) {
            lines = lines.slice(0, maxLines);
            truncated = true;
        }
        let shown = lines.join('\n');
        if (shown.length > maxChars) {
            shown = shown.slice(0, maxChars);
            truncated = true;
        }
        if (truncated)
            shown = `${shown.trimEnd()} …`;

        if (e.kind === Kind.FILE) {
            shown = shown.split('\n').map(l => {
                let p = l.trim().replace(/^file:\/\//, '');
                try {
                    p = decodeURIComponent(p);
                } catch {}
                return p;
            }).join('\n');
        }

        const label = new St.Label({
            text: shown,
            style_class: `cbp-preview-text${e.kind === Kind.CODE ? ' mono' : ''}`,
            x_expand: true,
        });
        label.clutter_text.line_wrap = true;
        label.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._actor.add_child(label);

        this._actor.add_child(new St.Widget({style_class: 'cbp-preview-sep', x_expand: true}));
        const lineCount = all.split('\n').length;
        const parts = [e.tag, e.app, this._when(e)];
        if (e.kind === Kind.FILE) {
            parts.push(ngettext('%d item', '%d items', lineCount).format(lineCount));
        } else {
            parts.push(ngettext('%d character', '%d characters', all.length).format(all.length));
            if (lineCount > 1)
                parts.push(ngettext('%d line', '%d lines', lineCount).format(lineCount));
        }
        const hint = e.kind === Kind.FILE ? _('Ctrl+Enter  Open') : (truncated || this.large ? this._enlargeHint() : null);
        this._actor.add_child(this._meta(parts, hint));
    }

    _buildLink(e) {
        const url = e.text.trim();
        const {host} = splitUrl(url);
        const head = new St.BoxLayout({style_class: 'cbp-preview-link-head', x_expand: true});
        const badge = new St.Bin({style_class: 'cbp-preview-link-badge'});
        badge.set_child(new St.Icon({gicon: makeIcon(KIND_ICON[Kind.LINK], this._path), style_class: 'cbp-preview-link-icon'}));
        head.add_child(badge);
        const texts = vbox({x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        texts.add_child(new St.Label({text: host, style_class: 'cbp-preview-title'}));
        texts.add_child(new St.Label({text: e.tag || _('Link'), style_class: 'cbp-preview-sub'}));
        head.add_child(texts);
        this._actor.add_child(head);

        const label = new St.Label({text: url.length > 600 ? `${url.slice(0, 600)}…` : url, style_class: 'cbp-preview-url mono', x_expand: true});
        label.clutter_text.line_wrap = true;
        label.clutter_text.line_wrap_mode = Pango.WrapMode.CHAR;
        label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._actor.add_child(label);
        this._actor.add_child(this._meta([e.app, this._when(e)], _('Ctrl+Enter  Open')));
    }

    _buildColor(e) {
        const rgb = parseColor(e.text) ?? {r: 0, g: 0, b: 0};
        const hex = rgbToHex(rgb);
        const swatch = new St.Bin({style_class: 'cbp-preview-swatch', x_expand: true});
        swatch.set_style(`background-color: ${hex};`);
        const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
        swatch.set_child(new St.Label({
            text: e.text.trim(),
            style_class: `cbp-preview-swatch-label${lum > 0.6 ? ' dark' : ''}`,
            x_align: Clutter.ActorAlign.START,
            y_align: Clutter.ActorAlign.END,
            x_expand: true,
            y_expand: true,
        }));
        this._actor.add_child(swatch);

        const values = [['HEX', hex], ['RGB', `${rgb.r}, ${rgb.g}, ${rgb.b}`], ['HSL', rgbToHslString(rgb)]];
        for (const [k, v] of values) {
            const row = new St.BoxLayout({style_class: 'cbp-preview-color-row'});
            row.add_child(new St.Label({text: k, style_class: 'cbp-preview-color-key'}));
            row.add_child(new St.Label({text: v, style_class: 'cbp-preview-color-value mono'}));
            this._actor.add_child(row);
        }
        this._actor.add_child(this._meta([e.tag, e.app, this._when(e)]));
    }

    _position() {
        const a = this._actor;
        const mon = this._monitor();
        const width = this._width();
        const [, natH] = a.get_preferred_height(width);
        const height = Math.min(natH, mon.height - 2 * MARGIN);

        let x, y;
        if (this.large || !this._menuBox) {
            x = mon.x + Math.round((mon.width - width) / 2);
            y = mon.y + Math.round((mon.height - height) / 2);
        } else {
            const [mx, my] = this._menuBox.get_transformed_position();
            const [mw, mh] = this._menuBox.get_transformed_size();
            x = mx - GAP - width;
            if (x < mon.x + MARGIN)
                x = mx + mw + GAP;
            let center = my + mh / 2;
            if (this._row?.get_stage()) {
                const [, ry] = this._row.get_transformed_position();
                const [, rh] = this._row.get_transformed_size();
                center = ry + rh / 2;
            }
            y = Math.round(center - height / 2);
            y = Math.max(my, Math.min(y, my + mh - height));
            y = Math.max(mon.y + MARGIN, Math.min(y, mon.y + mon.height - MARGIN - height));
        }
        a.set_position(Math.round(x), Math.round(y));
    }
}
