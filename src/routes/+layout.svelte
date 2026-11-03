<script lang="ts">
	import type { Snippet } from 'svelte';
	import '@fontsource-variable/inter/opsz.css';
	import '@fontsource-variable/jetbrains-mono/wght.css';
	import '#lib/styles/tokens.css';
	import '#lib/styles/base.css';

	let { children }: { children: Snippet } = $props();
</script>

{@render children()}
