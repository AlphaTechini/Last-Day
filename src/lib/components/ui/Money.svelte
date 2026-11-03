<script lang="ts">
	import { aiCost, money } from '#lib/ui/format.ts';

	let {
		value,
		per,
		kind = 'standard'
	}: { value: number | null | undefined; per?: 'month'; kind?: 'standard' | 'ai' } = $props();

	const text = $derived(kind === 'ai' ? aiCost(value) : money(value));
</script>

<span class="money num">{text}{#if per === 'month'}<span class="per">/mo</span>{/if}</span>

<style>
	.money {
		white-space: nowrap;
	}
	.per {
		color: var(--text-3);
		font-weight: var(--weight-regular);
		margin-left: 1px;
		font-size: 0.86em;
	}
</style>
