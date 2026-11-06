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
 *   cog      – a cogwheel
 *   minimize – a small solid square in the corner of a faint frame (the "shrink to the corner" glyph)
 *   spotify  – the round Spotify mark: a dark-brown disc with three wood-coloured arcs
 */
export function iconPadSprite(icon: 'cog' | 'minimize' | 'spotify'): Run[] {
	const W = 10;
	const H = 11;
	const plank = (y: number) => (y <= 3 ? '#b9774b' : y <= 6 ? '#a7643f' : '#94562f');
	const INK = '#24120a';
	const px = new Map<string, string>();
	/** Stamp a character grid into the icon area at (ox, oy); `key` maps a character to a colour. */
	const stamp = (rows: string[], ox: number, oy: number, key: Record<string, string>) =>
		rows.forEach((row, gy) =>
			[...row].forEach((ch, gx) => {
				if (key[ch]) px.set(`${ox + gx},${oy + gy}`, key[ch]);
			})
		);
	if (icon === 'cog') {
		// 7×7, symmetric about its centre pixel: 1px teeth N/E/S/W, 2px teeth at the four corners (thicker
		// than a single pixel, much slimmer than a 2×2 block). The middle is one open pixel ringed by four
		// mid-brown ones ('+'): a hub that is lighter than the black ring but not a blank hole.
		stamp(['##.#.##', '.#####.', '.##+##.', '##+.+##', '.##+##.', '.#####.', '##.#.##'], 1, 2, { '#': INK, '+': '#7a4a2c' });
	} else if (icon === 'minimize') {
		// A 7×7 frame drawn in mid-brown ('f'), with a 2×2 ink square ('#') tucked into its bottom-left corner.
		stamp(['fffffff', 'f.....f', 'f.....f', 'f.....f', 'f##...f', 'f##...f', 'fffffff'], 1, 2, { f: '#6b3d24', '#': INK });
	} else {
		// 8×8 disc ('g' ink) with three arcs ('d' wood): long on top, shorter below, like the logo.
		stamp(['..gggg..', '.gggggg.', 'gddddddg', 'gggggggg', 'ggddddgg', 'gggggggg', '.ggddgg.', '..gggg..'], 1, 1, { g: INK, d: '#b9774b' });
	}

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

// ── Music discs ──
// A disc is a vinyl body in one of several colours, with artwork on it in one of several designs. The
// pair is picked from a hash of the song, so a song always gets the same disc and different songs
// mostly differ: 14 palettes × 10 designs.

type Rgb = [number, number, number];
const toRgb = (c: string): Rgb => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) as Rgb;
const toHex = (c: Rgb) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (c: string, to: string, t: number) => {
	const a = toRgb(c);
	const b = toRgb(to);
	return toHex(a.map((v, i) => v + (b[i] - v) * t) as Rgb);
};
const darken = (c: string, t: number) => mix(c, '#000000', t);
const lighten = (c: string, t: number) => mix(c, '#ffffff', t);
function hsl(h: number, s: number, l: number) {
	const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
	const f = (n: number) => {
		const k = (n + h / 30) % 12;
		return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
	};
	return toHex([f(0), f(8), f(4)]);
}

/** `body` is the vinyl; `a`, `b`, `c` are the artwork colours (c is the accent). */
export interface DiscPalette {
	body: string;
	a: string;
	b: string;
	c: string;
}

export const DISC_PALETTES: DiscPalette[] = [
	{ body: '#363636', a: '#ff4d4d', b: '#7a0000', c: '#ffd24d' }, // black / red
	{ body: '#2c2c34', a: '#3fd0ff', b: '#0b3d91', c: '#ffffff' }, // black / cyan
	{ body: '#1c2a5a', a: '#ffd23f', b: '#ff8c1a', c: '#ffffff' }, // navy / gold
	{ body: '#1f4d2b', a: '#9be564', b: '#d8f3c0', c: '#ffe66d' }, // forest / lime
	{ body: '#3b1f6b', a: '#ff5fd2', b: '#c9a7ff', c: '#ffffff' }, // purple / magenta
	{ body: '#6a1020', a: '#ff9a3c', b: '#ffb3c1', c: '#fff1d6' }, // crimson / orange
	{ body: '#0f4f55', a: '#5ff0e0', b: '#b8ffe8', c: '#ffffff' }, // teal / aqua
	{ body: '#b8860b', a: '#4a2a05', b: '#fff2b8', c: '#c0392b' }, // gold / brown
	{ body: '#e8e4d8', a: '#1a1a1a', b: '#d62828', c: '#6b6b6b' }, // cream / ink
	{ body: '#d6559b', a: '#ffd1ec', b: '#6b1f4f', c: '#ffffff' }, // pink
	{ body: '#c85a10', a: '#ffd23f', b: '#4a1f05', c: '#ffffff' }, // orange / yellow
	{ body: '#44505e', a: '#7fc8ff', b: '#0b2a55', c: '#ffffff' }, // steel / sky
	{ body: '#2a0f3d', a: '#39ff88', b: '#0a5c3a', c: '#f0ff8a' } // night / neon green
];

/** The 14th palette: a hue taken from the song, so there are many more than 13 colourways. */
const hued = (hue: number): DiscPalette => ({
	body: '#2e2e2e',
	a: hsl(hue, 80, 62),
	b: hsl((hue + 40) % 360, 85, 32),
	c: hsl((hue + 180) % 360, 80, 72)
});

export const DISC_DESIGNS = ['classic', 'label', 'rings', 'stripes', 'checker', 'split', 'sunburst', 'dots', 'spiral', 'star'] as const;
export type DiscDesign = (typeof DISC_DESIGNS)[number];

/** The artwork at a pixel (dx, dy from the disc's centre, d from it), or null to leave plain vinyl. */
function artwork(design: DiscDesign, p: DiscPalette, dx: number, dy: number, d: number): string | null {
	const turn = (Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI); // 0..1 around the disc
	switch (design) {
		case 'classic': // a small two-tone square label
			return Math.abs(dx) <= 1.5 && Math.abs(dy) <= 1.5 ? (dy < 0 ? p.a : p.b) : null;
		case 'label': // a big round label with an accent rim
			return d <= 3.7 ? (d >= 3 ? p.c : dy < 0 ? p.a : p.b) : null;
		case 'rings': // concentric coloured bands
			if (d < 2) return p.c;
			return d < 6.2 ? [p.a, p.b, p.c][Math.floor((d - 2) / 1.05) % 3] : null;
		case 'stripes': // diagonal stripes
			if (d < 1.9) return p.b;
			return d < 6.4 && Math.floor(dx + dy + 30) % 6 < 3 ? p.a : null;
		case 'checker': // a checkerboard
			return d < 5.2 ? ((Math.floor((dx + 10) / 2) + Math.floor((dy + 10) / 2)) % 2 === 0 ? p.a : p.b) : null;
		case 'split': // two halves with a divider
			if (d >= 5.6) return null;
			return Math.abs(dx) <= 0.5 ? p.c : dx < 0 ? p.a : p.b;
		case 'sunburst': // alternating wedges
			if (d < 1.6) return p.c;
			return d < 6 ? (Math.floor(turn * 10) % 2 ? p.a : p.b) : null;
		case 'dots': // a grid of dots
			if (d < 1.8) return p.b;
			return d < 6 && Math.floor(dx + 10) % 3 === 0 && Math.floor(dy + 10) % 3 === 0 ? p.a : null;
		case 'spiral': // a spiral arm
			if (d < 1.8) return p.b;
			return d < 6.2 && Math.floor(d * 1.1 + turn * 2.4) % 2 === 0 ? p.a : null;
		case 'star': { // eight rays
			if (d < 1.8) return p.b;
			const ax = Math.abs(dx);
			const ay = Math.abs(dy);
			return d < 6.2 && (ax <= 0.7 || ay <= 0.7 || Math.abs(ax - ay) <= 0.7) ? p.a : null;
		}
	}
}

/** One disc: a 16×16 record in `palette` with `design` on it. `seed` only varies the vinyl's grain. */
export function paintDisc(palette: DiscPalette, design: DiscDesign, seed: number): Run[] {
	const r = rng(seed);
	const rim = darken(palette.body, 0.6);
	const groove = darken(palette.body, 0.28);
	const sheen = lighten(palette.body, 0.3);
	const grain = lighten(palette.body, 0.08);
	return runs(
		grid((x, y) => {
			const dx = x - 7.5;
			const dy = y - 7.5;
			const d = Math.hypot(dx, dy);
			if (d > 7.6) return null;
			if (d > 6.6) return rim;
			if (Math.abs(dx) <= 0.5 && Math.abs(dy) <= 0.5) return '#0d0d0d'; // the spindle hole
			const art = artwork(design, palette, dx, dy, d);
			if (art) return art;
			if (dx < -1 && dy < -1 && d > 3.2 && d < 5.4 && r() < 0.55) return sheen;
			if (Math.abs(d - 4.3) < 0.5 || Math.abs(d - 5.8) < 0.4) return groove;
			return r() < 0.15 ? grain : palette.body;
		})
	);
}

/** The disc for a song, from its "artist|title" key. The same song always gets the same disc. */
export function songDisc(key: string): Run[] {
	let h = 2166136261;
	for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
	h >>>= 0;
	// Re-mix so the palette and the design are not locked together by the same low bits.
	const h2 = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
	const h3 = Math.imul(h2 ^ (h2 >>> 13), 3266489917) >>> 0;
	const n = h % (DISC_PALETTES.length + 1);
	const palette = n < DISC_PALETTES.length ? DISC_PALETTES[n] : hued(h3 % 360);
	return paintDisc(palette, DISC_DESIGNS[h2 % DISC_DESIGNS.length], h3 % 1000);
}

/** An eighth note, 6×8, for the particles. `currentColor` takes each particle's hue. */
export const NOTE: Run[] = runs(
	['...##.', '...#.#', '...#..', '...#..', '...#..', '.###..', '####..', '.##...'].map((row) =>
		[...row].map((ch) => (ch === '#' ? 'currentColor' : null))
	)
);
