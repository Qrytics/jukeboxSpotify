<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { NOTE, iconPadSprite, knobSprite, padSprite, sideFace, songDisc, topFace, type Run } from './pixels';
	import type { SpotifyState } from './types';

	/**
	 * Just the jukebox. No panel, no chrome, no background: the window is transparent and everything
	 * outside the block is click-through, so it reads as a jukebox standing on the desktop.
	 *
	 *   click the block      play / pause
	 *   two wooden buttons   previous / next, set into the right face of the box
	 *   wooden slider        volume, set into the left face (hidden while there is nothing local to turn up)
	 *   scroll on the block  volume too
	 *   drag the block       move it anywhere on screen
	 *   hover the block      "Now playing: artist - song" floats above it (not over the buttons/slider)
	 *
	 * Nothing but the block. While music plays it thumps and notes rise off the lid (bigger when louder).
	 * The one floating line (game-style, no box) shows the song on hover, the volume while adjusting,
	 * or a connection problem. When the song changes, the record pops out and the next drops in.
	 */
	const SIDE = sideFace();
	const TOP = topFace();
	/** Position in the right face's own 16×16 grid (the face is skewed by the same matrix as the box). */
	/** x, y are each button's centre. The 6×7 sprite is drawn at half scale (3×3.5 grid units). */
	const PADS = [
		{ cmd: 'prev', label: 'Previous track', x: 3.7, y: 7.9, sprite: padSprite('prev') },
		{ cmd: 'next', label: 'Next track', x: 12.9, y: 7.9, sprite: padSprite('next') }
	] as const;
	/**
	 * Tools on the left face, bottom right. 10×11 sprites at 0.3 scale are 3×3.3 grid units, about the
	 * size of the arrows. The face's frame starts at 14, and the cog's right and bottom edges sit exactly
	 * on it (x 11 + 3 wide, y 10.7 + 3.3 tall), touching the brown with no gap.
	 */
	const COG = iconPadSprite('cog');
	const TOOL_Y = 10.7;
	const NO_SPOTIFY: SpotifyState = { running: false, status: 'stopped', title: '', artist: '', album: '', artUrl: null, durationMs: 0, positionMs: 0, volume: null, error: null };

	let s = $state<SpotifyState>(NO_SPOTIFY);
	let flash = $state<string | null>(null);
	/** Is the jukebox kept in front of other windows. The saved value arrives from the main process. */
	let onTop = $state(true);
	/** Pointer is over the box itself, not over a button or the slider drawn on its faces. */
	let overBlock = $state(false);
	let notes = $state<{ id: number; hue: number; dx: number; m: number }[]>([]);
	let dragging = $state(false);

	const playing = $derived(s.status === 'playing');
	const hasTrack = $derived(s.status !== 'stopped' && !!s.title);
	const name = $derived(s.artist ? `${s.artist} - ${s.title}` : s.title);

	/** Hovering the box (not its buttons) names the song, game-style. Not while dragging it. */
	const songShown = $derived(overBlock && !dragging && hasTrack);

	/** Standing text for when something is wrong and the jukebox can't do its job. */
	const warning = $derived(
		s.error === 'permission'
			? 'Let Jukebox control Spotify in System Settings › Privacy & Security › Automation'
			: s.error === 'unavailable'
				? "Can't reach Spotify"
				: null
	);

	// ── Window click-through: only the block and its buttons catch the mouse ──
	function interactive(on: boolean) {
		window.jukebox?.setInteractive(on);
	}

	// ── Click vs drag on the block ──
	let down: { x: number; y: number; id: number } | null = null;
	let pendingDrag: [number, number] | null = null;
	let dragRaf = 0;
	function onDown(e: PointerEvent) {
		if (e.button !== 0) return;
		down = { x: e.screenX, y: e.screenY, id: e.pointerId };
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onMove(e: PointerEvent) {
		if (!down) return;
		const dx = e.screenX - down.x;
		const dy = e.screenY - down.y;
		if (!dragging && Math.hypot(dx, dy) > 5) {
			dragging = true;
			window.jukebox?.dragStart();
		}
		if (dragging) {
			// One move per frame at most: a mouse reports far faster than the screen refreshes, and each
			// report is an IPC message plus a window resize in the main process.
			pendingDrag = [dx, dy];
			dragRaf ||= requestAnimationFrame(() => {
				dragRaf = 0;
				if (pendingDrag) window.jukebox?.dragMove(pendingDrag[0], pendingDrag[1]);
			});
		}
	}
	function onUp() {
		if (!down) return;
		const wasDrag = dragging;
		down = null;
		dragging = false;
		if (wasDrag) {
			if (pendingDrag) window.jukebox?.dragMove(pendingDrag[0], pendingDrag[1]);
			pendingDrag = null;
			window.jukebox?.dragEnd();
		}
		else press();
	}
	function press() {
		if (!hasTrack && !s.running) return;
		playClick(); // the box itself is the most-pressed button, so it clicks too
		window.jukebox?.control('toggle');
	}

	function onWheel(e: WheelEvent) {
		if (s.volume === null) return;
		e.preventDefault();
		const v = Math.max(0, Math.min(1, s.volume + (e.deltaY < 0 ? 0.05 : -0.05)));
		s.volume = v;
		window.jukebox?.setVolume(v);
		showVol(v);
	}

	// ── Volume: a wooden slider on the left face, in that face's own 16×16 grid ──
	// The face is skewed by the same matrix as the box, so the slider lies on it in perspective.
	// Pointer positions are mapped back into the face's grid through the group's screen matrix,
	// which is what makes dragging follow the slanted track exactly.
	const TRACK = { x: 4, top: 2, len: 12 };
	const KNOB = { w: 4, h: 3 };
	const TRAVEL = TRACK.len - KNOB.h;
	const KNOB_SPRITE = knobSprite();
	let faceL = $state<SVGGElement | undefined>();
	let volDrag = false;
	let lastSend = 0;
	const knobY = $derived(TRACK.top + (1 - (s.volume ?? 0)) * TRAVEL);

	function faceY(e: PointerEvent): number {
		const m = faceL?.getScreenCTM();
		const svg = faceL?.ownerSVGElement;
		if (!m || !svg) return 0;
		const pt = svg.createSVGPoint();
		pt.x = e.clientX;
		pt.y = e.clientY;
		return pt.matrixTransform(m.inverse()).y;
	}

	function dragVolume(e: PointerEvent) {
		const v = Math.max(0, Math.min(1, 1 - (faceY(e) - TRACK.top - KNOB.h / 2) / TRAVEL));
		s.volume = v;
		// Each send is an osascript call, so don't fire one per pointer event.
		const now = performance.now();
		if (now - lastSend > 90) {
			lastSend = now;
			window.jukebox?.setVolume(v);
		}
		showVol(v);
	}
	function volDown(e: PointerEvent) {
		if (e.button !== 0) return;
		playClick(); // once, when the knob is grabbed, not on every move
		volDrag = true;
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
		dragVolume(e);
	}
	function volMove(e: PointerEvent) {
		if (volDrag) dragVolume(e);
	}
	function volUp() {
		if (!volDrag) return;
		volDrag = false;
		if (s.volume !== null) window.jukebox?.setVolume(s.volume);
	}
	function volKey(e: KeyboardEvent) {
		const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 0.05 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -0.05 : 0;
		if (!d || s.volume === null) return;
		e.preventDefault();
		const v = Math.max(0, Math.min(1, s.volume + d));
		s.volume = v;
		window.jukebox?.setVolume(v);
		showVol(v);
	}

	// ── UI click sound: the game's button click, from src/sounds/click.(ogg|mp3|wav) ──
	// No file there means no sound (and no error), so the app works before the sound is added.
	// WAV first: it decodes everywhere. MP3 needs Windows' media codecs, which are missing on Windows N/KN
	// editions, where an MP3 click would be silent. Any of the three works if it is the only one present.
	const clickFiles = import.meta.glob('./sounds/click.{wav,ogg,mp3}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
	const clickUrl = ['wav', 'ogg', 'mp3'].map((e) => clickFiles[`./sounds/click.${e}`]).find(Boolean);
	/** On = click sounds are audible. Off = silent. Saved, and restored from the main process on load. */
	let clickSounds = $state(true);
	let warnedNoClick = false;
	function playClick() {
		if (!clickSounds) return;
		if (!clickUrl) {
			if (!warnedNoClick) console.warn('Jukebox: no click sound found. Put click.ogg, click.mp3 or click.wav in src/sounds/.');
			warnedNoClick = true;
			return;
		}
		// A fresh element per click, so rapid clicks overlap instead of cutting each other off. The file is
		// cached after the first load, so this is cheap.
		const a = new Audio(clickUrl);
		a.volume = 0.6;
		a.addEventListener('error', () => console.warn('Jukebox: the click sound failed to load', clickUrl), { once: true });
		a.play().catch((err) => console.warn('Jukebox: the click sound would not play', err));
	}

	function toggleOnTop() {
		playClick();
		onTop = !onTop;
		window.jukebox?.setOnTop(onTop);
	}

	// ── Shadow: a sun fixed at the top centre of the screen, behind the box and high above it ──
	// The shadow is the cube's own ground footprint, drawn in the cube's projection (same 32-unit
	// viewBox), plus that footprint swept away from the sun. The footprint itself NEVER moves, so the
	// shadow stays attached to the box's two outer bottom vertices (far left and far right) and its front
	// one: a shadow that lets go of those corners looks wrong. Only the far edge moves:
	//   - centred under the sun, it fans straight forward across the box's full width;
	//   - moving right, the far edge slides right (moving left is the mirror), stretching the shadow
	//     out past that side while the other side stays pinned to its corner;
	//   - strength follows how high the box is, so it is darkest near the top of the screen, nearest the sun.
	type Pt = [number, number];
	/** The cube's footprint on the ground: left, front, right, back corners. */
	const FOOT: Pt[] = [
		[0, 24],
		[16, 32],
		[32, 24],
		[16, 16]
	];

	/** Convex hull (monotone chain) of a handful of points. */
	function hull(pts: Pt[]): Pt[] {
		const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
		const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
		const build = (list: Pt[]) => {
			const out: Pt[] = [];
			for (const pt of list) {
				while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], pt) <= 0) out.pop();
				out.push(pt);
			}
			out.pop();
			return out;
		};
		return [...build(p), ...build([...p].reverse())];
	}
	/** Overall shadow strength, applied to the cast shadow and both contact edges alike: 1 is the previous
	 *  darkness, lower is lighter. The position-dependent shading below varies around this. */
	const SHADOW_GAIN = 0.68;
	let place = $state<{ fx: number; fy: number; cx?: number; dw?: number }>({ fx: 0.5, fy: 1 });

	// ── Keep the floating text on the screen ──
	// The text is centred on the box and can be wider than it, so beside a screen edge its overhang is cut
	// off. Shift it sideways just enough to fit, and not at all when there is room.
	let lineW = $state(0);
	const lineShift = $derived.by(() => {
		if (place.cx === undefined || place.dw === undefined || !lineW) return 0;
		const EDGE = 8; // keep this far from the screen edge
		const half = lineW / 2;
		const lo = EDGE - (place.cx - half); // least shift that keeps the left edge on screen
		const hi = place.dw - EDGE - (place.cx + half); // most shift that keeps the right edge on screen
		return Math.round(Math.max(lo, Math.min(hi, 0))); // as close to centred as the screen allows
	});
	const shadow = $derived.by(() => {
		const dx = Math.max(-1, Math.min(1, (place.fx - 0.5) * 2)); // -1 far left .. 0 under the sun .. 1 far right
		const t = Math.abs(dx);
		const dir = dx >= 0 ? 1 : -1;
		// Sideways: 0 under the sun, up to 15 units at a screen edge (15 is as far as the 400px window has
		// room for beside the box; at 15 the left bound has reached the front corner, 16).
		const ox = dir * 15 * t;
		// Forward: always some, so a shadow shows under the box even when centred, and longer when the sun
		// is more oblique. At most 7 units (~44px), which fits the 50px of padding under the box.
		const oy = 3.5 + 3.5 * t;
		// The hull of the fixed footprint and the same footprint shifted by (ox, oy): the base corners stay put.
		const poly = hull([...FOOT, ...FOOT.map(([x, y]): Pt => [x + ox, y + oy])]);
		// Stronger the higher the box is (nearer the sun), but never absent.
		const strength = (0.35 + 0.55 * (1 - Math.max(0, Math.min(1, place.fy)))) * SHADOW_GAIN;
		return {
			points: poly.map((q) => `${q[0].toFixed(2)},${q[1].toFixed(2)}`).join(' '),
			strength: strength.toFixed(3),
			// The contact shadow hugging each bottom edge. The edge nearer the sun is lit, so its shadow is
			// light; the edge facing away is dark. Box far right (dx 1): left edge lightest, right edge
			// darkest; they cross over at the centre and mirror when the box is far left (dx -1).
			leftEdge: ((0.12 + 0.55 * ((1 - dx) / 2)) * SHADOW_GAIN).toFixed(3),
			rightEdge: ((0.12 + 0.55 * ((1 + dx) / 2)) * SHADOW_GAIN).toFixed(3),
			// Fade runs from the box's base out to the far edge, so the corners stay dark and the far end thins.
			x1: 16,
			y1: 26,
			x2: (16 + ox).toFixed(2),
			y2: (32 + oy).toFixed(2)
		};
	});
	// Block body, not an expression: the assigned object must not be returned. The return value crosses the
	// context bridge back into the preload, where cloning it throws (the page-log spam this once caused).
	onMount(() =>
		window.jukebox?.onPlace?.((p) => {
			place = p;
		})
	);

	// ── Volume label: floats right above the slider (inside .body, so it moves with the box) ──
	let volLabel = $state<string | null>(null);
	let volTimer: ReturnType<typeof setTimeout> | undefined;
	function showVol(v: number) {
		volLabel = `Volume: ${Math.round(v * 100)}%`;
		clearTimeout(volTimer);
		volTimer = setTimeout(() => (volLabel = null), 1400);
	}

	// ── Settings panel, opened by the cogwheel ──
	let menuOpen = $state(false);
	let loginOn = $state(false);
	/** "Close jukebox" was pressed once; a second press within 3s quits. */
	let confirming = $state(false);
	let confirmTimer: ReturnType<typeof setTimeout> | undefined;
	let closeBtn = $state<HTMLButtonElement | undefined>();

	async function openMenu() {
		menuOpen = true;
		await tick();
		closeBtn?.focus();
	}
	function closeMenu() {
		menuOpen = false;
		confirming = false;
		clearTimeout(confirmTimer);
		interactive(false); // the panel vanishes under the pointer, so no pointerleave will fire
	}
	function toggleLogin() {
		playClick();
		loginOn = !loginOn;
		window.jukebox?.setLogin?.(loginOn);
	}
	function toggleClickSounds() {
		clickSounds = !clickSounds;
		window.jukebox?.setClickSounds?.(clickSounds);
		playClick(); // plays when turning on; silent when turning off, since it is already off by now
	}
	function pressQuit() {
		playClick();
		if (confirming) {
			window.jukebox?.quit?.();
			return;
		}
		confirming = true;
		clearTimeout(confirmTimer);
		confirmTimer = setTimeout(() => (confirming = false), 3000);
	}
	$effect(() => {
		if (!menuOpen) return;
		const esc = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu();
		window.addEventListener('keydown', esc);
		return () => window.removeEventListener('keydown', esc);
	});

	function onActivateKey(e: KeyboardEvent, act: () => void) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			act();
		}
	}

	// ── Size: the nub on the lid. Drag it down to shrink the jukebox, up to grow it, up to the default size ──
	const ZOOM_MIN = 0.45; // keep in step with BOX_MIN_SCALE in electron/main.mjs
	/**
	 * The peg's geometry, in the cube's 32-unit viewBox. It stands on the lid's back corner (the lid's top
	 * vertex is at 16,0): a diamond base with half-width `a`, raised by `h`. Its three visible faces are
	 * the same shapes the cube is made of, only much smaller.
	 */
	const PEG = (() => {
		const cx = 16;
		const cy = 2.5; // base centre, on the lid: its back point touches the inner edge of the rim (y≈2), in the corner
		const a = 0.8; // base half-width (a 1.6-unit-wide peg: ~10px at full size, down from 17px)
		const h = 1.9; // how far it stands up
		const pt = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;
		const bT: [number, number] = [cx, cy - a / 2];
		const bR: [number, number] = [cx + a, cy];
		const bB: [number, number] = [cx, cy + a / 2];
		const bL: [number, number] = [cx - a, cy];
		const up = ([x, y]: [number, number]): [number, number] => [x, y - h];
		const [tT, tR, tB, tL] = [bT, bR, bB, bL].map(up) as [number, number][];
		const join = (...p: [number, number][]) => p.map(([x, y]) => pt(x, y)).join(' ');
		return {
			left: join(bL, bB, tB, tL),
			right: join(bB, bR, tR, tB),
			top: join(tT, tR, tB, tL),
			all: join(tT, tR, bR, bB, bL, tL),
			edge: join(tL, tT, tR), // a thin light line along the top's two back edges
			shadow: join([cx, cy - a * 0.65 + 0.35], [cx + a * 1.45, cy + 0.35], [cx, cy + a * 0.65 + 0.35], [cx - a * 1.45, cy + 0.35]),
			hit: join([cx - a - 1, cy - h - a / 2 - 1], [cx + a + 1, cy - h - a / 2 - 1], [cx + a + 1, cy + a / 2 + 1], [cx - a - 1, cy + a / 2 + 1])
		};
	})();
	let zoom = $state(1);
	let sizeDrag: { y: number; z: number } | null = null;
	let sizeRaf = 0;
	/** Over how many screen pixels of dragging the size goes from smallest to largest. */
	const SIZE_RANGE = 260;

	function setZoom(z: number, final = false) {
		zoom = Math.max(ZOOM_MIN, Math.min(1, z));
		// The main process only needs it for hit-testing and keeping the box on-screen: once per frame while
		// dragging, then once more with `final` on release, which also saves it.
		cancelAnimationFrame(sizeRaf);
		if (final) {
			sizeRaf = 0;
			window.jukebox?.setSize?.(zoom, true);
			return;
		}
		sizeRaf = requestAnimationFrame(() => {
			sizeRaf = 0;
			window.jukebox?.setSize?.(zoom, false);
		});
	}
	function sizeDown(e: PointerEvent) {
		if (e.button !== 0) return;
		playClick();
		sizeDrag = { y: e.screenY, z: zoom };
		(e.currentTarget as Element).setPointerCapture(e.pointerId);
	}
	function sizeMove(e: PointerEvent) {
		if (!sizeDrag) return;
		setZoom(sizeDrag.z + (sizeDrag.y - e.screenY) / SIZE_RANGE); // up is bigger
		show(`Size: ${Math.round(zoom * 100)}%`);
	}
	function sizeUp() {
		if (!sizeDrag) return;
		sizeDrag = null;
		setZoom(zoom, true);
	}
	function sizeKey(e: KeyboardEvent) {
		const d = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 0.05 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -0.05 : 0;
		if (!d) return;
		e.preventDefault();
		setZoom(zoom + d, true);
		show(`Size: ${Math.round(zoom * 100)}%`);
	}

	function onPadKey(e: KeyboardEvent, cmd: 'prev' | 'next') {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			playClick();
			noteDirection(cmd);
			window.jukebox?.control(cmd);
		}
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'ArrowRight') (noteDirection('next'), window.jukebox?.control('next'));
		else if (e.key === 'ArrowLeft') (noteDirection('prev'), window.jukebox?.control('prev'));
		else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') onWheel(new WheelEvent('wheel', { deltaY: e.key === 'ArrowUp' ? -1 : 1 }));
	}

	let flashTimer: ReturnType<typeof setTimeout> | undefined;
	function show(text: string) {
		flash = text;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (flash = null), 1400);
	}

	// Notes rise from the lid while a song plays.
	let noteId = 0;
	$effect(() => {
		if (!playing || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		const t = setInterval(() => {
			const id = noteId++;
			// Louder, bigger: 0.4× at silence, 1× (portfolioSite's proportions) at 60%, 1.4× at full.
			// Without a volume to read (remote playback), notes stay at 1×. Each note keeps the size it was born with.
			const m = s.volume === null ? 1 : 0.4 + s.volume;
			notes = [...notes.slice(-6), { id, hue: Math.floor(Math.random() * 300), dx: Math.random() * 2 - 1, m }];
			setTimeout(() => (notes = notes.filter((n) => n.id !== id)), 1700);
		}, 650);
		return () => clearInterval(t);
	});

	// ── Song change: the record pops out, hovers, is swapped for the next, which drops in ──
	// The disc is hidden while a song plays. It only appears for this hand-over, the way the game's
	// jukebox spits a record out when it finishes. Spotify has already moved on by the time it plays;
	// this is purely the visual.
	type Phase = 'pop' | 'hold' | 'swap' | 'rest' | 'drop';
	/**
	 * When each phase begins, in ms. 'pop' is the physics launch (950ms: 380 up under deceleration,
	 * 260 falling under gravity, then two small bounces onto an invisible floor); 'drop' is the
	 * fall back into the slot plus the box's squash as it catches it. ~4s in all.
	 */
	const SCHEDULE: [Phase, number][] = [['hold', 950], ['swap', 2100], ['rest', 2800], ['drop', 3400]];
	const ANIM_END = 4000;
	const discCache = new Map<string, Run[]>();
	/** `back`: going to the previous song, so the old disc slides out to the RIGHT and the new one slides in
	 *  from the LEFT. Going forward is the other way round (out to the left, in from the right). */
	let anim = $state<{ from: Run[]; to: Run[]; phase: Phase; back: boolean } | null>(null);
	let animTimers: ReturnType<typeof setTimeout>[] = [];
	let shownKey = '';
	/** The last two songs, most recent last, so a change back to the song before can be told from a skip. */
	let history: string[] = [];
	/** The user's last button press, if it was this recent: a hint for the direction of the next change. */
	let lastPress: { dir: 'prev' | 'next'; at: number } | null = null;

	/** One song, one disc: label colours and grooves derived from "artist|title". */
	function discFor(key: string): Run[] {
		let d = discCache.get(key);
		if (!d) {
			d = songDisc(key);
			discCache.set(key, d);
			if (discCache.size > 30) discCache.delete(discCache.keys().next().value!);
		}
		return d;
	}

	function runChange(from: Run[], to: Run[], back: boolean) {
		animTimers.forEach(clearTimeout);
		anim = { from, to, phase: 'pop', back };
		animTimers = SCHEDULE.map(([phase, at]) =>
			setTimeout(() => {
				if (anim) anim.phase = phase;
			}, at)
		);
		animTimers.push(setTimeout(() => (anim = null), ANIM_END));
	}

	$effect(() => {
		const key = hasTrack ? `${s.artist}|${s.title}` : '';
		if (key === shownKey) return;
		const prev = shownKey;
		shownKey = key;
		// Which way did it go? The button just pressed says so directly; otherwise, if the song is the one
		// we were on before this one, it went back (covers Spotify's own controls and the keyboard).
		const pressed = lastPress && performance.now() - lastPress.at < 4000 ? lastPress.dir : null;
		lastPress = null;
		const back = pressed ? pressed === 'prev' : key !== '' && key === history[history.length - 2];
		if (key) {
			if (back) history.pop();
			else history.push(key);
			history = history.slice(-8);
		}
		// First song after nothing, or Spotify stopping: nothing to hand over.
		if (!key || !prev || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		runChange(anim ? anim.to : discFor(prev), discFor(key), back);
	});

	/** Remember which way a track button was pressed, for the disc animation that follows. */
	function noteDirection(dir: 'prev' | 'next') {
		lastPress = { dir, at: performance.now() };
	}

	onMount(() => () => animTimers.forEach(clearTimeout));
	// Windows' "Animation effects: off" (and battery saver) reaches the page as prefers-reduced-motion, which
	// switches off the notes, the beat and the disc animation by design. Record it, so it is easy to rule in or out.
	onMount(() => window.jukebox?.log?.('renderer ready', { reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches, clickSound: !!clickUrl }));
	// Optional-call: a window still running an older preload has no onPrefs, and a throw here would stop
	// the Spotify state below from ever being wired up.
	onMount(() =>
		window.jukebox?.onPrefs?.((p) => {
			onTop = p.onTop;
			loginOn = p.openAtLogin;
			clickSounds = p.clickSounds ?? true;
			if (!sizeDrag && p.boxScale) zoom = Math.max(ZOOM_MIN, Math.min(1, p.boxScale));
		})
	);

	// While the knob is being dragged, keep the local volume: a poll result would yank it back.
	onMount(() =>
		window.jukebox?.onState((next) => {
		// Block body, so the state object is not returned across the bridge (see onPlace above).
		s = volDrag ? { ...next, volume: s.volume } : next;
	})
);
	// In a plain browser (no Electron) there is no bridge: show a demo so the skin can be looked at.
	onMount(() => {
		if (window.jukebox) return;
		s = { ...NO_SPOTIFY, running: true, status: 'playing', title: 'Blueberry Eyes', artist: 'MAX', volume: 0.6 };
	});
</script>

<div class="stage" class:stage--playing={playing} class:stage--drop={anim?.phase === 'drop'} style="--zoom: {zoom}">
	<p
		class="line"
		class:line--flash={!!flash}
		class:line--warn={!flash && !!warning}
		class:line--show={!!flash || !!warning || songShown}
		aria-hidden={songShown && !flash && !warning}
		aria-live="polite"
		bind:clientWidth={lineW}
		style="--linex: {lineShift}px"
	>
		{#if flash ?? warning}
			{flash ?? warning}
		{:else if songShown}
			<span class="tip"><span class="line__label">Now playing:</span> <span class="line__song">{name}</span></span>
		{/if}
	</p>

	<div class="rig" class:rig--drag={dragging} role="group" aria-label="Jukebox">
		<!-- One object: the cube and the controls drawn on its faces. Every animation (hover grow, press
		     squash, beat thump, landing squash) is applied to this wrapper alone, so they cannot drift apart. -->
		<div class="body">
		<svg class="shadow" viewBox="0 0 32 32" aria-hidden="true">
			<defs>
				<!-- Bloom: a tight blur for the body plus a wider, fainter blur behind it for the glow. -->
				<filter id="shadow-soft" filterUnits="userSpaceOnUse" x="-34" y="6" width="100" height="50" color-interpolation-filters="sRGB">
					<feGaussianBlur in="SourceGraphic" stdDeviation="0.9" result="core" />
					<feGaussianBlur in="SourceGraphic" stdDeviation="2.4" result="glow" />
					<feComponentTransfer in="glow" result="glowSoft"><feFuncA type="linear" slope="0.55" /></feComponentTransfer>
					<feMerge><feMergeNode in="glowSoft" /><feMergeNode in="core" /></feMerge>
				</filter>
				<!-- Vignette along the cast: full strength at the box's base (so the pinned corners stay dark),
				     fading toward the far edge. Beyond either end the colour holds. -->
				<linearGradient id="shadow-vig" gradientUnits="userSpaceOnUse" x1={shadow.x1} y1={shadow.y1} x2={shadow.x2} y2={shadow.y2}>
					<stop offset="0" stop-color="#000" stop-opacity="0.95" />
					<stop offset="0.45" stop-color="#000" stop-opacity="0.8" />
					<stop offset="1" stop-color="#000" stop-opacity="0.18" />
				</linearGradient>
				<!-- The contact line's strength along x: the left face's edge (x 0-16) carries the left value, the
				     right face's edge (x 16-32) the right one, with a short blend at the front corner (x 16). -->
				<linearGradient id="shadow-edge" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="32" y2="0">
					<stop offset="0" stop-color="#000" stop-opacity={shadow.leftEdge} />
					<stop offset="0.44" stop-color="#000" stop-opacity={shadow.leftEdge} />
					<stop offset="0.56" stop-color="#000" stop-opacity={shadow.rightEdge} />
					<stop offset="1" stop-color="#000" stop-opacity={shadow.rightEdge} />
				</linearGradient>
				<!-- A barely blurred line for the contact shadow along the base, so the corners stay crisp. -->
				<filter id="shadow-contact" filterUnits="userSpaceOnUse" x="-6" y="18" width="44" height="22" color-interpolation-filters="sRGB">
					<feGaussianBlur stdDeviation="0.5" />
				</filter>
			</defs>
			<!-- A round-joined stroke in the same gradient rounds the outer corners before it is blurred. The
			     footprint is part of the polygon, so its far-left and far-right corners are always in it.
			     Drawn before the cube, which hides the part under it. -->
			<polygon
				points={shadow.points}
				fill="url(#shadow-vig)"
				stroke="url(#shadow-vig)"
				stroke-width="2"
				stroke-linejoin="round"
				opacity={shadow.strength}
				filter="url(#shadow-soft)"
			/>
			<!-- Contact shadow: a thin dark line along the cube's bottom edges (left corner, front corner,
			     right corner), pinning the shadow to them. -->
			<polyline points="0,24 16,32 32,24" fill="none" stroke="url(#shadow-edge)" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" filter="url(#shadow-contact)" />
		</svg>
		{#if volLabel}<span class="vollabel" aria-hidden="true">{volLabel}</span>{/if}
		<button
			type="button"
			class="block"
			class:block--drag={dragging}
			aria-label={hasTrack ? `Jukebox, ${playing ? 'playing' : 'paused'}: ${name}. Press to ${playing ? 'pause' : 'play'}.` : 'Jukebox, nothing playing'}
			onpointerenter={() => {
				overBlock = true;
				interactive(true);
			}}
			onpointerleave={() => {
				overBlock = false;
				if (!down) interactive(false);
			}}
			onpointerdown={onDown}
			onpointermove={onMove}
			onpointerup={onUp}
			onpointercancel={onUp}
			onkeydown={onKey}
			onwheel={onWheel}
			onclick={(e) => e.detail === 0 && press()}
		>
			<svg class="cube" viewBox="0 0 32 32" shape-rendering="crispEdges" aria-hidden="true">
				<g transform="matrix(1 0.5 -1 0.5 16 0)">
					{#each TOP as p, i (i)}<rect x={p.x} y={p.y} width={p.w} height="1" fill={p.c} />{/each}
				</g>
				<g transform="matrix(1 0.5 0 1 0 8)">
					{#each SIDE as p, i (i)}<rect x={p.x} y={p.y} width={p.w} height="1" fill={p.c} />{/each}
					<rect width="16" height="16" fill="#000" opacity="0.12" />
				</g>
				<g transform="matrix(1 -0.5 0 1 16 16)">
					{#each SIDE as p, i (i)}<rect x={p.x} y={p.y} width={p.w} height="1" fill={p.c} />{/each}
					<rect width="16" height="16" fill="#000" opacity="0.3" />
				</g>
			</svg>
		</button>

		<!-- Same viewBox and the faces' own matrices as the cube, so the controls lie flat on its faces. -->
		<svg class="pads" viewBox="0 0 32 32" shape-rendering="crispEdges">
			{#snippet tool(x: number, label: string, sprite: Run[], act: () => void, pressed?: boolean)}
				<g transform="translate({x} {TOOL_Y}) scale(0.3)">
					<g
						class="pad"
						role="button"
						tabindex="0"
						aria-label={label}
						aria-pressed={pressed}
						onpointerenter={() => interactive(true)}
						onpointerleave={() => interactive(false)}
						onclick={() => (playClick(), act())}
						onkeydown={(e) => onActivateKey(e, () => (playClick(), act()))}
					>
						<rect class="pad__hit" x="-1" y="-1" width="12" height="13" fill="transparent" />
						<rect x="0" y="11" width="10" height="1" fill="#000" opacity="0.4" />
						<g class="pad__body">
							{#each sprite as p, i (i)}<rect x={p.x} y={p.y} width={p.w} height="1" fill={p.c} />{/each}
							<rect class="pad__shade" width="10" height="11" fill="#000" opacity="0.18" />
							<rect class="pad__focus" x="-1.5" y="-1.5" width="13" height="14" fill="none" stroke="#fff" stroke-width="1.5" />
						</g>
					</g>
				</g>
			{/snippet}

			<!-- Left face, bottom right: the settings cog. -->
			<g transform="matrix(1 0.5 0 1 0 8)">
				{@render tool(11, 'Settings', COG, openMenu)}
			</g>

			{#if s.volume !== null}
				<!-- The left face's matrix: the volume slider lies on it in perspective. -->
				<g bind:this={faceL} transform="matrix(1 0.5 0 1 0 8)">
					<g
						class="vol"
						role="slider"
						tabindex="0"
						aria-label="Volume"
						aria-orientation="vertical"
						aria-valuemin="0"
						aria-valuemax="100"
						aria-valuenow={Math.round(s.volume * 100)}
						onpointerenter={() => interactive(true)}
						onpointerleave={() => {
							if (!volDrag) interactive(false);
						}}
						onpointerdown={volDown}
						onpointermove={volMove}
						onpointerup={volUp}
						onpointercancel={volUp}
						onkeydown={volKey}
					>
						<rect class="vol__hit" x="1" y="1" width="7" height="14" fill="transparent" />
						<!-- The groove, a slim slot: far (left) edge shadowed, near edge catching light. -->
						<rect x={TRACK.x - 0.5} y={TRACK.top - 0.5} width="0.5" height={TRACK.len + 1} fill="#24180f" />
						<rect x={TRACK.x} y={TRACK.top} width="1" height={TRACK.len} fill="#1a0f08" />
						<rect x={TRACK.x + 1} y={TRACK.top} width="0.5" height={TRACK.len + 0.5} fill="#8a5532" opacity="0.7" />
						<g transform="translate({TRACK.x + 0.5 - KNOB.w / 2} {knobY})">
							<rect x="0" y={KNOB.h} width={KNOB.w} height="1" fill="#000" opacity="0.4" />
							{#each KNOB_SPRITE as p, i (i)}<rect x={p.x} y={p.y} width={p.w} height="1" fill={p.c} />{/each}
							<rect class="vol__shade" width={KNOB.w} height={KNOB.h} fill="#000" opacity="0.12" />
							<rect class="vol__focus" x="-0.5" y="-0.5" width={KNOB.w + 1} height={KNOB.h + 1} fill="none" stroke="#fff" stroke-width="0.4" />
						</g>
					</g>
				</g>
			{/if}
			<g transform="matrix(1 -0.5 0 1 16 16)">
				{#each PADS as pad (pad.cmd)}
					<g transform="translate({pad.x - 1.5} {pad.y - 1.75}) scale(0.5)">
						<g
							class="pad"
							class:pad--off={!hasTrack}
							role="button"
							tabindex="0"
							aria-label={pad.label}
							onpointerenter={() => interactive(true)}
							onpointerleave={() => interactive(false)}
							onclick={() => (playClick(), noteDirection(pad.cmd), window.jukebox?.control(pad.cmd))}
							onkeydown={(e) => onPadKey(e, pad.cmd)}
						>
							<rect class="pad__hit" x="-1.5" y="-1.5" width="9" height="10" fill="transparent" />
							<rect x="0" y="7" width="6" height="1" fill="#000" opacity="0.4" />
							<g class="pad__body">
								{#each pad.sprite as p, i (i)}<rect x={p.x} y={p.y} width={p.w} height="1" fill={p.c} />{/each}
								<rect class="pad__shade" width="6" height="7" fill="#000" opacity="0.18" />
								<rect class="pad__focus" x="-1" y="-1" width="8" height="9" fill="none" stroke="#fff" stroke-width="0.8" />
							</g>
						</g>
					</g>
				{/each}
			</g>
			<!-- Resize peg: a small blank wooden peg standing up from the lid's back corner. Drawn in the cube's own
			     32-unit space as three faces (lit top, shaded left and right) the way the cube is, so it reads as 3D. -->
			<g
				class="pad nub"
				role="slider"
				tabindex="0"
				aria-label="Jukebox size"
				aria-orientation="vertical"
				aria-valuemin={Math.round(ZOOM_MIN * 100)}
				aria-valuemax="100"
				aria-valuenow={Math.round(zoom * 100)}
				onpointerenter={() => interactive(true)}
				onpointerleave={() => {
					if (!sizeDrag) interactive(false);
				}}
				onpointerdown={sizeDown}
				onpointermove={sizeMove}
				onpointerup={sizeUp}
				onpointercancel={sizeUp}
				onkeydown={sizeKey}
			>
				<polygon class="pad__hit" points={PEG.hit} fill="transparent" />
				<!-- where the peg meets the lid: a soft dark patch on the wood -->
				<polygon points={PEG.shadow} fill="#000" opacity="0.38" />
				<g class="pad__body">
					<polygon points={PEG.left} fill="#8a5330" />
					<polygon points={PEG.right} fill="#573320" />
					<polygon points={PEG.top} fill="#cf935f" />
					<polyline points={PEG.edge} fill="none" stroke="#e8b283" stroke-width="0.25" stroke-linejoin="round" />
					<polygon class="pad__shade" points={PEG.all} fill="#000" opacity="0.14" />
					<polygon class="pad__focus" points={PEG.all} fill="none" stroke="#fff" stroke-width="0.4" stroke-linejoin="round" />
				</g>
			</g>
		</svg>
		</div>

		<span class="notes" aria-hidden="true">
			{#each notes as n (n.id)}
				<svg class="note" viewBox="0 0 6 8" shape-rendering="crispEdges" style="--hue: {n.hue}; --dx: {n.dx}; --nv: {n.m}">
					{#each NOTE as p, i (i)}<rect x={p.x + 0.4} y={p.y + 0.4} width={p.w} height="1" fill="rgba(0,0,0,0.55)" />{/each}
					{#each NOTE as p, i (i)}<rect x={p.x} y={p.y} width={p.w} height="1" fill="currentColor" />{/each}
				</svg>
			{/each}
		</span>

		{#if anim}
			<div class="drive" data-phase={anim.phase} data-back={anim.back} aria-hidden="true">
				<div class="disc disc--from">
					<svg viewBox="0 0 16 16" shape-rendering="crispEdges">
						{#each anim.from as p, i (i)}<rect x={p.x} y={p.y} width={p.w} height="1" fill={p.c} />{/each}
					</svg>
				</div>
				<div class="disc disc--to">
					<svg viewBox="0 0 16 16" shape-rendering="crispEdges">
						{#each anim.to as p, i (i)}<rect x={p.x} y={p.y} width={p.w} height="1" fill={p.c} />{/each}
					</svg>
				</div>
			</div>
		{/if}

		{#if menuOpen}
			<!-- The settings panel: the game's grey inventory window, laid over the jukebox. -->
			<div
				class="menu"
				role="dialog"
				aria-label="Settings"
				tabindex="-1"
				onpointerenter={() => interactive(true)}
				onpointerleave={() => interactive(false)}
			>
				<button bind:this={closeBtn} type="button" class="mc-btn menu__x" aria-label="Close settings" onclick={() => (playClick(), closeMenu())}>X</button>
				<div class="menu__checks">
					{#each [{ label: 'Boot on Spotify startup', on: loginOn, act: toggleLogin }, { label: 'Always on top', on: onTop, act: toggleOnTop }, { label: 'Click sounds', on: clickSounds, act: toggleClickSounds }] as c (c.label)}
						<button type="button" class="menu__check" role="checkbox" aria-checked={c.on} onclick={c.act}>
							<span class="menu__box">
								{#if c.on}
									<svg viewBox="0 0 9 8" shape-rendering="crispEdges" aria-hidden="true">
										<!-- a white tick with a dark offset copy, like the game's text shadow -->
										<path transform="translate(0.6 0.6)" d="M1 3h1v1H1zM2 4h1v1H2zM3 5h1v1H3zM4 4h1v1H4zM5 3h1v1H5zM6 2h1v1H6zM7 1h1v1H7zM1 4h1v1H1zM2 5h1v1H2zM3 6h1v1H3zM4 5h1v1H4zM5 4h1v1H5zM6 3h1v1H6zM7 2h1v1H7z" fill="#373737" />
										<path d="M1 3h1v1H1zM2 4h1v1H2zM3 5h1v1H3zM4 4h1v1H4zM5 3h1v1H5zM6 2h1v1H6zM7 1h1v1H7zM1 4h1v1H1zM2 5h1v1H2zM3 6h1v1H3zM4 5h1v1H4zM5 4h1v1H5zM6 3h1v1H6zM7 2h1v1H7z" fill="#ffffff" />
									</svg>
								{/if}
							</span>
							<span class="menu__label">{c.label}</span>
						</button>
					{/each}
				</div>
				<button type="button" class="mc-btn menu__quit" class:menu__quit--confirm={confirming} onclick={pressQuit}>
					{confirming ? 'Confirm?' : 'Close jukebox'}
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.stage {
		position: relative;
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-end;
		gap: 10px;
		/* Room under the box for the cast shadow, which falls toward the viewer (up to ~44px at the
		   screen's edges) plus its soft glow. Must match BOTTOM_PAD in electron/main.mjs. */
		padding-bottom: 64px;
		/* Everything is sized from --k, the block's scale against portfolioSite's 104px jukebox, so
		   the notes keep that project's proportions (18x24px, rising 64px, drifting 30px at 104px). */
		--k: calc(1.923 * var(--zoom, 1)); /* --zoom is the user's size, 0.45..1; 1 is the default and largest */
		--size: calc(104px * var(--k));
	}

	/* ── The floating line of text, game-style: white with a hard dark drop shadow, no box ── */
	.line {
		margin: 0;
		max-width: 300px;
		min-height: 2.4em;
		/* The rig reserves 56px of empty space above the box for the disc's flight, plus the 10px gap,
		   so the text used to float ~66px over the lid. Pull it down into that space: it now sits about
		   16px above the box. (It only overlaps the disc if you hover mid-song-change.) */
		margin-bottom: -50px;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		text-align: center;
		font-size: 17px;
		line-height: 1.15;
		color: #ffffff;
		text-shadow:
			2px 2px 0 #3f3f3f,
			-1px 0 0 rgba(0, 0, 0, 0.55),
			1px -1px 0 rgba(0, 0, 0, 0.55);
		opacity: 0;
		transform: translateY(4px);
		/* Slid back onto the screen near its left/right edges (see `lineShift`). The separate `translate`
		   property composes with the fade's `transform`, and is deliberately not transitioned so the text
		   stays inside the screen while the box is being dragged. */
		translate: var(--linex, 0px) 0;
		transition:
			opacity 0.2s steps(4),
			transform 0.2s steps(4);
		pointer-events: none;
		overflow-wrap: anywhere;
	}

	.line--show {
		opacity: 1;
		transform: none;
	}

	.line--flash {
		color: #ffff55;
	}

	/* Right above the slider's top end. In the 32-unit viewBox the slider's centre is x=4.5 and the top of
	   its groove is at screen y=12.25 (face y 2, plus the face's 0.5 slant per unit and 8 offset), so the
	   label's bottom edge sits a little above that. Everything is a fraction of --size, so it scales. */
	.vollabel {
		position: absolute;
		left: calc(var(--size) * 4.5 / 32);
		top: calc(var(--size) * 10.6 / 32);
		transform: translate(-50%, -100%);
		white-space: nowrap;
		font-size: 13px;
		line-height: 1;
		color: #ffffff;
		text-shadow: 2px 2px 0 #3f3f3f;
		pointer-events: none;
		/* The label overlaps the cube's lid, and it comes before the cube in the markup, so without this the
		   cube paints over it. Above the box, its controls and the notes; below the settings panel (5). */
		z-index: 4;
	}

	/* ── Settings panel: the portfolio's inventory window, scaled up a little ── */
	.menu {
		position: absolute;
		left: 50%;
		bottom: calc(var(--size) * 0.14);
		z-index: 5;
		/* Narrower than the 200px box, and raised off its bottom edge, so the lid and the box's sides
		   still show around it. Monocraft is wide, so the longer labels wrap onto a second line. */
		width: 168px;
		padding: 28px 10px 10px;
		transform: translateX(-50%);
		display: grid;
		gap: 8px;
		background: #c6c6c6;
		color: #3f3f3f;
		box-shadow:
			inset 2px 2px 0 #ffffff,
			inset -2px -2px 0 #555555,
			0 0 0 2px #0b0c0d,
			0 6px 14px rgba(0, 0, 0, 0.45);
		pointer-events: auto;
		cursor: default;
	}

	.mc-btn {
		position: relative;
		display: grid;
		place-items: center;
		min-height: 28px;
		padding: 0 6px;
		border: 0;
		background: #6f6f6f;
		box-shadow:
			inset 0 0 0 2px #0b0c0d,
			inset 3px 3px 0 2px #aaaaaa,
			inset -3px -3px 0 2px #3a3a3a;
		color: #ffffff;
		font: inherit;
		font-size: 12px;
		text-shadow: 1px 1px 0 #3f3f3f;
		cursor: pointer;
	}

	.mc-btn:hover,
	.mc-btn:focus-visible {
		background: #7f8bc6;
		color: #ffffa0;
		outline: none;
	}

	.mc-btn:active {
		background: #5d6aa8;
	}

	/* Small, and tucked right into the panel's top-left corner (its rim is 2px, so 3px in from it). */
	.menu__x {
		position: absolute;
		top: 3px;
		left: 3px;
		min-height: 18px;
		width: 18px;
		padding: 0;
		font-size: 12px;
		line-height: 1;
		box-shadow:
			inset 0 0 0 1px #0b0c0d,
			inset 2px 2px 0 1px #aaaaaa,
			inset -2px -2px 0 1px #3a3a3a;
	}

	.menu__checks {
		display: grid;
		gap: 4px;
	}

	.menu__check {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 1px;
		border: 0;
		background: none;
		color: #3f3f3f;
		font: inherit;
		font-size: 12px;
		text-align: left;
		cursor: pointer;
	}

	.menu__check:focus-visible {
		outline: 2px dashed #3f3f3f;
		outline-offset: 2px;
	}

	.menu__label {
		min-width: 0;
		line-height: 1.25;
		overflow-wrap: anywhere; /* wrap rather than overflow if a label is ever longer than the panel */
	}

	.menu__box {
		flex: none;
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		background: #8b8b8b;
		box-shadow:
			inset 2px 2px 0 #373737,
			inset -2px -2px 0 #ffffff;
	}

	.menu__check:hover .menu__box {
		background: color-mix(in srgb, #ffffff 30%, #8b8b8b);
	}

	.menu__box svg {
		width: 12px;
		height: 11px;
		image-rendering: pixelated;
	}

	.menu__quit {
		justify-self: center;
		width: 92%;
		min-height: 28px;
	}

	.menu__quit--confirm {
		color: #ffff55;
	}

	/* The game's item tooltip, as on the portfolio's discs: near-black violet panel, a violet rim, and a
	   darker violet lower edge. The portfolio's 1px/2px rim is doubled to match this larger block. */
	.tip {
		display: inline-block;
		max-width: 300px;
		padding: 8px 12px;
		font-size: 15px;
		line-height: 1.2;
		background: color-mix(in srgb, #100010 94%, transparent);
		box-shadow:
			inset 0 0 0 2px #100010,
			inset 0 0 0 4px #5000ff,
			inset 0 -4px 0 4px #28007f;
	}

	/* The game's "Now playing" line: white label, song name cycling through the rainbow. */
	.line__song {
		/* The coloured song name keeps the previous font; everything else is Monocraft. */
		font-family: 'Pixelify Sans Variable', ui-monospace, monospace;
		color: hsl(0 90% 60%);
		font-weight: 700;
		animation: rainbow 3s linear infinite;
	}

	@keyframes rainbow {
		to {
			filter: hue-rotate(360deg);
		}
	}

	.line--warn {
		color: #ffaa00;
		text-shadow: 2px 2px 0 #2a1500;
	}

	/* ── The jukebox ── */
	.rig {
		position: relative;
		width: var(--size);
		height: calc(var(--size) + 56px);
		flex: none;
	}

	/* The cast shadow: a polygon in the cube's own 32-unit projection (see `shadow` in the script). It is
	   a flat gradient fill, not a CSS filter, so following the box while it is dragged stays cheap. */
	.shadow {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
		pointer-events: none;
	}

	/* The cube and the controls drawn on its faces are ONE object. Every animation targets this wrapper
	   and nothing inside it, so the controls cannot drift from the box. Hover and press use the separate
	   `scale` property; the beat and landing use `transform`, so the two compose instead of fighting. */
	.body {
		position: absolute;
		left: 0;
		bottom: 0;
		width: var(--size);
		height: var(--size);
		transform-origin: 50% 100%;
		transition: scale 0.12s steps(3);
	}

	.block {
		position: absolute;
		inset: 0;
		padding: 0;
		border: 0;
		background: none;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}

	/* Hovering the box, a button or the slider all count as hovering the one object. */
	.rig:has(.block:hover, .pad:hover, .vol:hover) .body {
		scale: 1.02;
	}

	.rig:has(.block:active) .body,
	.rig--drag .body {
		scale: 0.98;
	}

	.block--drag {
		cursor: grabbing;
	}

	.block:focus-visible {
		outline: 3px dashed #ffffff;
		outline-offset: 4px;
	}

	.cube {
		display: block;
		width: 100%;
		height: 100%;
		image-rendering: pixelated;
		pointer-events: none;
	}

	.stage--playing .body {
		animation: thump 0.5s ease-in-out infinite alternate;
		will-change: transform; /* its own GPU layer: the beat moves the layer, it never repaints the cube */
	}

	@keyframes thump {
		to {
			transform: scale(1.03, 0.98);
		}
	}

	.notes {
		position: absolute;
		left: 50%;
		/* 8% down the block, as in portfolioSite; the block is the bottom --size of the rig. */
		top: calc(100% - var(--size) + var(--size) * 0.08);
		width: 0;
		height: 0;
		pointer-events: none;
	}

	.note {
		/* --s: the block's scale (--k) times this note's volume factor (--nv). */
		--s: calc(var(--k) * var(--nv, 1));
		position: absolute;
		left: calc(-9px * var(--s));
		top: calc(-24px * var(--s));
		width: calc(18px * var(--s));
		max-width: none;
		height: calc(24px * var(--s));
		color: hsl(var(--hue) 95% 58%);
		/* The hard shadow is drawn as an offset dark copy inside the SVG, not as an animated filter. */
		overflow: visible;
		animation: rise 1.7s ease-out forwards;
	}

	/* The rise and drift stay tied to the block (--k), so a quiet note is a small note, not a short flight. */
	@keyframes rise {
		0% {
			opacity: 0;
			transform: translate(0, calc(6px * var(--k))) scale(0.6);
		}
		15% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translate(calc(var(--dx) * 30px * var(--k)), calc(-64px * var(--k))) scale(1);
		}
	}

	/* ── Controls drawn on the cube's faces (same viewBox and matrices, so they follow its perspective) ── */
	.pads {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
		pointer-events: none;
		image-rendering: pixelated;
		/* Hidden until the pointer is on the jukebox. */
		opacity: 0;
		transition: opacity 0.18s ease;
	}

	/* Shown while the pointer is over the box, a button or the slider (so moving between them never
	   flickers), while the slider is being dragged, or when a control has keyboard focus. NOT while the
	   box itself is being dragged: they fade out for the move, and fade back in on release only if the
	   pointer is still over the jukebox (the :hover rules below simply apply again). */
	.rig:not(.rig--drag):has(.block:hover, .pad:hover, .vol:hover, .vol:active, .block:focus-visible, .pad:focus-visible, .vol:focus-visible) .pads {
		opacity: 1;
	}

	.pad,
	.vol {
		/* Invisible controls must not catch clicks: a click where a button sits should still reach the
		   box (play/pause). They only take the pointer once the fade-in has started. */
		pointer-events: none;
		outline: none;
	}

	.rig:not(.rig--drag):has(.block:hover, .pad:hover, .vol:hover, .vol:active, .block:focus-visible, .pad:focus-visible, .vol:focus-visible) .pad,
	.rig:not(.rig--drag):has(.block:hover, .pad:hover, .vol:hover, .vol:active, .block:focus-visible, .pad:focus-visible, .vol:focus-visible) .vol {
		pointer-events: auto;
	}

	.pad {
		cursor: pointer;
	}

	.nub {
		cursor: ns-resize;
	}

	/* Pressed, the peg sinks into the lid a little instead of sliding sideways like the flat buttons. */
	.nub.pad:active .pad__body {
		transform: translate(0, 0.5px);
	}

	.pad--off {
		opacity: 0.55;
	}

	.vol {
		cursor: ns-resize;
	}

	.pad__body {
		transition: transform 0.08s steps(2);
	}

	/* Pressed: pushed into the face, i.e. along the face's own axes, so it sinks in perspective. */
	.pad:active .pad__body {
		transform: translate(1px, 1px); /* the pad group is at half scale, so this is half a grid unit */
	}

	.pad:hover .pad__shade,
	.vol:hover .vol__shade {
		opacity: 0;
	}

	.pad__focus,
	.vol__focus {
		opacity: 0;
	}

	.pad:focus-visible .pad__focus,
	.vol:focus-visible .vol__focus {
		opacity: 1;
	}

	/* ── Song change: the disc pops out, hovers, is swapped for the next, which drops in ──
	   All of it is centred on the lid and measured from --size, so it scales with the block. */
	.drive {
		--lift: calc(var(--size) * 0.34);
		--slide: calc(var(--size) * 0.5);
		position: absolute;
		left: 0;
		bottom: 0;
		width: var(--size);
		height: var(--size);
		pointer-events: none;
		/* Only what is above the lid's centre line is drawn, so the disc rises out of the slot and
		   falls back into it instead of floating over the box. The other sides are open. */
		clip-path: inset(-300% -300% 75% -300%);
	}

	.disc {
		position: absolute;
		left: 50%;
		/* The lid's centre is a quarter of the way down the block. */
		bottom: calc(var(--size) * 0.75);
		width: calc(var(--size) * 0.44);
		height: calc(var(--size) * 0.44);
		margin: 0 0 calc(var(--size) * -0.22) calc(var(--size) * -0.22);
		opacity: 0;
		filter: drop-shadow(0 calc(var(--size) * 0.04) 0 rgba(0, 0, 0, 0.25));
	}

	.disc svg {
		display: block;
		width: 100%;
		height: 100%;
		image-rendering: pixelated;
		/* Flat above the lid like the game's jukebox, and spinning; it bobs on the separate `translate`. */
		transform: scaleY(0.5);
	}

	[data-phase='hold'] .disc--from svg,
	[data-phase='rest'] .disc--to svg,
	[data-phase='pop'] .disc--from svg,
	[data-phase='swap'] .disc svg,
	[data-phase='drop'] .disc--to svg {
		animation:
			spin 2.4s linear infinite,
			bob 1.6s ease-in-out infinite alternate;
		will-change: transform, translate;
	}

	@keyframes spin {
		from {
			transform: scaleY(0.5) rotate(0deg);
		}
		to {
			transform: scaleY(0.5) rotate(360deg);
		}
	}

	@keyframes bob {
		from {
			translate: 0 0;
		}
		to {
			translate: 0 calc(var(--size) * -0.02);
		}
	}

	/* pop: shot out of the slot like a physics object. Each leg is a parabola: the climb uses an
	   ease-out quad (fast, slowing under gravity), every fall an ease-in quad (speeding up), and each
	   bounce is smaller than the last until it rests on an invisible floor at hover height (--lift). */
	[data-phase='pop'] .disc--from {
		animation: pop 0.95s forwards;
		will-change: transform, opacity;
	}

	@keyframes pop {
		0% {
			opacity: 1;
			/* starts a full disc below the clip line, i.e. still inside the box */
			transform: translateY(calc(var(--size) * 0.22));
			animation-timing-function: cubic-bezier(0.25, 0.46, 0.45, 0.94);
		}
		40% {
			/* apex, 0.3 block-widths above the floor */
			transform: translateY(calc(var(--lift) * -1 - var(--size) * 0.3));
			animation-timing-function: cubic-bezier(0.55, 0.085, 0.68, 0.53);
		}
		67% {
			/* first landing */
			transform: translateY(calc(var(--lift) * -1));
			animation-timing-function: cubic-bezier(0.25, 0.46, 0.45, 0.94);
		}
		79% {
			transform: translateY(calc(var(--lift) * -1 - var(--size) * 0.05));
			animation-timing-function: cubic-bezier(0.55, 0.085, 0.68, 0.53);
		}
		88% {
			transform: translateY(calc(var(--lift) * -1));
			animation-timing-function: cubic-bezier(0.25, 0.46, 0.45, 0.94);
		}
		94% {
			transform: translateY(calc(var(--lift) * -1 - var(--size) * 0.015));
			animation-timing-function: cubic-bezier(0.55, 0.085, 0.68, 0.53);
		}
		100% {
			opacity: 1;
			transform: translateY(calc(var(--lift) * -1));
		}
	}

	[data-phase='hold'] .disc--from {
		opacity: 1;
		transform: translateY(calc(var(--lift) * -1));
	}

	/* swap: the old one slides out left and fades while the new one slides in from the right */
	[data-phase='swap'] .disc--from {
		animation: out-left 0.7s cubic-bezier(0.4, 0, 0.6, 1) forwards;
		will-change: transform, opacity;
	}

	[data-phase='swap'] .disc--to {
		animation: in-right 0.7s cubic-bezier(0.4, 0, 0.6, 1) forwards;
		will-change: transform, opacity;
	}

	/* Going back (data-back="true") mirrors it: the old disc slides out to the right, the new one in from the
	   left. --dir is 1 going forward and -1 going back, and flips the sign of both slides. */
	.drive {
		--dir: 1;
	}

	.drive[data-back='true'] {
		--dir: -1;
	}

	@keyframes out-left {
		from {
			opacity: 1;
			transform: translate(0, calc(var(--lift) * -1));
		}
		to {
			opacity: 0;
			transform: translate(calc(var(--slide) * var(--dir) * -1), calc(var(--lift) * -1));
		}
	}

	@keyframes in-right {
		from {
			opacity: 0;
			transform: translate(calc(var(--slide) * var(--dir)), calc(var(--lift) * -1));
		}
		to {
			opacity: 1;
			transform: translate(0, calc(var(--lift) * -1));
		}
	}

	[data-phase='rest'] .disc--to {
		opacity: 1;
		transform: translateY(calc(var(--lift) * -1));
	}

	/* drop: it falls straight down into the slot, accelerating (ease-in quad), and the clip on .drive
	   swallows it as it crosses the lid. */
	[data-phase='drop'] .disc--to {
		animation:
			plop 0.34s cubic-bezier(0.55, 0.085, 0.68, 0.53) forwards,
			plop-fade 0.34s linear forwards;
		will-change: transform, opacity;
	}

	@keyframes plop {
		from {
			transform: translateY(calc(var(--lift) * -1));
		}
		to {
			transform: translateY(calc(var(--size) * 0.22));
		}
	}

	/* A very quick fade (~85ms) timed to finish as the disc reaches the lid line, so it is already
	   gone by the time it should be inside the slot and nobody can tell it never visibly enters the
	   hole. It is its own animation so the fall keeps its gravity curve. */
	@keyframes plop-fade {
		0%,
		55% {
			opacity: 1;
		}
		80%,
		100% {
			opacity: 0;
		}
	}

	/* the box takes the record with a squash, as it lands */
	.stage--drop .body {
		animation: plop-box 0.3s ease-in-out 0.26s 1;
	}

	@keyframes plop-box {
		50% {
			transform: scale(1.04, 0.95);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.stage--playing .body,
		.stage--drop .body,
		.drive .disc,
		.drive .disc svg,
		.line__song {
			animation: none;
		}
		.line,
		.body,
		.shadow,
		.pads,
		.pad__body {
			transition: none;
		}
	}
</style>
