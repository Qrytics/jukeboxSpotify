/**
 * Pixel art for the jukebox, generated rather than shipped: 16×16 textures in the style of a
 * block game (drawn here, not copied from one), returned as horizontal runs so each sprite is a few
 * dozen `<rect>`s instead of 256. A seeded RNG keeps the "noise" identical on server and client,
 * so hydration never sees a different texture.
 */
export type Run = { x: number; y: number; w: number; c: string };

function rng(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function runs(grid: (string | null)[][]): Run[] {
	const out: Run[] = [];
	grid.forEach((row, y) => {
		let x = 0;
		while (x < row.length) {
			const c = row[x];
			let w = 1;
			while (x + w < row.length && row[x + w] === c) w++;
			if (c) out.push({ x, y, w, c });
			x += w;
		}
	});
	return out;
}

const grid = (fn: (x: number, y: number) => string | null) =>
	Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => fn(x, y)));

const EDGE = '#24180f';

/**
 * A small wooden push-button, 6×7, drawn flat. It is placed inside the box's right-face transform,
 * so it picks up that face's skew and sits on it in perspective. Plank-lit on the top and left edge,
 * shaded on the bottom and right, with two plank seams of grain and a 4-pixel arrow pressed into it.
 */
export function padSprite(dir: 'prev' | 'next'): Run[] {
	// Horizontal planks: two lighter boards over a darker one, so it reads as cut timber, not a frame.
	const plank = (y: number) => (y <= 2 ? '#b9774b' : y <= 4 ? '#a7643f' : '#94562f');
	const ARROW = '#24120a';
	const arrow = new Set(dir === 'next' ? ['2,2', '2,3', '2,4', '3,3'] : ['3,2', '3,3', '3,4', '2,3']);
	return runs(
		Array.from({ length: 7 }, (_, y) =>
			Array.from({ length: 6 }, (_, x) => {
				if (arrow.has(`${x},${y}`)) return ARROW;
				if (y === 0 || x === 0) return '#d9a074'; // lit edge
				if (y === 6 || x === 5) return '#4a2a17'; // shaded edge
				return (x * 3 + y) % 5 === 0 ? '#8a5330' : plank(y); // plank, with a few grain flecks
			})
		)
	);
}

/**
 * A 10×11 wooden button with an icon, for the tools on the left face (drawn at 0.3 scale, so about the
 * size of the arrow buttons). Same plank look as `padSprite`; the icon sits in the 8×9 inside the rim.
 *   cog – a cogwheel
 */
export function iconPadSprite(_icon: 'cog'): Run[] {
	const W = 10;
	const H = 11;
	const plank = (y: number) => (y <= 3 ? '#b9774b' : y <= 6 ? '#a7643f' : '#94562f');
	const INK = '#24120a';
	const px = new Map<string, string>();
	// 7×7, symmetric about its centre pixel: 1px teeth N/E/S/W, 2px teeth at the four corners (thicker
	// than a single pixel, much slimmer than a 2×2 block). The middle is one open pixel ringed by four
	// mid-brown ones ('+'): a hub that is lighter than the black ring but not a blank hole.
	const GEAR = ['##.#.##', '.#####.', '.##+##.', '##+.+##', '.##+##.', '.#####.', '##.#.##'];
	GEAR.forEach((row, gy) =>
		[...row].forEach((ch, gx) => {
			if (ch === '#') px.set(`${1 + gx},${2 + gy}`, INK);
			else if (ch === '+') px.set(`${1 + gx},${2 + gy}`, '#7a4a2c');
		})
	);

	return runs(
		Array.from({ length: H }, (_, y) =>
			Array.from({ length: W }, (_, x) => {
				const inked = px.get(`${x},${y}`);
				if (inked) return inked;
				if (y === 0 || x === 0) return '#d9a074'; // lit edge
				if (y === H - 1 || x === W - 1) return '#4a2a17'; // shaded edge
				return (x * 3 + y) % 5 === 0 ? '#8a5330' : plank(y); // plank, with a few grain flecks
			})
		)
	);
}

/** The volume slider's knob, 4×3: a small wooden plank, lit on top and left, shaded below and right. */
export function knobSprite(): Run[] {
	const wood = ['#b06d45', '#a7643f', '#b9774b'];
	return runs(
		Array.from({ length: 3 }, (_, y) =>
			Array.from({ length: 4 }, (_, x) => {
				if (y === 0 || x === 0) return '#d2956a';
				if (y === 2 || x === 3) return '#6b3d24';
				return wood[(x * 2 + y) % wood.length];
			})
		)
	);
}

/** A side of the box: a dark frame around a lattice of diamonds on mottled wood. */
export function sideFace(): Run[] {
	const r = rng(7);
	const wood = ['#6e4129', '#7a482d', '#62391f', '#83502f'];
	return runs(
		grid((x, y) => {
			if (x === 0 || y === 0 || x === 15 || y === 15) return EDGE;
			if (x === 1 || y === 1 || x === 14 || y === 14) return '#43281a';
			if ((x + y) % 4 === 0 || (x - y + 16) % 4 === 0) return r() < 0.8 ? '#3e2416' : '#4b2d1c';
			return wood[Math.floor(r() * wood.length)];
		})
	);
}

/** The lid: planks in a rim, with the disc slot across the middle. */
export function topFace(): Run[] {
	const r = rng(11);
	const plank = ['#a7643f', '#9c5c3a', '#b06d45', '#a06040'];
	return runs(
		grid((x, y) => {
			if (x === 0 || y === 0 || x === 15 || y === 15) return EDGE;
			if (x === 1 || y === 1 || x === 14 || y === 14) return '#6b3d24';
			if (y >= 7 && y <= 8 && x >= 4 && x <= 11) return y === 7 ? '#101010' : '#1d1d1d';
			if (y === 6 && x >= 4 && x <= 11) return '#5a331f';
			if (y === 4 || y === 11) return '#7f4628';
			return plank[Math.floor(r() * plank.length)];
		})
	);
}

/** A record: a pixel circle with grooves and a sheen, and a two-colour label round a spindle hole. */
export function disc(label: [string, string], seed: number): Run[] {
	const r = rng(seed);
	return runs(
		grid((x, y) => {
			const dx = x - 7.5;
			const dy = y - 7.5;
			const d = Math.hypot(dx, dy);
			if (d > 7.6) return null;
			if (d > 6.6) return '#151515';
			if (Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5) return '#0d0d0d';
			if (Math.abs(dx) <= 1.5 && Math.abs(dy) <= 1.5) return dy < 0 ? label[0] : label[1];
			if (dx < -1 && dy < -1 && d > 3.2 && d < 5.4 && r() < 0.55) return '#5a5a5a';
			if (Math.abs(d - 4.3) < 0.5 || Math.abs(d - 5.8) < 0.4) return '#2b2b2b';
			return r() < 0.15 ? '#424242' : '#363636';
		})
	);
}

/** An eighth note, 6×8, for the particles. `currentColor` takes each particle's hue. */
export const NOTE: Run[] = runs(
	['...##.', '...#.#', '...#..', '...#..', '...#..', '.###..', '####..', '.##...'].map((row) =>
		[...row].map((ch) => (ch === '#' ? 'currentColor' : null))
	)
);
