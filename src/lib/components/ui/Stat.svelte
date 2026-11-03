<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		value,
		hint,
		tone = 'default',
		href,
		children
	}: {
		label: string;
		value?: string | number;
		hint?: string;
		tone?: 'default' | 'danger' | 'warning' | 'success';
		href?: string;
		children?: Snippet;
	} = $props();
</script>

<svelte:element this={href ? 'a' : 'div'} {href} class="stat tone-{tone}" class:link={!!href}>
	<span class="label">{label}</span>
	<span class="value num">
		{#if children}{@render children()}{:else}{value}{/if}
	</span>
	{#if hint}<span class="hint">{hint}</span>{/if}
</svelte:element>

<style>
	.stat {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 14px 16px 13px;
		min-width: 0;
		color: var(--text);
		text-decoration: none;
		position: relative;
	}
	.link:hover {
		background: var(--surface-2);
		text-decoration: none;
	}
	.label {
		font-size: var(--text-sm);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.value {
		font-size: 22px;
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-tighter);
		line-height: 1.25;
		margin-top: 2px;
	}
	.hint {
		font-size: var(--text-xs);
		color: var(--text-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tone-danger .value {
		color: var(--danger-text);
	}
	.tone-danger .label::before,
	.tone-warning .label::before {
		content: '';
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		margin-right: 6px;
		vertical-align: 1px;
		background: var(--danger);
	}
	.tone-warning .label::before {
		background: var(--warning-strong);
	}
	.tone-warning .value {
		color: var(--text);
	}
</style>
