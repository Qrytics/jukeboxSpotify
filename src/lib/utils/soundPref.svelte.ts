/**
 * Stand-in for the portfolio's site-wide mute switch. The jukebox only reads `soundPref.enabled`;
 * here it is simply always on. Wire it to a real mute control if the widget gets one.
 */
export const soundPref = $state({ enabled: true, ready: false });

export function loadSoundPref() {
	soundPref.ready = true;
}
