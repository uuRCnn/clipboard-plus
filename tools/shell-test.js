// Automated visual test, run inside an isolated headless GNOME Shell:
//   tools/run-test.sh
// Copies sample content, opens the popup in every layout and state and
// writes screenshots to $CBP_TEST_OUT.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const UUID = 'clipboard-plus@dukha';
const OUT = GLib.getenv('CBP_TEST_OUT');
const SAMPLE_IMAGE = GLib.getenv('CBP_TEST_IMAGE');
const ONLY = GLib.getenv('CBP_TEST_ONLY') ?? '';
const LOG = [];

function log(msg) {
    LOG.push(msg);
    console.log(`CBP-TEST: ${msg}`);
}

function sleep(ms) {
    return new Promise(resolve => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

async function shot(name) {
    const file = Gio.File.new_for_path(`${OUT}/${name}.png`);
    const stream = file.replace(null, false, Gio.FileCreateFlags.NONE, null);
    const shooter = new Shell.Screenshot();
    await shooter.screenshot(false, stream);
    stream.close(null);
    log(`screenshot ${name}`);
}

async function copyText(text) {
    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
    await sleep(250);
}

async function copyImage(path) {
    const [, contents] = GLib.file_get_contents(path);
    St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, 'image/png', new GLib.Bytes(contents));
    await sleep(900);
}

async function test() {
    const iface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
    iface.set_string('color-scheme', GLib.getenv('CBP_TEST_SCHEME') || 'prefer-dark');
    if (iface.settings_schema.has_key('accent-color'))
        iface.set_string('accent-color', 'green');
    Main.overview.hide();
    await sleep(800);

    Main.extensionManager.enableExtension(UUID);
    await sleep(1500);
    const ext = Main.extensionManager.lookup(UUID);
    log(`extension state=${ext?.state} error=${ext?.error ?? ''}`);
    if (!ext?.stateObj?._button)
        throw new Error(`extension did not start: ${ext?.error}`);
    const obj = ext.stateObj;
    const button = obj._button;
    const settings = obj._settings;
    const store = obj._store;

    // ---- empty state
    button.menu.open();
    await sleep(500);
    await shot('00-empty');
    button.menu.close();
    await sleep(300);

    // ---- sample content (oldest first)
    await copyText('Merhaba, ekteki dosyayı inceleyebilir misiniz? Yarın sabah toplantıdan önce dönüş yaparsanız sevinirim.');
    await copyText('file:///home/uur/Belgeler/fatura-ekim.pdf');
    await copyText('#5E5CE6');
    if (SAMPLE_IMAGE) {
        // a screenshot tool saves the file and copies the image
        Gio.File.new_for_path(SAMPLE_IMAGE).copy(Gio.File.new_for_path(GLib.getenv('CBP_TEST_SCREENSHOT')),
            Gio.FileCopyFlags.OVERWRITE, null, null);
        await copyImage(SAMPLE_IMAGE);
    }
    await copyText('sudo pacman -Syu --noconfirm');
    await copyText('https://extensions.gnome.org/extension/779/clipboard-indicator/');
    await copyText("Toplantı notları: Perşembe 15:00'te sunum provası.\nHerkes kendi bölümünü 10 dakikada bitirecek şekilde hazırlasın.\nSlaytlar Çarşamba akşamına kadar ortak klasöre yüklensin.\n\n— Projektör ve HDMI adaptörü: Ahmet\n— Toplantı odası: B-204");
    log(`items=${store.items.length} kinds=${store.items.map(e => e.kind).join(',')}`);

    // duplicate must not create a new entry
    await copyText('#5E5CE6');
    log(`items after duplicate=${store.items.length}`);

    // pin two
    const notes = store.items.find(e => e.text?.startsWith('Toplantı'));
    const link = store.items.find(e => e.kind === 'link');
    store.togglePin(notes);
    store.togglePin(link);

    if (ONLY === 'sound') {
        // open (shortcut or click), choose an entry; with pauses longer
        // than the time the sound players are kept
        const steps = [['key', 1000, 1500], ['click', 300, 17000], ['key', 17000, 1500], ['click', 1000, 1500]];
        for (const [how, beforeSelect, after] of steps) {
            if (how === 'key')
                button.toggleFromShortcut();
            else
                button.menu.open();
            log(`sound open (${how}) ${Date.now()}`);
            await sleep(beforeSelect);
            button._activate(0);
            log(`sound select ${Date.now()}`);
            await sleep(after);
        }
        return;
    }

    if (ONLY === 'prefs') {
        Main.overview.hide();
        for (let page = 0; page < 5; page++) {
            const launcher = new Gio.SubprocessLauncher({flags: Gio.SubprocessFlags.NONE});
            launcher.setenv('WAYLAND_DISPLAY', 'cbp-test-0', true);
            launcher.setenv('GDK_BACKEND', 'wayland', true);
            const proc = launcher.spawnv(['gjs', '-m', GLib.getenv('CBP_PREFS_HARNESS'), GLib.getenv('CBP_PREFS_DIR'), String(page)]);
            await sleep(3500);
            await shot(`40-prefs-${page}`);
            proc.force_exit();
            await sleep(500);
        }
        return;
    }

    const layouts = ONLY ? [ONLY] : ['default', 'spotlight', 'cards', 'compact'];
    for (const layout of layouts) {
        settings.set_string('layout', layout);
        await sleep(200);
        button.menu.open();
        await sleep(600);
        await shot(`10-${layout}-open`);

        // keyboard navigation to the image → preview card
        const imgIndex = button._entries.findIndex(e => e.kind === 'image');
        button._select(Math.max(0, imgIndex), 'keyboard');
        await sleep(450);
        await shot(`11-${layout}-preview-image`);

        if (layout === 'default') {
            await sleep(1500);
            log(`image source=${store.items.find(e => e.kind === 'image')?.source}`);
            // hover actions with the folder button on the image row
            const imgRow = button._rows[imgIndex];
            const actions = imgRow.get_children().find(c => c.style_class === 'cbp-actions');
            log(`image row actions=${actions?.get_n_children()}`);
            imgRow.hover = true;
            await sleep(200);
            await shot('16-default-row-actions');
            imgRow.hover = false;
            const fileIndex = button._entries.findIndex(e => e.kind === 'file');
            button._select(fileIndex, 'keyboard');
            await sleep(450);
            await shot('17-default-preview-file');
            button._select(0, 'keyboard');
            await sleep(450);
            await shot('12-default-preview-text');
            const colorIndex = button._entries.findIndex(e => e.kind === 'color');
            button._select(colorIndex, 'keyboard');
            await sleep(450);
            await shot('13-default-preview-color');
            const linkIndex = button._entries.findIndex(e => e.kind === 'link');
            button._select(linkIndex, 'keyboard');
            await sleep(450);
            await shot('14-default-preview-link');

            // enlarge
            button._select(Math.max(0, imgIndex), 'keyboard');
            await sleep(400);
            button._preview.toggleLarge();
            await sleep(300);
            await shot('15-default-preview-large');
            button._preview.toggleLarge();

            // search: engaged → chips
            button._setEngaged(true);
            await sleep(300);
            await shot('20-search-engaged');
            button._entry.set_text(GLib.getenv('CBP_TEST_QUERY') || 'ima');
            await sleep(400);
            await shot('21-search-suggest');
            button._applyFilter(button._suggestions()[0]);
            await sleep(300);
            await shot('22-search-token');
            button._entry.set_text('');
            button._setToken(null);
            button._entry.set_text('pacman');
            await sleep(300);
            await shot('23-search-text');
            button._entry.set_text('zzzz-nothing');
            await sleep(300);
            await shot('24-search-empty');
            button._entry.set_text('');
        }
        button.menu.close();
        await sleep(400);
    }
    settings.set_string('layout', 'default');

    // ---- private mode
    settings.set_boolean('private-mode', true);
    const before = store.items.length;
    await copyText('secret-should-not-be-recorded');
    log(`private mode recorded=${store.items.length !== before}`);
    button.menu.open();
    await sleep(500);
    await shot('30-private-mode');
    button.menu.close();
    settings.set_boolean('private-mode', false);

    // ---- password manager hint must be ignored (simulated by excluded app list)
    // ---- delete + clear keep pinned
    store.clear(true);
    log(`after clear items=${store.items.length} pinned=${store.pinned.length}`);

    // ---- disable / enable cycle
    Main.extensionManager.disableExtension(UUID);
    await sleep(800);
    Main.extensionManager.enableExtension(UUID);
    await sleep(1500);
    const ext2 = Main.extensionManager.lookup(UUID);
    log(`re-enabled state=${ext2?.state} items=${ext2?.stateObj?._store?.items.length}`);
}

export const METRICS = {};

export async function run() {
    try {
        await test();
    } catch (e) {
        log(`FAILED: ${e.message}\n${e.stack}`);
    }
    GLib.file_set_contents(`${OUT}/log.txt`, LOG.join('\n'));
}
