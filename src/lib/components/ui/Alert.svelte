<script lang="ts">
	import type { Snippet } from 'svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import Info from '@lucide/svelte/icons/info';
	import CircleCheck from '@lucide/svelte/icons/circle-check';

	let {
		tone = 'info',
		title,
		children,
		actions,
		live = false
	}: {
		tone?: 'info' | 'success' | 'warning' | 'danger';
		title?: string;
		children?: Snippet;
		actions?: Snippet;
		live?: boolean;
	} = $props();

	const Icon = $derived(
		tone === 'danger' ? CircleAlert : tone === 'warning' ? TriangleAlert : tone === 'success' ? CircleCheck : Info
	);
</script>

<div class="alert tone-{tone}" role={live ? (tone === 'danger' ? 'alert' : 'status') : undefined}>
	<span class="icon"><Icon size={16} strokeWidth={2} aria-hidden="true" /></span>
	<div class="content">
		{#if title}<p class="title">{title}</p>{/if}
		{#if children}<div class="body">{@render children()}</div>{/if}
	</div>
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
	.alert {
		--bg: var(--accent-soft);
		--fg: var(--accent-text);
		--bd: var(--accent-border);
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 10px 12px;
		border-radius: var(--radius-md);
		background: var(--bg);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--bd) 70%, transparent);
		font-size: var(--text-sm);
		color: var(--text);
	}
	.tone-success {
		--bg: var(--success-soft);
		--fg: var(--success-text);
		--bd: var(--success-border);
	}
	.tone-warning {
		--bg: var(--warning-soft);
		--fg: var(--warning-text);
		--bd: var(--warning-border);
	}
	.tone-danger {
		--bg: var(--danger-soft);
		--fg: var(--danger-text);
		--bd: var(--danger-border);
	}
	.icon {
		display: flex;
		color: var(--fg);
		margin-top: 1px;
		flex: none;
	}
	.content {
		flex: 1;
		min-width: 0;
	}
	.title {
		font-weight: var(--weight-semibold);
		color: var(--fg);
	}
	.body {
		color: var(--text-2);
		line-height: var(--leading-snug);
	}
	.title + .body {
		margin-top: 2px;
	}
	.actions {
		flex: none;
		display: flex;
		gap: var(--space-2);
		align-self: center;
	}
</style>
