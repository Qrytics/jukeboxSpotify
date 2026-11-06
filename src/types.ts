export interface SpotifyState {
	/** Is the Spotify desktop app running at all. */
	running: boolean;
	status: 'playing' | 'paused' | 'stopped';
	title: string;
	artist: string;
	album: string;
	artUrl: string | null;
	durationMs: number;
	positionMs: number;
	/** 0..1, or null when there is no local volume to read (Windows with no local session). */
	volume: number | null;
	error: 'permission' | 'unavailable' | null;
}

export interface JukeboxBridge {
	onState(cb: (s: SpotifyState) => void): () => void;
	control(cmd: 'toggle' | 'next' | 'prev'): void;
	setVolume(v: number): void;
	setInteractive(on: boolean): void;
	/** Saved preferences, sent when the window loads and whenever the tray menu changes them. */
	onPrefs(cb: (p: { onTop: boolean; openAtLogin: boolean; clickSounds?: boolean; boxScale?: number }) => void): () => void;
	/** Resize the jukebox: 0.45..1, where 1 is the default and largest. `final` on release, to save it. */
	setSize(scale: number, final?: boolean): void;
	/** Play the game's click sound on buttons and the slider. */
	setClickSounds(on: boolean): void;
	/** Where the box is on its screen, as 0..1 fractions of the screen's width and height. */
	onPlace(cb: (p: { fx: number; fy: number; cx?: number; dw?: number }) => void): () => void;
	setOnTop(on: boolean): void;
	/** Append a line to the app's log file (tray menu → Open log folder). */
	log(...parts: unknown[]): void;
	/** Start with the computer, so the jukebox is already running when Spotify opens. */
	setLogin(on: boolean): void;
	/** Quit the whole program. */
	quit(): void;
	dragStart(): void;
	dragMove(dx: number, dy: number): void;
	dragEnd(): void;
}

declare global {
	interface Window {
		jukebox?: JukeboxBridge;
	}
}
