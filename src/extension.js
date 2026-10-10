// Clipboard+ — a minimal clipboard manager for GNOME Shell.
// Made by Dukha.

import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {HistoryStore} from './lib/history.js';
import {ClipboardService} from './lib/clipboard.js';
import {ClipboardButton} from './lib/popup.js';
import {entryTitle} from './lib/util.js';

// Keybinding names are global across all extensions, so ours carry a
// prefix; Clipboard Indicator, for example, also registers "toggle-menu".
const KEYBINDINGS = [
    'clipboard-plus-toggle-menu',
    'clipboard-plus-next-entry',
    'clipboard-plus-prev-entry',
    'clipboard-plus-clear-history',
    'clipboard-plus-toggle-private-mode',
];

export default class ClipboardPlusExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._store = new HistoryStore(this._settings);
        this._service = new ClipboardService(this._settings, this._store);
        this._button = new ClipboardButton(this, this._settings, this._store, this._service);
        Main.panel.addToStatusArea(this.uuid, this._button);

        this._service.onCopied = entry => {
            this._cycleIndex = 0;
            this._button.pulse();
            if (this._settings.get_boolean('notify-on-copy'))
                Main.notify(_('Copied'), entryTitle(entry));
        };

        this._cycleIndex = 0;
        this._clearTimerId = 0;
        this._settingsIds = [
            this._settings.connect('changed::enable-keybindings', () => this._updateKeybindings()),
            this._settings.connect('changed::history-size', () => this._store.trim()),
            this._settings.connect('changed::clear-interval', () => {
                this._settings.set_int64('next-clear-time', 0);
                this._scheduleClear();
            }),
            this._settings.connect('changed::cache-history', () => this._store.trim()),
            this._settings.connect('changed::cache-pinned-only', () => this._store.trim()),
        ];

        this._store.load(() => {
            this._clearOnBoot();
            this._scheduleClear();
        });
        this._keybindings = [];
        this._updateKeybindings();
    }

    disable() {
        this._removeKeybindings();
        if (this._clearTimerId)
            GLib.source_remove(this._clearTimerId);
        this._clearTimerId = 0;
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = null;

        this._button.destroy();
        this._button = null;
        this._service.destroy();
        this._service = null;
        this._store.destroy();
        this._store = null;
        this._settings = null;
    }

    // ---- keybindings ----

    _updateKeybindings() {
        this._removeKeybindings();
        if (!this._settings.get_boolean('enable-keybindings'))
            return;
        const handlers = {
            'clipboard-plus-toggle-menu': () => this._button.toggleFromShortcut(),
            'clipboard-plus-next-entry': () => this._cycle(1),
            'clipboard-plus-prev-entry': () => this._cycle(-1),
            'clipboard-plus-clear-history': () => this._button.clearHistory(),
            'clipboard-plus-toggle-private-mode': () => this._settings.set_boolean('private-mode',
                !this._settings.get_boolean('private-mode')),
        };
        for (const name of KEYBINDINGS) {
            const action = Main.wm.addKeybinding(name, this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP,
                handlers[name]);
            if (action !== Meta.KeyBindingAction.NONE)
                this._keybindings.push(name);
            else
                console.warn(`Clipboard+: could not register the shortcut "${name}"`);
        }
    }

    _removeKeybindings() {
        // Only remove what we added: never another extension's binding.
        for (const name of this._keybindings)
            Main.wm.removeKeybinding(name);
        this._keybindings = [];
    }

    /** Copy the next / previous history entry without opening the popup. */
    _cycle(delta) {
        const items = this._store.items;
        if (!items.length)
            return;
        this._cycleIndex = Math.max(0, Math.min(items.length - 1, this._cycleIndex + delta));
        const entry = items[this._cycleIndex];
        this._service.setEntry(entry);
        if (this._settings.get_boolean('notify-on-copy'))
            Main.notify(_('Clipboard'), entryTitle(entry));
    }

    // ---- automatic clearing ----

    _clearOnBoot() {
        let bootId = '';
        try {
            const [ok, contents] = GLib.file_get_contents('/proc/sys/kernel/random/boot_id');
            if (ok)
                bootId = new TextDecoder().decode(contents).trim();
        } catch {}
        if (!bootId)
            return;
        const last = this._settings.get_string('last-boot-id');
        if (last !== bootId) {
            if (last && this._settings.get_boolean('clear-on-boot'))
                this._store.clear(true);
            this._settings.set_string('last-boot-id', bootId);
        }
    }

    _scheduleClear() {
        if (this._clearTimerId)
            GLib.source_remove(this._clearTimerId);
        this._clearTimerId = 0;

        const minutes = this._settings.get_int('clear-interval');
        if (minutes <= 0)
            return;
        const now = Math.floor(Date.now() / 1000);
        let next = this._settings.get_int64('next-clear-time');
        if (next <= 0) {
            next = now + minutes * 60;
            this._settings.set_int64('next-clear-time', next);
        }
        // A single one-shot timer; nothing runs in between.
        const wait = Math.max(1, next - now);
        this._clearTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, wait, () => {
            this._clearTimerId = 0;
            this._store.clear(true);
            this._settings.set_int64('next-clear-time', Math.floor(Date.now() / 1000) + minutes * 60);
            this._scheduleClear();
            return GLib.SOURCE_REMOVE;
        });
    }
}
