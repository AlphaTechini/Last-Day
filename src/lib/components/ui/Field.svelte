<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		hint,
		error,
		id,
		required = false,
		optional = false,
		children,
		aside
	}: {
		label: string;
		hint?: string | null;
		error?: string | null;
		id: string;
		required?: boolean;
		optional?: boolean;
		children: Snippet<[{ id: string; describedBy: string | undefined; invalid: boolean }]>;
		aside?: Snippet;
	} = $props();

	const hintId = $derived(`${id}-hint`);
	const errorId = $derived(`${id}-error`);
	const describedBy = $derived(
		[error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="field" class:invalid={!!error}>
	<div class="label-row">
		<label for={id}>
			{label}
			{#if required}<span class="req" aria-hidden="true">*</span>{/if}
			{#if optional}<span class="opt">Optional</span>{/if}
		</label>
		{#if aside}<span class="aside">{@render aside()}</span>{/if}
	</div>
	{@render children({ id, describedBy, invalid: !!error })}
	{#if error}
		<p class="error" id={errorId}>{error}</p>
	{:else if hint}
		<p class="hint" id={hintId}>{hint}</p>
	{/if}
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.label-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-2);
	}
	label {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--text);
	}
	.req {
		color: var(--danger-text);
		margin-left: 2px;
	}
	.opt {
		margin-left: 6px;
		color: var(--text-3);
		font-weight: var(--weight-regular);
		font-size: var(--text-xs);
	}
	.aside {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.hint,
	.error {
		font-size: var(--text-xs);
		line-height: 1.45;
	}
	.hint {
		color: var(--text-3);
	}
	.error {
		color: var(--danger-text);
		font-weight: var(--weight-medium);
	}
</style>
