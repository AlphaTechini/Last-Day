<script lang="ts">
	import { SYSTEM_NAMES, type SystemId } from '#lib/types.ts';

	let {
		system,
		size = 28,
		bare = false,
		title
	}: { system: SystemId | null | undefined; size?: number; bare?: boolean; title?: string } = $props();

	const name = $derived(system ? SYSTEM_NAMES[system] : 'Last Day');
	const glyph = $derived(Math.round(bare ? size : size * 0.58));
</script>

<span
	class="sys"
	class:bare
	style:--s="{size}px"
	role="img"
	aria-label={title ?? name}
	title={title ?? name}
>
	<svg width={glyph} height={glyph} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		{#if system === 'keycloak'}
			<path d="M8 1.6 13.55 4.8v6.4L8 14.4 2.45 11.2V4.8Z" />
			<circle cx="8" cy="6.9" r="1.55" />
			<path d="M8 8.45v2.3" />
		{:else if system === 'mattermost'}
			<path d="M8 2.2a5.8 5.8 0 1 1-2.95 10.8L2.3 13.7l.72-2.62A5.8 5.8 0 0 1 8 2.2Z" />
			<path d="M6.1 9.9 9.9 6.1" />
		{:else if system === 'github'}
			<circle cx="4.9" cy="3.6" r="1.45" />
			<circle cx="4.9" cy="12.4" r="1.45" />
			<circle cx="11.1" cy="5.3" r="1.45" />
			<path d="M4.9 5.05v5.9" />
			<path d="M11.1 6.75c0 2.6-6.2 1.6-6.2 4.2" />
		{:else if system === 'vultr'}
			<path d="M2.6 3.6h3.1L8 8.9l2.3-5.3h3.1L8 13.4Z" />
		{:else}
			<circle cx="8" cy="8" r="5.5" />
		{/if}
	</svg>
</span>

<style>
	.sys {
		display: inline-grid;
		place-items: center;
		flex: none;
		width: var(--s);
		height: var(--s);
		border-radius: calc(var(--s) * 0.26);
		background: var(--surface);
		color: var(--text);
		box-shadow:
			inset 0 0 0 1px var(--border),
			0 1px 1px rgb(16 24 40 / 0.04);
	}
	.bare {
		background: none;
		box-shadow: none;
		color: var(--text-2);
		width: auto;
		height: auto;
	}
</style>
