/**
 * Jukebox main process.
 *
 * The app lives in the tray / menu bar. It watches for Spotify and, while Spotify is running, shows
 * one frameless, fully transparent, always-on-top window that contains nothing but the jukebox: no
 * background, no title bar. Everything around the jukebox is click-through, so the window can be
 * large enough for the panel to pop open without blocking whatever is underneath it.
 */
import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, screen, shell } from 'electron';
import { log, logPath } from './log.mjs';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProvider } from './spotify/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// Wide enough that a long shadow cast to either side is not clipped by the window's edge.
const WIDTH = 480; // the shadow reaches ~94px past the box at a screen edge, plus ~40px of glow
// The window is mostly empty space around the box: room above for the disc's flight and the song
// tooltip, and BOTTOM_PAD below for the shadow. The box (BOX px square) is centred, BOTTOM_PAD up from
// the bottom. BOTTOM_PAD must match `.stage { padding-bottom }` in src/App.svelte.
const BOX_MAX = 200; // the box at full size: the default, and the largest it can be
const BOX_MIN_SCALE = 0.45; // the smallest the user can shrink it to
const BOTTOM_PAD = 64;
const HEIGHT = 564;
const MARGIN = 16;
// The window never changes size; the box is anchored bottom-centre inside it and scales from there, so
// resizing does not move the box's base.
let boxScale = 1;
const boxPx = () => Math.round(BOX_MAX * boxScale);
const boxLeft = () => (WIDTH - boxPx()) / 2; // the box's left edge, from the window's left
const boxTop = () => HEIGHT - BOTTOM_PAD - boxPx(); // the box's top edge, from the window's top

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Keep the BOX (not the mostly-empty window around it) inside a display's work area. Without this the
 * window may be dragged anywhere, including entirely off-screen, where the box could not be found again.
 */
function clampBox(x, y, area) {
	return {
		x: clamp(x, area.x - boxLeft(), area.x + area.width - boxLeft() - boxPx()),
		y: clamp(y, area.y - boxTop(), area.y + area.height - boxTop() - boxPx())
	};
}
const DEV_URL = process.env.VITE_DEV_URL;

if (!app.requestSingleInstanceLock()) app.quit();
if (process.platform === 'darwin') app.dock?.hide();

let win = null;
let tray = null;
let last = null;
let pinned = !!process.env.JUKEBOX_MOCK; // "Show jukebox" from the tray keeps it up without Spotify
let dragFrom = null;
const provider = createProvider(log);
/** True for a few seconds after a manual launch, so the jukebox shows even before Spotify is open. */
let intro = false;

const posFile = () => join(app.getPath('userData'), 'position.json');
const prefsFile = () => join(app.getPath('userData'), 'prefs.json');

/** Saved settings. `onTop`: keep the jukebox in front of other windows. `openAtLogin`: start with the
 *  computer, so the jukebox is already running whenever Spotify launches. */
let prefs = { onTop: true, openAtLogin: false, clickSounds: true, boxScale: 1 };

function loadPrefs() {
	try {
		prefs = { ...prefs, ...JSON.parse(readFileSync(prefsFile(), 'utf8')) };
	} catch {
		// first run: defaults
	}
	boxScale = clamp(Number(prefs.boxScale) || 1, BOX_MIN_SCALE, 1);
	prefs.boxScale = boxScale;
	// Once installed, the OS is the source of truth for the login item (the user can change it there).
	if (app.isPackaged) prefs.openAtLogin = app.getLoginItemSettings().openAtLogin;
}

function savePrefs() {
	try {
		writeFileSync(prefsFile(), JSON.stringify(prefs));
	} catch {
		// not worth interrupting playback over
	}
}

function applyOnTop() {
	if (!win) return;
	if (prefs.onTop) win.setAlwaysOnTop(true, 'floating');
	else win.setAlwaysOnTop(false);
}

function setOnTop(on, tellRenderer = false) {
	prefs.onTop = !!on;
	savePrefs();
	applyOnTop();
	refreshTray();
	if (tellRenderer) win?.webContents.send('jukebox:prefs', { ...prefs });
}

function setLogin(on, tellRenderer = false) {
	prefs.openAtLogin = !!on;
	savePrefs();
	// Only an installed build registers a login item. Unpackaged (`npm run dev`), the executable is the
	// bare Electron binary, which would launch an empty Electron window at every login.
	// --hidden: a start at login stays quiet; only a manual launch shows the jukebox right away.
	if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: prefs.openAtLogin, args: ['--hidden'] });
	refreshTray();
	if (tellRenderer) win?.webContents.send('jukebox:prefs', { ...prefs });
}

function savedPosition() {
	try {
		const p = JSON.parse(readFileSync(posFile(), 'utf8'));
		const area = screen.getDisplayNearestPoint({ x: p.x + WIDTH / 2, y: p.y + HEIGHT / 2 }).workArea;
		const c = clampBox(p.x, p.y, area);
		if (c.x === p.x && c.y === p.y) return c; // still fully on a display; anything else resets to the corner
	} catch {
		// first run or unreadable file: use the default corner
	}
	return null;
}

function defaultPosition() {
	const area = screen.getPrimaryDisplay().workArea;
	// Bottom right: the box MARGIN px in from the work area's right and bottom edges.
	return { x: area.x + area.width - boxLeft() - boxPx() - MARGIN, y: area.y + area.height - boxTop() - boxPx() - MARGIN };
}

function createWindow() {
	const { x, y } = savedPosition() ?? defaultPosition();
	win = new BrowserWindow({
		x,
		y,
		width: WIDTH,
		height: HEIGHT,
		show: false,
		frame: false,
		transparent: true,
		backgroundColor: '#00000000',
		hasShadow: false,
		resizable: false,
		maximizable: false,
		minimizable: false,
		fullscreenable: false,
		// macOS pushes any window back on-screen, and this window is far taller than its box, so without
		// this the box could not be dragged above the point where the window's own top hits the screen's
		// top (about halfway up). This option lifts that constraint; `clampBox` keeps the box on-screen.
		enableLargerThanScreen: true,
		skipTaskbar: true,
		webPreferences: {
			preload: join(here, 'preload.cjs'),
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false
		}
	});
	applyOnTop();
	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
	// Click-through until the pointer is over the jukebox itself (the renderer reports that).
	win.setIgnoreMouseEvents(true, { forward: true });
	win.webContents.on('will-navigate', (e) => e.preventDefault());
	win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
	win.on('closed', () => (win = null));
	log('window created', { bounds: win.getBounds(), display: screen.getPrimaryDisplay().workArea, scale: screen.getPrimaryDisplay().scaleFactor });
	win.webContents.on('did-fail-load', (_e, code, desc, url) => log('page failed to load', code, desc, url));
	win.webContents.on('render-process-gone', (_e, d) => log('renderer crashed', d));
	win.webContents.on('console-message', (...a) => {
		const d = a[0] && typeof a[0] === 'object' && 'message' in a[0] ? a[0] : { level: a[1], message: a[2] };
		if (d.level === 'warning' || d.level === 'error' || d.level >= 2) log('page console', d.message);
	});

	if (DEV_URL) void win.loadURL(DEV_URL);
	else void win.loadFile(join(here, '..', 'dist', 'renderer', 'index.html'));
}

function updateVisibility() {
	const want = pinned || intro || !!last?.running;
	if (want && !win) createWindow();
	if (!win) return;
	if (want && !win.isVisible()) {
		win.showInactive();
		log('window shown', { bounds: win.getBounds(), onTop: win.isAlwaysOnTop() });
	}
	if (!want && win.isVisible()) {
		win.hide();
		log('window hidden');
	}
}

/** Everything the UI shows. The playback position is deliberately absent: it changes every second but
 *  nothing draws it, so including it would wake the renderer once a second for no visible change. */
const visibleKey = (s) => `${s.running}|${s.status}|${s.title}|${s.artist}|${s.error}|${s.volume === null ? '' : Math.round(s.volume * 100)}`;

function onState(state) {
	const changed = !last || visibleKey(last) !== visibleKey(state);
	last = state;
	if (!changed) return;
	// `raw` and `session` only come from the Windows bridge: what Windows itself said about Spotify.
	log('spotify', { running: state.running, status: state.status, title: state.title, artist: state.artist, error: state.error, volume: state.volume, raw: state.raw, session: state.session });
	updateVisibility();
	win?.webContents.send('jukebox:state', state);
}

/**
 * Tell the UI where the box is on its screen, as fractions (0..1) of that screen's width and height,
 * so it can cast its shadow away from a sun fixed at the top centre of the screen.
 */
function sendPlace() {
	if (!win) return;
	const b = win.getBounds();
	const d = screen.getDisplayMatching(b).bounds;
	win.webContents.send('jukebox:place', {
		// Pixels, so the UI can keep its text on this screen: the box's centre from the screen's left edge,
		// and the screen's width.
		cx: b.x + b.width / 2 - d.x,
		dw: d.width,
		fx: (b.x + b.width / 2 - d.x) / d.width,
		fy: (b.y + b.height - BOTTOM_PAD - boxPx() / 2 - d.y) / d.height // the box's vertical centre
	});
}

function savePosition() {
	if (!win) return;
	const [x, y] = win.getPosition();
	try {
		writeFileSync(posFile(), JSON.stringify({ x, y }));
	} catch {
		// not worth interrupting playback over
	}
}

/** The settings menu: shown from the tray icon and from the cogwheel on the jukebox. */
function menuTemplate() {
	return [
		{ label: 'Keep on top of other windows', type: 'checkbox', checked: prefs.onTop, click: (item) => setOnTop(item.checked, true) },
		{ label: 'Show jukebox even when Spotify is closed', type: 'checkbox', checked: pinned, click: (item) => ((pinned = item.checked), updateVisibility(), refreshTray()) },
		{ label: 'Boot on Spotify startup', type: 'checkbox', checked: prefs.openAtLogin, click: (item) => setLogin(item.checked, true) },
		{
			label: 'Reset position',
			click: () => {
				const { x, y } = defaultPosition();
				win?.setPosition(x, y);
				savePosition();
				sendPlace();
			}
		},
		{ label: 'Open log folder', click: () => shell.showItemInFolder(logPath()) },
		{ type: 'separator' },
		{ label: 'Quit Jukebox', role: 'quit' }
	];
}

function refreshTray() {
	tray?.setContextMenu(Menu.buildFromTemplate(menuTemplate()));
}

function buildTray() {
	// tray.png (22px) with tray@2x.png (44px) beside it: Electron picks the Retina one by name.
	const file = join(here, 'assets', 'tray.png');
	const icon = existsSync(file) ? nativeImage.createFromPath(file) : nativeImage.createEmpty();
	tray = new Tray(icon);
	tray.setToolTip('Jukebox');
	// Clicking the tray icon shows the jukebox for a few seconds, wherever it is. On Windows a new tray icon
	// sits in the "hidden icons" overflow, and this is how you find out the app is alive.
	tray.on('click', () => {
		intro = true;
		updateVisibility();
		setTimeout(() => {
			intro = false;
			updateVisibility();
		}, 8000);
	});
	refreshTray();
}

app.whenReady().then(() => {
	loadPrefs();
	log('start', { version: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged, electron: process.versions.electron, argv: process.argv.slice(1) });
	buildTray();
	provider.start(onState);
	ipcMain.on('jukebox:log', (_e, ...a) => log('renderer', ...a));

	// A manual launch shows the jukebox for a few seconds even if Spotify isn't open yet, so you can see
	// it is running. A start at login (--hidden, or macOS's own flag) stays quiet.
	const quiet = process.argv.includes('--hidden') || (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);
	if (!quiet) {
		intro = true;
		updateVisibility();
		setTimeout(() => {
			intro = false;
			updateVisibility();
		}, 8000);
	}

	ipcMain.on('jukebox:ready', (e) => {
		e.sender.send('jukebox:prefs', { ...prefs });
		sendPlace();
		if (last) e.sender.send('jukebox:state', last);
	});
	ipcMain.on('jukebox:on-top', (_e, on) => setOnTop(on));
	// The user is dragging the nub on the lid. `final` is the release: save it, and pull the box back
	// on-screen if growing it pushed an edge off the display.
	ipcMain.on('jukebox:size', (_e, scale, final) => {
		if (!win) return;
		boxScale = clamp(Number(scale) || 1, BOX_MIN_SCALE, 1);
		if (final) {
			prefs.boxScale = boxScale;
			savePrefs();
			const [x, y] = win.getPosition();
			const c = clampBox(x, y, screen.getDisplayMatching(win.getBounds()).workArea);
			if (c.x !== x || c.y !== y) win.setPosition(c.x, c.y);
			savePosition();
		}
		sendPlace();
	});
	ipcMain.on('jukebox:login', (_e, on) => setLogin(on));
	ipcMain.on('jukebox:click-sounds', (_e, on) => {
		prefs.clickSounds = !!on;
		savePrefs();
	});
	ipcMain.on('jukebox:quit', () => app.quit());
	ipcMain.on('jukebox:control', (_e, cmd) => provider.control(cmd));
	ipcMain.on('jukebox:volume', (_e, v) => provider.setVolume(v));
	ipcMain.on('jukebox:interactive', (_e, on) => {
		if (!win) return;
		if (on) win.setIgnoreMouseEvents(false);
		else win.setIgnoreMouseEvents(true, { forward: true });
	});
	ipcMain.on('jukebox:drag-start', () => {
		if (win) dragFrom = win.getPosition();
	});
	ipcMain.on('jukebox:drag-move', (_e, dx, dy) => {
		if (!win || !dragFrom) return;
		// Clamp against the display under the pointer, so the box can be carried between monitors.
		const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
		const { x, y } = clampBox(Math.round(dragFrom[0] + dx), Math.round(dragFrom[1] + dy), area);
		// setBounds, not setPosition: on Windows with display scaling, setPosition can drift the size.
		win.setBounds({ x, y, width: WIDTH, height: HEIGHT });
		sendPlace();
	});
	ipcMain.on('jukebox:drag-end', () => {
		dragFrom = null;
		savePosition();
	});
});

app.on('second-instance', () => updateVisibility());
app.on('window-all-closed', () => {}); // stay in the tray
app.on('before-quit', () => provider.stop());
