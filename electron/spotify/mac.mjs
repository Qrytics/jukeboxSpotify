/**
 * macOS provider: reads and controls the desktop Spotify app through its AppleScript dictionary.
 * No login, API keys or Premium needed. The first call makes macOS ask the user to let Jukebox
 * control Spotify (Automation permission); until they agree, `error: 'permission'` is reported.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SEP = '\u001f';

// `application "Spotify" is running` does not launch the app; everything after it only runs once it is.
const READ = `
if application "Spotify" is not running then return "off"
tell application "Spotify"
	set pstate to player state as string
	if pstate is "stopped" then return "stopped"
	set trk to current track
	set sep to (ASCII character 31)
	return pstate & sep & (name of trk) & sep & (artist of trk) & sep & (album of trk) & sep & (artwork url of trk) & sep & (duration of trk) & sep & (player position) & sep & (sound volume)
end tell`;

const COMMANDS = {
	toggle: 'tell application "Spotify" to playpause',
	next: 'tell application "Spotify" to next track',
	prev: 'tell application "Spotify" to previous track'
};

const num = (v) => {
	const n = Number(String(v).replace(',', '.'));
	return Number.isFinite(n) ? n : 0;
};

async function isRunning() {
	try {
		await run('pgrep', ['-x', 'Spotify']);
		return true;
	} catch {
		return false;
	}
}

async function read() {
	const base = { running: true, status: 'stopped', title: '', artist: '', album: '', artUrl: null, durationMs: 0, positionMs: 0, volume: null, error: null };
	try {
		const { stdout } = await run('osascript', ['-e', READ], { timeout: 4000 });
		const out = stdout.trim();
		if (out === 'off') return { ...base, running: false };
		if (out === 'stopped') return base;
		const [st, title, artist, album, art, dur, pos, vol] = out.split(SEP);
		return {
			...base,
			status: st === 'playing' ? 'playing' : 'paused',
			title,
			artist,
			album,
			artUrl: art && art.startsWith('http') ? art : null,
			durationMs: num(dur),
			positionMs: num(pos) * 1000,
			volume: Math.max(0, Math.min(1, num(vol) / 100))
		};
	} catch (err) {
		const msg = String(err?.stderr ?? err?.message ?? err);
		if (msg.includes('-1743') || /not authori[sz]ed/i.test(msg)) return { ...base, error: 'permission' };
		return { ...base, error: 'unavailable' };
	}
}

export function createMacProvider() {
	let timer;
	let stopped = false;
	let emit = () => {};

	const OFF = { running: false, status: 'stopped', title: '', artist: '', album: '', artUrl: null, durationMs: 0, positionMs: 0, volume: null, error: null };
	let up = false; // last known: is Spotify running

	async function tick() {
		if (stopped) return;
		let next = 2500;
		// While Spotify is up, go straight to the one AppleScript call (it reports "off" itself if Spotify
		// quit). Only when it is down is the cheaper pgrep worth spawning. This halves the process spawns.
		if (up || (await isRunning())) {
			const state = await read();
			up = state.running;
			emit(state);
			// A paused or stopped player changes rarely; poll it half as often.
			next = state.status === 'playing' ? 1000 : 2000;
		} else {
			up = false;
			emit(OFF);
		}
		timer = setTimeout(tick, next);
	}

	return {
		start(onState) {
			emit = onState;
			stopped = false;
			void tick();
		},
		stop() {
			stopped = true;
			clearTimeout(timer);
		},
		async control(cmd) {
			if (!COMMANDS[cmd]) return;
			await run('osascript', ['-e', COMMANDS[cmd]], { timeout: 4000 }).catch(() => {});
			clearTimeout(timer);
			void tick();
		},
		async setVolume(v) {
			const n = Math.round(Math.max(0, Math.min(1, Number(v))) * 100);
			await run('osascript', ['-e', `tell application "Spotify" to set sound volume to ${n}`], { timeout: 4000 }).catch(() => {});
		}
	};
}
