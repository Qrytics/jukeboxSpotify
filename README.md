# Jukebox

A Minecraft jukebox that sits on your desktop and opens by itself when Spotify does.

## Download

Get the installer for your computer from the **[latest release](../../releases/latest)**:

| | File | Then |
|---|---|---|
| **Windows** | `Jukebox-Setup.exe` | Run it. It installs Jukebox, adds it to your Start menu and Apps list, and starts it. |
| **Mac (Apple silicon: M1 or newer)** | `Jukebox-arm64.dmg` | Open it and drag Jukebox into **Applications**. |
| **Mac (Intel)** | `Jukebox-x64.dmg` | Same. |

Not sure which Mac you have?  menu → **About This Mac**: "Chip: Apple M…" is Apple silicon, "Processor: Intel" is Intel.

Jukebox isn't code-signed (that costs the author a yearly fee), so your computer will warn you the first time. This is expected:

- **Windows:** "Windows protected your PC" → click **More info** → **Run anyway**.
- **Mac:** if it says the app "can't be opened", open **System Settings → Privacy & Security**, scroll down and click **Open Anyway** next to Jukebox (or right-click the app in Applications → **Open**).

On a Mac, the first time it runs it asks whether Jukebox may control Spotify. Click **OK**: that's how it sees what's playing. It has no Dock icon; look for it in the menu bar, and for the jukebox on your screen whenever Spotify is open.

## What it is

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
npm run icons      # regenerate the app and tray icons from the pixel art
npm run dist:mac   # or dist:win — builds the installer into release/
```
Needs Node 22+. If Electron's binary is missing after `npm install`, run `node node_modules/electron/install.js`.

### Releasing
Installers are built by GitHub Actions (`.github/workflows/release.yml`) on a Windows and a Mac machine. To publish one:
```
npm version patch          # bumps package.json and creates the tag, e.g. v0.1.1
git push origin main --follow-tags
```
When the build finishes, the installers appear on the repo's Releases page.

## Layout
- `electron/main.mjs` — tray, transparent click-through window, show/hide with Spotify
- `electron/spotify/` — `mac.mjs`, `win.mjs` + `win-bridge.ps1`, `mock.mjs`
- `src/App.svelte` — the jukebox (all UI)
- `src/pixels.ts` — generated pixel art, no image files: the cube, the music discs (13 colour schemes × 10 designs, picked per song) and the controls
- `scripts/make-icons.mjs` — draws the app and tray icons from that same pixel art

Derived from the jukebox in [portfolioSite](https://github.com/Qrytics/portfolioSite).
