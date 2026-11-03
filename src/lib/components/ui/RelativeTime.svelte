<script lang="ts">
	import { onMount } from 'svelte';
	import { clock } from '#lib/ui/clock.svelte.ts';
	import { countdown, dateTime, relative, relativeShort } from '#lib/ui/format.ts';

	let {
		date,
		mode = 'relative',
		prefix = ''
	}: { date: string | null | undefined; mode?: 'relative' | 'short' | 'countdown'; prefix?: string } = $props();

	// Before mount use the time the HTML was rendered so hydration matches; then go live.
	let mounted = $state(false);
	const renderedAt = Date.now();
	onMount(() => (mounted = true));

	const now = $derived(mounted ? clock.now : renderedAt);
	const text = $derived(
		mode === 'countdown' ? countdown(date, now) : mode === 'short' ? relativeShort(date, now) : relative(date, now)
	);
</script>

{#if date}
	<time datetime={date} title={dateTime(date)}>{prefix}{text}</time>
{/if}

<style>
	time {
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
</style>
