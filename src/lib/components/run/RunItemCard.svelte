<script lang="ts">
	import type { RunItemView, RunStatus } from '#lib/types.ts';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Mail from '@lucide/svelte/icons/mail';
	import AtSign from '@lucide/svelte/icons/at-sign';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Fingerprint from '@lucide/svelte/icons/fingerprint';
	import Check from '@lucide/svelte/icons/check';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import ItemStatusIcon from './ItemStatusIcon.svelte';
	import StatusPill from '#lib/components/ui/StatusPill.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import ConfidenceMeter from '#lib/components/ui/ConfidenceMeter.svelte';
	import StepList from '#lib/components/ui/StepList.svelte';
	import ActionForm from '#lib/components/ui/ActionForm.svelte';
	import { ACCOUNT_KIND, LINK_METHOD } from '#lib/ui/status.ts';
	import { date, time } from '#lib/ui/format.ts';
	import { SYSTEM_NAMES } from '#lib/types.ts';

	let {
		item,
		firstName,
		canApprove,
		runStatus,
		regression = null,
		anchor
	}: {
		item: RunItemView;
		firstName: string;
		canApprove: boolean;
		runStatus: RunStatus;
		/** What the re-check observed for this item, if it came back. */
		regression?: string | null;
		/** DOM id so the approval bar can scroll to it. */
		anchor?: string;
	} = $props();

	const a = $derived(item.account);
	const isAi = $derived(item.matchKind === 'probable' || a.linkMethod === 'ai');
	const method = $derived(a.linkMethod ? LINK_METHOD[a.linkMethod] : null);
	const MethodIcon = $derived(
		a.linkMethod === 'rule:work_email' ? Mail : a.linkMethod === 'rule:username' ? AtSign : a.linkMethod === 'rule:sso_subject' ? Fingerprint : Link2
	);

	const primary = $derived(
		a.kind === 'apikey' ? (a.displayName ?? a.externalId) : a.kind === 'invitation' ? (a.emails[0] ?? a.displayName ?? 'Invitation') : (a.username ?? a.displayName ?? a.externalId)
	);
	const secondary = $derived.by(() => {
		const parts: string[] = [];
		if (a.kind === 'apikey') {
			parts.push(`Key ${a.externalId}`);
			if (a.username) parts.push(`owned by ${a.username}`);
		} else if (a.kind === 'invitation') {
			if (a.displayName) parts.push(a.displayName);
			if (a.createdAt) parts.push(`sent ${date(a.createdAt)}`);
		} else {
			if (a.displayName && a.displayName !== primary) parts.push(a.displayName);
			parts.push(...a.emails.filter((e) => e !== primary));
		}
		return parts;
	});
	// Show the name in full, then the primary email; everything else folds into "+N more" with a tooltip.
	const idShown = $derived(a.kind === 'user' || a.kind === 'service' ? secondary.slice(0, 2) : secondary);
	const idMore = $derived(secondary.slice(idShown.length));

	// Expansion: running and failed items open themselves so progress is visible.
	let userToggled = $state<boolean | null>(null);
	const autoOpen = $derived(item.status === 'running' || item.status === 'failed');
	const open = $derived(userToggled ?? autoOpen);

	// One satisfying moment when an item turns green while you watch.
	let flash = $state(false);
	let prevStatus: string | null = null;
	$effect(() => {
		const s = item.status;
		if (prevStatus && prevStatus !== s && s === 'verified') {
			flash = true;
			userToggled = null;
			const t = setTimeout(() => (flash = false), 1400);
			prevStatus = s;
			return () => clearTimeout(t);
		}
		prevStatus = s;
	});

	const uid = $props.id();
	const doneSteps = $derived(item.actions.filter((s) => s.status === 'done').length);
	const showDecision = $derived(item.status === 'proposed' && canApprove);
</script>

<article
	id={anchor}
	tabindex="-1"
	class="item st-{item.status}"
	class:ai={isAi && item.status === 'proposed'}
	class:flash
	class:regressed={!!regression}
	aria-labelledby="{uid}-name"
>
	<div class="head">
		<ItemStatusIcon status={regression ? 'failed' : item.status} />
		<div class="ident">
			<div class="name-row">
				<h4 class="name" id="{uid}-name">
					<span class:mono={a.kind !== 'invitation' && a.kind !== 'apikey'}>{primary}</span>
				</h4>
				<span class="kind">{ACCOUNT_KIND[a.kind]}</span>
			</div>
			{#if secondary.length}
				<p class="secondary">
					{#each idShown as s, i (s)}
						{#if i > 0}<span class="sep" aria-hidden="true">·</span>{/if}<span class="truncate">{s}</span>
					{/each}
					{#if idMore.length}<span class="sep" aria-hidden="true">·</span><span class="more" title={idMore.join('\n')}>+{idMore.length} more</span>{/if}
				</p>
			{/if}
		</div>

		<div class="badges">
			{#if isAi}
				<span class="ai-badge">
					<Badge tone="ai" icon={Sparkles}>AI match</Badge>
					{#if a.confidence != null}<ConfidenceMeter value={a.confidence} size="sm" />{/if}
				</span>
			{:else if method}
				<Badge tone="neutral" variant="outline" icon={MethodIcon}>{method.label}</Badge>
			{/if}
		</div>

		<div class="status">
			{#if regression}
				<StatusPill kind="run" value="regressed" label="Came back" size="sm" />
			{:else}
				<StatusPill kind="item" value={item.status} size="sm" />
			{/if}
		</div>

		<button
			class="toggle"
			type="button"
			aria-expanded={open}
			aria-controls="{uid}-detail"
			aria-label={open ? `Hide steps for ${primary}` : `Show steps for ${primary}`}
			onclick={() => (userToggled = !open)}
		>
			<span class="toggle-text num">{doneSteps}/{item.actions.length} steps</span>
			<ChevronDown size={15} strokeWidth={2} class="chev" />
		</button>
	</div>

	{#if regression}
		<div class="regression" role="alert">
			<TriangleAlert size={14} strokeWidth={2.2} aria-hidden="true" />
			<span><strong>Came back after revocation.</strong> {regression}</span>
		</div>
	{/if}

	{#if item.status === 'proposed' || (isAi && open)}
		<div class="evidence">
			<p class="ev-title">Why Last Day thinks this is {firstName}</p>
			<ul>
				{#each a.evidence as ev (ev)}
					<li>{ev}</li>
				{/each}
			</ul>
			{#if showDecision}
				<ActionForm action="decide" class="decision" successToast={false}>
					{#snippet children({ pending, submitter })}
						<input type="hidden" name="itemId" value={item.id} />
						<Button type="submit" name="decision" value="yes" variant="primary" size="sm" icon={Check} loading={pending && submitter === 'yes'} disabled={pending}>
							Yes, that's {firstName}
						</Button>
						<Button type="submit" name="decision" value="no" variant="secondary" size="sm" loading={pending && submitter === 'no'} disabled={pending}>
							Not {firstName}
						</Button>
						<span class="decision-note">The AI only suggests. Nothing changes until you approve.</span>
					{/snippet}
				</ActionForm>
			{/if}
		</div>
	{/if}

	{#if item.status === 'rejected'}
		<div class="rejected-note">
			<span>You said this is not {firstName}. Last Day will leave this account alone.</span>
			{#if canApprove && runStatus === 'review'}
				<ActionForm action="decide" successToast={false}>
					{#snippet children({ pending })}
						<input type="hidden" name="itemId" value={item.id} />
						<Button type="submit" name="decision" value="yes" variant="ghost" size="xs" loading={pending}>Undo, it is {firstName}</Button>
					{/snippet}
				</ActionForm>
			{/if}
		</div>
	{/if}

	{#if item.status === 'failed' && item.lastError}
		<div class="error">
			<div class="error-text">
				<p class="error-title">Failed after {item.attempts} {item.attempts === 1 ? 'attempt' : 'attempts'}</p>
				<p>{item.lastError}</p>
			</div>
			{#if canApprove}
				<ActionForm action="retry" successToast="Retrying">
					{#snippet children({ pending })}
						<input type="hidden" name="itemId" value={item.id} />
						<Button type="submit" size="sm" icon={RotateCcw} loading={pending} loadingLabel="Retrying">Retry</Button>
					{/snippet}
				</ActionForm>
			{/if}
		</div>
	{/if}

	{#if item.verifiedState && !open && item.status === 'verified'}
		<div class="readback">
			<span class="rb-label" class:was={!!regression}>{regression ? 'Earlier read-back' : `Confirmed by ${SYSTEM_NAMES[a.system]}`}</span>
			<code>{item.verifiedState}</code>
			{#if item.verifiedAt}<span class="rb-at num">{time(item.verifiedAt)}</span>{/if}
		</div>
	{/if}

	<div class="detail" id="{uid}-detail" hidden={!open}>
		{#if open}
			<StepList steps={item.actions} readBack={item.verifiedState && item.status === 'verified' ? { text: item.verifiedState, at: item.verifiedAt } : null} />
			<dl class="facts">
				<div><dt>External ID</dt><dd class="mono">{a.externalId}</dd></div>
				{#if a.createdAt}<div><dt>Created</dt><dd>{date(a.createdAt)}</dd></div>{/if}
				{#if a.lastActiveAt}<div><dt>Last active</dt><dd>{date(a.lastActiveAt)}</dd></div>{/if}
				{#if item.attempts > 1}<div><dt>Attempts</dt><dd class="num">{item.attempts}</dd></div>{/if}
			</dl>
			{#if canApprove && runStatus === 'review' && item.status === 'pending'}
				<ActionForm action="approve" class="single-approve" successToast="Approved this item">
					{#snippet children({ pending })}
						<input type="hidden" name="itemIds" value={item.id} />
						<Button type="submit" variant="ghost" size="xs" loading={pending}>Approve only this account</Button>
					{/snippet}
				</ActionForm>
			{/if}
		{/if}
	</div>
</article>

<style>
	.item {
		position: relative;
		padding: 12px 14px 12px 14px;
		background: var(--surface);
		transition:
			background-color var(--dur-4) var(--ease-out),
			box-shadow var(--dur-3) var(--ease-out);
	}
	.item + :global(.item) {
		border-top: 1px solid var(--border-subtle);
	}
	.item::before {
		content: '';
		position: absolute;
		left: 0;
		top: 10px;
		bottom: 10px;
		width: 2px;
		border-radius: 0 2px 2px 0;
		background: transparent;
		transition: background-color var(--dur-3) var(--ease-out);
	}
	.st-verified::before,
	.st-removed::before {
		background: var(--success);
	}
	.st-failed::before,
	.regressed::before {
		background: var(--danger);
	}
	.st-running::before {
		background: var(--accent);
	}
	.ai::before {
		background: var(--ai);
	}
	.ai {
		background: linear-gradient(var(--ai-soft), var(--ai-soft)) padding-box;
		background: color-mix(in srgb, var(--ai-soft) 45%, var(--surface));
	}
	.st-failed,
	.regressed {
		background: color-mix(in srgb, var(--danger-soft) 40%, var(--surface));
	}
	.st-rejected .ident,
	.st-rejected .badges {
		opacity: 0.6;
	}
	.flash {
		animation: flash 1.4s var(--ease-out);
	}
	@keyframes flash {
		0% {
			background-color: color-mix(in srgb, var(--success-soft-2) 90%, var(--surface));
		}
		100% {
			background-color: var(--surface);
		}
	}

	.head {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto auto auto;
		align-items: center;
		gap: 12px;
	}
	.ident {
		min-width: 0;
	}
	.name-row {
		display: flex;
		align-items: baseline;
		gap: 8px;
		min-width: 0;
	}
	.name {
		font-size: var(--text-base);
		font-weight: var(--weight-semibold);
		letter-spacing: -0.005em;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.name .mono {
		font-size: 13px;
		font-weight: 600;
	}
	.kind {
		flex: none;
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.secondary {
		display: flex;
		gap: 6px;
		margin-top: 1px;
		font-size: var(--text-sm);
		color: var(--text-2);
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
	}
	.sep {
		color: var(--text-3);
	}
	.secondary > :global(.truncate:first-child) {
		flex: none;
		max-width: 60%;
	}
	.more {
		flex: none;
		color: var(--text-3);
		cursor: help;
	}
	.badges {
		display: flex;
		align-items: center;
		justify-content: flex-end;
	}
	.ai-badge {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.status {
		display: flex;
		justify-content: flex-end;
		min-width: 112px;
	}
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 26px;
		padding: 0 6px 0 8px;
		border-radius: var(--radius-sm);
		color: var(--text-3);
		font-size: var(--text-xs);
	}
	.toggle:hover {
		background: var(--surface-3);
		color: var(--text);
	}
	.toggle :global(.chev) {
		transition: transform var(--dur-2) var(--ease-out);
	}
	.toggle[aria-expanded='true'] :global(.chev) {
		transform: rotate(180deg);
	}

	.evidence,
	.readback,
	.error,
	.rejected-note,
	.regression,
	.detail {
		margin-left: 34px;
	}

	.evidence {
		margin-top: 10px;
		padding: 10px 12px 12px;
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--ai-border);
	}
	.ev-title {
		font-size: var(--text-xs);
		font-weight: var(--weight-semibold);
		color: var(--ai-text);
	}
	.evidence ul {
		margin: 6px 0 0;
		padding-left: 16px;
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: var(--text-sm);
		color: var(--text);
	}
	.evidence li::marker {
		color: var(--ai);
	}
	.evidence :global(.decision) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px solid var(--border-subtle);
	}
	.decision-note {
		font-size: var(--text-xs);
		color: var(--text-3);
		margin-left: 4px;
	}

	.rejected-note {
		margin-top: 6px;
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		font-size: var(--text-sm);
		color: var(--text-2);
	}

	.regression {
		margin-top: 8px;
		display: flex;
		gap: 8px;
		align-items: flex-start;
		padding: 8px 10px;
		border-radius: var(--radius-sm);
		background: var(--danger-soft);
		color: var(--danger-text);
		font-size: var(--text-sm);
	}
	.regression :global(svg) {
		margin-top: 2px;
		flex: none;
	}
	.regression span {
		color: var(--text);
	}
	.regression strong {
		color: var(--danger-text);
	}

	.error {
		margin-top: 10px;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 12px;
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--danger-border);
		font-size: var(--text-sm);
	}
	.error-text {
		flex: 1;
		min-width: 0;
		color: var(--text-2);
	}
	.error-title {
		font-weight: var(--weight-semibold);
		color: var(--danger-text);
	}

	.readback {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-top: 6px;
		font-size: var(--text-xs);
		color: var(--text-3);
		min-width: 0;
	}
	.rb-label {
		flex: none;
		color: var(--success-text);
		font-weight: var(--weight-medium);
	}
	.rb-label.was {
		color: var(--text-3);
	}
	.readback code {
		font-size: 11.5px;
		color: var(--text-2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.rb-at {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 11px;
		flex: none;
	}

	.detail {
		margin-top: 8px;
		padding-top: 4px;
		animation: reveal var(--dur-3) var(--ease-out);
	}
	@keyframes reveal {
		from {
			opacity: 0;
			transform: translateY(-3px);
		}
	}
	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 20px;
		margin-top: 8px;
		padding-top: 10px;
		border-top: 1px dashed var(--border);
		font-size: var(--text-xs);
	}
	.facts div {
		display: flex;
		gap: 6px;
	}
	.facts dt {
		color: var(--text-3);
	}
	.facts dd {
		margin: 0;
		color: var(--text-2);
	}
	.facts .mono {
		font-size: 11px;
	}
	.detail :global(.single-approve) {
		margin-top: 8px;
	}

	@media (max-width: 860px) {
		.head {
			grid-template-columns: auto minmax(0, 1fr) auto;
			row-gap: 8px;
		}
		.badges {
			grid-column: 2;
			grid-row: 2;
			justify-content: flex-start;
		}
		.status {
			grid-column: 3;
			grid-row: 1;
			min-width: 0;
		}
		.toggle {
			grid-column: 3;
			grid-row: 2;
			justify-self: end;
		}
		.toggle-text {
			display: none;
		}
	}
	@media (max-width: 520px) {
		.evidence,
		.readback,
		.error,
		.rejected-note,
		.regression,
		.detail {
			margin-left: 0;
		}
		.error {
			flex-direction: column;
			align-items: flex-start;
		}
		.readback {
			flex-wrap: wrap;
		}
		.secondary {
			flex-wrap: wrap;
			white-space: normal;
			gap: 0 6px;
		}
		.secondary :global(.truncate) {
			white-space: normal;
			overflow-wrap: anywhere;
		}
		.readback code {
			white-space: normal;
			overflow-wrap: anywhere;
		}
		.decision-note {
			margin-left: 0;
			width: 100%;
		}
	}
</style>
