<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLTextareaAttributes, 'value'> {
		value?: string | null;
		invalid?: boolean;
	}
	let { value = $bindable(), invalid = false, class: klass = '', ...rest }: Props = $props();
</script>

<textarea bind:value class="textarea {klass}" aria-invalid={invalid || undefined} {...rest}></textarea>

<style>
	.textarea {
		width: 100%;
		min-height: 84px;
		padding: 8px 10px;
		background: var(--surface);
		border: 1px solid var(--border-input);
		border-radius: var(--radius-sm);
		font-size: var(--text-base);
		line-height: var(--leading-snug);
		color: var(--text);
		resize: vertical;
		box-shadow: var(--shadow-xs);
	}
	.textarea:hover:not(:disabled) {
		border-color: var(--border-strong);
	}
	.textarea:focus-visible {
		border-color: var(--accent);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
		border-radius: var(--radius-sm);
	}
	.textarea[aria-invalid='true'] {
		border-color: var(--danger);
	}
	.textarea::placeholder {
		color: var(--text-3);
	}
</style>
