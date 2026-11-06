/**
 * Windows provider: a persistent Windows PowerShell process (win-bridge.ps1) that reads Spotify's
 * media session and executes play/pause/skip. Volume comes from the desktop app’s audio session
 * (null with nothing local to turn up, hiding the slider); discs use a generated colour.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./win-bridge.ps1', import.meta.url));
const OFF = { running: false, status: 'stopped', title: '', artist: '', album: '', artUrl: null, durationMs: 0, positionMs: 0, volume: null, error: null };

export function createWinProvider(log = () => {}) {
	let child = null;
	let stopped = false;
	let retry;
	let emit = () => {};

	function launch() {
		if (stopped) return;
		// The bridge runs from a file, not -EncodedCommand: the script outgrew the command line
		// (base64 past ~32KB fails to spawn), and a file needs no quoting or asar tricks either.
		// Rewritten on every launch, so it can never go stale.
		const dir = join(tmpdir(), 'jukebox');
		mkdirSync(dir, { recursive: true });
		const cached = join(dir, 'win-bridge.ps1');
		writeFileSync(cached, readFileSync(SCRIPT, 'utf8'));
		child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', cached], {
			windowsHide: true,
			stdio: ['pipe', 'pipe', 'pipe']
		});
		log('powershell bridge started', { pid: child.pid });
		// PowerShell's own errors, which used to be thrown away. Only the first few, so a loop that fails
		// every half second cannot flood the log.
		let errLines = 0;
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (d) => {
			// PowerShell's "Preparing modules for first use" progress record: startup noise, not an error.
			if (String(d).includes('Preparing modules for first use') || String(d).trim() === '#< CLIXML') return;
			if (errLines++ < 8) log('powershell stderr', String(d).trim().slice(0, 500));
		});
		child.on('error', (err) => log('powershell failed to start', String(err)));
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
		child.on('exit', (code, signal) => {
			log('powershell bridge exited', { code, signal });
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
			if (['toggle', 'next', 'prev', 'focus'].includes(cmd)) send(cmd);
		},
		setVolume(v) {
		const n = Math.max(0, Math.min(1, Number(v)));
		if (Number.isFinite(n)) send(`vol ${n.toFixed(3)}`);
	}
	};
}
