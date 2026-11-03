<script lang="ts">
	import UnknownPage from '#lib/components/pages/UnknownPage.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<UnknownPage {data} {form} />
