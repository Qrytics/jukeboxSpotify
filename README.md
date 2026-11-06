# Jukebox

A Minecraft jukebox that sits on your desktop and opens by itself when Spotify does.

There is no window, background or panel. It is a transparent, always-on-top overlay that contains only the jukebox block, so it looks like one was placed on your screen. Everything around the block is click-through.

- **Click** the block to play or pause. **Drag** it to move it. It remembers where you left it.
- **Hover** the box to see the song, drawn like the game's floating "Now playing" text. Hovering the buttons doesn't show it.
- Two wooden **buttons** on the right face are previous and next. A wooden **slider** on the left face is the volume (macOS only; **scroll** on the box works too). All three are drawn on the cube's faces so they follow its perspective.
- While a song plays the block thumps and notes rise off the lid, bigger when the volume is higher.
- When the song changes, the record pops out of the box, hovers and spins, slides away as the next one slides in from the right, and drops into the slot.
- It lives in the menu bar / system tray (quit, start at login, reset position, show without Spotify).

## How it talks to Spotify
Spotify's own mini-player can't be modified, so this mirrors the real desktop app. No login, API keys or Premium.

| OS | Source | Notes |
|---|---|---|
| macOS | Spotify's AppleScript interface | Asks once for Automation permission. Reads track, art, position and volume; controls play, skip and volume. |
| Windows | Windows media session (PowerShell bridge) | Track, play state and play/pause/skip. No volume, so scrolling does nothing there. |

The OS is detected at launch. `JUKEBOX_MOCK=1` fakes Spotify for working on the skin.

## Develop
```
npm install
npm run dev:mock   # fake Spotify
npm run dev        # real Spotify
npm run check
npm run dist:mac   # or dist:win
```
Needs Node 22+. If Electron's binary is missing after `npm install`, run `node node_modules/electron/install.js`.

## Layout
- `electron/main.mjs` — tray, transparent click-through window, show/hide with Spotify
- `electron/spotify/` — `mac.mjs`, `win.mjs` + `win-bridge.ps1`, `mock.mjs`
- `src/App.svelte` — the jukebox (all UI)
- `src/pixels.ts` — generated pixel art, no image files

Derived from the jukebox in [portfolioSite](https://github.com/Qrytics/portfolioSite).
