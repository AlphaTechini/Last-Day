<script lang="ts">
	import type { Snippet } from 'svelte';

	export interface KVItem {
		label: string;
		value?: string | number | null;
		mono?: boolean;
		render?: Snippet;
	}

	let { items, layout = 'rows', dense = false }: { items: KVItem[]; layout?: 'rows' | 'grid'; dense?: boolean } = $props();
</script>

<dl class="kv layout-{layout}" class:dense>
	{#each items as item (item.label)}
		<div class="pair">
			<dt>{item.label}</dt>
			<dd class:mono={item.mono}>
				{#if item.render}
					{@render item.render()}
				{:else if item.value == null || item.value === ''}
					<span class="none">None</span>
				{:else}
					{item.value}
				{/if}
			</dd>
		</div>
	{/each}
</dl>

<style>
	.kv {
		display: flex;
		flex-direction: column;
	}
	.layout-rows .pair {
		display: grid;
		grid-template-columns: minmax(96px, 38%) 1fr;
		gap: var(--space-3);
		padding: 9px 0;
		border-top: 1px solid var(--border-subtle);
		align-items: baseline;
	}
	.layout-rows .pair:first-child {
		border-top: 0;
		padding-top: 0;
	}
	.layout-rows .pair:last-child {
		padding-bottom: 0;
	}
	.dense.layout-rows .pair {
		padding: 6px 0;
	}
	.layout-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: var(--space-4) var(--space-5);
	}
	.layout-grid .pair {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	dt {
		color: var(--text-3);
		font-size: var(--text-sm);
	}
	.layout-grid dt {
		font-size: var(--text-xs);
	}
	dd {
		margin: 0;
		color: var(--text);
		font-size: var(--text-sm);
		min-width: 0;
		overflow-wrap: anywhere;
	}
	dd.mono {
		font-family: var(--font-mono);
		font-size: 12px;
	}
	.none {
		color: var(--text-3);
	}
</style>
