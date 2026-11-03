<script lang="ts">
	import AppShell from '#lib/components/shell/AppShell.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<AppShell user={data.user} nav={data.nav} isDemo={data.isDemo}>
	{@render children()}
</AppShell>
