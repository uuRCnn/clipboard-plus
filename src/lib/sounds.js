// Short UI sound effects: opening the popup and choosing an entry.
//
// Meta's sound player follows the system-wide "event sounds" switch, which
// many people turn off; these sounds have their own switch in the
// preferences, so they are played with GStreamer. Players only exist while
// they are needed: they are created when the popup opens and released a few
// seconds after it closes, so nothing stays connected to the audio server
// in the background.
//
// The samples are pushed into the pipeline by hand, with the audio sink not
// syncing to the clock. With a synced sink, every stop and start of such
// short sounds lets the sound server's clock drift a little from the
// pipeline's; the sink then drops samples to catch up and the sounds get
// more and more broken the more they are played. Without the clock the
// sink cannot change the playback rate either, so the pitch is varied by
// resampling the samples here.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const Sound = {
    OPEN: 'open',
    SELECT: 'select',
};

const RATE = 48000;
const RELEASE_AFTER_SECONDS = 15;
// The audio server still holds the end of a sound when the last samples
// have been handed over; corking the stream right away cuts that tail off.
const CORK_AFTER_END_MS = 600;
// Each sound plays a little lower at random (up to 30 %), so repeated
// sounds never feel mechanical.
const MAX_PITCH_DROP = 0.3;
// Voices that can play at the same time, so a sound played again quickly
// overlaps the previous one instead of waiting or cutting it off.
const VOICES = 3;

let gstPromise = null;

/** @returns {Promise<object|null>} the Gst module, or null if unavailable */
function loadGst() {
    gstPromise ??= import('gi://Gst?version=1.0')
        .then(({default: Gst}) => {
            if (!Gst.is_initialized())
                Gst.init(null);
            return Gst;
        })
        .catch(e => {
            console.warn(`Clipboard+: GStreamer is not available, using the system sound player: ${e.message}`);
            return null;
        });
    return gstPromise;
}

/**
 * @param {string} path a 16-bit mono WAV file at RATE
 * @returns {Promise<Int16Array|null>} its samples
 */
function readWav(path) {
    return new Promise(resolve => {
        Gio.File.new_for_path(path).load_bytes_async(null, (file, res) => {
            try {
                resolve(parseWav(file.load_bytes_finish(res)[0].toArray()));
            } catch (e) {
                console.warn(`Clipboard+: could not read ${path}: ${e.message}`);
                resolve(null);
            }
        });
    });
}

/**
 * @param {Uint8Array} bytes contents of a 16-bit mono WAV file
 * @returns {Int16Array|null} its samples
 */
function parseWav(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // Walk the RIFF chunks to the "data" chunk.
    for (let pos = 12; pos + 8 <= bytes.length;) {
        const id = String.fromCharCode(...bytes.subarray(pos, pos + 4));
        const size = view.getUint32(pos + 4, true);
        if (id === 'data') {
            const n = Math.min(size, bytes.length - pos - 8) >> 1;
            const samples = new Int16Array(n);
            for (let i = 0; i < n; i++)
                samples[i] = view.getInt16(pos + 8 + 2 * i, true);
            return samples;
        }
        pos += 8 + size + (size & 1);
    }
    return null;
}

/**
 * Play the samples slower, which lowers the pitch.
 *
 * @param {Int16Array} samples source samples
 * @param {number} rate playback speed, at most 1
 * @returns {Uint8Array} 16-bit little-endian samples
 */
function resample(samples, rate) {
    const n = Math.floor((samples.length - 1) / rate);
    const out = new Int16Array(n);
    for (let i = 0; i < n; i++) {
        const x = i * rate;
        const j = Math.floor(x);
        const f = x - j;
        out[i] = Math.round(samples[j] * (1 - f) + samples[j + 1] * f);
    }
    return new Uint8Array(out.buffer);
}

export class SoundPlayer {
    /**
     * @param {Gio.Settings} settings extension settings
     * @param {string} dir directory with open.wav and select.wav
     */
    constructor(settings, dir) {
        this._settings = settings;
        this._dir = dir;
        this._samples = new Map();
        this._voices = [];
        this._releaseId = 0;
        this._held = false;
        this._destroyed = false;
    }

    get enabled() {
        return this._settings.get_boolean('enable-sounds') &&
            this._settings.get_int('sound-volume') > 0;
    }

    _file(name) {
        return GLib.build_filenamev([this._dir, `${name}.wav`]);
    }

    /**
     * Get the voices ready so the next sound starts without delay, and keep
     * them until done() is called.
     */
    prepare() {
        if (!this.enabled)
            return;
        this._held = true;
        this._cancelRelease();
        loadGst().then(Gst => {
            if (!Gst || this._destroyed)
                return;
            for (const name of Object.values(Sound))
                this._sound(name);
            this._createVoices(Gst);
        });
    }

    /** The voices may be released a few seconds after the last sound. */
    done() {
        this._held = false;
        if (this._voices.length)
            this._scheduleRelease();
    }

    /** @param {string} name one of Sound */
    play(name) {
        if (!this.enabled || !this._settings.get_boolean(`sound-${name}`))
            return;
        this._cancelRelease();
        Promise.all([loadGst(), this._sound(name)]).then(([Gst, samples]) => {
            if (this._destroyed)
                return;
            if (!Gst || !samples || !this._createVoices(Gst)) {
                this._playWithMeta(name);
                return;
            }
            const rate = 1 - Math.random() * MAX_PITCH_DROP;
            this._start(this._freeVoice(), resample(samples, rate));
        });
        if (!this._held)
            this._scheduleRelease();
    }

    /** @returns {Promise<Int16Array|null>} the samples of a sound, read once */
    _sound(name) {
        if (!this._samples.has(name))
            this._samples.set(name, readWav(this._file(name)));
        return this._samples.get(name);
    }

    /** @returns {boolean} whether the voices exist */
    _createVoices(Gst) {
        if (this._voices.length)
            return true;
        for (let i = 0; i < VOICES; i++) {
            let pipeline;
            try {
                pipeline = Gst.parse_launch(
                    `appsrc name=src format=time caps=audio/x-raw,format=S16LE,layout=interleaved,channels=1,rate=${RATE} ` +
                    '! audioconvert ! audioresample ! volume name=volume ! autoaudiosink name=sink sync=false');
            } catch (e) {
                console.warn(`Clipboard+: could not create a sound player: ${e.message}`);
                this.release();
                return false;
            }
            // The sound server remembers the stream volume of an application
            // and applies it to new streams; keep it at 100 %, the volume
            // is set by the volume element.
            pipeline.get_by_name('sink').connect('element-added', (_bin, element) => {
                if ('volume' in element)
                    element.volume = 1.0;
            });
            const bus = pipeline.get_bus();
            bus.add_signal_watch();
            const busId = bus.connect('message', (_bus, message) => {
                if (message.type === Gst.MessageType.ERROR) {
                    const [error] = message.parse_error();
                    console.warn(`Clipboard+: could not play a sound: ${error.message}`);
                }
            });
            this._voices.push({
                Gst, pipeline, bus, busId,
                src: pipeline.get_by_name('src'),
                volume: pipeline.get_by_name('volume'),
                endTime: 0,
                corkId: 0,
            });
        }
        return true;
    }

    /** @returns {object} a voice that is not playing, else the oldest one */
    _freeVoice() {
        const now = GLib.get_monotonic_time();
        return this._voices.find(v => v.endTime <= now) ??
            this._voices.reduce((a, b) => (a.endTime <= b.endTime ? a : b));
    }

    _start(voice, bytes) {
        const {Gst} = voice;
        this._cancelCork(voice);
        // Start from a clean state: drop anything still playing, and reset
        // the sink's position, which kept moving through the silence since
        // the last sound. Without this, the start of the new samples would
        // be "in the past" for the sink and get dropped.
        voice.pipeline.send_event(Gst.Event.new_flush_start());
        voice.pipeline.send_event(Gst.Event.new_flush_stop(true));
        voice.volume.volume = this._volume();
        voice.src.emit('push-buffer', Gst.Buffer.new_wrapped_bytes(new GLib.Bytes(bytes)));
        voice.pipeline.set_state(Gst.State.PLAYING);

        const ms = bytes.length / 2 / RATE * 1000;
        voice.endTime = GLib.get_monotonic_time() + ms * 1000;
        // Pause when done, so the audio stream is corked while nothing plays.
        voice.corkId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.ceil(ms) + CORK_AFTER_END_MS, () => {
            voice.corkId = 0;
            voice.pipeline.set_state(Gst.State.PAUSED);
            return GLib.SOURCE_REMOVE;
        });
    }

    _volume() {
        // Perceived loudness is roughly logarithmic; a square curve makes
        // the slider feel even.
        const v = this._settings.get_int('sound-volume') / 100;
        return v * v;
    }

    _playWithMeta(name) {
        const player = global.display.get_sound_player?.();
        player?.play_from_file(Gio.File.new_for_path(this._file(name)), 'Clipboard+', null);
    }

    _cancelCork(voice) {
        if (voice.corkId)
            GLib.source_remove(voice.corkId);
        voice.corkId = 0;
    }

    _cancelRelease() {
        if (this._releaseId)
            GLib.source_remove(this._releaseId);
        this._releaseId = 0;
    }

    _scheduleRelease() {
        this._cancelRelease();
        this._releaseId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, RELEASE_AFTER_SECONDS, () => {
            this._releaseId = 0;
            this.release();
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Free every voice; they are created again when needed. */
    release() {
        for (const voice of this._voices) {
            this._cancelCork(voice);
            voice.bus.disconnect(voice.busId);
            voice.bus.remove_signal_watch();
            voice.pipeline.set_state(voice.Gst.State.NULL);
        }
        this._voices = [];
    }

    destroy() {
        this._destroyed = true;
        this._cancelRelease();
        this.release();
    }
}
