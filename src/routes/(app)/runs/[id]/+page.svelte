<script lang="ts">
	import RunDetailPage from '#lib/components/pages/RunDetailPage.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<RunDetailPage {data} {form} />
