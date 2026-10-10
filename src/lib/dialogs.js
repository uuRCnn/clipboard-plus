// Modal dialogs: edit text / tag, confirmation.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Dialog from 'resource:///org/gnome/shell/ui/dialog.js';
import * as ModalDialog from 'resource:///org/gnome/shell/ui/modalDialog.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

export const EditDialog = GObject.registerClass(
class EditDialog extends ModalDialog.ModalDialog {
    /**
     * @param {'edit'|'tag'} mode what is edited
     * @param {string} initial initial value
     * @param {Function} onSave called with the new value
     */
    _init(mode, initial, onSave) {
        super._init({styleClass: 'cbp-dialog'});
        this._onSave = onSave;
        const multi = mode === 'edit';

        const content = new Dialog.MessageDialogContent({
            title: multi ? _('Edit Entry') : _('Tag Entry'),
            description: multi ? '' : _('A short label that is shown in the list and can be searched.'),
        });
        this.contentLayout.add_child(content);

        this._entry = new St.Entry({
            style_class: `cbp-dialog-entry${multi ? ' multi' : ''}`,
            text: initial,
            hint_text: multi ? '' : _('e.g. Work, Address, Token'),
            can_focus: true,
            x_expand: true,
        });
        const text = this._entry.clutter_text;
        if (multi) {
            text.single_line_mode = false;
            text.activatable = false;
            text.line_wrap = true;
            text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        } else {
            text.connect('activate', () => this._save());
        }
        this.contentLayout.add_child(this._entry);
        this.setInitialKeyFocus(text);

        this.addButton({label: _('Cancel'), action: () => this.close(), key: Clutter.KEY_Escape});
        this.addButton({label: _('Save'), action: () => this._save(), default: true});
    }

    _save() {
        this._onSave(this._entry.get_text());
        this.close();
    }
});

export const ConfirmDialog = GObject.registerClass(
class ConfirmDialog extends ModalDialog.ModalDialog {
    _init(title, description, confirmLabel, onConfirm) {
        super._init({styleClass: 'cbp-dialog'});
        this.contentLayout.add_child(new Dialog.MessageDialogContent({title, description}));
        this.addButton({label: _('Cancel'), action: () => this.close(), key: Clutter.KEY_Escape});
        this.addButton({
            label: confirmLabel,
            action: () => {
                onConfirm();
                this.close();
            },
            default: true,
        });
    }
});
