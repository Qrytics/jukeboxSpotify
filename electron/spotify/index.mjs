import { createMacProvider } from './mac.mjs';
import { createWinProvider } from './win.mjs';
import { createMockProvider } from './mock.mjs';

/** Picks the Spotify bridge for the OS this is running on. */
export function createProvider(log = () => {}) {
	if (process.env.JUKEBOX_MOCK) return createMockProvider();
	if (process.platform === 'darwin') return createMacProvider();
	if (process.platform === 'win32') return createWinProvider(log);
	// Linux and others: nothing to read from, so the jukebox simply never opens.
	return {
		start: (onState) => onState({ running: false, status: 'stopped', title: '', artist: '', album: '', artUrl: null, durationMs: 0, positionMs: 0, volume: null, error: null }),
		stop() {},
		control() {},
		setVolume() {}
	};
}
