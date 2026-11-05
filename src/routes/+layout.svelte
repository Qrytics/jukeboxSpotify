<script lang="ts">
	import '@fontsource-variable/jetbrains-mono/wght.css';
	import '../app.css';
	import Jukebox from '$lib/components/jukebox/Jukebox.svelte';

	let { children } = $props();
</script>

{@render children()}
<Jukebox />
