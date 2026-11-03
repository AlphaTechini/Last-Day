<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Logo from '#lib/components/ui/Logo.svelte';
	import Button from '#lib/components/ui/Button.svelte';

	let { status, message }: { status: number; message?: string | null } = $props();

	const title = $derived(
		status === 404 ? 'This page does not exist' : status === 403 ? 'You do not have access to this' : status >= 500 ? 'Something went wrong on our side' : 'Something went wrong'
	);
	const body = $derived(
		status === 404
			? 'The link may be old, or the run or person was removed when the demo company was reset.'
			: status === 403
				? 'Ask an admin if you think you should be able to see this.'
				: status >= 500
					? 'No action was taken. If you were approving something, check the run before trying again.'
					: (message ?? 'Please try again.')
	);
</script>

<svelte:head><title>{title} · Last Day</title></svelte:head>

<div class="err">
	<div class="box">
		<Logo size={28} wordmark={false} />
		<p class="code num">Error {status}</p>
		<h1>{title}</h1>
		<p class="body">{body}</p>
		{#if message && status !== 404 && message !== body}<p class="msg mono">{message}</p>{/if}
		<div class="actions">
			<Button variant="primary" href="/" icon={ArrowLeft}>Back to dashboard</Button>
		</div>
	</div>
</div>

<style>
	.err {
		min-height: 70dvh;
		display: grid;
		place-items: center;
		padding: 48px 16px;
	}
	.box {
		max-width: 440px;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
	}
	.code {
		margin-top: 20px;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	h1 {
		margin-top: 6px;
		font-size: var(--text-2xl);
		letter-spacing: var(--tracking-tighter);
	}
	.body {
		margin-top: 8px;
		color: var(--text-2);
	}
	.msg {
		margin-top: 12px;
		padding: 6px 10px;
		border-radius: var(--radius-sm);
		background: var(--surface-3);
		font-size: 12px;
		color: var(--text-2);
	}
	.actions {
		margin-top: 24px;
	}
</style>
