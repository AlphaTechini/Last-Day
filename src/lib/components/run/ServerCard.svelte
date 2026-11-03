<script lang="ts">
	import type { RunItemView } from '#lib/types.ts';
	import Server from '@lucide/svelte/icons/server';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Check from '@lucide/svelte/icons/check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Camera from '@lucide/svelte/icons/camera';
	import StatusPill from '#lib/components/ui/StatusPill.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import StepList from '#lib/components/ui/StepList.svelte';
	import ActionForm from '#lib/components/ui/ActionForm.svelte';
	import Spinner from '#lib/components/ui/Spinner.svelte';
	import { date, moneyMonthly } from '#lib/ui/format.ts';

	let {
		item,
		firstName,
		managerName,
		canDestroy,
		canApprove
	}: {
		item: RunItemView;
		firstName: string;
		managerName: string | null;
		canDestroy: boolean;
		canApprove: boolean;
	} = $props();

	const a = $derived(item.account);
	const s = $derived(item.status);
	const monthly = $derived(a.monthlyCostUsd ?? item.stillBillingUsdMonth ?? 0);
	const snapshotCost = $derived(item.snapshotCostUsdMonth ?? null);
	const removed = $derived(s === 'removed');
	const halted = $derived(s === 'awaiting_manager' || s === 'destroying' || removed);
	const stillBilling = $derived(item.stillBillingUsdMonth ?? (removed ? (snapshotCost ?? 0) : monthly));
	const manager = $derived(managerName ?? `${firstName}'s manager`);

	type StepState = 'done' | 'active' | 'upcoming' | 'failed';
	const step1: StepState = $derived(halted ? 'done' : s === 'failed' ? 'failed' : s === 'running' || s === 'approved' ? 'active' : 'upcoming');
	const step2: StepState = $derived(removed ? 'done' : s === 'awaiting_manager' || s === 'destroying' ? 'active' : 'upcoming');

	let confirmOpen = $state(false);
	let showSteps = $state(false);
	const uid = $props.id();

	const headline = $derived.by(() => {
		if (removed) return 'Removed. The server is destroyed and confirmed gone.';
		if (s === 'destroying') return 'Destroying the server now.';
		if (s === 'awaiting_manager')
			return canDestroy
				? `${firstName} left a server. Snapshot taken. Anything to keep?`
				: `Halted and snapshotted. Waiting on ${manager} to decide.`;
		if (s === 'running') return 'Halting and taking a snapshot.';
		if (s === 'failed') return 'The halt or snapshot did not complete.';
		return 'On approval Last Day halts it and takes a snapshot. Nothing is destroyed yet.';
	});
</script>

<article class="server st-{s}" aria-labelledby="{uid}-name">
	<div class="top">
		<span class="glyph" aria-hidden="true">
			{#if s === 'running' || s === 'destroying'}<Spinner size={16} />{:else}<Server size={17} strokeWidth={1.8} />{/if}
		</span>
		<div class="ident">
			<h4 id="{uid}-name" class="mono">{a.displayName ?? a.externalId}</h4>
			<p class="meta">
				{#if a.plan}<span>{a.plan}</span>{/if}
				{#if a.region}<span class="sep" aria-hidden="true">·</span><span>{a.region}</span>{/if}
				{#if a.createdAt}<span class="sep" aria-hidden="true">·</span><span>Launched by {firstName}, {date(a.createdAt)}</span>{/if}
			</p>
		</div>
		<StatusPill kind="item" value={s} />
	</div>

	<p class="headline">{headline}</p>

	<div class="money">
		<div class="cell" class:billing={!removed}>
			<span class="cell-label">{removed ? 'Instance' : 'Still billing'}</span>
			<span class="cell-value num">
				{#if removed}<s class="struck">{moneyMonthly(monthly)}</s> <span class="gone">destroyed</span>{:else}{moneyMonthly(monthly)}{/if}
			</span>
			<span class="cell-hint">{removed ? 'No longer billed' : halted ? 'Halted servers still bill until destroyed' : 'Running now'}</span>
		</div>
		<div class="cell">
			<span class="cell-label">Snapshot storage</span>
			<span class="cell-value num">{snapshotCost != null ? moneyMonthly(snapshotCost) : 'None yet'}</span>
			<span class="cell-hint">
				{#if item.snapshotId}<Camera size={11} strokeWidth={2} aria-hidden="true" /> <span class="mono">{item.snapshotId}</span>{:else}Taken on approval{/if}
			</span>
		</div>
		<div class="cell">
			<span class="cell-label">{removed ? 'Still billing' : 'Power'}</span>
			<span class="cell-value num">{removed ? moneyMonthly(stillBilling) : (a.powerStatus ?? 'unknown')}</span>
			<span class="cell-hint wrap">{removed ? 'Snapshot only' : (item.verifiedState ?? 'Read from the Vultr API')}</span>
		</div>
	</div>

	<ol class="track" role="list" aria-label="Two approvals">
		<li class="t t-{step1}">
			<span class="dot" aria-hidden="true">{#if step1 === 'done'}<Check size={11} strokeWidth={3} />{:else}1{/if}</span>
			<span class="t-text">
				<span class="t-title">Halt and snapshot</span>
				<span class="t-sub">People ops approval</span>
			</span>
		</li>
		<li class="bar" aria-hidden="true"><span class:fill={step1 === 'done'}></span></li>
		<li class="t t-{step2}">
			<span class="dot" aria-hidden="true">{#if step2 === 'done'}<Check size={11} strokeWidth={3} />{:else}2{/if}</span>
			<span class="t-text">
				<span class="t-title">Destroy</span>
				<span class="t-sub">{manager}'s approval</span>
			</span>
		</li>
	</ol>

	<div class="foot">
		<button class="steps-toggle" type="button" aria-expanded={showSteps} aria-controls="{uid}-steps" onclick={() => (showSteps = !showSteps)}>
			API steps <ChevronDown size={14} strokeWidth={2} class="chev" />
		</button>
		<span class="spacer"></span>
		{#if s === 'failed' && canApprove}
			<ActionForm action="retry" successToast="Retrying">
				{#snippet children({ pending })}
					<input type="hidden" name="itemId" value={item.id} />
					<Button type="submit" size="sm" loading={pending}>Retry</Button>
				{/snippet}
			</ActionForm>
		{/if}
		{#if s === 'awaiting_manager'}
			{#if canDestroy}
				<Button variant="danger" size="sm" icon={Trash2} onclick={() => (confirmOpen = true)}>Destroy server</Button>
			{:else}
				<span class="waiting">Only {manager} can destroy it.</span>
			{/if}
		{/if}
	</div>

	<div id="{uid}-steps" hidden={!showSteps} class="steps">
		{#if showSteps}
			<StepList steps={item.actions} readBack={item.verifiedState ? { text: item.verifiedState, at: item.verifiedAt } : null} />
		{/if}
	</div>
</article>

{#if canDestroy}
	<Dialog bind:open={confirmOpen} title="Destroy {a.displayName ?? 'this server'}?" role="alertdialog" size="sm">
		<p class="dlg-p">
			This permanently deletes the server. The snapshot
			{#if item.snapshotId}<code>{item.snapshotId}</code>{/if}
			stays, so nothing on it is lost{#if snapshotCost != null}. It keeps billing {moneyMonthly(snapshotCost)} for storage{/if}.
		</p>
		{#snippet footer()}
			<Button variant="secondary" onclick={() => (confirmOpen = false)}>Keep it for now</Button>
			<ActionForm action="destroy" successToast="Destroy started" onsuccess={() => (confirmOpen = false)}>
				{#snippet children({ pending })}
					<input type="hidden" name="itemId" value={item.id} />
					<Button type="submit" variant="danger" icon={Trash2} loading={pending} loadingLabel="Destroying">Destroy server</Button>
				{/snippet}
			</ActionForm>
		{/snippet}
	</Dialog>
{/if}

<style>
	.server {
		padding: 16px;
		background: var(--surface);
	}
	.server + :global(.server) {
		border-top: 1px solid var(--border-subtle);
	}
	.top {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.glyph {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		flex: none;
		border-radius: var(--radius-md);
		background: var(--surface-2);
		color: var(--text-2);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.st-awaiting_manager .glyph {
		background: var(--warning-soft);
		color: var(--warning-text);
		box-shadow: inset 0 0 0 1px var(--warning-border);
	}
	.st-removed .glyph {
		background: var(--success-soft);
		color: var(--success-text);
		box-shadow: inset 0 0 0 1px var(--success-border);
	}
	.st-running .glyph,
	.st-destroying .glyph {
		color: var(--accent);
	}
	.ident {
		flex: 1;
		min-width: 0;
	}
	h4 {
		font-size: 13.5px;
		font-weight: 600;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0 6px;
		margin-top: 1px;
		font-size: var(--text-sm);
		color: var(--text-2);
	}
	.sep {
		color: var(--text-3);
	}
	.headline {
		margin: 12px 0 12px 46px;
		font-size: var(--text-base);
		font-weight: var(--weight-medium);
		color: var(--text);
	}
	.money {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		margin-left: 46px;
		border-radius: var(--radius-md);
		box-shadow: inset 0 0 0 1px var(--border);
		overflow: hidden;
	}
	.cell {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 10px 12px;
		min-width: 0;
	}
	.cell + .cell {
		border-left: 1px solid var(--border);
	}
	.cell.billing {
		background: color-mix(in srgb, var(--warning-soft) 70%, var(--surface));
	}
	.cell-label {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.billing .cell-label {
		color: var(--warning-text);
		font-weight: var(--weight-medium);
	}
	.cell-value {
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-tight);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.struck {
		color: var(--text-3);
		font-weight: var(--weight-medium);
	}
	.gone {
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--success-text);
	}
	.cell-hint {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: var(--text-xs);
		color: var(--text-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cell-hint.wrap {
		white-space: normal;
		font-family: var(--font-mono);
		font-size: 11px;
		line-height: 1.4;
	}
	.cell-hint .mono {
		font-size: 11px;
	}

	.track {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 14px 0 0 46px;
	}
	.t {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: none;
	}
	.dot {
		display: grid;
		place-items: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-3);
		box-shadow: inset 0 0 0 1.5px var(--border-strong);
	}
	.t-done .dot {
		background: var(--success);
		color: #fff;
		box-shadow: none;
	}
	.t-active .dot {
		background: var(--warning-soft-2);
		color: var(--warning-text);
		box-shadow: inset 0 0 0 1.5px var(--warning-strong);
	}
	.t-failed .dot {
		background: var(--danger);
		color: #fff;
		box-shadow: none;
	}
	.t-text {
		display: flex;
		flex-direction: column;
		line-height: 1.25;
	}
	.t-title {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
	}
	.t-upcoming .t-title {
		color: var(--text-2);
	}
	.t-sub {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.bar {
		flex: 1;
		height: 2px;
		min-width: 24px;
		max-width: 120px;
		border-radius: 2px;
		background: var(--border);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		width: 0;
		background: var(--success);
		transition: width var(--dur-4) var(--ease-out);
	}
	.bar span.fill {
		width: 100%;
	}

	.foot {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 14px 0 0 46px;
		padding-top: 12px;
		border-top: 1px solid var(--border-subtle);
	}
	.spacer {
		flex: 1;
	}
	.steps-toggle {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: var(--text-xs);
		color: var(--text-3);
		padding: 4px 6px;
		margin-left: -6px;
		border-radius: var(--radius-xs);
	}
	.steps-toggle:hover {
		color: var(--text);
		background: var(--surface-3);
	}
	.steps-toggle :global(.chev) {
		transition: transform var(--dur-2) var(--ease-out);
	}
	.steps-toggle[aria-expanded='true'] :global(.chev) {
		transform: rotate(180deg);
	}
	.waiting {
		font-size: var(--text-sm);
		color: var(--text-2);
	}
	.steps {
		margin: 8px 0 0 46px;
	}
	.dlg-p {
		color: var(--text-2);
	}
	.dlg-p code {
		font-size: 12px;
		color: var(--text);
	}

	@media (max-width: 640px) {
		.headline,
		.money,
		.track,
		.foot,
		.steps {
			margin-left: 0;
		}
		.money {
			grid-template-columns: 1fr 1fr;
		}
		.cell.billing {
			grid-column: 1 / -1;
		}
		.cell + .cell {
			border-left: 0;
			border-top: 1px solid var(--border);
		}
		.cell:last-child {
			border-left: 1px solid var(--border);
		}
		.top {
			align-items: flex-start;
		}
		.meta {
			flex-direction: column;
		}
		.meta .sep {
			display: none;
		}
		.track {
			flex-direction: column;
			align-items: flex-start;
			gap: 8px;
		}
		.bar {
			display: none;
		}
		.foot {
			flex-wrap: wrap;
		}
	}
</style>
