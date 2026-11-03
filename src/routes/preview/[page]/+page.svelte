<script lang="ts">
	import { dev } from '$app/env';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import AppShell from '#lib/components/shell/AppShell.svelte';
	import ErrorPage from '#lib/components/pages/ErrorPage.svelte';
	import { defaultLayout, previewBySlug } from '#lib/ui/preview-registry.ts';
	import { setPreviewMode } from '#lib/ui/context.ts';
	import { startOfLiveRun, tick } from '#lib/ui/simulate.ts';
	import type { RunDetail } from '#lib/types.ts';

	setPreviewMode(true);

	const entry = $derived(dev ? previewBySlug.get(page.params.page ?? '') : undefined);

	// Live simulation: advance the run every 1.2s once mounted.
	let liveRun = $state<RunDetail | null>(null);
	onMount(() => {
		if (!entry?.live) return;
		const base = (entry.props.data as { run: RunDetail }).run;
		liveRun = startOfLiveRun(base);
		const id = setInterval(() => {
			if (liveRun) liveRun = tick(liveRun);
		}, 1200);
		return () => clearInterval(id);
	});

	const props = $derived(entry?.live && liveRun ? { ...entry.props, data: { run: liveRun } } : entry?.props);
</script>

{#if entry && props}
	{@const Page = entry.component}
	{#if entry.shell === false}
		<Page {...props} />
	{:else}
		{@const layout = entry.layout ?? defaultLayout}
		<AppShell user={layout.user} nav={layout.nav} isDemo={layout.isDemo} currentPath={entry.path}>
			{#key entry.slug}
				<Page {...props} />
			{/key}
		</AppShell>
	{/if}
{:else}
	<ErrorPage status={404} />
{/if}
