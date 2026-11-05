/**
 * The jukebox's discs, streamed from SoundCloud through its embeddable player — no audio files are
 * hosted here. `url` is the track's soundcloud.com page (also its required backlink); `uploader` is
 * the account that posted it, which SoundCloud's terms require crediting alongside the artist.
 * A disc with no `url` sits in its slot greyed out. `label` is the two colours of the disc's centre.
 */
export interface Track {
	id: string;
	title: string;
	artist: string;
	uploader?: string;
	url?: string;
	label: [string, string];
}

export const tracks: Track[] = [
	{
		id: 'blueberry-eyes',
		title: "Blueberry Eyes (feat. Lil Mosey, SUGA of BTS & Olivia O'Brien)",
		artist: 'MAX',
		uploader: 'MAX',
		url: 'https://soundcloud.com/officialmaxmusic/max-blueberry-eyes-feat-lil-mosey-suga-of-bts-olivia-obrien',
		label: ['#7fa8e0', '#3e6fb8']
	},
	{
		id: 'laiki',
		title: 'Лайки (feat. uniqe, nkeeei & ARTEM SHILOVETS)',
		artist: 'SODA LUV',
		uploader: 'SODA LUV',
		url: 'https://soundcloud.com/sodaluvluv/layki-feat-uniqe-nkeeei-artem-shilovets',
		label: ['#ff2a2a', '#7a0000']
	},
	{
		id: 'apartment',
		title: 'Apartment',
		artist: 'TogetherEffect',
		uploader: 'TogetherEffect',
		url: 'https://soundcloud.com/togethereffect/apartment',
		label: ['#a68cff', '#4a1fff']
	},
	{
		id: 'dial-143',
		title: 'Dial 143',
		artist: 'jomm',
		uploader: 'jomm',
		url: 'https://soundcloud.com/jomm-sc/dial-143',
		label: ['#f4c430', '#ffffff']
	},
	{
		id: 'dragostea-din-tei',
		title: 'Dragostea Din Tei',
		artist: 'O-Zone',
		uploader: 'Ozone',
		url: 'https://soundcloud.com/ozoneofficial/dragostea-din-tei-1',
		label: ['#c026ff', '#ffffff']
	},
	{
		id: 'sideways',
		title: 'Sideways',
		artist: 'Your Neighbors',
		uploader: 'Marmol Samich',
		url: 'https://soundcloud.com/marmol-samich/sideways-your-neighbors',
		label: ['#f97316', '#fde047']
	},
	{
		id: 'where-do-you-go',
		title: 'Where Do You Go?',
		artist: 'Leanys',
		uploader: 'Leanys',
		url: 'https://soundcloud.com/leanysmusic/where-do-you-go',
		label: ['#3ee03e', '#0f6a1f']
	},
	// Not on SoundCloud from diet lemon's own account; stays greyed out until it has a source.
	{ id: 'lime', title: 'lime', artist: 'diet lemon', label: ['#a6ff33', '#18e08a'] }
];

/** "Artist - Title", or just the title when the artist isn't known. */
export const trackName = (t: Track) => (t.artist ? `${t.artist} - ${t.title}` : t.title);
