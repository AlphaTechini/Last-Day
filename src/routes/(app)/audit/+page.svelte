<script lang="ts">
	import AuditPage from '#lib/components/pages/AuditPage.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<AuditPage {data} />
