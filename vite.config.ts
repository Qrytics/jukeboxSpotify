import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	base: './',
	plugins: [svelte()],
	// Not 5173: that is every other Vite project's default. dev.mjs reads the URL Vite actually bound.
	server: { host: '127.0.0.1', port: 5317, strictPort: false },
	// assetsInlineLimit 0: never inline assets as data: URIs. The 3KB click sound was being inlined, and the
	// page's security policy blocks data: audio, so it never played.
	build: { outDir: 'dist/renderer', emptyOutDir: true, target: 'chrome140', assetsInlineLimit: 0 }
});
