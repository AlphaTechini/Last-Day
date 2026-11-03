<script lang="ts">
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Server from '@lucide/svelte/icons/server';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Users from '@lucide/svelte/icons/users';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Activity from '@lucide/svelte/icons/activity';
	import Camera from '@lucide/svelte/icons/camera';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Stat from '#lib/components/ui/Stat.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import SystemIcon from '#lib/components/ui/SystemIcon.svelte';
	import RelativeTime from '#lib/components/ui/RelativeTime.svelte';
	import ActionForm from '#lib/components/ui/ActionForm.svelte';
	import Avatar from '#lib/components/ui/Avatar.svelte';
	import RunRow from '#lib/components/run/RunRow.svelte';
	import ActivityFeed from '#lib/components/ActivityFeed.svelte';
	import { CONNECTION_STATUS } from '#lib/ui/status.ts';
	import { count, firstName, money, moneyMonthly } from '#lib/ui/format.ts';
	import type { DashboardPageData, PageProps } from '#lib/ui/page-data.ts';

	let { data, form }: PageProps<DashboardPageData> = $props();

	let resetOpen = $state(false);
	const s = $derived(data.stats);
	const unhealthy = $derived(data.connections.filter((c) => c.status !== 'healthy'));
</script>

<svelte:head><title>Dashboard · Last Day</title></svelte:head>

<PageHeader title="Dashboard" description="Who is leaving, what they can still reach, and what needs you.">
	{#snippet meta()}
		{#if data.lastSweepAt}
			<span>Last sweep <RelativeTime date={data.lastSweepAt} /></span>
		{:else}
			<span>No sweep yet</span>
		{/if}
	{/snippet}
	{#snippet actions()}
		{#if data.isDemo}
			<Button variant="ghost" size="sm" icon={RotateCcw} onclick={() => (resetOpen = true)}>Reset demo company</Button>
		{/if}
		<ActionForm action="sweep" successToast="Sweep finished">
			{#snippet children({ pending })}
				<Button type="submit" size="sm" icon={RefreshCw} loading={pending} loadingLabel="Sweeping 4 systems">Sweep now</Button>
			{/snippet}
		</ActionForm>
	{/snippet}
</PageHeader>

{#if form?.error}
	<div class="block"><Alert tone="danger" title="That did not go through" live>{form.error}</Alert></div>
{/if}

<section class="stats" aria-label="At a glance">
	<Stat label="Employees" value={count(s.employees)} href="/employees" hint="In the employee record" />
	<Stat label="Active accounts" value={count(s.activeAccounts)} hint="Across 4 systems" />
	<Stat label="Unknown owners" value={count(s.unknownAccounts)} href="/unknown" hint={s.unknownAccounts ? 'Not linked to anyone' : 'Every account has an owner'} tone={s.unknownAccounts ? 'warning' : 'default'} />
	<Stat label="Open runs" value={count(s.openRuns)} href="/runs" hint="Offboardings in progress" />
	<Stat label="Needs attention" value={count(s.needsAttention)} href="/runs" hint={s.needsAttention ? 'Regressed or failed' : 'All clear'} tone={s.needsAttention ? 'danger' : 'default'} />
	<Stat label="Leftover servers" hint={s.monthlyServerSpendUsd ? 'Still billing until destroyed' : 'Nothing billing'}>
		{money(s.monthlyServerSpendUsd)}<span class="per">/mo</span>
	</Stat>
</section>

<section class="conns" aria-label="Connections">
	{#each data.connections as c (c.system)}
		{@const meta = CONNECTION_STATUS[c.status]}
		<a class="conn" href="/connections">
			<SystemIcon system={c.system} size={26} />
			<span class="conn-text">
				<span class="conn-name">{c.name}</span>
				<span class="conn-sub num">{c.status === 'not_configured' ? 'Not connected' : `${count(c.accountCount)} accounts`}{#if c.lastTestedAt}, tested <RelativeTime date={c.lastTestedAt} mode="short" />{/if}</span>
			</span>
			<span class="health tone-{meta.tone}" title={meta.hint}><span class="hdot"></span>{meta.label}</span>
		</a>
	{/each}
</section>
{#if unhealthy.length}
	<div class="block">
		<Alert tone="warning" title="{unhealthy.map((c) => c.name).join(', ')} {unhealthy.length === 1 ? 'needs' : 'need'} attention">
			Offboarding cannot revoke access in a system Last Day cannot reach. <a href="/connections">Open connections</a>
		</Alert>
	</div>
{/if}

<div class="grid">
	<div class="col">
		{#if data.needsAttention.length}
			<Card padding="none" tone="danger" title="Needs attention" description="Access came back after revocation, or an action failed.">
				{#each data.needsAttention as run (run.id)}
					<RunRow {run} note={run.status === 'regressed' ? 'Re-check found access that came back' : 'Some actions failed'} />
				{/each}
			</Card>
		{/if}

		{#if data.pendingDestroys.length}
			<Card padding="none" tone="warning" title="Waiting on a manager" description="Halted servers keep billing until the leaver's manager destroys them.">
				<ul class="destroys" role="list">
					{#each data.pendingDestroys as d (d.itemId)}
						<li>
							<span class="srv" aria-hidden="true"><Server size={16} strokeWidth={1.8} /></span>
							<div class="d-text">
								<p class="d-title">{firstName(d.employeeName)} left a server. Snapshot taken. Anything to keep?</p>
								<p class="d-sub">
									<code>{d.serverLabel}</code>
									<span class="bill num">{moneyMonthly(d.stillBillingUsdMonth)} still billing</span>
									<span class="snap num"><Camera size={12} strokeWidth={2} aria-hidden="true" /> snapshot {moneyMonthly(d.snapshotCostUsdMonth)}</span>
								</p>
							</div>
							<Button size="sm" href="/runs/{d.runId}" iconRight={ArrowRight}>Review</Button>
						</li>
					{/each}
				</ul>
			</Card>
		{/if}

		<Card padding="none" title="Open runs" description="Offboardings that are in review or still revoking.">
			{#snippet actions()}
				<Button variant="ghost" size="sm" href="/runs">All runs</Button>
			{/snippet}
			{#if data.openRuns.length}
				{#each data.openRuns as run (run.id)}
					<RunRow {run} />
				{/each}
			{:else}
				<EmptyState icon={Users} title="No one is being offboarded" body="Open an employee's profile and click Offboard now. You review every account before anything is revoked." compact>
					{#snippet actions()}
						<Button size="sm" href="/employees">Go to employees</Button>
					{/snippet}
				</EmptyState>
			{/if}
		</Card>

		{#if !data.needsAttention.length}
			<div class="clear">
				<ShieldCheck size={15} strokeWidth={2} aria-hidden="true" />
				<span>Nothing needs attention. Every re-check so far came back clean.</span>
			</div>
		{/if}
	</div>

	<div class="col side">
		<Card padding="none" title="Recent activity">
			{#snippet actions()}
				<Button variant="ghost" size="sm" href="/audit">Audit log</Button>
			{/snippet}
			{#if data.recentActivity.length}
				<ActivityFeed entries={data.recentActivity} />
			{:else}
				<EmptyState icon={Activity} title="No activity yet" body="Sweeps, approvals and every API call will show up here." compact />
			{/if}
		</Card>
	</div>
</div>

{#if data.isDemo}
	<Dialog bind:open={resetOpen} title="Reset the demo company?" role="alertdialog">
		{#snippet icon()}
			<Avatar name="Northwind Labs" size={36} />
		{/snippet}
		<p class="dlg">
			Last Day re-creates Northwind Labs' 30 fictional people and their accounts in Keycloak, Mattermost, GitHub and Vultr through
			the real APIs. Demo runs start fresh. This takes about a minute.
		</p>
		{#snippet footer()}
			<Button onclick={() => (resetOpen = false)}>Cancel</Button>
			<ActionForm action="resetDemo" successToast="Demo company reset" onsuccess={() => (resetOpen = false)}>
				{#snippet children({ pending })}
					<Button type="submit" variant="danger" icon={RotateCcw} loading={pending} loadingLabel="Resetting">Reset demo company</Button>
				{/snippet}
			</ActionForm>
		{/snippet}
	</Dialog>
{/if}

<style>
	.block {
		margin-bottom: var(--space-4);
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(6, minmax(0, 1fr));
		margin-bottom: var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-xs);
		overflow: hidden;
	}
	.stats > :global(*) + :global(*) {
		border-left: 1px solid var(--border-subtle);
	}
	.per {
		font-size: 14px;
		color: var(--text-3);
		font-weight: var(--weight-medium);
		margin-left: 1px;
		letter-spacing: 0;
	}

	.conns {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: var(--space-3);
		margin-bottom: var(--space-6);
	}
	.conn {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border-radius: var(--radius-md);
		background: var(--surface);
		border: 1px solid var(--border);
		color: var(--text);
		text-decoration: none;
		min-width: 0;
		transition: border-color var(--dur-1) var(--ease-out);
	}
	.conn:hover {
		border-color: var(--border-strong);
		text-decoration: none;
	}
	.conn-text {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		line-height: 1.3;
	}
	.conn-name {
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.conn-sub {
		font-size: var(--text-xs);
		color: var(--text-3);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.health {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		flex: none;
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		color: var(--text-2);
	}
	.hdot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--gray-8);
	}
	.health.tone-success {
		color: var(--success-text);
	}
	.tone-success .hdot {
		background: var(--success);
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 18%, transparent);
	}
	.health.tone-danger {
		color: var(--danger-text);
	}
	.tone-danger .hdot {
		background: var(--danger);
	}
	.tone-warning .hdot {
		background: var(--warning-strong);
	}

	.grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 380px;
		gap: var(--space-5);
		align-items: start;
	}
	.col {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		min-width: 0;
	}

	.destroys li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 16px;
	}
	.srv {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		flex: none;
		border-radius: var(--radius-md);
		background: var(--warning-soft);
		color: var(--warning-text);
		box-shadow: inset 0 0 0 1px var(--warning-border);
	}
	.d-text {
		flex: 1;
		min-width: 0;
	}
	.d-title {
		font-weight: var(--weight-semibold);
		font-size: var(--text-base);
	}
	.d-sub {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 12px;
		margin-top: 3px;
		font-size: var(--text-sm);
		color: var(--text-2);
	}
	.d-sub code {
		font-size: 12px;
		color: var(--text);
	}
	.bill {
		color: var(--warning-text);
		font-weight: var(--weight-medium);
	}
	.snap {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--text-3);
	}
	.clear {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 4px;
		font-size: var(--text-sm);
		color: var(--text-3);
	}
	.clear :global(svg) {
		color: var(--success-text);
	}
	.dlg {
		color: var(--text-2);
	}

	@media (max-width: 1240px) {
		.stats {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
		.stats > :global(:nth-child(4)) {
			border-left: 0;
		}
		.stats > :global(:nth-child(n + 4)) {
			border-top: 1px solid var(--border-subtle);
		}
		.grid {
			grid-template-columns: minmax(0, 1fr) 340px;
		}
	}
	@media (max-width: 1024px) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.conns {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 560px) {
		.stats {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.stats > :global(*) {
			border-left: 0 !important;
			border-top: 1px solid var(--border-subtle);
		}
		.stats > :global(:nth-child(-n + 2)) {
			border-top: 0;
		}
		.stats > :global(:nth-child(even)) {
			border-left: 1px solid var(--border-subtle) !important;
		}
		.conns {
			grid-template-columns: minmax(0, 1fr);
			gap: var(--space-2);
		}
		.destroys li {
			flex-wrap: wrap;
		}
	}
</style>
