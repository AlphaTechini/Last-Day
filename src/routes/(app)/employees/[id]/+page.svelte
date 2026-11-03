<script lang="ts">
	import EmployeeProfilePage from '#lib/components/pages/EmployeeProfilePage.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<EmployeeProfilePage {data} {form} />
