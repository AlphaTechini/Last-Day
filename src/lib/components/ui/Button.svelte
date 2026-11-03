<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import type { LucideIcon } from '@lucide/svelte';
	import Spinner from './Spinner.svelte';

	type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-secondary' | 'success';
	type Size = 'xs' | 'sm' | 'md' | 'lg';

	interface Props extends Omit<HTMLButtonAttributes, 'children'> {
		variant?: Variant;
		size?: Size;
		loading?: boolean;
		/** Text shown while loading; defaults to the normal label. */
		loadingLabel?: string;
		href?: string;
		icon?: LucideIcon;
		iconRight?: LucideIcon;
		iconOnly?: boolean;
		full?: boolean;
		children?: Snippet;
	}

	let {
		variant = 'secondary',
		size = 'md',
		loading = false,
		loadingLabel,
		href,
		icon: Icon,
		iconRight: IconRight,
		iconOnly = false,
		full = false,
		type = 'button',
		disabled,
		class: klass = '',
		children,
		...rest
	}: Props = $props();

	const iconSize = $derived(size === 'lg' ? 17 : size === 'xs' ? 13 : 15);
	const cls = $derived(
		`btn btn-${variant} btn-${size} ${iconOnly ? 'btn-icon' : ''} ${full ? 'btn-full' : ''} ${loading ? 'is-loading' : ''} ${klass}`
	);
</script>

{#snippet inner()}
	{#if loading}
		<Spinner size={iconSize - 1} />
	{:else if Icon}
		<Icon size={iconSize} strokeWidth={1.9} aria-hidden="true" />
	{/if}
	{#if !iconOnly}
		<span class="btn-label">
			{#if loading && loadingLabel}{loadingLabel}{:else}{@render children?.()}{/if}
		</span>
	{:else}
		{@render children?.()}
	{/if}
	{#if IconRight && !loading}
		<IconRight size={iconSize} strokeWidth={1.9} aria-hidden="true" />
	{/if}
{/snippet}

{#if href && !disabled}
	<a {href} class={cls} {...rest as Record<string, unknown>}>{@render inner()}</a>
{:else}
	<button {type} class={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
		{@render inner()}
	</button>
{/if}

<style>
	.btn {
		--h: 32px;
		--px: 12px;
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		height: var(--h);
		padding: 0 var(--px);
		border-radius: var(--radius-sm);
		font-size: var(--text-base);
		font-weight: var(--weight-medium);
		line-height: 1;
		white-space: nowrap;
		text-decoration: none;
		border: 1px solid transparent;
		user-select: none;
		transition:
			background-color var(--dur-1) var(--ease-out),
			border-color var(--dur-1) var(--ease-out),
			color var(--dur-1) var(--ease-out),
			box-shadow var(--dur-1) var(--ease-out),
			transform var(--dur-1) var(--ease-out);
	}
	.btn:hover {
		text-decoration: none;
	}
	.btn:active:not(:disabled) {
		transform: translateY(0.5px);
	}
	.btn:focus-visible {
		box-shadow: var(--focus-ring);
	}
	.btn:disabled {
		opacity: 0.5;
	}
	.btn.is-loading:disabled {
		opacity: 0.85;
		cursor: progress;
	}

	.btn-xs {
		--h: 24px;
		--px: 8px;
		gap: 5px;
		font-size: var(--text-xs);
		border-radius: var(--radius-xs);
	}
	.btn-sm {
		--h: 28px;
		--px: 10px;
		gap: 6px;
		font-size: var(--text-sm);
	}
	.btn-lg {
		--h: 40px;
		--px: 16px;
		font-size: var(--text-md);
		border-radius: var(--radius-md);
	}
	.btn-icon {
		width: var(--h);
		padding: 0;
	}
	.btn-full {
		width: 100%;
	}

	.btn-primary {
		background: var(--primary);
		color: var(--primary-text);
		box-shadow: var(--shadow-sm), var(--shadow-inset);
	}
	.btn-primary:hover:not(:disabled) {
		background: var(--primary-hover);
	}

	.btn-secondary {
		background: var(--surface);
		color: var(--text);
		border-color: var(--border-input);
		box-shadow: var(--shadow-xs);
	}
	.btn-secondary:hover:not(:disabled) {
		background: var(--surface-2);
		border-color: var(--border-strong);
	}

	.btn-ghost {
		color: var(--text-2);
	}
	.btn-ghost:hover:not(:disabled) {
		background: var(--surface-3);
		color: var(--text);
	}

	.btn-danger {
		background: var(--danger);
		color: #fff;
		box-shadow: var(--shadow-sm), var(--shadow-inset);
	}
	.btn-danger:hover:not(:disabled) {
		background: var(--danger-hover);
	}

	/* Prominent but not alarming: tinted outline. */
	.btn-danger-secondary {
		background: var(--surface);
		color: var(--danger-text);
		border-color: color-mix(in srgb, var(--danger) 38%, var(--border-input));
		box-shadow: var(--shadow-xs);
	}
	.btn-danger-secondary:hover:not(:disabled) {
		background: var(--danger-soft);
		border-color: color-mix(in srgb, var(--danger) 60%, var(--border-input));
	}

	.btn-success {
		background: var(--success);
		color: #fff;
	}

	.btn-label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
</style>
