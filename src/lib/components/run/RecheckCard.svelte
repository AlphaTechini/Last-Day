<script lang="ts">
	import type { RunDetail } from '#lib/types.ts';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import Card from '#lib/components/ui/Card.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import ActionForm from '#lib/components/ui/ActionForm.svelte';
	import RelativeTime from '#lib/components/ui/RelativeTime.svelte';
	import Spinner from '#lib/components/ui/Spinner.svelte';
	import { dateTime, shortDateTime } from '#lib/ui/format.ts';

	let { run }: { run: RunDetail } = $props();

	const status = $derived(run.recheckResult?.status ?? run.recheck?.status ?? null);
	const firedAt = $derived(run.recheckResult?.firedAt ?? run.recheck?.firedAt ?? null);
	const dueAt = $derived(run.recheck?.dueAt ?? null);
	const diff = $derived(run.recheckResult?.diff ?? []);
	const canRecheck = $derived(run.canApprove && (run.status === 'verified' || run.status === 'regressed' || run.status === 'partial'));
	const revokedCount = $derived(run.items.filter((i) => i.status === 'verified' || i.status === 'removed' || i.status === 'awaiting_manager').length);
</script>

<Card padding="sm" tone={status === 'regressed' ? 'danger' : 'default'} class="recheck">
	{#snippet header()}
		<div class="h">
			<h3>Re-check</h3>
			{#if status === 'clean'}<span class="tag ok">Still clean</span>{/if}
			{#if status === 'regressed'}<span class="tag bad">Regressed</span>{/if}
		</div>
	{/snippet}

	<div class="body">
		{#if status === 'pending' && dueAt}
			<div class="big">
				<span class="ico neutral"><CalendarClock size={16} strokeWidth={2} /></span>
				<div>
					<p class="count num"><RelativeTime date={dueAt} mode="countdown" prefix="In " /></p>
					<p class="sub">Scheduled for {shortDateTime(dueAt)}. Last Day re-reads all {revokedCount} revoked accounts once, then stops.</p>
				</div>
			</div>
		{:else if status === 'running'}
			<div class="big">
				<span class="ico accent"><Spinner size={16} /></span>
				<div>
					<p class="count">Re-checking now</p>
					<p class="sub">Re-reading {revokedCount} accounts in their own systems.</p>
				</div>
			</div>
		{:else if status === 'clean'}
			<div class="big">
				<span class="ico ok"><ShieldCheck size={16} strokeWidth={2} /></span>
				<div>
					<p class="count">Nothing came back</p>
					<p class="sub">Re-checked <RelativeTime date={firedAt} />{#if firedAt}, {dateTime(firedAt)}{/if}. Every revoked account is still revoked.</p>
				</div>
			</div>
		{:else if status === 'regressed'}
			<div class="big">
				<span class="ico bad"><TriangleAlert size={16} strokeWidth={2} /></span>
				<div>
					<p class="count bad-text">{diff.length} {diff.length === 1 ? 'thing' : 'things'} came back</p>
					<p class="sub">Found <RelativeTime date={firedAt} />. Revoke them again, then re-check.</p>
				</div>
			</div>
			<ul class="diff" role="list">
				{#each diff as d (`${d.itemId}|${d.label}`)}
					<li>
						<span class="d-label">{d.label}</span>
						<span class="d-obs">{d.observed}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="sub plain">
				Once every line is green, Last Day schedules one automatic re-check to make sure nothing was turned back on.
			</p>
		{/if}

		{#if canRecheck}
			<ActionForm action="recheck" successToast="Re-check started">
				{#snippet children({ pending })}
					<Button type="submit" size="sm" icon={RefreshCw} loading={pending || status === 'running'} loadingLabel="Re-checking" full>
						Re-check now
					</Button>
				{/snippet}
			</ActionForm>
		{/if}
	</div>
</Card>

<style>
	.h {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px 0;
	}
	h3 {
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
	}
	.tag {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		padding: 2px 7px;
		border-radius: var(--radius-full);
	}
	.tag.ok {
		background: var(--success-soft);
		color: var(--success-text);
	}
	.tag.bad {
		background: var(--danger-soft);
		color: var(--danger-text);
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.big {
		display: flex;
		gap: 12px;
		align-items: flex-start;
	}
	.ico {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		flex: none;
		border-radius: var(--radius-md);
	}
	.ico.neutral {
		background: var(--surface-3);
		color: var(--text-2);
	}
	.ico.accent {
		background: var(--accent-soft);
		color: var(--accent);
	}
	.ico.ok {
		background: var(--success-soft);
		color: var(--success-text);
	}
	.ico.bad {
		background: var(--danger-soft);
		color: var(--danger-text);
	}
	.count {
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-tight);
		line-height: 1.3;
	}
	.bad-text {
		color: var(--danger-text);
	}
	.sub {
		margin-top: 2px;
		font-size: var(--text-sm);
		color: var(--text-2);
		line-height: var(--leading-snug);
	}
	.plain {
		margin: 0;
	}
	.diff {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.diff li {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px 10px;
		border-radius: var(--radius-sm);
		background: var(--danger-soft);
	}
	.d-label {
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		color: var(--danger-text);
	}
	.d-obs {
		font-size: var(--text-sm);
		color: var(--text);
	}
</style>
