<script lang="ts">
	import { confidenceBand } from '#lib/ui/status.ts';

	let {
		value,
		threshold,
		showBand = false,
		size = 'md'
	}: { value: number; threshold?: number; showBand?: boolean; size?: 'sm' | 'md' } = $props();

	const pct = $derived(Math.round(Math.max(0, Math.min(1, value)) * 100));
	const band = $derived(confidenceBand(value));
</script>

<span
	class="meter size-{size} level-{band.level}"
	role="meter"
	aria-valuemin={0}
	aria-valuemax={100}
	aria-valuenow={pct}
	aria-label="AI confidence {pct}%"
	title="{band.label}: {pct}%"
>
	<span class="track" aria-hidden="true">
		<span class="fill" style:width="{pct}%"></span>
		{#if threshold != null}
			<span class="tick" style:left="{Math.round(threshold * 100)}%"></span>
		{/if}
	</span>
	<span class="value num">{pct}%</span>
	{#if showBand}<span class="band">{band.label}</span>{/if}
</span>

<style>
	.meter {
		--w: 64px;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		white-space: nowrap;
	}
	.size-sm {
		--w: 40px;
		gap: 6px;
	}
	.track {
		position: relative;
		width: var(--w);
		height: 4px;
		border-radius: 4px;
		background: color-mix(in srgb, var(--ai) 14%, var(--surface-3));
		overflow: visible;
	}
	.fill {
		position: absolute;
		inset: 0 auto 0 0;
		border-radius: inherit;
		background: var(--ai);
		transition: width var(--dur-4) var(--ease-out);
	}
	.level-low .fill {
		background: color-mix(in srgb, var(--ai) 55%, var(--gray-8));
	}
	.tick {
		position: absolute;
		top: -3px;
		width: 1.5px;
		height: 10px;
		margin-left: -0.75px;
		background: var(--text-2);
		border-radius: 1px;
		opacity: 0.6;
	}
	.value {
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		color: var(--ai-text);
		min-width: 3ch;
	}
	.size-sm .value {
		font-size: var(--text-xs);
	}
	.band {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
</style>
