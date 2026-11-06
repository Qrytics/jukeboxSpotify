# Jukebox

Electron + Svelte 5 + Vite desktop overlay: a Minecraft jukebox that shows when Spotify runs. macOS and Windows.

- The UI is ONLY the jukebox block on a transparent window. No panel, no background, no title bar. Keep it that way.
- Click-through: the renderer calls `setInteractive` on pointer enter/leave of the block; the window ignores mouse events otherwise.
- Spotify access lives in `electron/spotify/` behind one interface: `start(onState)`, `stop()`, `control('toggle'|'next'|'prev')`, `setVolume(0..1)`. State shape is `SpotifyState` in `src/types.ts`.
- Pixel art is generated in `src/pixels.ts`, not shipped as images.
- No Spotify web API / OAuth. Do not add one.
- Run `npm run check` and `npm run build` before committing.
