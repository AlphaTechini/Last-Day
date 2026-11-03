<script lang="ts">
	import type { RunItemView, SystemId } from '#lib/types.ts';
	import { SYSTEM_NAMES } from '#lib/types.ts';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import StatusPill from '#lib/components/ui/StatusPill.svelte';
	import Avatar from '#lib/components/ui/Avatar.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import ProgressBar, { type Segment } from '#lib/components/ui/ProgressBar.svelte';
	import SystemIcon from '#lib/components/ui/SystemIcon.svelte';
	import RelativeTime from '#lib/components/ui/RelativeTime.svelte';
	import Money from '#lib/components/ui/Money.svelte';
	import RunItemCard from '#lib/components/run/RunItemCard.svelte';
	import ServerCard from '#lib/components/run/ServerCard.svelte';
	import RecheckCard from '#lib/components/run/RecheckCard.svelte';
	import ApprovalBar from '#lib/components/run/ApprovalBar.svelte';
	import { pollRun } from '#lib/ui/poll.svelte.ts';
	import { isPreviewMode } from '#lib/ui/context.ts';
	import { clock } from '#lib/ui/clock.svelte.ts';
	import { count, dateTime, duration, firstName, plural, secondsBetween } from '#lib/ui/format.ts';
	import type { PageProps, RunDetailPageData } from '#lib/ui/page-data.ts';

	let { data, form }: PageProps<RunDetailPageData> = $props();

	// Local copy of the run: replaced by polling, re-derived when the page data reloads.
	let run = $derived(data.run);
	const preview = isPreviewMode();
	pollRun({ get: () => run, set: (r) => (run = r), enabled: () => !preview });

	const first = $derived(firstName(run.employeeName));
	const SYSTEM_ORDER: SystemId[] = ['keycloak', 'mattermost', 'github', 'vultr'];

	const accountGroups = $derived(
		SYSTEM_ORDER.map((system) => ({
			system,
			items: run.items.filter((i) => i.account.system === system && i.matchKind !== 'server')
		})).filter((g) => g.items.length > 0)
	);
	const servers = $derived(run.items.filter((i) => i.matchKind === 'server'));

	const DONE = new Set(['verified', 'removed', 'awaiting_manager']);
	const regressionByItem = $derived(new Map((run.recheckResult?.diff ?? []).map((d) => [d.itemId, d.observed])));
	const counted = $derived(run.items.filter((i) => i.status !== 'rejected'));
	const regressedCount = $derived(counted.filter((i) => regressionByItem.has(i.id)).length);
	const doneCount = $derived(counted.filter((i) => DONE.has(i.status) && !regressionByItem.has(i.id)).length);
	const proposedCount = $derived(run.items.filter((i) => i.status === 'proposed').length);
	const failedItems = $derived(run.items.filter((i) => i.status === 'failed'));
	const allGreen = $derived(counted.length > 0 && doneCount === counted.length);

	const segments: Segment[] = $derived([
		{ value: doneCount, tone: 'success', label: 'Confirmed' },
		{ value: counted.filter((i) => i.status === 'running' || i.status === 'destroying').length, tone: 'accent', label: 'Running' },
		{ value: failedItems.length + regressedCount, tone: 'danger', label: 'Failed or came back' }
	]);


	const elapsed = $derived.by(() => {
		if (run.stats.secondsToGreen != null) return run.stats.secondsToGreen;
		if (run.status === 'executing') return (clock.now - new Date(run.startedAt).getTime()) / 1000;
		return secondsBetween(run.startedAt, run.verifiedAt);
	});

	const headline = $derived.by(() => {
		if (run.status === 'review')
			return proposedCount
				? `Found ${plural(counted.length, 'account')}. ${proposedCount} need your decision.`
				: `Found ${plural(counted.length, 'account')}. Ready for your approval.`;
		if (run.status === 'regressed') return `Access came back on ${plural(regressedCount || (run.recheckResult?.diff.length ?? 0), 'account')}`;
		if (allGreen) return `All ${counted.length} confirmed${run.stats.secondsToGreen != null ? ` in ${duration(run.stats.secondsToGreen)}` : ''}`;
		return `${doneCount} of ${counted.length} confirmed`;
	});

	const subline = $derived.by(() => {
		if (run.status === 'review') return 'Nothing has been revoked yet. Review each account, then approve.';
		if (run.status === 'executing') return 'Each line turns green only when that system confirms it with its own API.';
		if (run.status === 'regressed') return 'The re-check found accounts that were switched back on. Details below.';
		if (failedItems.length) return `${plural(failedItems.length, 'action')} failed. Retry below; everything else is confirmed.`;
		return 'Every system confirmed the revocation with its own API.';
	});

	function jumpToProposed() {
		const first = run.items.find((i) => i.status === 'proposed');
		if (!first) return;
		const el = document.getElementById(`item-${first.id}`);
		el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		el?.focus({ preventScroll: true });
	}

	const groupDone = (items: RunItemView[]) => items.filter((i) => DONE.has(i.status) && !regressionByItem.has(i.id)).length;
	const groupTotal = (items: RunItemView[]) => items.filter((i) => i.status !== 'rejected').length;
	const runShortId = $derived(run.id.replace(/^run_/, '').toUpperCase());
</script>

<svelte:head><title>Offboarding {run.employeeName} · Last Day</title></svelte:head>

<div class="page" class:regressed={run.status === 'regressed'}>
	<PageHeader
		title="Offboarding {run.employeeName}"
		crumbs={[{ label: 'Runs', href: '/runs' }, { label: run.employeeName }]}
	>
		{#snippet lead()}
			<Avatar name={run.employeeName} size={44} />
		{/snippet}
		{#snippet meta()}
			<StatusPill kind="run" value={run.status} />
			<span>{run.employee.role}, {run.employee.department}</span>
			{#if run.employee.managerName}<span class="dot-sep">Manager {run.employee.managerName}</span>{/if}
			<span class="dot-sep">Started by {run.startedBy} <RelativeTime date={run.startedAt} /></span>
		{/snippet}
		{#snippet actions()}
			<Button variant="ghost" size="sm" href="/employees/{run.employeeId}">Profile</Button>
			<Button variant="secondary" size="sm" icon={ScrollText} href="/audit?run={run.id}">Audit log</Button>
		{/snippet}
	</PageHeader>

	{#if form?.error}
		<div class="block"><Alert tone="danger" title="That did not go through" live>{form.error}</Alert></div>
	{/if}

	<!-- Progress / summary -->
	<section class="overview" class:green={allGreen && run.status !== 'regressed'} class:red={run.status === 'regressed'} aria-labelledby="overview-title">
		<div class="ov-top">
			<div class="ov-titles">
				<h2 id="overview-title" class="ov-headline">
					{#if run.status === 'regressed'}
						<TriangleAlert size={18} strokeWidth={2.2} aria-hidden="true" />
					{:else if allGreen}
						<CircleCheck size={18} strokeWidth={2.2} aria-hidden="true" />
					{/if}
					{headline}
				</h2>
				<p class="ov-sub">{subline}</p>
			</div>
			<div class="ov-count num" aria-hidden="true">
				<span class="ov-n">{doneCount}</span><span class="ov-d">/{counted.length}</span>
			</div>
		</div>
		<ProgressBar {segments} total={counted.length} height={6} label="{doneCount} of {counted.length} confirmed" />
		<p class="sr-only" aria-live="polite" aria-atomic="true">{doneCount} of {counted.length} confirmed. {failedItems.length ? `${failedItems.length} failed.` : ''}</p>

		<dl class="ov-stats">
			<div>
				<dt>{run.stats.secondsToGreen != null ? 'Click to green' : run.status === 'executing' ? 'Elapsed' : 'Time to green'}</dt>
				<dd class="num">{elapsed != null && run.status !== 'review' ? duration(elapsed) : 'Not started'}</dd>
			</div>
			<div>
				<dt>Found by rules</dt>
				<dd class="num">{run.stats.foundByRules}</dd>
			</div>
			<div>
				<dt>Found only by AI</dt>
				<dd class="num ai-val"><Sparkles size={13} strokeWidth={2.2} aria-hidden="true" />{run.stats.foundByAi}</dd>
			</div>
			<div>
				<dt>Servers</dt>
				<dd class="num">{run.stats.servers}</dd>
			</div>
			<div>
				<dt>AI cost</dt>
				<dd><Money value={run.aiCostUsd} kind="ai" /> <span class="dd-sub num">{run.stats.aiCalls} calls, {count(run.stats.aiTokens)} tokens</span></dd>
			</div>
		</dl>
	</section>

	{#if failedItems.length && run.status !== 'review'}
		<div class="block">
			<Alert tone="danger" title="{plural(failedItems.length, 'account')} could not be revoked yet">
				{failedItems.map((i) => `${SYSTEM_NAMES[i.account.system]}: ${i.account.username ?? i.account.displayName}`).join(', ')}. Last Day retried with backoff. You can retry by hand once the system is reachable.
			</Alert>
		</div>
	{/if}

	<div class="layout">
		<div class="main">
			{#each accountGroups as group (group.system)}
				{@const done = groupDone(group.items)}
				{@const total = groupTotal(group.items)}
				<section class="group" aria-labelledby="g-{group.system}">
					<header class="g-head">
						<SystemIcon system={group.system} size={26} />
						<h3 id="g-{group.system}">{SYSTEM_NAMES[group.system]}</h3>
						<span class="g-count">{plural(group.items.length, 'account')}</span>
						<span class="g-spacer"></span>
						{#if run.status !== 'review' && total > 0}
							<span class="g-done num" class:all={done === total}>
								{#if done === total}<ShieldCheck size={13} strokeWidth={2.2} aria-hidden="true" />{/if}
								{done} of {total} confirmed
							</span>
						{/if}
					</header>
					<div class="g-list">
						{#each group.items as item (item.id)}
							<RunItemCard
								{item}
								firstName={first}
								canApprove={run.canApprove}
								runStatus={run.status}
								regression={regressionByItem.get(item.id) ?? null}
								anchor="item-{item.id}"
							/>
						{/each}
					</div>
				</section>
			{/each}

			{#if servers.length}
				<section class="group" aria-labelledby="g-servers">
					<header class="g-head">
						<SystemIcon system="vultr" size={26} />
						<h3 id="g-servers">Leftover servers</h3>
						<span class="g-count">{plural(servers.length, 'server')} on Vultr</span>
					</header>
					<div class="g-list">
						{#each servers as item (item.id)}
							<ServerCard {item} firstName={first} managerName={run.employee.managerName} canDestroy={run.canDestroy} canApprove={run.canApprove} />
						{/each}
					</div>
				</section>
			{/if}

			{#if run.status === 'review'}
				<ApprovalBar {run} onjump={jumpToProposed} />
			{/if}
		</div>

		<aside class="aside" aria-label="Run details">
			{#if run.status === 'review'}
				<Card padding="sm" title="Before you approve" headingLevel={3}>
					<ol class="how" role="list">
						<li><span class="n">1</span><span>Confirm or reject each AI match. The AI only suggests and cannot change anything.</span></li>
						<li><span class="n">2</span><span>Approve once. Last Day revokes in each system, one action at a time.</span></li>
						<li><span class="n">3</span><span>A line turns green only after the system itself confirms it.</span></li>
						<li><span class="n">4</span><span>Servers are halted and snapshotted. {run.employee.managerName ?? 'The manager'} decides whether to destroy them.</span></li>
					</ol>
				</Card>
			{/if}

			{#if run.status !== 'review'}
				<RecheckCard {run} />
			{/if}

			<Card padding="sm" title="Approvals" headingLevel={3}>
				{#if run.approvals.length}
					<ul class="approvals" role="list">
						{#each run.approvals as ap (ap.id)}
							<li>
								<Avatar name={ap.approverName} size={24} />
								<div class="ap-text">
									<p>
										<strong>{ap.approverName}</strong>
										{ap.scope === 'hr_revoke' ? `approved revoking ${plural(ap.itemCount, 'item')}` : `approved destroying ${plural(ap.itemCount, 'server')}`}
									</p>
									<p class="ap-at" title={dateTime(ap.at)}><RelativeTime date={ap.at} /></p>
								</div>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="none">No approvals yet. Every approval is recorded with who, when and the exact action list.</p>
				{/if}
			</Card>

			<Card padding="sm" title="Details" headingLevel={3}>
				<dl class="facts">
					<div><dt>Run</dt><dd class="mono">{runShortId}</dd></div>
					<div><dt>Started</dt><dd>{dateTime(run.startedAt)}</dd></div>
					{#if run.verifiedAt}<div><dt>All green</dt><dd>{dateTime(run.verifiedAt)}</dd></div>{/if}
					<div><dt>Work email</dt><dd class="mono">{run.employee.workEmail}</dd></div>
					{#if run.employee.aliases.length}
						<div><dt>Known aliases</dt><dd class="aliases">{#each run.employee.aliases as al (al)}<code>{al}</code>{/each}</dd></div>
					{/if}
				</dl>
			</Card>
		</aside>
	</div>
</div>

<style>
	.block {
		margin-bottom: var(--space-4);
	}

	/* ---------- Overview ---------- */
	.overview {
		padding: 18px 20px 0;
		margin-bottom: var(--space-6);
		border-radius: var(--radius-lg);
		background: var(--surface);
		border: 1px solid var(--border);
		box-shadow: var(--shadow-xs);
		transition:
			border-color var(--dur-4) var(--ease-out),
			box-shadow var(--dur-4) var(--ease-out);
	}
	.overview.green {
		border-color: color-mix(in srgb, var(--success) 35%, var(--border));
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 8%, transparent);
	}
	.overview.red {
		border-color: color-mix(in srgb, var(--danger) 45%, var(--border));
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 9%, transparent);
		background: linear-gradient(180deg, color-mix(in srgb, var(--danger-soft) 55%, var(--surface)) 0%, var(--surface) 70%);
	}
	.ov-top {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 14px;
	}
	.ov-titles {
		min-width: 0;
	}
	.ov-headline {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--text-xl);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-tighter);
	}
	.green .ov-headline {
		color: var(--success-text);
	}
	.red .ov-headline {
		color: var(--danger-text);
	}
	.ov-sub {
		margin-top: 4px;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.ov-count {
		flex: none;
		line-height: 1;
		letter-spacing: var(--tracking-tighter);
	}
	.ov-n {
		font-size: 30px;
		font-weight: var(--weight-semibold);
	}
	.ov-d {
		font-size: 18px;
		color: var(--text-3);
		font-weight: var(--weight-medium);
	}
	.ov-stats {
		display: grid;
		grid-template-columns: repeat(5, minmax(0, 1fr));
		margin: 16px -20px 0;
		border-top: 1px solid var(--border-subtle);
	}
	.ov-stats > div {
		padding: 12px 20px 14px;
		min-width: 0;
	}
	.ov-stats > div + div {
		border-left: 1px solid var(--border-subtle);
	}
	.ov-stats dt {
		font-size: var(--text-xs);
		color: var(--text-3);
		white-space: nowrap;
	}
	.ov-stats dd {
		margin: 2px 0 0;
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-tight);
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0 6px;
	}
	.ai-val {
		color: var(--ai-text);
		align-items: center !important;
		gap: 4px !important;
	}
	.dd-sub {
		font-size: var(--text-xs);
		font-weight: var(--weight-regular);
		color: var(--text-3);
		letter-spacing: 0;
	}

	/* ---------- Layout ---------- */
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 300px;
		gap: var(--space-6);
		align-items: start;
	}
	.main {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		min-width: 0;
	}
	.aside {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		position: sticky;
		top: var(--space-6);
	}

	.group {
		border-radius: var(--radius-lg);
		background: var(--surface);
		border: 1px solid var(--border);
		box-shadow: var(--shadow-xs);
		overflow: hidden;
	}
	.g-head {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 14px;
		background: var(--surface-2);
		border-bottom: 1px solid var(--border-subtle);
	}
	.g-head h3 {
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
	}
	.g-count {
		font-size: var(--text-sm);
		color: var(--text-3);
	}
	.g-spacer {
		flex: 1;
	}
	.g-done {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--text-2);
	}
	.g-done.all {
		color: var(--success-text);
	}

	/* ---------- Aside ---------- */
	.how {
		display: flex;
		flex-direction: column;
		gap: 10px;
		font-size: var(--text-sm);
		color: var(--text-2);
	}
	.how li {
		display: flex;
		gap: 10px;
	}
	.n {
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		flex: none;
		margin-top: 1px;
		border-radius: 50%;
		font-size: 10.5px;
		font-weight: 600;
		color: var(--text-2);
		box-shadow: inset 0 0 0 1px var(--border-strong);
	}
	.approvals {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.approvals li {
		display: flex;
		gap: 10px;
	}
	.ap-text {
		font-size: var(--text-sm);
		color: var(--text-2);
		line-height: 1.4;
	}
	.ap-text strong {
		color: var(--text);
		font-weight: var(--weight-semibold);
	}
	.ap-at {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.none {
		font-size: var(--text-sm);
		color: var(--text-3);
	}
	.facts {
		display: flex;
		flex-direction: column;
		gap: 8px;
		font-size: var(--text-sm);
	}
	.facts div {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 2px 12px;
	}
	.facts dt {
		color: var(--text-3);
		flex: none;
	}
	.facts dd {
		margin: 0 0 0 auto;
		text-align: right;
		max-width: 100%;
		overflow-wrap: anywhere;
	}
	.facts .mono {
		font-size: 11.5px;
	}
	.aliases {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 4px;
	}
	.aliases code {
		font-size: 11px;
		padding: 1px 5px;
		border-radius: 4px;
		background: var(--surface-3);
	}

	@media (max-width: 1180px) {
		.layout {
			grid-template-columns: minmax(0, 1fr) 272px;
		}
		.ov-stats {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
		.ov-stats > div:nth-child(4) {
			border-left: 0;
		}
		.ov-stats > div:nth-child(n + 4) {
			border-top: 1px solid var(--border-subtle);
		}
	}
	@media (max-width: 980px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
		}
		.aside {
			position: static;
			display: grid;
			grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		}
	}
	@media (max-width: 560px) {
		.overview {
			padding: 16px 16px 0;
		}
		.ov-stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			margin: 14px -16px 0;
		}
		.ov-stats > div {
			padding: 10px 16px 12px;
		}
		.ov-stats > div:nth-child(n) {
			border-left: 0;
			border-top: 1px solid var(--border-subtle);
		}
		.ov-stats > div:nth-child(1) {
			border-top: 0;
		}
		.ov-stats > div:nth-child(2) {
			border-top: 0;
		}
		.ov-stats > div:nth-child(even) {
			border-left: 1px solid var(--border-subtle);
		}
		.ov-stats > div:last-child {
			grid-column: 1 / -1;
			border-left: 0;
		}
		.ov-headline {
			font-size: var(--text-lg);
		}
		.ov-count {
			display: none;
		}
		.g-count {
			display: none;
		}
	}
</style>
