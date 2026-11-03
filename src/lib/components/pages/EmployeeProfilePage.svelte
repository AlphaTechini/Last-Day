<script lang="ts">
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Mail from '@lucide/svelte/icons/mail';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Inbox from '@lucide/svelte/icons/inbox';
	import Check from '@lucide/svelte/icons/check';
	import History from '@lucide/svelte/icons/history';
	import { SYSTEM_NAMES, type SystemId } from '#lib/types.ts';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Avatar from '#lib/components/ui/Avatar.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import StatusPill from '#lib/components/ui/StatusPill.svelte';
	import SystemIcon from '#lib/components/ui/SystemIcon.svelte';
	import ConfidenceMeter from '#lib/components/ui/ConfidenceMeter.svelte';
	import RelativeTime from '#lib/components/ui/RelativeTime.svelte';
	import KeyValue from '#lib/components/ui/KeyValue.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Spinner from '#lib/components/ui/Spinner.svelte';
	import ActionForm from '#lib/components/ui/ActionForm.svelte';
	import RunRow from '#lib/components/run/RunRow.svelte';
	import { ACCOUNT_KIND, LINK_METHOD } from '#lib/ui/status.ts';
	import { date, firstName, identityLine, moneyMonthly, plural } from '#lib/ui/format.ts';
	import type { EmployeeProfilePageData, PageProps } from '#lib/ui/page-data.ts';

	let { data, form }: PageProps<EmployeeProfilePageData> = $props();

	const e = $derived(data.employee);
	const first = $derived(firstName(e.name));
	const ORDER: SystemId[] = ['keycloak', 'mattermost', 'github', 'vultr'];
	const groups = $derived(
		ORDER.map((system) => ({ system, accounts: data.accounts.filter((a) => a.system === system) })).filter((g) => g.accounts.length)
	);
	const activeCount = $derived(data.accounts.filter((a) => a.active).length);
	const openRun = $derived(data.runs.find((r) => r.status === 'review' || r.status === 'executing' || r.status === 'partial'));
	const aiCount = $derived(data.accounts.filter((a) => a.linkMethod === 'ai').length);

	let confirmOpen = $state(false);
	let submitting = $state(false);
	let phase = $state(0);
	$effect(() => {
		if (!submitting) {
			phase = 0;
			return;
		}
		const id = setInterval(() => (phase = Math.min(phase + 1, ORDER.length)), 900);
		return () => clearInterval(id);
	});
</script>

<svelte:head><title>{e.name} · Last Day</title></svelte:head>

<PageHeader title={e.name} crumbs={[{ label: 'Employees', href: '/employees' }, { label: e.name }]}>
	{#snippet lead()}
		<Avatar name={e.name} size={52} muted={e.status === 'offboarded'} />
	{/snippet}
	{#snippet meta()}
		<StatusPill kind="employee" value={e.status} />
		<span>{e.role}</span>
		<span class="dot-sep">{e.department}</span>
		<span class="dot-sep mono-ish">{e.workEmail}</span>
	{/snippet}
	{#snippet actions()}
		{#if openRun}
			<Button variant="primary" href="/runs/{openRun.id}" iconRight={ArrowRight}>View offboarding run</Button>
		{:else if data.canOffboard && e.status !== 'offboarded'}
			<Button variant="danger-secondary" icon={UserMinus} onclick={() => (confirmOpen = true)}>Offboard now</Button>
		{/if}
	{/snippet}
</PageHeader>

{#if form?.error}
	<div class="block"><Alert tone="danger" title="Offboarding did not start" live>{form.error}</Alert></div>
{/if}
{#if e.status === 'offboarding' && openRun}
	<div class="block">
		<Alert tone="warning" title="{first} is being offboarded">
			Started by {openRun.startedBy} <RelativeTime date={openRun.startedAt} />. {openRun.verifiedCount} of {openRun.itemCount} accounts confirmed so far.
		</Alert>
	</div>
{:else if e.status === 'offboarded'}
	<div class="block">
		<Alert tone="success" title="Offboarded{e.endDate ? ` on ${date(e.endDate)}` : ''}">Every account below was revoked and confirmed by its own system.</Alert>
	</div>
{/if}

<div class="layout" class:offboarding={e.status === 'offboarding'}>
	<div class="main">
		<Card padding="none" title="Accounts" description="{plural(data.accounts.length, 'account')} across {plural(groups.length, 'system')}, {activeCount} still active.{aiCount ? ` ${aiCount} found by the AI resolver under other names.` : ''}">
			{#if groups.length}
				{#each groups as g (g.system)}
					<div class="sys-group">
						<div class="sys-head">
							<SystemIcon system={g.system} size={22} />
							<span class="sys-name">{SYSTEM_NAMES[g.system]}</span>
							<span class="sys-count num">{g.accounts.length}</span>
						</div>
						<ul role="list">
							{#each g.accounts as a (a.id)}
								<li class="acc" class:inactive={!a.active}>
									<div class="acc-main">
										<p class="acc-name">
											<span class:mono={a.kind !== 'invitation'}>{a.kind === 'invitation' ? (a.displayName ?? 'Invitation') : (a.username ?? a.displayName ?? a.externalId)}</span>
											<span class="acc-kind">{ACCOUNT_KIND[a.kind]}</span>
										</p>
										<p class="acc-sub">
											{#if a.kind === 'instance'}
												{a.plan}{#if a.region}, {a.region}{/if}{#if a.monthlyCostUsd != null}, <span class="num">{moneyMonthly(a.monthlyCostUsd)}</span>{/if}
											{:else if a.kind === 'apikey'}
												Key <span class="mono">{a.externalId}</span>
											{:else if a.kind === 'invitation'}
												{a.emails.join(' · ')}{#if a.createdAt}, sent {date(a.createdAt)}{/if}
											{:else}
												<span title={identityLine(a.displayName, a.emails, a.username).title}>{identityLine(a.displayName, a.emails, a.username).text}</span>
											{/if}
										</p>
									</div>
									<div class="acc-link">
										{#if a.linkMethod === 'ai'}
											<Badge tone="ai" icon={Sparkles}>AI match</Badge>
											{#if a.confidence != null}<ConfidenceMeter value={a.confidence} size="sm" />{/if}
										{:else if a.linkMethod}
											<Badge variant="outline" icon={a.linkMethod === 'rule:work_email' ? Mail : Link2}>{LINK_METHOD[a.linkMethod].short}</Badge>
										{/if}
									</div>
									<div class="acc-seen">
										{#if a.lastActiveAt}<span class="subtle">Active <RelativeTime date={a.lastActiveAt} /></span>{/if}
									</div>
									<div class="acc-state">
										{#if a.active}
											<span class="state on"><span class="sdot"></span>{a.kind === 'instance' ? (a.powerStatus ?? 'running') : a.kind === 'invitation' ? 'Pending' : 'Active'}</span>
										{:else}
											<span class="state off"><Check size={12} strokeWidth={2.6} aria-hidden="true" />Revoked</span>
										{/if}
									</div>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			{:else}
				<EmptyState icon={Inbox} title="No linked accounts" body="Run a sweep from the dashboard to find {first}'s accounts in every connected system." compact />
			{/if}
		</Card>

		<Card padding="none" title="Offboarding runs">
			{#if data.runs.length}
				{#each data.runs as run (run.id)}
					<RunRow {run} />
				{/each}
			{:else}
				<EmptyState icon={History} title="No offboarding runs" body="When {first} leaves, click Offboard now. Every run and its proof is kept here." compact />
			{/if}
		</Card>
	</div>

	<aside class="aside">
		<Card padding="sm" title="Details" headingLevel={3}>
			<KeyValue
				items={[
					{ label: 'Manager', value: e.managerName },
					{ label: 'Department', value: e.department },
					{ label: 'Job title', value: e.role },
					{ label: 'Start date', value: date(e.startDate) },
					{ label: 'Last day', value: e.endDate ? date(e.endDate) : null },
					{ label: 'Known aliases', render: aliases }
				]}
			/>
		</Card>
		{#if data.canOffboard && e.status === 'active'}
			<Card padding="sm" tone="muted" title="When {first} leaves" headingLevel={3}>
				<ul class="explain" role="list">
					<li>Last Day looks for {first}'s accounts in every connected system, including ones under other names.</li>
					<li>You review each match. Nothing is revoked until you approve.</li>
					<li>Each account turns green only when its system confirms it.</li>
				</ul>
			</Card>
		{/if}
	</aside>
</div>

{#snippet aliases()}
	{#if e.aliases.length}
		<span class="aliases">{#each e.aliases as al (al)}<code>{al}</code>{/each}</span>
	{:else}
		<span class="subtle">None recorded</span>
	{/if}
{/snippet}

{#if data.canOffboard}
	<Dialog bind:open={confirmOpen} title="Offboard {e.name}?" role="alertdialog" dismissible={!submitting}>
		{#snippet icon()}
			<span class="dlg-ico"><UserMinus size={18} strokeWidth={2} /></span>
		{/snippet}
		<p class="dlg-lead">This will revoke {first}'s access in every connected system. Continue?</p>
		<p class="dlg-sub">First you see everything Last Day finds. Nothing is revoked until you approve it.</p>
		<ul class="dlg-systems" role="list" aria-live="polite">
			{#each ORDER as s, i (s)}
				<li class:done={submitting && phase > i} class:active={submitting && phase === i}>
					<SystemIcon system={s} size={22} />
					<span>{SYSTEM_NAMES[s]}</span>
					<span class="dlg-state">
						{#if submitting && phase > i}<Check size={13} strokeWidth={2.6} />{:else if submitting && phase === i}<Spinner size={12} />{/if}
					</span>
				</li>
			{/each}
		</ul>
		{#if submitting}<p class="dlg-wait">Searching for {first}'s accounts. This takes a few seconds.</p>{/if}
		{#snippet footer()}
			<Button onclick={() => (confirmOpen = false)} disabled={submitting}>Cancel</Button>
			<ActionForm action="offboard" successToast={false} onbefore={() => void (submitting = true)} onsettled={() => (submitting = false)}>
				{#snippet children({ pending })}
					<Button type="submit" variant="danger" icon={UserMinus} loading={pending} loadingLabel="Finding accounts">Offboard {first}</Button>
				{/snippet}
			</ActionForm>
		{/snippet}
	</Dialog>
{/if}

<style>
	.block {
		margin-bottom: var(--space-4);
	}
	.layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 300px;
		gap: var(--space-5);
		align-items: start;
	}
	.main,
	.aside {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		min-width: 0;
	}
	.sys-group + .sys-group {
		border-top: 1px solid var(--border-subtle);
	}
	.sys-head {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 20px 4px;
	}
	.sys-name {
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
	}
	.sys-count {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.acc {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 170px 130px 84px;
		align-items: center;
		gap: 12px;
		padding: 9px 20px 9px 50px;
	}
	.acc + .acc {
		border-top: 1px dashed var(--border-subtle);
	}
	.sys-group ul {
		padding-bottom: 6px;
	}
	.acc-name {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-weight: var(--weight-semibold);
		font-size: var(--text-sm);
		min-width: 0;
	}
	.acc-name .mono {
		font-size: 12.5px;
	}
	.acc-kind {
		font-weight: var(--weight-regular);
		font-size: var(--text-xs);
		color: var(--text-3);
		white-space: nowrap;
	}
	.acc-sub {
		font-size: var(--text-xs);
		color: var(--text-2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.acc-sub .mono {
		font-size: 11px;
	}
	.acc-link {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.acc-seen {
		font-size: var(--text-xs);
	}
	.acc-state {
		display: flex;
		justify-content: flex-end;
	}
	.state {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		text-transform: capitalize;
	}
	.state.on {
		color: var(--text);
	}
	.sdot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--gray-9);
	}
	.offboarding .sdot {
		background: var(--warning-strong);
	}
	.state.off {
		color: var(--success-text);
	}
	.inactive .acc-name,
	.inactive .acc-sub {
		color: var(--text-3);
	}
	.aliases {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.aliases code {
		font-size: 11px;
		padding: 1px 5px;
		border-radius: 4px;
		background: var(--surface-3);
	}
	.explain {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-left: 16px;
		list-style: disc;
		font-size: var(--text-sm);
		color: var(--text-2);
	}
	.explain li::marker {
		color: var(--text-3);
	}

	.dlg-ico {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-md);
		background: var(--danger-soft);
		color: var(--danger-text);
	}
	.dlg-lead {
		font-size: var(--text-md);
		font-weight: var(--weight-medium);
	}
	.dlg-sub {
		margin-top: 4px;
		color: var(--text-2);
	}
	.dlg-systems {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
		margin-top: 16px;
	}
	.dlg-systems li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 10px;
		border-radius: var(--radius-sm);
		background: var(--surface-2);
		font-size: var(--text-sm);
		box-shadow: inset 0 0 0 1px var(--border-subtle);
		transition: background-color var(--dur-3) var(--ease-out);
	}
	.dlg-systems li.active {
		box-shadow: inset 0 0 0 1px var(--accent-border);
	}
	.dlg-systems li.done {
		background: var(--success-soft);
		box-shadow: inset 0 0 0 1px var(--success-border);
	}
	.dlg-state {
		margin-left: auto;
		display: flex;
		color: var(--success-text);
	}
	.active .dlg-state {
		color: var(--accent);
	}
	.dlg-wait {
		margin-top: 12px;
		font-size: var(--text-sm);
		color: var(--text-2);
	}

	@media (max-width: 1100px) {
		.acc {
			grid-template-columns: minmax(0, 1fr) auto 84px;
		}
		.acc-seen {
			display: none;
		}
	}
	@media (max-width: 980px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 640px) {
		.acc {
			grid-template-columns: minmax(0, 1fr) auto;
			padding: 10px 16px;
			row-gap: 6px;
		}
		.acc-link {
			grid-row: 2;
			grid-column: 1 / -1;
		}
		.acc-state {
			grid-row: 1;
			grid-column: 2;
		}
		.sys-head {
			padding: 12px 16px 4px;
		}
		.dlg-systems {
			grid-template-columns: 1fr;
		}
	}
</style>
