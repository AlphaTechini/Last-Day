<script lang="ts">
	import Lock from '@lucide/svelte/icons/lock';
	import PlugZap from '@lucide/svelte/icons/plug-zap';
	import Eye from '@lucide/svelte/icons/eye';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import StatusPill from '#lib/components/ui/StatusPill.svelte';
	import SystemIcon from '#lib/components/ui/SystemIcon.svelte';
	import RelativeTime from '#lib/components/ui/RelativeTime.svelte';
	import ActionForm from '#lib/components/ui/ActionForm.svelte';
	import { count } from '#lib/ui/format.ts';
	import type { ConnectionsPageData, PageProps } from '#lib/ui/page-data.ts';

	let { data, form }: PageProps<ConnectionsPageData> = $props();

	const readOnly = $derived(data.connections.length > 0 && data.connections.every((c) => !c.canEdit));
</script>

<svelte:head><title>Connections · Last Day</title></svelte:head>

<PageHeader
	title="Connections"
	description="The systems Last Day reads and revokes in. Credentials are encrypted at rest and never shown again after you save them."
/>

{#if readOnly}
	<div class="block">
		<Alert tone="info" title="View only">You can see how each system is connected, but only an admin can change credentials.</Alert>
	</div>
{/if}
{#if form?.error && !form.field}
	<div class="block"><Alert tone="danger" live>{form.error}</Alert></div>
{/if}

<div class="grid">
	{#each data.connections as c (c.system)}
		{@const fieldErr = (key: string) => (form?.error && form.field === key ? form.error : null)}
		<section class="card st-{c.status}" aria-labelledby="c-{c.system}">
			<header class="head">
				<SystemIcon system={c.system} size={36} />
				<div class="titles">
					<div class="title-row">
						<h2 id="c-{c.system}">{c.name}</h2>
						<StatusPill kind="connection" value={c.status} size="sm" />
					</div>
					<p class="desc">{c.description}</p>
				</div>
			</header>

			<dl class="meta">
				<div><dt>Accounts</dt><dd class="num">{c.status === 'not_configured' ? 'None yet' : count(c.accountCount)}</dd></div>
				<div><dt>Last test</dt><dd>{#if c.lastTestedAt}<RelativeTime date={c.lastTestedAt} />{:else}Never{/if}</dd></div>
				<div><dt>Credentials</dt><dd>{#if c.hasSecret}<span class="saved"><Lock size={12} strokeWidth={2.2} aria-hidden="true" />Saved</span>{:else}Not saved{/if}</dd></div>
			</dl>

			{#if c.lastError}
				<div class="err"><Alert tone="danger" title="Last test failed">{c.lastError}</Alert></div>
			{/if}

			<ActionForm action="save" class="form" successToast={c.canEdit ? true : false}>
				{#snippet children({ pending, submitter })}
					<input type="hidden" name="system" value={c.system} />
					<fieldset disabled={!c.canEdit}>
						<legend class="sr-only">{c.name} settings</legend>
						{#each c.configFields as f (f.key)}
							<Field id="{c.system}-{f.key}" label={f.label} error={fieldErr(f.key)}>
								{#snippet children({ id, describedBy, invalid })}
									<Input {id} name={f.key} value={c.config[f.key] ?? ''} placeholder={f.placeholder} mono {invalid} aria-describedby={describedBy} autocomplete="off" spellcheck="false" />
								{/snippet}
							</Field>
						{/each}
						{#each c.secretFields as f (f.key)}
							<Field
								id="{c.system}-{f.key}"
								label={f.label}
								hint={c.hasSecret ? 'Saved, never shown again. Leave blank to keep it.' : 'Stored encrypted. You will not be able to see it again.'}
								error={fieldErr(f.key)}
							>
								{#snippet children({ id, describedBy, invalid })}
									<Input
										{id}
										name={f.key}
										type="password"
										placeholder={c.hasSecret ? '••••••••••••  saved' : f.placeholder}
										mono
										{invalid}
										aria-describedby={describedBy}
										autocomplete="new-password"
										spellcheck="false"
									/>
								{/snippet}
							</Field>
						{/each}
					</fieldset>
					{#if c.canEdit}
						<div class="actions">
							<Button type="submit" size="sm" formaction="?/test" icon={PlugZap} loading={pending && submitter === 'test'} disabled={pending || c.status === 'not_configured'} loadingLabel="Testing">
								Test connection
							</Button>
							<Button type="submit" size="sm" variant="primary" loading={pending && submitter === 'save'} disabled={pending} loadingLabel="Saving">
								{c.hasSecret ? 'Save changes' : 'Save and connect'}
							</Button>
						</div>
					{:else}
						<p class="ro"><Eye size={13} strokeWidth={2} aria-hidden="true" /> Only an admin can edit this connection.</p>
					{/if}
				{/snippet}
			</ActionForm>
		</section>
	{/each}
</div>

<style>
	.block {
		margin-bottom: var(--space-4);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-5);
		align-items: start;
	}
	.card {
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-xs);
		min-width: 0;
	}
	.card.st-error {
		border-color: color-mix(in srgb, var(--danger) 30%, var(--border));
	}
	.head {
		display: flex;
		gap: 14px;
		padding: 18px 20px 0;
	}
	.titles {
		min-width: 0;
	}
	.title-row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px 10px;
	}
	h2 {
		font-size: var(--text-md);
		font-weight: var(--weight-semibold);
	}
	.desc {
		margin-top: 3px;
		font-size: var(--text-sm);
		color: var(--text-2);
	}
	.meta {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		margin: 16px 20px 0;
		padding: 10px 0;
		border-top: 1px solid var(--border-subtle);
		border-bottom: 1px solid var(--border-subtle);
	}
	.meta div + div {
		padding-left: 14px;
		border-left: 1px solid var(--border-subtle);
	}
	.meta dt {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.meta dd {
		margin: 1px 0 0;
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
	}
	.saved {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--success-text);
	}
	.err {
		margin: 14px 20px 0;
	}
	.card :global(.form) {
		display: flex;
		flex-direction: column;
		flex: 1;
	}
	fieldset {
		border: 0;
		padding: 16px 20px;
		margin: 0;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: auto;
		padding: 12px 20px;
		border-top: 1px solid var(--border-subtle);
		background: var(--surface-2);
		border-radius: 0 0 var(--radius-lg) var(--radius-lg);
	}
	.ro {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: auto;
		padding: 12px 20px;
		border-top: 1px solid var(--border-subtle);
		font-size: var(--text-sm);
		color: var(--text-3);
		background: var(--surface-2);
		border-radius: 0 0 var(--radius-lg) var(--radius-lg);
	}
	@media (max-width: 1024px) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 520px) {
		.head,
		fieldset,
		.actions,
		.ro {
			padding-left: 16px;
			padding-right: 16px;
		}
		.meta,
		.err {
			margin-left: 16px;
			margin-right: 16px;
		}
		.actions {
			flex-direction: column-reverse;
		}
		.actions :global(.btn) {
			width: 100%;
		}
	}
</style>
