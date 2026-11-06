/**
 * Windows provider: a persistent Windows PowerShell process (win-bridge.ps1) that reads Spotify's
 * media session and executes play/pause/skip. Windows exposes no per-app volume or album-art URL
 * through that API, so `volume` stays null (the slider is hidden) and discs use a generated colour.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./win-bridge.ps1', import.meta.url));
const OFF = { running: false, status: 'stopped', title: '', artist: '', album: '', artUrl: null, durationMs: 0, positionMs: 0, volume: null, error: null };

export function createWinProvider() {
	let child = null;
	let stopped = false;
	let retry;
	let emit = () => {};

	function launch() {
		if (stopped) return;
		// -EncodedCommand takes UTF-16LE base64, which sidesteps quoting and the asar path of a packaged app.
		const encoded = Buffer.from(readFileSync(SCRIPT, 'utf8'), 'utf16le').toString('base64');
		child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
			windowsHide: true,
			stdio: ['pipe', 'pipe', 'ignore']
		});
		let buf = '';
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk) => {
			buf += chunk;
			let i;
			while ((i = buf.indexOf('\n')) >= 0) {
				const line = buf.slice(0, i).trim();
				buf = buf.slice(i + 1);
				if (!line) continue;
				try {
					emit({ ...OFF, ...JSON.parse(line) });
				} catch {
					// A partial or non-JSON line (PowerShell banner noise): ignore it.
				}
			}
		});
		child.on('exit', () => {
			child = null;
			emit({ ...OFF, error: 'unavailable' });
			if (!stopped) retry = setTimeout(launch, 3000);
		});
		child.stdin.on('error', () => {});
	}

	const send = (cmd) => child?.stdin.writable && child.stdin.write(`${cmd}\n`);

	return {
		start(onState) {
			emit = onState;
			stopped = false;
			launch();
		},
		stop() {
			stopped = true;
			clearTimeout(retry);
			child?.stdin.end();
			child?.kill();
		},
		control(cmd) {
			if (['toggle', 'next', 'prev'].includes(cmd)) send(cmd);
		},
		setVolume() {}
	};
}
