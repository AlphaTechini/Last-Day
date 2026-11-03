<script lang="ts">
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Bot from '@lucide/svelte/icons/bot';
	import Flag from '@lucide/svelte/icons/flag';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { SYSTEM_NAMES } from '#lib/types.ts';
	import type { UnknownAccount } from '#lib/types.ts';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Select from '#lib/components/ui/Select.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import SegmentedControl from '#lib/components/ui/SegmentedControl.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import SystemIcon from '#lib/components/ui/SystemIcon.svelte';
	import Avatar from '#lib/components/ui/Avatar.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import ConfidenceMeter from '#lib/components/ui/ConfidenceMeter.svelte';
	import RelativeTime from '#lib/components/ui/RelativeTime.svelte';
	import ActionForm from '#lib/components/ui/ActionForm.svelte';
	import { ACCOUNT_KIND } from '#lib/ui/status.ts';
	import type { PageProps, UnknownPageData } from '#lib/ui/page-data.ts';

	let { data, form }: PageProps<UnknownPageData> = $props();

	type F = UnknownAccount['flag'];
	let filter = $state<F>('unlinked');
	const shown = $derived(data.accounts.filter((a) => a.flag === filter));
	const countOf = (f: F) => data.accounts.filter((a) => a.flag === f).length;
	let openWhy = $state<Record<string, boolean>>({});
</script>

<svelte:head><title>Unknown owners · Last Day</title></svelte:head>

<PageHeader
	title="Unknown owners"
	description="Accounts Last Day could not link to anyone. Decide who owns each one, so that when that person leaves, nothing is missed."
/>

{#if form?.error}
	<div class="block"><Alert tone="danger" live>{form.error}</Alert></div>
{/if}

<div class="toolbar">
	<SegmentedControl
		label="Show"
		size="sm"
		bind:value={filter}
		options={[
			{ value: 'unlinked', label: 'Unlinked', count: countOf('unlinked') },
			{ value: 'service', label: 'Service accounts', count: countOf('service') },
			{ value: 'flagged', label: 'Flagged', count: countOf('flagged') }
		]}
	/>
</div>

<Card padding="none">
	{#if shown.length}
		<ul class="list" role="list">
			{#each shown as a (a.id)}
				{@const s = a.aiSuggestion}
				<li class="row">
					<div class="acct">
						<SystemIcon system={a.system} size={30} />
						<div class="acct-text">
							<p class="acct-name">
								<span class="mono">{a.username ?? a.displayName ?? a.externalId}</span>
								<span class="kind">{SYSTEM_NAMES[a.system]} {ACCOUNT_KIND[a.kind].toLowerCase()}</span>
							</p>
							<p class="acct-sub">
								{[a.displayName !== a.username ? a.displayName : null, ...a.emails].filter(Boolean).join(' · ') || 'No name or email on the account'}
							</p>
							<p class="acct-meta">
								{#if a.createdAt}<span>Created <RelativeTime date={a.createdAt} /></span>{/if}
								{#if a.lastActiveAt}<span>Last active <RelativeTime date={a.lastActiveAt} /></span>{/if}
							</p>
						</div>
					</div>

					<div class="suggest">
						{#if a.flag === 'service'}
							<p class="note"><Bot size={14} strokeWidth={2} aria-hidden="true" /> Shared or service account. Offboarding skips it.</p>
						{:else if a.flag === 'flagged'}
							<p class="note flagged"><Flag size={14} strokeWidth={2} aria-hidden="true" /> Flagged for an admin to look at.</p>
						{:else if s}
							<div class="sugg-head">
								<Badge tone="ai" icon={Sparkles}>AI suggests</Badge>
								<ConfidenceMeter value={s.confidence} size="sm" />
							</div>
							<p class="sugg-person"><Avatar name={s.employeeName} size={20} /> {s.employeeName}</p>
							<button type="button" class="why" aria-expanded={!!openWhy[a.id]} onclick={() => (openWhy[a.id] = !openWhy[a.id])}>
								Why <ChevronDown size={12} strokeWidth={2.2} />
							</button>
							{#if openWhy[a.id]}
								<ul class="ev">
									{#each s.evidence as ev (ev)}<li>{ev}</li>{/each}
								</ul>
							{/if}
						{:else}
							<p class="note">No likely owner found.{#if a.evidence.length} {a.evidence[0]}.{/if}</p>
						{/if}
					</div>

					<div class="actions">
						<ActionForm action="link" class="link-form" successToast="Linked">
							{#snippet children({ pending })}
								<input type="hidden" name="accountId" value={a.id} />
								<Select name="employeeId" size="sm" value={s?.employeeId ?? ''} aria-label="Owner of {a.username ?? a.displayName}" required>
									<option value="" disabled>Choose a person</option>
									{#each data.employees as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
								</Select>
								<Button type="submit" size="sm" variant={s ? 'primary' : 'secondary'} icon={s ? UserCheck : Link2} loading={pending}>Link</Button>
							{/snippet}
						</ActionForm>
						<div class="secondary">
							{#if a.flag !== 'service'}
								<ActionForm action="markService" successToast="Marked as a service account">
									{#snippet children({ pending })}
										<input type="hidden" name="accountId" value={a.id} />
										<Button type="submit" size="xs" variant="ghost" icon={Bot} loading={pending}>Mark as service</Button>
									{/snippet}
								</ActionForm>
							{/if}
							{#if a.flag !== 'flagged'}
								<ActionForm action="flag" successToast="Flagged">
									{#snippet children({ pending })}
										<input type="hidden" name="accountId" value={a.id} />
										<Button type="submit" size="xs" variant="ghost" icon={Flag} loading={pending}>Flag</Button>
									{/snippet}
								</ActionForm>
							{/if}
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<EmptyState
			icon={UserCheck}
			tone={filter === 'unlinked' ? 'success' : 'neutral'}
			title={filter === 'unlinked' ? 'Every account has an owner' : filter === 'service' ? 'No service accounts' : 'Nothing flagged'}
			body={filter === 'unlinked' ? 'New accounts found by the next sweep will show up here if Last Day cannot place them.' : 'Accounts you mark from the Unlinked list appear here.'}
		/>
	{/if}
</Card>

<style>
	.block {
		margin-bottom: var(--space-4);
	}
	.toolbar {
		margin-bottom: var(--space-4);
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) 300px;
		gap: 20px;
		padding: 16px 20px;
		align-items: start;
	}
	.row + .row {
		border-top: 1px solid var(--border-subtle);
	}
	.acct {
		display: flex;
		gap: 12px;
		min-width: 0;
	}
	.acct-text {
		min-width: 0;
	}
	.acct-name {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 2px 8px;
		font-weight: var(--weight-semibold);
	}
	.acct-name .mono {
		font-size: 13px;
	}
	.kind {
		font-size: var(--text-xs);
		font-weight: var(--weight-regular);
		color: var(--text-3);
	}
	.acct-sub {
		margin-top: 1px;
		font-size: var(--text-sm);
		color: var(--text-2);
		overflow-wrap: anywhere;
	}
	.acct-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 12px;
		margin-top: 4px;
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.suggest {
		min-width: 0;
		font-size: var(--text-sm);
	}
	.sugg-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.sugg-person {
		display: flex;
		align-items: center;
		gap: 7px;
		margin-top: 7px;
		font-weight: var(--weight-medium);
	}
	.why {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		margin-top: 4px;
		font-size: var(--text-xs);
		color: var(--text-link);
	}
	.why[aria-expanded='true'] :global(svg) {
		transform: rotate(180deg);
	}
	.ev {
		margin-top: 6px;
		padding-left: 16px;
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: var(--text-xs);
		color: var(--text-2);
	}
	.ev li::marker {
		color: var(--ai);
	}
	.note {
		display: flex;
		gap: 7px;
		align-items: flex-start;
		color: var(--text-2);
	}
	.note :global(svg) {
		margin-top: 2px;
		flex: none;
		color: var(--text-3);
	}
	.flagged :global(svg) {
		color: var(--warning-text);
	}
	.actions {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.actions :global(.link-form) {
		display: flex;
		gap: 6px;
	}
	.secondary {
		display: flex;
		gap: 2px;
		margin-left: -6px;
	}
	@media (max-width: 1100px) {
		.row {
			grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		}
		.actions {
			grid-column: 1 / -1;
			flex-direction: row;
			align-items: center;
			flex-wrap: wrap;
		}
		.actions :global(.link-form) {
			width: 320px;
			max-width: 100%;
		}
		.secondary {
			margin-left: 0;
		}
	}
	@media (max-width: 640px) {
		.row {
			grid-template-columns: minmax(0, 1fr);
			gap: 12px;
			padding: 14px 16px;
		}
		.suggest {
			padding-left: 42px;
		}
		.actions :global(.link-form) {
			width: 100%;
		}
	}
</style>
