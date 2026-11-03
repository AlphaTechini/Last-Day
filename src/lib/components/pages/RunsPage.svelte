<script lang="ts">
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import SegmentedControl from '#lib/components/ui/SegmentedControl.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Avatar from '#lib/components/ui/Avatar.svelte';
	import StatusPill from '#lib/components/ui/StatusPill.svelte';
	import RelativeTime from '#lib/components/ui/RelativeTime.svelte';
	import Money from '#lib/components/ui/Money.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import type { RunSummary } from '#lib/types.ts';
	import { duration, secondsBetween } from '#lib/ui/format.ts';
	import type { PageProps, RunsPageData } from '#lib/ui/page-data.ts';

	let { data }: PageProps<RunsPageData> = $props();

	type Filter = 'all' | 'open' | 'attention' | 'done';
	let filter = $state<Filter>('all');

	const isOpen = (r: RunSummary) => r.status === 'review' || r.status === 'executing';
	const isAttention = (r: RunSummary) => r.status === 'regressed' || r.status === 'failed' || r.status === 'partial';
	const isDone = (r: RunSummary) => r.status === 'verified';
	const match: Record<Filter, (r: RunSummary) => boolean> = { all: () => true, open: isOpen, attention: isAttention, done: isDone };
	const shown = $derived(data.runs.filter(match[filter]));

	const tone = (r: RunSummary) => (isAttention(r) ? (r.status === 'partial' ? 'warning' : 'danger') : r.status === 'verified' ? 'success' : 'accent');
</script>

<svelte:head><title>Runs · Last Day</title></svelte:head>

<PageHeader title="Offboarding runs" description="Every offboarding, from review to the re-check, with proof from each system." />

<div class="toolbar">
	<SegmentedControl
		label="Filter runs"
		size="sm"
		bind:value={filter}
		options={[
			{ value: 'all', label: 'All', count: data.runs.length },
			{ value: 'open', label: 'Open', count: data.runs.filter(isOpen).length },
			{ value: 'attention', label: 'Needs attention', count: data.runs.filter(isAttention).length },
			{ value: 'done', label: 'Verified', count: data.runs.filter(isDone).length }
		]}
	/>
</div>

<Card padding="none">
	{#if shown.length}
		<Table label="Offboarding runs">
			<thead>
				<tr>
					<th>Leaver</th>
					<th>Status</th>
					<th>Confirmed</th>
					<th class="num">Click to green</th>
					<th>Re-check</th>
					<th class="num">AI cost</th>
					<th>Started</th>
				</tr>
			</thead>
			<tbody>
				{#each shown as r (r.id)}
					{@const pct = r.itemCount ? (r.verifiedCount / r.itemCount) * 100 : 0}
					{@const secs = secondsBetween(r.startedAt, r.verifiedAt)}
					<tr class:attn={isAttention(r)}>
						<td class="primary">
							<a class="who" href="/runs/{r.id}">
								<Avatar name={r.employeeName} size={28} />
								<span class="who-text">
									<span class="name">{r.employeeName}</span>
									<span class="by">by {r.startedBy}</span>
								</span>
							</a>
						</td>
						<td data-label="Status"><StatusPill kind="run" value={r.status} size="sm" /></td>
						<td data-label="Confirmed">
							<span class="prog">
								<span class="track"><span class="fill tone-{tone(r)}" style:width="{pct}%"></span></span>
								<span class="num frac">{r.verifiedCount}/{r.itemCount}</span>
							</span>
						</td>
						<td data-label="Click to green" class="num">{#if secs != null}{duration(secs)}{:else}<span class="subtle">Not yet</span>{/if}</td>
						<td data-label="Re-check">
							{#if r.recheck}
								<StatusPill kind="recheck" value={r.recheck.status} size="sm" />
							{:else}
								<span class="subtle">Not scheduled</span>
							{/if}
						</td>
						<td data-label="AI cost" class="num"><Money value={r.aiCostUsd} kind="ai" /></td>
						<td data-label="Started" class="subtle"><RelativeTime date={r.startedAt} /></td>
					</tr>
				{/each}
			</tbody>
		</Table>
	{:else}
		<EmptyState
			icon={ListChecks}
			title={data.runs.length ? 'No runs in this view' : 'No offboarding runs yet'}
			body={data.runs.length ? 'Pick another filter to see the rest.' : 'Open an employee and click Offboard now. Each run keeps its full proof.'}
		>
			{#snippet actions()}
				{#if !data.runs.length}<Button size="sm" href="/employees">Go to employees</Button>{/if}
			{/snippet}
		</EmptyState>
	{/if}
</Card>

<style>
	.toolbar {
		margin-bottom: var(--space-4);
	}
	.who {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--text);
	}
	.who:hover {
		text-decoration: none;
	}
	.who:hover .name {
		text-decoration: underline;
		text-decoration-color: var(--border-strong);
	}
	.who-text {
		display: flex;
		flex-direction: column;
		line-height: 1.3;
	}
	.name {
		font-weight: var(--weight-semibold);
		font-size: var(--text-base);
	}
	.by {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.prog {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		width: 120px;
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
		background: var(--accent);
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
	}
	.subtle {
		color: var(--text-3);
		white-space: nowrap;
	}
	tr.attn td:first-child {
		box-shadow: inset 2px 0 0 var(--danger);
	}
</style>
