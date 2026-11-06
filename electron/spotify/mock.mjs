/** Fake Spotify for developing the skin without Spotify running (`npm run dev:mock`). */
const TRACKS = [
	{ title: 'Blueberry Eyes', artist: 'MAX', album: 'Colour Vision', durationMs: 214000 },
	{ title: 'Dragostea Din Tei', artist: 'O-Zone', album: 'DiscO-Zone', durationMs: 213000 },
	{ title: 'Apartment', artist: 'TogetherEffect', album: 'Apartment', durationMs: 187000 },
	{ title: 'Sideways', artist: 'Your Neighbors', album: 'Sideways', durationMs: 172000 }
];

export function createMockProvider() {
	let i = 0;
	let playing = true;
	let pos = 38000;
	let volume = 0.6;
	let timer;
	let emit = () => {};

	const snapshot = () => ({
		running: true,
		status: playing ? 'playing' : 'paused',
		...TRACKS[i],
		artUrl: null,
		positionMs: pos,
		volume,
		error: null
	});

	return {
		start(onState) {
			emit = onState;
			timer = setInterval(() => {
				if (playing) pos += 1000;
				if (pos >= TRACKS[i].durationMs) {
					i = (i + 1) % TRACKS.length;
					pos = 0;
				}
				emit(snapshot());
			}, 1000);
			emit(snapshot());
		},
		stop: () => clearInterval(timer),
		control(cmd) {
			if (cmd === 'toggle') playing = !playing;
			if (cmd === 'next') (i = (i + 1) % TRACKS.length), (pos = 0);
			if (cmd === 'prev') (i = (i + TRACKS.length - 1) % TRACKS.length), (pos = 0);
			emit(snapshot());
		},
		setVolume(v) {
			volume = Math.max(0, Math.min(1, Number(v)));
		}
	};
}
