<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
		title?: string;
		description?: string;
		/** Right side of the header. */
		actions?: Snippet;
		/** Replaces the default header entirely. */
		header?: Snippet;
		footer?: Snippet;
		padding?: 'none' | 'sm' | 'md' | 'lg';
		tone?: 'default' | 'danger' | 'success' | 'warning' | 'ai' | 'muted';
		as?: 'section' | 'div' | 'article';
		headingLevel?: 2 | 3;
		children?: Snippet;
	}

	let {
		title,
		description,
		actions,
		header,
		footer,
		padding = 'md',
		tone = 'default',
		as = 'section',
		headingLevel = 2,
		class: klass = '',
		children,
		...rest
	}: Props = $props();
</script>

<svelte:element this={as} class="card tone-{tone} pad-{padding} {klass}" {...rest}>
	{#if header}
		{@render header()}
	{:else if title || actions}
		<header class="card-head">
			<div class="card-titles">
				{#if title}
					<svelte:element this={`h${headingLevel}`} class="card-title">{title}</svelte:element>
				{/if}
				{#if description}<p class="card-desc">{description}</p>{/if}
			</div>
			{#if actions}<div class="card-actions">{@render actions()}</div>{/if}
		</header>
	{/if}
	{#if children}
		<div class="card-body">{@render children()}</div>
	{/if}
	{#if footer}
		<footer class="card-foot">{@render footer()}</footer>
	{/if}
</svelte:element>

<style>
	.card {
		--pad: var(--space-5);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-xs);
		min-width: 0;
	}
	.pad-none {
		--pad: 0px;
	}
	.pad-sm {
		--pad: var(--space-4);
	}
	.pad-lg {
		--pad: var(--space-6);
	}
	.tone-danger {
		border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 7%, transparent);
	}
	.tone-success {
		border-color: color-mix(in srgb, var(--success) 30%, var(--border));
	}
	.tone-warning {
		border-color: color-mix(in srgb, var(--warning-strong) 35%, var(--border));
	}
	.tone-ai {
		border-color: color-mix(in srgb, var(--ai) 28%, var(--border));
	}
	.tone-muted {
		background: var(--surface-2);
		box-shadow: none;
	}
	.card-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
		padding: calc(var(--pad) - 2px) var(--pad) 0;
	}
	.pad-none .card-head {
		padding: var(--space-4) var(--space-5);
		border-bottom: 1px solid var(--border-subtle);
	}
	.card-titles {
		min-width: 0;
	}
	.card-title {
		font-size: var(--text-md);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-tight);
		line-height: 1.35;
	}
	.card-desc {
		margin-top: 2px;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.card-actions {
		display: flex;
		gap: var(--space-2);
		align-items: center;
		flex: none;
	}
	.card-body {
		padding: var(--pad);
	}
	.card-head + .card-body {
		padding-top: var(--space-4);
	}
	.pad-none .card-head + .card-body {
		padding-top: 0;
	}
	.card-foot {
		padding: var(--space-3) var(--pad);
		border-top: 1px solid var(--border-subtle);
		background: var(--surface-2);
		border-radius: 0 0 var(--radius-lg) var(--radius-lg);
	}
	.pad-none .card-foot {
		padding: var(--space-3) var(--space-5);
	}
</style>
