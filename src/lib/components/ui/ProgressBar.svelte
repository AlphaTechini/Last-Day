<script module lang="ts">
	export type Segment = { value: number; tone: 'success' | 'accent' | 'danger' | 'warning' | 'neutral' | 'ai'; label?: string };
</script>

<script lang="ts">
	let {
		segments,
		total,
		height = 6,
		label
	}: { segments: Segment[]; total: number; height?: number; label: string } = $props();

	const done = $derived(segments.filter((s) => s.tone === 'success').reduce((a, s) => a + s.value, 0));
</script>

<div
	class="bar"
	style:height="{height}px"
	role="progressbar"
	aria-label={label}
	aria-valuemin={0}
	aria-valuemax={total}
	aria-valuenow={done}
>
	{#each segments as seg, i (i)}
		{#if seg.value > 0}
			<span class="seg tone-{seg.tone}" style:flex-grow={seg.value} title={seg.label}></span>
		{/if}
	{/each}
	{#if total - segments.reduce((a, s) => a + s.value, 0) > 0}
		<span class="seg rest" style:flex-grow={total - segments.reduce((a, s) => a + s.value, 0)}></span>
	{/if}
</div>

<style>
	.bar {
		display: flex;
		gap: 2px;
		width: 100%;
		border-radius: 999px;
		overflow: hidden;
	}
	.seg {
		flex-basis: 0;
		min-width: 4px;
		transition: flex-grow var(--dur-4) var(--ease-out), background-color var(--dur-3) var(--ease-out);
	}
	.rest {
		background: var(--surface-3);
		box-shadow: inset 0 0 0 1px var(--border-subtle);
	}
	.tone-success {
		background: var(--success);
	}
	.tone-accent {
		background: var(--accent);
		background-image: linear-gradient(
			90deg,
			transparent 0%,
			rgb(255 255 255 / 0.28) 50%,
			transparent 100%
		);
		background-size: 200% 100%;
		animation: sweep 1.6s linear infinite;
	}
	.tone-danger {
		background: var(--danger);
	}
	.tone-warning {
		background: var(--warning-strong);
	}
	.tone-ai {
		background: var(--ai);
	}
	.tone-neutral {
		background: var(--gray-7);
	}
	@keyframes sweep {
		from {
			background-position: 100% 0;
		}
		to {
			background-position: -100% 0;
		}
	}
</style>
