// Shared UI helpers.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {gettext as _, ngettext} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Kind, oneLine} from './kinds.js';

export const KIND_ICON = {
    [Kind.TEXT]: 'format-justify-left-symbolic',
    [Kind.LINK]: 'link',
    [Kind.CODE]: 'code',
    [Kind.FILE]: 'folder-documents-symbolic',
    [Kind.IMAGE]: 'image-x-generic-symbolic',
    [Kind.COLOR]: 'color-select-symbolic',
};

/**
 * @param {string} name themed icon name, or one of our own icons
 * @param {string} path extension path
 * @returns {Gio.Icon}
 */
export function makeIcon(name, path) {
    if (name === 'code' || name === 'link')
        return Gio.icon_new_for_string(`${path}/icons/cbp-${name}-symbolic.svg`);
    if (name.startsWith('clipboard-plus'))
        return Gio.icon_new_for_string(`${path}/icons/${name}-symbolic.svg`);
    return new Gio.ThemedIcon({name});
}

/**
 * @param {number} time unix ms
 * @returns {string} short relative time
 */
export function relativeTime(time) {
    const secs = Math.max(0, (Date.now() - time) / 1000);
    if (secs < 60)
        return _('now');
    const mins = Math.floor(secs / 60);
    if (mins < 60)
        return ngettext('%d min', '%d min', mins).format(mins);
    const hours = Math.floor(mins / 60);
    if (hours < 24)
        return ngettext('%d h', '%d h', hours).format(hours);
    const days = Math.floor(hours / 24);
    if (days === 1)
        return _('yesterday');
    if (days < 7)
        return ngettext('%d day', '%d days', days).format(days);
    const dt = GLib.DateTime.new_from_unix_local(Math.floor(time / 1000));
    return dt.format('%e %b').trim();
}

/**
 * @param {object} entry history entry
 * @returns {string} single line title
 */
export function entryTitle(entry) {
    if (entry.kind === Kind.IMAGE) {
        return entry.width
            ? _('Image — %d × %d').format(entry.width, entry.height)
            : _('Image');
    }
    if (entry.kind === Kind.FILE) {
        const lines = entry.text.trim().split('\n');
        const first = lines[0].replace(/^file:\/\//, '');
        let shown;
        try {
            shown = decodeURIComponent(first);
        } catch {
            shown = first;
        }
        shown = shown.replace(GLib.get_home_dir(), '~');
        return lines.length > 1
            ? _('%s and %d more').format(shown, lines.length - 1)
            : shown;
    }
    return oneLine(entry.text, 160);
}

