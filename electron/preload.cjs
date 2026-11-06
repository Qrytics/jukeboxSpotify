const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jukebox', {
	onState(cb) {
		const handler = (_e, state) => cb(state);
		ipcRenderer.on('jukebox:state', handler);
		ipcRenderer.send('jukebox:ready');
		return () => ipcRenderer.removeListener('jukebox:state', handler);
	},
	control: (cmd) => ipcRenderer.send('jukebox:control', cmd),
	setVolume: (v) => ipcRenderer.send('jukebox:volume', v),
	setInteractive: (on) => ipcRenderer.send('jukebox:interactive', !!on),
	onPrefs(cb) {
		const handler = (_e, prefs) => cb(prefs);
		ipcRenderer.on('jukebox:prefs', handler);
		return () => ipcRenderer.removeListener('jukebox:prefs', handler);
	},
	onPlace(cb) {
		const handler = (_e, place) => cb(place);
		ipcRenderer.on('jukebox:place', handler);
		return () => ipcRenderer.removeListener('jukebox:place', handler);
	},
	setOnTop: (on) => ipcRenderer.send('jukebox:on-top', !!on),
	setLogin: (on) => ipcRenderer.send('jukebox:login', !!on),
	setClickSounds: (on) => ipcRenderer.send('jukebox:click-sounds', !!on),
	quit: () => ipcRenderer.send('jukebox:quit'),
	dragStart: () => ipcRenderer.send('jukebox:drag-start'),
	dragMove: (dx, dy) => ipcRenderer.send('jukebox:drag-move', dx, dy),
	dragEnd: () => ipcRenderer.send('jukebox:drag-end')
});
