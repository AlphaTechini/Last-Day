<script lang="ts">
	import type { RunDetail } from '#lib/types.ts';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Lock from '@lucide/svelte/icons/lock';
	import ArrowDown from '@lucide/svelte/icons/arrow-down';
	import Button from '#lib/components/ui/Button.svelte';
	import ActionForm from '#lib/components/ui/ActionForm.svelte';
	import { plural } from '#lib/ui/format.ts';

	let { run, onjump }: { run: RunDetail; onjump?: () => void } = $props();

	const proposed = $derived(run.items.filter((i) => i.status === 'proposed'));
	const pending = $derived(run.items.filter((i) => i.status === 'pending'));
	// Count the API actions approval will run. A server's destroy step needs the manager, so it is not counted.
	const actionCount = $derived(
		pending.reduce((n, i) => n + i.actions.filter((a) => !/destroy/i.test(a.action)).length, 0)
	);
	const systems = $derived(new Set(pending.map((i) => i.account.system)).size);
	const hasServer = $derived(pending.some((i) => i.matchKind === 'server'));
	const blocked = $derived(proposed.length > 0 || pending.length === 0 || !run.canApprove);
</script>

<div class="bar" class:blocked role="region" aria-label="Approve revocation">
	<div class="msg">
		{#if !run.canApprove}
			<span class="ico"><Lock size={15} strokeWidth={2} /></span>
			<p><strong>View only.</strong> People ops or an admin approves revocation.</p>
		{:else if proposed.length > 0}
			<span class="ico ai"><Sparkles size={15} strokeWidth={2} /></span>
			<p>
				<strong>Decide {plural(proposed.length, 'probable match', 'probable matches')} first.</strong>
				<span class="muted">Approval runs only on accounts you have confirmed.</span>
				{#if onjump}<button type="button" class="jump" onclick={onjump}>Show me <ArrowDown size={12} strokeWidth={2.2} /></button>{/if}
			</p>
		{:else if pending.length === 0}
			<span class="ico"><ShieldCheck size={15} strokeWidth={2} /></span>
			<p><strong>Nothing left to approve.</strong></p>
		{:else}
			<span class="ico ok"><ShieldCheck size={15} strokeWidth={2} /></span>
			<p>
				<strong>{plural(actionCount, 'action')} across {plural(systems, 'system')}.</strong>
				<span class="muted">
					{#if hasServer}Servers are halted and snapshotted, never destroyed without the manager.{:else}Each line turns green only when the system confirms.{/if}
				</span>
			</p>
		{/if}
	</div>
	<ActionForm action="approve" successToast="Approved. Revoking now.">
		{#snippet children({ pending: busy })}
			<input type="hidden" name="all" value="1" />
			<Button type="submit" variant="primary" size="lg" disabled={blocked} loading={busy} loadingLabel="Approving" aria-describedby="approve-why">
				Approve revocation ({actionCount} {actionCount === 1 ? 'action' : 'actions'})
			</Button>
		{/snippet}
	</ActionForm>
	<span id="approve-why" class="sr-only">
		{#if proposed.length > 0}Disabled until every probable match is decided.{/if}
	</span>
</div>

<style>
	.bar {
		position: sticky;
		bottom: 16px;
		z-index: var(--z-sticky);
		display: flex;
		align-items: center;
		gap: 16px;
		margin-top: var(--space-6);
		padding: 10px 10px 10px 16px;
		border-radius: var(--radius-xl);
		background: color-mix(in srgb, var(--surface-raised) 92%, transparent);
		backdrop-filter: saturate(1.4) blur(12px);
		border: 1px solid var(--border);
		box-shadow: var(--shadow-lg);
		animation: rise var(--dur-4) var(--ease-out);
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
	}
	.msg {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: var(--text-sm);
	}
	.msg p {
		line-height: 1.45;
	}
	.msg strong {
		font-weight: var(--weight-semibold);
	}
	.ico {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		flex: none;
		border-radius: var(--radius-md);
		background: var(--surface-3);
		color: var(--text-2);
	}
	.ico.ai {
		background: var(--ai-soft);
		color: var(--ai-text);
	}
	.ico.ok {
		background: var(--success-soft);
		color: var(--success-text);
	}
	.jump {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		margin-left: 4px;
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--text-link);
	}
	.jump:hover {
		text-decoration: underline;
	}
	@media (max-width: 720px) {
		.bar {
			flex-direction: column;
			align-items: stretch;
			gap: 10px;
			padding: 12px;
			bottom: 10px;
		}
		.bar :global(form),
		.bar :global(.btn) {
			width: 100%;
		}
	}
</style>
