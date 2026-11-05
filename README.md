# jukeboxSpotify

Reskinning the Spotify pop-out widget as a Minecraft jukebox.

Built on the jukebox from [portfolioSite](https://github.com/Qrytics/portfolioSite): a pixel-art jukebox
that springs open on hover, shows a panel of discs, and plays/shuffles tracks. The portfolio version streams
SoundCloud through its Widget API; this project will swap that for Spotify playback and reskin the UI to look
like a Minecraft jukebox.

## Stack
SvelteKit 2 + Svelte 5, TypeScript, Vercel adapter.

## Develop
```
npm install
npm run dev
npm run check
```

## Layout
- `src/lib/components/jukebox/Jukebox.svelte` — the widget (panel, discs, player wiring)
- `src/lib/components/jukebox/pixels.ts` — generated pixel art (no image files)
- `src/lib/data/jukebox.ts` — track list
- `src/lib/utils/soundPref.svelte.ts` — stub for the portfolio's site-wide mute switch
