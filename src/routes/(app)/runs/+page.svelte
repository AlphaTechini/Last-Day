<script lang="ts">
	import RunsPage from '#lib/components/pages/RunsPage.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<RunsPage {data} />
