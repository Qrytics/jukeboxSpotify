// Renders the app and tray icons from the jukebox's own pixel art (src/pixels.ts), so they always match
// the cube on screen. Pure Node, no image libraries:  npm run icons
//   build/icon.png            1024px  app icon (electron-builder makes the .icns and .ico from it)
//   electron/assets/tray.png  22px    menu-bar / system-tray icon
//   electron/assets/tray@2x.png 44px  its Retina version (Electron picks it up by name)
import { mkdirSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { sideFace, topFace } from '../src/pixels.ts';

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

/** A face's runs as a 16×16 grid of [r, g, b] (or null). */
function grid(runs) {
	const g = Array.from({ length: 16 }, () => Array(16).fill(null));
	for (const r of runs) for (let i = 0; i < r.w; i++) g[r.y][r.x + i] = hex(r.c);
	return g;
}
const TOP = grid(topFace());
const SIDE = grid(sideFace());

/** The colour of the cube at a point in its 32-unit viewBox, or null outside it. Mirrors the SVG in App.svelte. */
function sample(X, Y) {
	const at = (g, u, v, shade) => {
		if (u < 0 || v < 0 || u >= 16 || v >= 16) return null;
		const c = g[Math.floor(v)][Math.floor(u)];
		return c && c.map((n) => Math.round(n * (1 - shade)));
	};
	return (
		at(TOP, (X - 16 + 2 * Y) / 2, (2 * Y - X + 16) / 2, 0) || // lid:        matrix(1 .5 -1 .5 16 0)
		at(SIDE, X, Y - 0.5 * X - 8, 0.12) || //                      left face:  matrix(1 .5 0 1 0 8)
		at(SIDE, X - 16, Y - 16 + 0.5 * (X - 16), 0.3) //              right face: matrix(1 -.5 0 1 16 16)
	);
}

/** Rasterise the cube into `size` px with `pad` (0..0.5) of margin on each side, 3×3 supersampled. */
function render(size, pad) {
	const span = size * (1 - 2 * pad);
	const out = Buffer.alloc(size * size * 4);
	const N = 3;
	for (let py = 0; py < size; py++) {
		for (let px = 0; px < size; px++) {
			let r = 0, g = 0, b = 0, a = 0;
			for (let sy = 0; sy < N; sy++) {
				for (let sx = 0; sx < N; sx++) {
					const X = ((px + (sx + 0.5) / N - size * pad) / span) * 32;
					const Y = ((py + (sy + 0.5) / N - size * pad) / span) * 32;
					const c = sample(X, Y);
					if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
				}
			}
			const i = (py * size + px) * 4;
			if (a) {
				out[i] = Math.round(r / a);
				out[i + 1] = Math.round(g / a);
				out[i + 2] = Math.round(b / a);
				out[i + 3] = Math.round((a / (N * N)) * 255);
			}
		}
	}
	return out;
}

function png(size, rgba) {
	const chunk = (type, data) => {
		const body = Buffer.concat([Buffer.from(type), data]);
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(body) >>> 0);
		return Buffer.concat([len, body, crc]);
	};
	const head = Buffer.alloc(13);
	head.writeUInt32BE(size, 0);
	head.writeUInt32BE(size, 4);
	head.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
	const raw = Buffer.alloc(size * (size * 4 + 1));
	for (let y = 0; y < size; y++) {
		raw[y * (size * 4 + 1)] = 0; // filter: none
		rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', head),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

mkdirSync('build', { recursive: true });
mkdirSync('electron/assets', { recursive: true });
const files = [
	['build/icon.png', 1024, 0.1],
	['electron/assets/tray.png', 22, 0.04],
	['electron/assets/tray@2x.png', 44, 0.04]
];
for (const [path, size, pad] of files) {
	writeFileSync(path, png(size, render(size, pad)));
	console.log(`wrote ${path} (${size}×${size})`);
}
