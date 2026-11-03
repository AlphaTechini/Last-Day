<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { LucideIcon } from '@lucide/svelte';

	let {
		icon: Icon,
		title,
		body,
		actions,
		compact = false,
		tone = 'neutral'
	}: {
		icon?: LucideIcon;
		title: string;
		body?: string;
		actions?: Snippet;
		compact?: boolean;
		tone?: 'neutral' | 'success';
	} = $props();
</script>

<div class="empty tone-{tone}" class:compact>
	{#if Icon}
		<div class="glyph" aria-hidden="true"><Icon size={compact ? 16 : 18} strokeWidth={1.8} /></div>
	{/if}
	<p class="title">{title}</p>
	{#if body}<p class="body">{body}</p>{/if}
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		padding: var(--space-10) var(--space-6);
	}
	.compact {
		padding: var(--space-6) var(--space-4);
	}
	.glyph {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		margin-bottom: var(--space-3);
		border-radius: var(--radius-md);
		background: var(--surface);
		color: var(--text-2);
		box-shadow:
			0 0 0 1px var(--border),
			0 2px 4px -1px rgb(16 24 40 / 0.06);
	}
	.compact .glyph {
		width: 30px;
		height: 30px;
		margin-bottom: var(--space-2);
	}
	.tone-success .glyph {
		color: var(--success-text);
		background: var(--success-soft);
		box-shadow: 0 0 0 1px var(--success-border);
	}
	.title {
		font-weight: var(--weight-semibold);
		font-size: var(--text-base);
	}
	.body {
		margin-top: 4px;
		max-width: 42ch;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.actions {
		display: flex;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}
</style>
