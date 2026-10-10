// Event-driven clipboard watcher, clipboard setter and paste helper.
// No polling: we only react to Meta.Selection 'owner-changed'.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Kind} from './kinds.js';
import {getBackend} from './compat.js';

const CLIPBOARD = St.ClipboardType.CLIPBOARD;
const READ_DELAY_MS = 50;
const SELF_SET_WINDOW_MS = 600;
const PASTE_DELAY_MS = 120;

const SECRET_MIMES = ['x-kde-passwordManagerHint', 'application/x-kde-passwordManagerHint'];
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff'];
const TERMINAL_RE = /term|kitty|alacritty|ghostty|foot|wezterm|konsole|ptyxis|tilix|terminator|blackbox|guake|tilda|yakuake|rio|warp|contour|st-256/i;

export class ClipboardService {
    /**
     * @param {Gio.Settings} settings extension settings
     * @param {import('./history.js').HistoryStore} store history store
     */
    constructor(settings, store) {
        this._settings = settings;
        this._store = store;
        this._clipboard = St.Clipboard.get_default();
        this._readId = 0;
        this._pasteId = 0;
        this._selfSetTime = 0;
        this._selfSetHash = null;
        this._device = null;
        this._contentPurpose = Clutter.InputContentPurpose.NORMAL;
        this.onCopied = null;

        this._selection = global.display.get_selection();
        this._ownerChangedId = this._selection.connect('owner-changed', (_sel, type) => {
            if (type === Meta.SelectionType.SELECTION_CLIPBOARD)
                this._queueRead();
        });

        this._purposeId = Main.inputMethod.connect('notify::content-purpose', method => {
            this._contentPurpose = method.content_purpose;
        });
    }

    destroy() {
        if (this._ownerChangedId)
            this._selection.disconnect(this._ownerChangedId);
        this._ownerChangedId = 0;
        if (this._purposeId)
            Main.inputMethod.disconnect(this._purposeId);
        this._purposeId = 0;
        if (this._readId)
            GLib.source_remove(this._readId);
        this._readId = 0;
        if (this._pasteId)
            GLib.source_remove(this._pasteId);
        this._pasteId = 0;
        this._device = null;
        this.onCopied = null;
    }

    _queueRead() {
        // Apps often set the selection several times in a row; coalesce.
        if (this._readId)
            GLib.source_remove(this._readId);
        this._readId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, READ_DELAY_MS, () => {
            this._readId = 0;
            this._read();
            return GLib.SOURCE_REMOVE;
        });
    }

    _focusedApp() {
        const win = global.display.focus_window;
        const app = win ? Shell.WindowTracker.get_default().get_window_app(win) : null;
        return {
            name: app?.get_name() ?? win?.get_wm_class() ?? '',
            ids: [app?.get_id()?.replace(/\.desktop$/, ''), win?.get_wm_class(),
                win?.get_wm_class_instance(), app?.get_name()].filter(Boolean),
        };
    }

    _isExcluded(ids) {
        const excluded = this._settings.get_strv('excluded-apps').map(s => s.toLowerCase());
        return ids.some(id => excluded.includes(id.toLowerCase()));
    }

    _read() {
        if (this._settings.get_boolean('private-mode'))
            return;
        const app = this._focusedApp();
        if (this._isExcluded(app.ids))
            return;

        const mimes = this._clipboard.get_mimetypes(CLIPBOARD);
        if (!mimes.length || mimes.some(m => SECRET_MIMES.includes(m)))
            return;

        const fromSelf = Date.now() - this._selfSetTime < SELF_SET_WINDOW_MS;
        const hasText = mimes.some(m => m.startsWith('text/plain') || m === 'UTF8_STRING' ||
            m === 'STRING' || m === 'TEXT');
        const imageMime = IMAGE_MIMES.find(m => mimes.includes(m));

        if (!hasText && imageMime) {
            if (!this._settings.get_boolean('cache-images'))
                return;
            this._clipboard.get_content(CLIPBOARD, imageMime, (_c, bytes) => {
                if (!bytes || this._settings.get_boolean('private-mode'))
                    return;
                if (fromSelf && this._selfSetHash === GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA1, bytes))
                    return;
                this._store.addImage(bytes, imageMime, app.name, entry => {
                    if (entry)
                        this.onCopied?.(entry);
                });
            });
            return;
        }

        if (!hasText)
            return;
        this._clipboard.get_text(CLIPBOARD, (_c, text) => {
            if (!text || this._settings.get_boolean('private-mode'))
                return;
            if (fromSelf && this._selfSetHash === GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, text, -1))
                return;
            const entry = this._store.addText(text, app.name);
            if (entry)
                this.onCopied?.(entry);
        });
    }

    /**
     * Put an entry on the clipboard.
     *
     * @param {object} entry history entry
     * @param {Function} [done] called once the clipboard is set
     */
    setEntry(entry, done) {
        this._selfSetTime = Date.now();
        this._selfSetHash = entry.hash;
        if (entry.kind === Kind.IMAGE) {
            this._store.readImage(entry, bytes => {
                if (!bytes)
                    return;
                this._selfSetTime = Date.now();
                this._clipboard.set_content(CLIPBOARD, entry.mime ?? 'image/png', bytes);
                done?.();
            });
            return;
        }
        this._clipboard.set_text(CLIPBOARD, entry.text);
        done?.();
    }

    /** Simulate the paste shortcut in the focused window. */
    paste() {
        if (this._pasteId)
            GLib.source_remove(this._pasteId);
        // Give the popup time to close and focus to return to the window.
        this._pasteId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, PASTE_DELAY_MS, () => {
            this._pasteId = 0;
            this._sendPaste();
            return GLib.SOURCE_REMOVE;
        });
    }

    _sendPaste() {
        if (!this._device) {
            const seat = getBackend().get_default_seat();
            this._device = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        }
        const wmClass = global.display.focus_window?.get_wm_class() ?? '';
        const terminal = this._contentPurpose === Clutter.InputContentPurpose.TERMINAL ||
            TERMINAL_RE.test(wmClass);
        const keys = terminal
            ? [Clutter.KEY_Control_L, Clutter.KEY_Shift_L, Clutter.KEY_v]
            : [Clutter.KEY_Control_L, Clutter.KEY_v];
        const time = GLib.get_monotonic_time();
        for (const k of keys)
            this._device.notify_keyval(time, k, Clutter.KeyState.PRESSED);
        for (const k of keys.reverse())
            this._device.notify_keyval(time, k, Clutter.KeyState.RELEASED);
    }
}
