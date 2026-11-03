<script lang="ts">
	import SettingsPage from '#lib/components/pages/SettingsPage.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<SettingsPage {data} {form} />
