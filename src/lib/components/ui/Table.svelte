<script lang="ts">
	// Table container. Write a normal <table> inside; give each <td> a data-label so that
	// narrow screens can stack rows into cards (stack="sm"), or let it scroll (stack="none").
	import type { Snippet } from 'svelte';

	let {
		children,
		stack = 'sm',
		dense = false,
		label
	}: { children: Snippet; stack?: 'sm' | 'none'; dense?: boolean; label?: string } = $props();
</script>

<div class="table-wrap stack-{stack}" class:dense role="region" aria-label={label} tabindex={stack === 'none' ? 0 : undefined}>
	<table>
		{@render children()}
	</table>
</div>

<style>
	.table-wrap {
		width: 100%;
		overflow-x: auto;
		-webkit-overflow-scrolling: touch;
	}
	table {
		width: 100%;
		border-collapse: separate;
		border-spacing: 0;
		font-size: var(--text-sm);
	}
	.table-wrap :global(th) {
		position: sticky;
		top: 0;
		text-align: left;
		font-weight: var(--weight-medium);
		font-size: var(--text-xs);
		color: var(--text-3);
		padding: 9px 12px;
		background: var(--surface-2);
		border-bottom: 1px solid var(--border);
		white-space: nowrap;
	}
	.table-wrap :global(th:first-child),
	.table-wrap :global(td:first-child) {
		padding-left: 20px;
	}
	.table-wrap :global(th:last-child),
	.table-wrap :global(td:last-child) {
		padding-right: 20px;
	}
	.table-wrap :global(td) {
		padding: 11px 12px;
		border-bottom: 1px solid var(--border-subtle);
		vertical-align: middle;
		color: var(--text);
	}
	.dense :global(td) {
		padding-top: 8px;
		padding-bottom: 8px;
	}
	.table-wrap :global(tbody tr:last-child td) {
		border-bottom: 0;
	}
	.table-wrap :global(tbody tr) {
		transition: background-color var(--dur-1) var(--ease-out);
	}
	.table-wrap :global(tbody tr:hover) {
		background: color-mix(in srgb, var(--surface-2) 70%, transparent);
	}
	.table-wrap :global(th.num),
	.table-wrap :global(td.num) {
		text-align: right;
	}

	@media (max-width: 720px) {
		.stack-sm :global(table),
		.stack-sm :global(tbody),
		.stack-sm :global(tr),
		.stack-sm :global(td) {
			display: block;
			width: 100%;
		}
		.stack-sm :global(thead) {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0 0 0 0);
		}
		.stack-sm :global(tr) {
			padding: 12px 16px;
			border-bottom: 1px solid var(--border-subtle);
		}
		.stack-sm :global(tbody tr:last-child) {
			border-bottom: 0;
		}
		.stack-sm :global(td),
		.stack-sm :global(td:first-child),
		.stack-sm :global(td:last-child) {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 12px;
			padding: 4px 0;
			border: 0;
			text-align: right;
		}
		.stack-sm :global(td[data-label])::before {
			content: attr(data-label);
			color: var(--text-3);
			font-size: var(--text-xs);
			text-align: left;
			flex: none;
		}
		.stack-sm :global(td.primary) {
			justify-content: flex-start;
			text-align: left;
			padding-bottom: 8px;
		}
		.stack-sm :global(td.primary)::before {
			display: none;
		}
		.stack-sm :global(td.hide-sm) {
			display: none;
		}
	}
</style>
