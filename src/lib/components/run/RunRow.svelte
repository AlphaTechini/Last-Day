<script lang="ts">
	import type { RunSummary } from '#lib/types.ts';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Avatar from '#lib/components/ui/Avatar.svelte';
	import StatusPill from '#lib/components/ui/StatusPill.svelte';
	import RelativeTime from '#lib/components/ui/RelativeTime.svelte';

	let { run, note }: { run: RunSummary; note?: string } = $props();
	const pct = $derived(run.itemCount ? Math.round((run.verifiedCount / run.itemCount) * 100) : 0);
	const tone = $derived(run.status === 'regressed' || run.status === 'failed' ? 'danger' : run.status === 'verified' ? 'success' : run.status === 'partial' ? 'warning' : 'accent');
</script>

<a class="row" href="/runs/{run.id}">
	<Avatar name={run.employeeName} size={30} />
	<span class="who">
		<span class="name">{run.employeeName}</span>
		<span class="sub">{note ?? `Started by ${run.startedBy}`} · <RelativeTime date={run.startedAt} /></span>
	</span>
	<span class="prog" aria-label="{run.verifiedCount} of {run.itemCount} confirmed">
		<span class="track"><span class="fill tone-{tone}" style:width="{pct}%"></span></span>
		<span class="num frac">{run.verifiedCount}/{run.itemCount}</span>
	</span>
	<span class="st"><StatusPill kind="run" value={run.status} size="sm" /></span>
	<ChevronRight size={15} strokeWidth={2} class="chev" aria-hidden="true" />
</a>

<style>
	.row {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) 120px 118px auto;
		align-items: center;
		gap: 12px;
		padding: 11px 16px;
		color: var(--text);
		text-decoration: none;
		transition: background-color var(--dur-1) var(--ease-out);
	}
	.row + :global(.row) {
		border-top: 1px solid var(--border-subtle);
	}
	.row:hover {
		background: var(--surface-2);
		text-decoration: none;
	}
	.who {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.35;
	}
	.name {
		font-weight: var(--weight-semibold);
		font-size: var(--text-base);
	}
	.sub {
		font-size: var(--text-xs);
		color: var(--text-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.prog {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.track {
		flex: 1;
		height: 4px;
		border-radius: 4px;
		background: var(--surface-3);
		overflow: hidden;
	}
	.fill {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
		transition: width var(--dur-4) var(--ease-out);
	}
	.fill.tone-success {
		background: var(--success);
	}
	.fill.tone-danger {
		background: var(--danger);
	}
	.fill.tone-warning {
		background: var(--warning-strong);
	}
	.frac {
		font-size: var(--text-xs);
		color: var(--text-2);
		min-width: 3ch;
		text-align: right;
	}
	.st {
		display: flex;
		justify-content: flex-end;
	}
	.row :global(.chev) {
		color: var(--text-3);
	}
	@media (max-width: 640px) {
		.row {
			grid-template-columns: auto minmax(0, 1fr) auto;
		}
		.prog {
			display: none;
		}
		.row :global(.chev) {
			display: none;
		}
	}
</style>
