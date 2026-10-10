// History store: in-memory list + debounced, asynchronous persistence.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';

import {Kind, detectKind} from './kinds.js';

const SAVE_DELAY_SECONDS = 2;
const MAX_TEXT_LENGTH = 1024 * 1024;
const FILE_VERSION = 1;
const THUMB = 96;
const PREVIEW_W = 1200;
const PREVIEW_H = 900;

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/**
 * @typedef {object} Entry
 * @property {number} id
 * @property {string} kind
 * @property {string} [text]
 * @property {string} [file]   image file name inside the images dir
 * @property {string} [thumb]  small square thumbnail file name
 * @property {string} [preview] preview-sized file name
 * @property {string} [mime]
 * @property {string} hash
 * @property {boolean} pinned
 * @property {string} [tag]
 * @property {string} [app]
 * @property {number} time     unix ms
 * @property {number} [width]
 * @property {number} [height]
 * @property {number} [size]
 */

export class HistoryStore {
    constructor(settings) {
        this._settings = settings;
        this._dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'clipboard-plus']);
        this._imageDir = GLib.build_filenamev([this._dir, 'images']);
        this._historyFile = GLib.build_filenamev([this._dir, 'history.json']);
        GLib.mkdir_with_parents(this._imageDir, 0o700);

        /** @type {Entry[]} newest first */
        this.items = [];
        this._nextId = 1;
        this._saveId = 0;
        this._listeners = new Set();
        this._cancellable = new Gio.Cancellable();
    }

    get imageDir() {
        return this._imageDir;
    }

    imagePath(entry, variant = 'file') {
        const name = entry[variant];
        return name ? GLib.build_filenamev([this._imageDir, name]) : null;
    }

    _filesOf(entry) {
        return [entry.file, entry.thumb, entry.preview].filter(Boolean);
    }

    /** @param {Function} fn called with no arguments when the list changes */
    connectChanged(fn) {
        this._listeners.add(fn);
        return fn;
    }

    disconnectChanged(fn) {
        this._listeners.delete(fn);
    }

    _emitChanged(save = true) {
        for (const fn of this._listeners)
            fn();
        if (save)
            this._queueSave();
    }

    // ---- loading / saving ----

    load(callback) {
        if (!this._settings.get_boolean('cache-history')) {
            this._deleteAllImages(new Set());
            callback?.();
            return;
        }
        const file = Gio.File.new_for_path(this._historyFile);
        file.load_contents_async(this._cancellable, (f, res) => {
            try {
                const [, contents] = f.load_contents_finish(res);
                const data = JSON.parse(decoder.decode(contents));
                if (data?.version === FILE_VERSION && Array.isArray(data.items)) {
                    const loaded = data.items.filter(e => e && e.hash &&
                        (e.kind !== Kind.IMAGE || GLib.file_test(this.imagePath(e), GLib.FileTest.EXISTS)));
                    // Keep anything copied while we were loading, on top.
                    const fresh = this.items;
                    this.items = [...fresh, ...loaded.filter(l => !fresh.some(f => f.hash === l.hash))];
                    this._nextId = loaded.reduce((m, e) => Math.max(m, e.id), 0) + 1;
                    for (const f of fresh)
                        f.id = this._nextId++;
                    this._trim();
                }
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND) &&
                    !e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.warn(`Clipboard+: could not read history: ${e.message}`);
            }
            if (this._cancellable.is_cancelled())
                return;
            this._deleteAllImages(new Set(this.items.flatMap(e => this._filesOf(e))));
            this._emitChanged(false);
            callback?.();
        });
    }

    _serialize() {
        let items = this.items;
        if (this._settings.get_boolean('cache-pinned-only'))
            items = items.filter(e => e.pinned);
        return encoder.encode(JSON.stringify({version: FILE_VERSION, items}));
    }

    _queueSave() {
        if (this._saveId)
            return;
        this._saveId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, SAVE_DELAY_SECONDS, () => {
            this._saveId = 0;
            this._save(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    _save(sync) {
        const file = Gio.File.new_for_path(this._historyFile);
        if (!this._settings.get_boolean('cache-history')) {
            file.delete_async(GLib.PRIORITY_LOW, null, (f, res) => {
                try {
                    f.delete_finish(res);
                } catch {}
            });
            return;
        }
        const bytes = this._serialize();
        if (sync) {
            try {
                file.replace_contents(bytes, null, false, Gio.FileCreateFlags.PRIVATE, null);
            } catch (e) {
                console.warn(`Clipboard+: could not save history: ${e.message}`);
            }
            return;
        }
        file.replace_contents_bytes_async(new GLib.Bytes(bytes), null, false,
            Gio.FileCreateFlags.PRIVATE, null, (f, res) => {
                try {
                    f.replace_contents_finish(res);
                } catch (e) {
                    console.warn(`Clipboard+: could not save history: ${e.message}`);
                }
            });
    }

    /** Write pending changes immediately and stop all I/O. */
    destroy() {
        this._cancellable.cancel();
        if (this._saveId) {
            GLib.source_remove(this._saveId);
            this._saveId = 0;
            this._save(true);
        }
        this._listeners.clear();
    }

    // ---- queries ----

    find(id) {
        return this.items.find(e => e.id === id) ?? null;
    }

    get pinned() {
        return this.items.filter(e => e.pinned);
    }

    get unpinned() {
        return this.items.filter(e => !e.pinned);
    }

    // ---- mutations ----

    /**
     * @param {string} text copied text
     * @param {string} app source application name
     * @returns {Entry|null}
     */
    addText(text, app) {
        if (this._settings.get_boolean('strip-whitespace'))
            text = text.trim();
        if (!text || !text.trim() || text.length > MAX_TEXT_LENGTH)
            return null;
        const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, text, -1);
        const existing = this.items.find(e => e.hash === hash);
        if (existing)
            return this._touch(existing, app);
        const entry = {
            id: this._nextId++,
            kind: detectKind(text),
            text,
            hash,
            pinned: false,
            app,
            time: Date.now(),
        };
        this.items.unshift(entry);
        this._trim();
        this._emitChanged();
        return entry;
    }

    /**
     * @param {GLib.Bytes} bytes image data
     * @param {string} mime mime type
     * @param {string} app source application name
     * @param {Function} callback called with the entry or null
     */
    addImage(bytes, mime, app, callback) {
        const size = bytes.get_size();
        if (!size || size > this._settings.get_int('max-image-size') * 1024 * 1024) {
            callback?.(null);
            return;
        }
        const hash = GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA1, bytes);
        const existing = this.items.find(e => e.hash === hash);
        if (existing) {
            callback?.(this._touch(existing, app));
            return;
        }
        const ext = mime.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'png';
        const name = `${hash}.${ext}`;
        const file = Gio.File.new_for_path(GLib.build_filenamev([this._imageDir, name]));
        file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.PRIVATE,
            this._cancellable, (f, res) => {
                try {
                    f.replace_contents_finish(res);
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`Clipboard+: could not store image: ${e.message}`);
                    callback?.(null);
                    return;
                }
                let width = 0, height = 0;
                try {
                    const [, w, h] = GdkPixbuf.Pixbuf.get_file_info(f.get_path());
                    width = w;
                    height = h;
                } catch {}
                if (this._cancellable.is_cancelled())
                    return;
                const entry = {
                    id: this._nextId++,
                    kind: Kind.IMAGE,
                    file: name,
                    mime,
                    hash,
                    pinned: false,
                    app,
                    time: Date.now(),
                    width,
                    height,
                    size,
                };
                this._makeThumbnails(entry, () => {
                    this.items.unshift(entry);
                    this._trim();
                    this._emitChanged();
                    callback?.(entry);
                });
            });
    }

    /**
     * Pre-scale an image once, so the popup never decodes full-size images:
     * a small square thumbnail (cover-cropped) and a preview (fit).
     *
     * @param {Entry} entry image entry
     * @param {Function} done called when finished (successful or not)
     */
    _makeThumbnails(entry, done) {
        const file = Gio.File.new_for_path(this.imagePath(entry));
        file.read_async(GLib.PRIORITY_LOW, this._cancellable, (f, res) => {
            let stream;
            try {
                stream = f.read_finish(res);
            } catch {
                done();
                return;
            }
            GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, PREVIEW_W, PREVIEW_H, true,
                this._cancellable, (_s, res2) => {
                    try {
                        const preview = GdkPixbuf.Pixbuf.new_from_stream_finish(res2);
                        stream.close(null);
                        const previewName = `${entry.hash}.preview.png`;
                        preview.savev(GLib.build_filenamev([this._imageDir, previewName]), 'png', [], []);
                        entry.preview = previewName;

                        const pw = preview.get_width(), ph = preview.get_height();
                        const scale = THUMB / Math.min(pw, ph);
                        const sw = Math.max(THUMB, Math.round(pw * scale));
                        const sh = Math.max(THUMB, Math.round(ph * scale));
                        const scaled = preview.scale_simple(sw, sh, GdkPixbuf.InterpType.BILINEAR);
                        const thumb = scaled.new_subpixbuf(
                            Math.floor((sw - THUMB) / 2), Math.floor((sh - THUMB) / 2), THUMB, THUMB);
                        const thumbName = `${entry.hash}.thumb.png`;
                        thumb.savev(GLib.build_filenamev([this._imageDir, thumbName]), 'png', [], []);
                        entry.thumb = thumbName;
                    } catch (e) {
                        if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                            console.warn(`Clipboard+: could not create thumbnail: ${e.message}`);
                    }
                    if (!this._cancellable.is_cancelled())
                        done();
                });
        });
    }

    _touch(entry, app) {
        if (this._settings.get_boolean('move-to-top')) {
            entry.time = Date.now();
            if (app)
                entry.app = app;
            this._moveFirst(entry);
            this._emitChanged();
        }
        return entry;
    }

    _moveFirst(entry) {
        const i = this.items.indexOf(entry);
        if (i > 0) {
            this.items.splice(i, 1);
            this.items.unshift(entry);
        }
    }

    /** Mark an entry as used (selected from the popup). */
    use(entry) {
        if (!this._settings.get_boolean('move-to-top'))
            return;
        entry.time = Date.now();
        this._moveFirst(entry);
        this._emitChanged();
    }

    togglePin(entry) {
        entry.pinned = !entry.pinned;
        this._trim();
        this._emitChanged();
    }

    setText(entry, text) {
        if (entry.kind === Kind.IMAGE || !text)
            return;
        entry.text = text;
        entry.kind = detectKind(text);
        entry.hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, text, -1);
        // Merge with an identical older entry
        const dup = this.items.find(e => e !== entry && e.hash === entry.hash);
        if (dup) {
            entry.pinned ||= dup.pinned;
            this._removeEntries([dup]);
        }
        this._emitChanged();
    }

    setTag(entry, tag) {
        entry.tag = tag?.trim() || undefined;
        this._emitChanged();
    }

    remove(entry) {
        this._removeEntries([entry]);
        this._emitChanged();
    }

    /** @param {boolean} keepPinned keep pinned entries */
    clear(keepPinned = true) {
        const gone = this.items.filter(e => !keepPinned || !e.pinned);
        if (!gone.length)
            return;
        this._removeEntries(gone);
        this._emitChanged();
    }

    _removeEntries(entries) {
        const set = new Set(entries);
        this.items = this.items.filter(e => !set.has(e));
        for (const e of entries) {
            if (e.file && !this.items.some(o => o.file === e.file)) {
                for (const name of this._filesOf(e))
                    this._deleteFile(GLib.build_filenamev([this._imageDir, name]));
            }
        }
    }

    _trim() {
        const max = this._settings.get_int('history-size');
        const unpinned = this.items.filter(e => !e.pinned);
        if (unpinned.length > max)
            this._removeEntries(unpinned.slice(max));
    }

    trim() {
        this._trim();
        this._emitChanged();
    }

    _deleteFile(path) {
        Gio.File.new_for_path(path).delete_async(GLib.PRIORITY_LOW, null, (f, res) => {
            try {
                f.delete_finish(res);
            } catch {}
        });
    }

    /** Remove image files that no entry references. */
    _deleteAllImages(keep) {
        const dir = Gio.File.new_for_path(this._imageDir);
        dir.enumerate_children_async('standard::name', Gio.FileQueryInfoFlags.NONE,
            GLib.PRIORITY_LOW, this._cancellable, (d, res) => {
                let enumerator;
                try {
                    enumerator = d.enumerate_children_finish(res);
                } catch {
                    return;
                }
                let info;
                while ((info = enumerator.next_file(null))) {
                    const name = info.get_name();
                    if (!keep.has(name))
                        this._deleteFile(GLib.build_filenamev([this._imageDir, name]));
                }
                enumerator.close(null);
            });
    }

    /**
     * Read an entry's image bytes asynchronously.
     *
     * @param {Entry} entry image entry
     * @param {Function} callback (GLib.Bytes|null) => void
     */
    readImage(entry, callback) {
        Gio.File.new_for_path(this.imagePath(entry)).load_bytes_async(this._cancellable, (f, res) => {
            try {
                const [bytes] = f.load_bytes_finish(res);
                callback(bytes);
            } catch {
                callback(null);
            }
        });
    }
}
