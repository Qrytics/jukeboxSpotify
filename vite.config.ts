import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	base: './',
	plugins: [svelte()],
	// Not 5173: that is every other Vite project's default. dev.mjs reads the URL Vite actually bound.
	server: { host: '127.0.0.1', port: 5317, strictPort: false },
	build: { outDir: 'dist/renderer', emptyOutDir: true, target: 'chrome140' }
});
