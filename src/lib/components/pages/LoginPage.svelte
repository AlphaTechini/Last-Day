<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Gavel from '@lucide/svelte/icons/gavel';
	import Logo from '#lib/components/ui/Logo.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import ActionForm from '#lib/components/ui/ActionForm.svelte';
	import Toaster from '#lib/components/ui/Toaster.svelte';
	import type { LoginPageData, PageProps } from '#lib/ui/page-data.ts';

	let { data, form }: PageProps<LoginPageData> = $props();

	let email = $state('');
	let password = $state('');
	let submitBtn: HTMLDivElement | undefined = $state();
	let filled = $state(false);

	const fieldError = (name: string) => (form?.error && form.field === name ? form.error : null);
	const generalError = $derived(form?.error && !form.field ? form.error : null);

	function fillJudge() {
		if (!data.demoHint) return;
		email = data.demoHint.email;
		password = data.demoHint.password;
		filled = true;
		submitBtn?.querySelector('button')?.focus();
	}
</script>

<svelte:head><title>Sign in · Last Day</title></svelte:head>

<div class="login">
	<div class="col">
		<div class="brand">
			<Logo size={40} wordmark={false} />
		</div>
		<h1>Sign in to Last Day</h1>
		<p class="lede">Offboard anyone in one click. Every account found, every revocation proven.</p>

		<div class="card">
			{#if generalError}
				<div class="err"><Alert tone="danger" live>{generalError}</Alert></div>
			{/if}
			<ActionForm action="login" successToast={false} class="form">
				{#snippet children({ pending })}
					<Field id="email" label="Work email" error={fieldError('email')}>
						{#snippet children({ id, describedBy, invalid })}
							<Input {id} name="email" type="email" autocomplete="username" required placeholder="you@company.com" bind:value={email} {invalid} aria-describedby={describedBy} />
						{/snippet}
					</Field>
					<Field id="password" label="Password" error={fieldError('password')}>
						{#snippet children({ id, describedBy, invalid })}
							<Input {id} name="password" type="password" autocomplete="current-password" required bind:value={password} {invalid} aria-describedby={describedBy} />
						{/snippet}
					</Field>
					<div bind:this={submitBtn}>
						<Button type="submit" variant="primary" size="lg" full loading={pending} loadingLabel="Signing in" iconRight={ArrowRight}>Sign in</Button>
					</div>
				{/snippet}
			</ActionForm>
		</div>

		{#if data.demoHint}
			<div class="judge" class:filled>
				<div class="judge-head">
					<span class="judge-ico" aria-hidden="true"><Gavel size={14} strokeWidth={2} /></span>
					<div>
						<p class="judge-title">Judge access</p>
						<p class="judge-sub">Signs you in to the fictional Northwind Labs demo company. You can reset it, offboard people and read the audit log.</p>
					</div>
				</div>
				<dl class="creds">
					<div><dt>Email</dt><dd class="mono">{data.demoHint.email}</dd></div>
					<div><dt>Password</dt><dd class="mono">{data.demoHint.password}</dd></div>
				</dl>
				<Button size="sm" full onclick={fillJudge}>{filled ? 'Filled in. Press Sign in.' : 'Fill in judge login'}</Button>
			</div>
		{/if}

		<p class="foot">Nothing is revoked without a person's approval.</p>
	</div>
</div>

<Toaster />

<style>
	.login {
		min-height: 100dvh;
		display: grid;
		place-items: center;
		padding: 48px 16px;
		background-color: var(--bg);
		background-image: radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--text) 9%, transparent) 1px, transparent 0);
		background-size: 22px 22px;
		background-position: center;
	}
	.login::before {
		content: '';
		position: fixed;
		inset: 0;
		background: radial-gradient(ellipse 60% 55% at 50% 45%, var(--bg) 35%, transparent 100%);
		pointer-events: none;
	}
	.col {
		position: relative;
		width: 100%;
		max-width: 384px;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}
	.brand {
		margin-bottom: 20px;
		filter: drop-shadow(0 6px 14px rgb(16 24 40 / 0.14));
	}
	h1 {
		font-size: var(--text-2xl);
		letter-spacing: var(--tracking-tighter);
	}
	.lede {
		margin-top: 8px;
		color: var(--text-2);
		font-size: var(--text-md);
		max-width: 34ch;
	}
	.card {
		width: 100%;
		margin-top: 28px;
		padding: 22px;
		text-align: left;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow-md);
	}
	.err {
		margin-bottom: 14px;
	}
	.card :global(.form) {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.card :global(.form > div:last-child) {
		margin-top: 4px;
	}
	.judge {
		width: 100%;
		margin-top: 14px;
		padding: 14px;
		text-align: left;
		border-radius: var(--radius-lg);
		background: var(--surface-2);
		border: 1px dashed var(--border-strong);
		transition: border-color var(--dur-3) var(--ease-out);
	}
	.judge.filled {
		border-style: solid;
		border-color: var(--success-border);
	}
	.judge-head {
		display: flex;
		gap: 10px;
	}
	.judge-ico {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		flex: none;
		border-radius: var(--radius-sm);
		background: var(--surface);
		color: var(--text-2);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.judge-title {
		font-weight: var(--weight-semibold);
		font-size: var(--text-sm);
	}
	.judge-sub {
		margin-top: 1px;
		font-size: var(--text-xs);
		color: var(--text-2);
		line-height: 1.45;
	}
	.creds {
		margin: 12px 0;
		padding: 8px 10px;
		border-radius: var(--radius-sm);
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--border);
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--text-xs);
	}
	.creds div {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}
	.creds dt {
		color: var(--text-3);
	}
	.creds dd {
		margin: 0;
		font-size: 11.5px;
		overflow-wrap: anywhere;
		text-align: right;
	}
	.foot {
		margin-top: 22px;
		font-size: var(--text-xs);
		color: var(--text-3);
	}
</style>
