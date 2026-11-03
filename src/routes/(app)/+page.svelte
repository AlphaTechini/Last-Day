<script lang="ts">
	import DashboardPage from '#lib/components/pages/DashboardPage.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<DashboardPage {data} {form} />
