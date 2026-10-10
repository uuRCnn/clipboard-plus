// Small helpers that hide API differences between GNOME Shell 46 and 51.

import Clutter from 'gi://Clutter';
import St from 'gi://St';

/**
 * Create a vertical St.BoxLayout. `vertical` was removed in GNOME 51,
 * `orientation` only exists since GNOME 48.
 *
 * @param {object} params St.BoxLayout construct params
 * @returns {St.BoxLayout}
 */
export function vbox(params = {}) {
    const box = new St.BoxLayout(params);
    if ('orientation' in box)
        box.orientation = Clutter.Orientation.VERTICAL;
    else
        box.vertical = true;
    return box;
}

/**
 * Connect a key-press handler. Uses Clutter.KeyController where available
 * (GNOME 50+), falling back to the legacy `key-press-event` signal.
 *
 * The handler receives (symbol, modifierState) and returns
 * Clutter.EVENT_STOP or Clutter.EVENT_PROPAGATE.
 *
 * @param {Clutter.Actor} actor actor receiving key events
 * @param {Function} handler (symbol, state) => boolean
 * @returns {Function} disconnect function
 */
export function onKeyPress(actor, handler) {
    if (Clutter.KeyController) {
        const controller = new Clutter.KeyController();
        controller.connect('key-press', () => {
            const [, symbol] = controller.get_key();
            const [, pressed, latched, locked] = controller.get_state();
            return handler(symbol, pressed | latched | locked);
        });
        if (actor.add_action_full)
            actor.add_action_full('clipboard-plus-keys', Clutter.EventPhase.CAPTURE, controller);
        else
            actor.add_action(controller);
        return () => actor.remove_action(controller);
    }

    const id = actor.connect('key-press-event', (_a, event) =>
        handler(event.get_key_symbol(), event.get_state()));
    return () => actor.disconnect(id);
}

/** @returns {Clutter.Backend} */
export function getBackend() {
    if (global.stage?.context?.get_backend)
        return global.stage.context.get_backend();
    return Clutter.get_default_backend();
}

/** @returns {boolean} whether animations should be used */
export function animationsEnabled() {
    const settings = St.Settings.get();
    if (!settings.enable_animations)
        return false;
    if (St.ReducedMotion && settings.reducedMotion === St.ReducedMotion.REDUCE)
        return false;
    return true;
}

/**
 * Arguments for PopupMenu.open() / close() that skip the animation.
 * GNOME 51 takes `{animate}`, older versions a BoxPointer.PopupAnimation.
 *
 * @param {PopupMenu.PopupMenu} menu the menu
 * @returns {object|number}
 */
export function noPopupAnimation(menu) {
    return menu._getPopupAnimationFromParams ? {animate: false} : 0;
}

/**
 * Scroll `scrollView` so that `actor` is visible.
 *
 * @param {St.ScrollView} scrollView the scroll view
 * @param {Clutter.Actor} actor a descendant of the scroll view
 */
export function scrollToActor(scrollView, actor) {
    const adjustment = scrollView.vadjustment ?? scrollView.vscroll?.adjustment;
    if (!adjustment)
        return;
    const [current, , upper, , , pageSize] = adjustment.get_values();
    let value = current;

    let box = actor.get_allocation_box();
    let y1 = box.y1, y2 = box.y2;
    let parent = actor.get_parent();
    while (parent && parent !== scrollView) {
        box = parent.get_allocation_box();
        y1 += box.y1;
        y2 += box.y1;
        parent = parent.get_parent();
    }
    if (!parent)
        return;

    const margin = 6;
    if (y1 < value + margin)
        value = Math.max(0, y1 - margin);
    else if (y2 > value + pageSize - margin)
        value = Math.min(upper, y2 + margin - pageSize);
    else
        return;

    adjustment.set_value(value);
}
