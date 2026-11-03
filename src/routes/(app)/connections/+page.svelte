<script lang="ts">
	import ConnectionsPage from '#lib/components/pages/ConnectionsPage.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<ConnectionsPage {data} {form} />
