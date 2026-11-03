<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import ChevronDown from '@lucide/svelte/icons/chevrons-up-down';

	interface Props extends Omit<HTMLSelectAttributes, 'value'> {
		value?: string | null;
		invalid?: boolean;
		size?: 'sm' | 'md';
		children: Snippet;
	}

	let {
		value = $bindable(),
		invalid = false,
		size = 'md',
		class: klass = '',
		children,
		...rest
	}: Props = $props();
</script>

<span class="select-wrap size-{size} {klass}">
	<select bind:value class="select" aria-invalid={invalid || undefined} {...rest}>
		{@render children()}
	</select>
	<span class="chev" aria-hidden="true"><ChevronDown size={14} strokeWidth={1.9} /></span>
</span>

<style>
	.select-wrap {
		position: relative;
		display: flex;
		width: 100%;
		min-width: 0;
	}
	.select {
		appearance: none;
		width: 100%;
		height: 34px;
		padding: 0 30px 0 10px;
		background: var(--surface);
		border: 1px solid var(--border-input);
		border-radius: var(--radius-sm);
		font-size: var(--text-base);
		color: var(--text);
		box-shadow: var(--shadow-xs);
		cursor: pointer;
		text-overflow: ellipsis;
		transition: border-color var(--dur-1) var(--ease-out);
	}
	.size-sm .select {
		height: 30px;
		font-size: var(--text-sm);
	}
	.select:hover:not(:disabled) {
		border-color: var(--border-strong);
	}
	.select:focus-visible {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
		border-radius: var(--radius-sm);
	}
	.select[aria-invalid='true'] {
		border-color: var(--danger);
	}
	.select:disabled {
		background: var(--surface-2);
		color: var(--text-2);
		cursor: not-allowed;
		box-shadow: none;
	}
	.chev {
		position: absolute;
		right: 9px;
		top: 50%;
		translate: 0 -50%;
		color: var(--text-3);
		pointer-events: none;
		display: flex;
	}
</style>
