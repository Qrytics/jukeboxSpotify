# jukeboxSpotify

Standalone SvelteKit app: the Spotify pop-out widget reskinned as a Minecraft jukebox.
Forked from the jukebox in `~/gitProjects/portfolioSite` (`src/lib/components/jukebox/`).

- The widget is still wired to the **SoundCloud Widget API** (inherited). Moving playback to Spotify is the main open task.
- `soundPref.svelte.ts` is a stub (always enabled); the portfolio's real one is tied to its sound manager.
- Pixel art is generated in `pixels.ts`, not shipped as images. Keep it that way.
- Run `npm run check` before committing.
