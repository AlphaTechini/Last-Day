<script lang="ts">
	import LoginPage from '#lib/components/pages/LoginPage.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<LoginPage {data} {form} />
