<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		text,
		side = 'top',
		children
	}: { text: string; side?: 'top' | 'bottom' | 'right'; children: Snippet } = $props();
	const uid = $props.id();
</script>

<span class="tt side-{side}" aria-describedby="{uid}-tip">
	{@render children()}
	<span class="tip" role="tooltip" id="{uid}-tip">{text}</span>
</span>

<style>
	.tt {
		position: relative;
		display: inline-flex;
	}
	.tip {
		position: absolute;
		z-index: var(--z-overlay);
		left: 50%;
		bottom: calc(100% + 6px);
		translate: -50% 2px;
		width: max-content;
		max-width: 240px;
		padding: 5px 8px;
		border-radius: var(--radius-sm);
		background: var(--surface-inverse);
		color: var(--text-inverse);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		line-height: 1.4;
		text-align: left;
		white-space: normal;
		box-shadow: var(--shadow-md);
		opacity: 0;
		pointer-events: none;
		transition:
			opacity var(--dur-1) var(--ease-out),
			translate var(--dur-1) var(--ease-out);
	}
	.side-bottom .tip {
		bottom: auto;
		top: calc(100% + 6px);
		translate: -50% -2px;
	}
	.side-right .tip {
		left: calc(100% + 8px);
		bottom: auto;
		top: 50%;
		translate: -2px -50%;
	}
	.tt:hover .tip,
	.tt:focus-within .tip {
		opacity: 1;
		translate: -50% 0;
		transition-delay: 250ms;
	}
	.side-right:hover .tip,
	.side-right:focus-within .tip {
		translate: 0 -50%;
		transition-delay: 0ms;
	}
</style>
