/**
 * A small log file, so "it doesn't work on my machine" can be answered from facts: what Windows or macOS
 * reported, what the Spotify bridge said, and why the window was or wasn't shown. It lives in the app's data
 * folder (tray menu → "Open log folder"). It records the song title and artist when they change, and nothing
 * else about what you listen to. It is trimmed to stay small.
 */
import { app } from 'electron';
import { appendFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

const MAX_BYTES = 256 * 1024;
let file = null;

export const logPath = () => (file ??= join(app.getPath('userData'), 'jukebox.log'));

export function log(...parts) {
	try {
		const f = logPath();
		try {
			if (statSync(f).size > MAX_BYTES) renameSync(f, f + '.old');
		} catch {
			// no file yet
		}
		const text = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
		appendFileSync(f, `${new Date().toISOString()} ${text}\n`);
	} catch {
		// logging must never break the app
	}
}
