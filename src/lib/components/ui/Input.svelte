<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import type { LucideIcon } from '@lucide/svelte';

	interface Props extends Omit<HTMLInputAttributes, 'value' | 'size'> {
		value?: string | number | null;
		invalid?: boolean;
		icon?: LucideIcon;
		mono?: boolean;
		size?: 'sm' | 'md';
		el?: HTMLInputElement;
	}

	let {
		value = $bindable(),
		invalid = false,
		icon: Icon,
		mono = false,
		size = 'md',
		el = $bindable(),
		class: klass = '',
		...rest
	}: Props = $props();
</script>

<span class="input-wrap size-{size} {klass}" class:has-icon={!!Icon}>
	{#if Icon}<span class="icon"><Icon size={15} strokeWidth={1.9} aria-hidden="true" /></span>{/if}
	<input bind:this={el} bind:value class="input" class:mono aria-invalid={invalid || undefined} {...rest} />
</span>

<style>
	.input-wrap {
		position: relative;
		display: flex;
		width: 100%;
		min-width: 0;
	}
	.icon {
		position: absolute;
		left: 10px;
		top: 50%;
		translate: 0 -50%;
		color: var(--text-3);
		pointer-events: none;
		display: flex;
	}
	.input {
		width: 100%;
		height: 34px;
		padding: 0 10px;
		background: var(--surface);
		border: 1px solid var(--border-input);
		border-radius: var(--radius-sm);
		font-size: var(--text-base);
		color: var(--text);
		box-shadow: var(--shadow-xs);
		transition:
			border-color var(--dur-1) var(--ease-out),
			box-shadow var(--dur-1) var(--ease-out);
	}
	.size-sm .input {
		height: 30px;
		font-size: var(--text-sm);
	}
	.has-icon .input {
		padding-left: 32px;
	}
	.input.mono {
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}
	.input::placeholder {
		color: var(--text-3);
		opacity: 0.85;
	}
	.input:hover:not(:disabled) {
		border-color: var(--border-strong);
	}
	.input:focus-visible {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
		border-radius: var(--radius-sm);
	}
	.input[aria-invalid='true'] {
		border-color: var(--danger);
	}
	.input[aria-invalid='true']:focus-visible {
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 18%, transparent);
	}
	.input:disabled,
	.input:read-only {
		background: var(--surface-2);
		color: var(--text-2);
		box-shadow: none;
	}
	.input:disabled {
		cursor: not-allowed;
	}
	.input[type='file'] {
		height: auto;
		padding: 8px 10px;
		font-size: var(--text-sm);
	}
	.input[type='file']::file-selector-button {
		margin-right: 10px;
		height: 26px;
		padding: 0 10px;
		border: 1px solid var(--border-input);
		border-radius: var(--radius-xs);
		background: var(--surface-2);
		color: var(--text);
		font: inherit;
		font-weight: var(--weight-medium);
		cursor: pointer;
	}
</style>
