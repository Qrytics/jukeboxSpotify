<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { trackName, tracks, type Track } from '$lib/data/jukebox';
	import { getLocalItem, setLocalItem } from '$lib/utils/safeStorage';
	import { loadSoundPref, soundPref } from '$lib/utils/soundPref.svelte';
	import { NOTE, disc, sideFace, topFace } from './pixels';

	/**
	 * A tiny jukebox in the bottom-left corner of every page. Hover (or focus, or tap) and it springs
	 * up to full size with a panel of discs above it; pick one and it plays, then shuffles on to
	 * another when the song ends. Mounted in the root layout, so it — and the player — survive
	 * client-side navigation and the music keeps going between pages.
	 *
	 * The audio is SoundCloud's own embedded player, not files hosted here: one iframe, created on
	 * the first disc click and driven through SoundCloud's Widget API (`load`, `toggle`, `setVolume`,
	 * and its PLAY / PAUSE / FINISH events). Its terms ask for the uploader and SoundCloud to be
	 * credited with a visible link to each track, so the player stays visible in the panel and the
	 * "now playing" line links out. Nothing loads from SoundCloud until a disc is clicked, nothing
	 * plays without one, and the site-wide mute silences it too.
	 */
	type Widget = {
		bind(event: string, cb: () => void): void;
		load(url: string, opts: Record<string, unknown>): void;
		toggle(): void;
		pause(): void;
		play(): void;
		setVolume(v: number): void;
	};
	type SoundCloud = {
		Widget: ((el: HTMLIFrameElement) => Widget) & { Events: Record<'PLAY' | 'PAUSE' | 'FINISH' | 'ERROR' | 'READY', string> };
	};

	const SIDE = sideFace();
	const TOP = topFace();
	const DISCS = tracks.map((t, i) => disc(t.label, i * 97 + 13));
	const playable = tracks.filter((t) => t.url);
	const PLAYER_OPTS = {
		auto_play: true,
		visual: false,
		show_artwork: false,
		show_comments: false,
		show_reposts: false,
		show_teaser: false,
		hide_related: true,
		color: '#3ee03e'
	};

	let pinned = $state(false);
	let current = $state<Track | null>(null);
	let paused = $state(true);
	let volume = $state(0.6);
	let tip = $state<number | null>(null);
	let notes = $state<{ id: number; hue: number; dx: number }[]>([]);
	let root = $state<HTMLElement | undefined>();
	let frame = $state<HTMLIFrameElement | undefined>();
	let frameSrc = $state<string | null>(null);
	/** The browser held autoplay back (Safari can); the user has to press play in the player. */
	let stalled = $state(false);
	let failed = $state(false);

	let widget: Widget | null = null;
	let api: Promise<SoundCloud> | null = null;
	let noteId = 0;
	let noteTimer: ReturnType<typeof setInterval> | undefined;
	let stallTimer: ReturnType<typeof setTimeout> | undefined;
	const broken = new Set<string>();

	const playing = $derived(!!current && !paused);

	function loadApi(): Promise<SoundCloud> {
		api ??= new Promise<SoundCloud>((resolve, reject) => {
			const w = window as unknown as { SC?: SoundCloud };
			if (w.SC) return resolve(w.SC);
			const script = document.createElement('script');
			script.src = 'https://w.soundcloud.com/player/api.js';
			script.async = true;
			script.onload = () => (w.SC ? resolve(w.SC) : reject(new Error('SoundCloud API missing')));
			script.onerror = () => {
				api = null; // let a later click retry
				reject(new Error('SoundCloud API blocked'));
			};
			document.head.appendChild(script);
		});
		return api;
	}

	function applyVolume() {
		// Perceptual: squaring makes the slider feel linear to the ear.
		widget?.setVolume(soundPref.enabled ? Math.round(volume * volume * 100) : 0);
	}

	function togglePlay() {
		if (!widget || !current) return;
		if (playing) {
			widget.pause();
			paused = true;
		} else {
			widget.play();
			paused = false;
			stalled = false;
			applyVolume();
		}
	}

	/** `auto`: picked by the shuffle, not clicked — a track that won't start is skipped, not waited on. */
	async function play(t: Track, auto = false) {
		if (!t.url || broken.has(t.id)) return;
		if (current?.id === t.id && widget) {
			togglePlay();
			return;
		}
		current = t;
		paused = true; // reset until playback is confirmed
		failed = false;
		stalled = false;
		clearTimeout(stallTimer);

		// Autoplay recovery timer: on mobile or strict browsers, autoplay without user interaction
		// may be held back. If paused after a few seconds, retry load once, then mark stalled so
		// the user can tap Play. Never mark tracks broken from autoplay blocks.
		stallTimer = setTimeout(() => {
			if (!paused || current?.id !== t.id || !t.url) return;
			widget?.load(t.url, {
				...PLAYER_OPTS,
				callback: () => {
					applyVolume();
					if (!auto) widget?.play();
				}
			});
			stallTimer = setTimeout(() => {
				if (!paused || current?.id !== t.id) return;
				stalled = true;
			}, 3500);
		}, 4000);

		if (widget) {
			widget.load(t.url, {
				...PLAYER_OPTS,
				callback: () => {
					applyVolume();
					if (!auto) widget?.play();
				}
			});
			if (!auto) {
				try {
					widget.play();
				} catch {
					// Ignored if widget not fully ready; callback will trigger it.
				}
			}
			return;
		}
		// First disc: render the iframe while this click's user activation is fresh, so the
		// delegated `allow="autoplay"` lets it start on its own.
		frameSrc = `https://w.soundcloud.com/player/?${new URLSearchParams({ url: t.url, ...Object.fromEntries(Object.entries(PLAYER_OPTS).map(([k, v]) => [k, String(v)])) })}`;
		await tick();
		const SC = await loadApi().catch(() => null);
		if (!SC || !frame) {
			failed = true;
			return;
		}
		widget = SC.Widget(frame);
		const E = SC.Widget.Events;
		widget.bind(E.READY, () => {
			applyVolume();
			if (!auto) widget?.play();
		});
		widget.bind(E.PLAY, () => {
			paused = false;
			stalled = false;
			applyVolume();
		});
		widget.bind(E.PAUSE, () => (paused = true));
		widget.bind(E.FINISH, () => shuffle());
		widget.bind(E.ERROR, () => {
			if (current) broken.add(current.id);
			if (!auto) shuffle();
			else eject();
		});
	}

	function shuffle() {
		const pool = playable.filter((t) => !broken.has(t.id) && t.id !== current?.id);
		if (!pool.length) return eject();
		void play(pool[Math.floor(Math.random() * pool.length)], true);
	}

	function eject() {
		widget?.pause();
		clearTimeout(stallTimer);
		current = null;
		paused = true;
		stalled = false;
	}

	function onVolume(e: Event) {
		volume = Number((e.currentTarget as HTMLInputElement).value) / 100;
		applyVolume();
		setLocalItem('jukebox-volume', String(volume));
	}

	// Notes rise from the lid while a song plays.
	$effect(() => {
		clearInterval(noteTimer);
		if (!playing || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
		noteTimer = setInterval(() => {
			if (document.hidden) return;
			const id = noteId++;
			notes = [...notes.slice(-6), { id, hue: Math.floor(Math.random() * 300), dx: Math.random() * 2 - 1 }];
			setTimeout(() => (notes = notes.filter((n) => n.id !== id)), 1700);
		}, 650);
		return () => clearInterval(noteTimer);
	});

	$effect(() => {
		void soundPref.enabled;
		applyVolume();
	});

	// A tap opens it (there is no hover on touch); a tap anywhere else, or Escape, closes it.
	$effect(() => {
		if (!pinned) return;
		const away = (e: PointerEvent) => {
			if (!root?.contains(e.target as Node)) pinned = false;
		};
		const esc = (e: KeyboardEvent) => {
			if (e.key === 'Escape') pinned = false;
		};
		window.addEventListener('pointerdown', away);
		window.addEventListener('keydown', esc);
		return () => {
			window.removeEventListener('pointerdown', away);
			window.removeEventListener('keydown', esc);
		};
	});

	onMount(() => {
		loadSoundPref();
		void loadApi().catch(() => {});
		const saved = Number(getLocalItem('jukebox-volume'));
		if (Number.isFinite(saved) && saved >= 0 && saved <= 1 && getLocalItem('jukebox-volume') !== null) volume = saved;
		return () => {
			clearInterval(noteTimer);
			clearTimeout(stallTimer);
			widget?.pause();
		};
	});

	const nowPlaying = $derived(current ? trackName(current) : '');
</script>

{#snippet sprite(r: { x: number; y: number; w: number; c: string }[], cls = '')}
	<svg class={cls} viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">
		{#each r as p, i (i)}<rect x={p.x} y={p.y} width={p.w} height="1" fill={p.c} />{/each}
	</svg>
{/snippet}

<div class="jb" class:jb--open={pinned} class:jb--playing={playing} bind:this={root}>
	<div class="panel" id="jukebox-panel" role="group" aria-label="Jukebox">
		<div class="panel__head">
			<span class="panel__title">Jukebox</span>
			<span class="panel__state">{playing ? 'playing' : current ? 'paused' : 'idle'}</span>
		</div>

		<div class="slots">
			{#each tracks as t, i (t.id)}
				{@const empty = !t.url || broken.has(t.id)}
				<button
					type="button"
					class="slot"
					class:slot--empty={empty}
					class:slot--on={current?.id === t.id}
					aria-label={empty ? 'Empty disc slot' : `${current?.id === t.id && playing ? 'Pause' : 'Play'} ${trackName(t)}`}
					aria-disabled={empty}
					onclick={() => play(t)}
					onpointerenter={(e) => {
						if (e.pointerType !== 'touch') tip = i;
					}}
					onpointerleave={() => (tip = null)}
					onfocus={() => (tip = i)}
					onblur={() => (tip = null)}
				>
					{@render sprite(DISCS[i], 'slot__disc')}
				</button>
			{/each}
			{#if tip !== null}
				{@const t = tracks[tip]}
				<div class="tooltip" class:tooltip--edge={tip % 4 === 0} style="--col: {tip % 4}; --row: {Math.floor(tip / 4)}" aria-hidden="true">
					<span class="tooltip__name">Music Disc</span>
					<span class="tooltip__desc">{t.url ? trackName(t) : `${trackName(t)} — not on SoundCloud yet`}</span>
					{#if t.uploader}<span class="tooltip__src">SoundCloud · {t.uploader}</span>{/if}
				</div>
			{/if}
		</div>

		<p class="now" aria-live="polite">
			{#if failed}
				The SoundCloud player couldn't load — a blocker may be stopping it.
			{:else if current}
				<span class="now__label">Now playing:</span> <span class="now__song">{nowPlaying}</span>
			{:else}
				Pick a disc.
			{/if}
		</p>
		{#if current?.url}
			<p class="credit">
				uploaded by {current.uploader} ·
				<a href={current.url} target="_blank" rel="noopener noreferrer">SoundCloud ↗</a>
			</p>
		{/if}
		{#if stalled}
			<p class="credit credit--hint">Tap <strong>Play</strong> or ▶ in the player below to start.</p>
		{/if}
		{#if frameSrc}
			<div class="sc" class:sc--idle={!current} class:sc--stalled={stalled}>
				<iframe
					bind:this={frame}
					title="SoundCloud player"
					src={frameSrc}
					allow="autoplay; encrypted-media"
					width="100%"
					height={stalled ? '80' : '20'}
					scrolling="no"
				></iframe>
			</div>
		{/if}

		<div class="controls">
			{#if current}
				<button type="button" class="mc-btn mc-btn--play" onclick={togglePlay}>
					{playing ? 'Pause' : 'Play'}
				</button>
			{/if}
			<button type="button" class="mc-btn" disabled={!playable.length} onclick={shuffle}>Shuffle</button>
			<button type="button" class="mc-btn" disabled={!current} onclick={eject}>Eject</button>
		</div>

		<label class="slider">
			<input type="range" min="0" max="100" step="1" value={Math.round(volume * 100)} oninput={onVolume} aria-label="Music volume" />
			<span class="slider__text" aria-hidden="true">Music: {Math.round(volume * 100)}%</span>
		</label>
	</div>

	<button
		type="button"
		class="block"
		aria-label="Jukebox{current ? `, ${playing ? 'playing' : 'paused'}: ${nowPlaying}` : ''}"
		aria-expanded={pinned}
		aria-controls="jukebox-panel"
		onclick={() => (pinned = !pinned)}
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
		<span class="notes" aria-hidden="true">
			{#each notes as n (n.id)}
				<svg class="note" viewBox="0 0 6 8" shape-rendering="crispEdges" style="--hue: {n.hue}; --dx: {n.dx}">
					{#each NOTE as p, i (i)}<rect x={p.x} y={p.y} width={p.w} height="1" fill="currentColor" />{/each}
				</svg>
			{/each}
		</span>
	</button>
</div>

<style>
	/* The spring: overshoots, settles back, overshoots a little less, then sits. Browsers without
	   `linear()` drop that declaration and keep the plain back-out curve above it. */
	.jb {
		--spring: cubic-bezier(0.34, 1.56, 0.64, 1);
		--spring: linear(0, 0.013 0.6%, 0.05 1.2%, 0.2 2.6%, 0.43 4.3%, 0.86 7.7%, 1.04 9.6%, 1.17 11.8%, 1.22 13.4%, 1.24 15%, 1.22 16.9%, 1.16 19.2%, 0.98 25%, 0.92 28%, 0.9 31%, 0.92 34.5%, 1.02 42%, 1.04 46%, 1.03 50%, 0.99 60%, 0.995 67%, 1.003 78%, 1);
		--big: 104px;
		position: fixed;
		left: calc(12px + env(safe-area-inset-left, 0px));
		bottom: calc(12px + env(safe-area-inset-bottom, 0px));
		z-index: 1000;
		width: var(--big);
		height: var(--big);
		pointer-events: none;
		font-family: var(--font-mono);
	}

	/* ── The block ── */
	.block {
		position: absolute;
		inset: 0;
		padding: 0;
		border: 0;
		background: none;
		cursor: pointer;
		pointer-events: auto;
		transform: scale(0.4);
		transform-origin: 0 100%;
		transition: transform 0.35s ease;
		filter: drop-shadow(0 6px 8px color-mix(in srgb, var(--ink-black) 35%, transparent));
		-webkit-tap-highlight-color: transparent;
	}

	@media (hover: hover) {
		.jb:hover .block {
			transform: scale(1);
			transition: transform 0.9s var(--spring);
		}

		.jb:hover .panel {
			opacity: 1;
			visibility: visible;
			transform: none;
			transition:
				opacity 0.2s ease 0.12s,
				transform 0.5s var(--spring) 0.12s,
				visibility 0s;
		}
	}

	.jb:has(:focus-visible) .block,
	.jb--open .block {
		transform: scale(1);
		transition: transform 0.9s var(--spring);
	}

	.block:focus-visible {
		outline: 2px dashed var(--accent);
		outline-offset: 4px;
	}

	.cube {
		display: block;
		width: 100%;
		height: 100%;
		image-rendering: pixelated;
	}

	/* While a song plays, the box thumps gently on the beat. */
	.jb--playing .cube {
		animation: thump 0.5s ease-in-out infinite alternate;
		transform-origin: 50% 100%;
	}

	@keyframes thump {
		to {
			transform: scale(1.03, 0.98);
		}
	}

	.notes {
		position: absolute;
		left: 50%;
		top: 8%;
		width: 0;
		height: 0;
	}

	.note {
		position: absolute;
		left: -9px;
		top: -24px;
		width: 18px;
		max-width: none; /* the global `svg { max-width: 100% }` would collapse it in its 0-wide anchor */
		height: 24px;
		color: hsl(var(--hue) 95% 58%);
		filter: drop-shadow(1px 1px 0 color-mix(in srgb, var(--ink-black) 55%, transparent));
		animation: rise 1.7s ease-out forwards;
	}

	@keyframes rise {
		0% {
			opacity: 0;
			transform: translate(0, 6px) scale(0.6);
		}
		15% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translate(calc(var(--dx) * 30px), -64px) scale(1);
		}
	}

	/* ── The panel: a block-game inventory window ── */
	.panel {
		position: absolute;
		left: 0;
		bottom: calc(100% + 10px);
		width: 14rem;
		padding: 8px;
		background: #c6c6c6;
		color: #3f3f3f;
		box-shadow:
			inset 2px 2px 0 var(--paper-white),
			inset -2px -2px 0 #555555,
			0 0 0 2px var(--ink-black),
			0 14px 30px color-mix(in srgb, var(--ink-black) 45%, transparent);
		pointer-events: auto;
		opacity: 0;
		visibility: hidden;
		transform: translateY(8px) scale(0.92);
		transform-origin: 0 100%;
		transition:
			opacity 0.15s ease,
			transform 0.15s ease,
			visibility 0s linear 0.15s;
	}

	/* A bridge across the gap, so moving from the box up to the panel never drops the hover. */
	.panel::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		top: 100%;
		height: 14px;
	}

	.jb:has(:focus-visible) .panel,
	.jb--open .panel {
		opacity: 1;
		visibility: visible;
		transform: none;
		transition:
			opacity 0.2s ease 0.12s,
			transform 0.5s var(--spring) 0.12s,
			visibility 0s;
	}

	.panel__head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin: 0 2px 6px;
		font-size: 0.75rem;
	}

	.panel__title {
		color: #3f3f3f;
		font-weight: 700;
	}

	.panel__state {
		color: #6b6b6b;
		font-size: 0.75rem;
	}

	.slots {
		position: relative;
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 2px;
	}

	.slot {
		display: grid;
		place-items: center;
		aspect-ratio: 1;
		padding: 0;
		border: 0;
		background: #8b8b8b;
		box-shadow:
			inset 2px 2px 0 #373737,
			inset -2px -2px 0 var(--paper-white);
		cursor: pointer;
	}

	.slot:hover,
	.slot:focus-visible {
		background: color-mix(in srgb, var(--paper-white) 30%, #8b8b8b);
		outline: none;
	}

	.slot--on {
		background: color-mix(in srgb, #3ee03e 30%, #8b8b8b);
	}

	.slot--empty {
		cursor: default;
	}

	.slot--empty :global(.slot__disc) {
		opacity: 0.35;
		filter: grayscale(1);
	}

	.slot :global(.slot__disc) {
		width: 72%;
		height: 72%;
		image-rendering: pixelated;
	}

	.jb--playing .slot--on :global(.slot__disc) {
		animation: spin 1.8s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* The game's item tooltip: near-black violet, a violet rim, white name, grey lore. */
	.tooltip {
		position: absolute;
		z-index: 1;
		left: calc(var(--col) * 25% + 12.5%);
		top: calc(var(--row) * 50% - 4px);
		display: grid;
		gap: 2px;
		width: max-content;
		max-width: 13rem;
		padding: 5px 7px;
		background: color-mix(in srgb, #100010 94%, transparent);
		box-shadow:
			inset 0 0 0 1px #100010,
			inset 0 0 0 2px #5000ff,
			inset 0 -2px 0 2px #28007f;
		font-size: 0.75rem;
		line-height: 1.25;
		pointer-events: none;
		transform: translate(-30%, -100%);
	}

	/* The first disc in a row sits against the screen edge, where centring the tip on it would push
	   it off-screen. Line it up with the slot grid's left edge instead. */
	.tooltip--edge {
		left: 0;
		transform: translate(0, -100%);
	}

	.tooltip__name {
		color: var(--paper-white);
		text-shadow: 1px 1px 0 #3f3f3f;
	}

	.tooltip__desc {
		color: #aaaaaa;
		text-shadow: 1px 1px 0 #2a2a2a;
	}

	.tooltip__src {
		color: #5555ff;
		text-shadow: 1px 1px 0 #15153f;
	}

	.now {
		margin: 8px 2px 6px;
		min-height: 2.4em;
		color: #3f3f3f;
		font-size: 0.75rem;
		line-height: 1.2;
	}

	.credit {
		margin: -2px 2px 6px;
		color: #555555;
		font-size: 0.75rem;
	}

	.credit a {
		color: #2a2aa8;
		text-decoration: underline;
	}

	.credit a:hover,
	.credit a:focus-visible {
		color: #0000ee;
	}

	.credit--hint {
		color: #8a3b00;
	}

	/* SoundCloud's own mini player, kept on show (its terms want the source visible). Collapsed,
	   not removed, after an eject: a display:none iframe breaks the widget in some browsers. */
	.sc {
		height: 20px;
		margin: 0 0 6px;
		box-shadow: 0 0 0 1px var(--ink-black);
		background: var(--paper-white);
		transition: height 0.25s ease;
	}

	.sc--stalled {
		height: 84px;
	}

	.sc iframe {
		display: block;
		width: 100%;
		height: 100%;
		border: 0;
	}

	.sc--idle {
		height: 0;
		margin: 0;
		overflow: hidden;
		box-shadow: none;
	}

	.now__label {
		color: #555555;
	}

	/* The game's "Now Playing" line cycles through the rainbow. */
	.now__song {
		color: hsl(0 90% 40%);
		font-weight: 700;
		animation: rainbow 3s linear infinite;
	}

	@keyframes rainbow {
		to {
			filter: hue-rotate(360deg);
		}
	}

	.controls {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
		gap: 4px;
		margin-bottom: 4px;
	}

	.mc-btn--play {
		background: #4a752c;
		color: #eaffd0;
	}

	.mc-btn--play:hover {
		background: #5b9036;
		color: var(--paper-white);
	}

	.mc-btn,
	.slider {
		position: relative;
		display: grid;
		place-items: center;
		min-height: 1.9rem;
		background: #6f6f6f;
		box-shadow:
			inset 0 0 0 1px var(--ink-black),
			inset 2px 2px 0 1px #aaaaaa,
			inset -2px -2px 0 1px #3a3a3a;
		color: var(--paper-white);
		font: inherit;
		font-size: 0.75rem;
		text-shadow: 1px 1px 0 #3f3f3f;
	}

	.mc-btn {
		border: 0;
		cursor: pointer;
	}

	.mc-btn:hover:not(:disabled),
	.mc-btn:focus-visible {
		background: #7f8bc6;
		color: #ffffa0;
		outline: none;
	}

	.mc-btn:disabled {
		background: #2c2c2c;
		color: #a0a0a0;
		cursor: default;
	}

	.slider {
		display: block;
		background: #2c2c2c;
		box-shadow: inset 0 0 0 1px var(--ink-black);
	}

	.slider input {
		display: block;
		width: 100%;
		height: 1.9rem;
		margin: 0;
		background: transparent;
		cursor: pointer;
		appearance: none;
	}

	.slider input::-webkit-slider-thumb {
		width: 10px;
		height: 1.9rem;
		background: #c6c6c6;
		box-shadow:
			inset 0 0 0 1px var(--ink-black),
			inset 2px 2px 0 1px var(--paper-white),
			inset -2px -2px 0 1px #555555;
		appearance: none;
	}

	.slider input::-moz-range-thumb {
		width: 10px;
		height: 1.9rem;
		border: 0;
		border-radius: 0;
		background: #c6c6c6;
		box-shadow:
			inset 0 0 0 1px var(--ink-black),
			inset 2px 2px 0 1px var(--paper-white),
			inset -2px -2px 0 1px #555555;
	}

	.slider input:focus-visible {
		outline: 2px solid var(--paper-white);
		outline-offset: -2px;
	}

	.slider__text {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		pointer-events: none;
	}

	@media (max-width: 480px) {
		.jb {
			--big: 88px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.block,
		.jb:hover .block,
		.jb:has(:focus-visible) .block,
		.jb--open .block,
		.panel,
		.jb:hover .panel,
		.jb:has(:focus-visible) .panel,
		.jb--open .panel {
			transition-duration: 0s;
			transition-delay: 0s;
		}

		.jb--playing .cube,
		.jb--playing .slot--on :global(.slot__disc),
		.now__song {
			animation: none;
		}
	}

	@media print {
		.jb {
			display: none;
		}
	}
</style>
