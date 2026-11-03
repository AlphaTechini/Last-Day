<script lang="ts">
	import EmployeesPage from '#lib/components/pages/EmployeesPage.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<EmployeesPage {data} {form} />
