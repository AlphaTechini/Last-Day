<script lang="ts">
	import type { ActionStep } from '#lib/types.ts';
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import Minus from '@lucide/svelte/icons/minus';
	import Spinner from './Spinner.svelte';
	import { time } from '#lib/ui/format.ts';

	let { steps, readBack }: { steps: ActionStep[]; readBack?: { text: string; at: string | null } | null } = $props();

	const STATUS_LABEL: Record<ActionStep['status'], string> = {
		pending: 'Not started',
		running: 'Running',
		done: 'Done',
		failed: 'Failed',
		skipped: 'Skipped'
	};

	function splitEndpoint(ep: string | null): { method: string | null; path: string } | null {
		if (!ep) return null;
		const m = ep.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+(.*)$/);
		return m ? { method: m[1], path: m[2] } : { method: null, path: ep };
	}

	function codeTone(code: number | null) {
		if (code == null) return 'none';
		if (code < 300) return 'ok';
		if (code < 400) return 'info';
		return 'bad';
	}
</script>

<ol class="steps" role="list">
	{#each steps as step, i (step.action + i)}
		{@const ep = splitEndpoint(step.endpoint)}
		<li class="step s-{step.status}">
			<span class="mark" aria-hidden="true">
				{#if step.status === 'done'}
					<Check size={11} strokeWidth={3} />
				{:else if step.status === 'failed'}
					<X size={11} strokeWidth={3} />
				{:else if step.status === 'running'}
					<Spinner size={12} />
				{:else if step.status === 'skipped'}
					<Minus size={11} strokeWidth={3} />
				{/if}
			</span>
			<div class="main">
				<div class="line">
					<span class="label">{step.label}</span>
					<span class="sr-only">{STATUS_LABEL[step.status]}</span>
					{#if step.at}<span class="at num">{time(step.at)}</span>{/if}
				</div>
				{#if ep}
					<div class="call">
						{#if ep.method}<span class="method m-{ep.method.toLowerCase()}">{ep.method}</span>{/if}
						<span class="path">{ep.path}</span>
						{#if step.httpStatus != null}
							<span class="code c-{codeTone(step.httpStatus)}">{step.httpStatus}</span>
						{/if}
					</div>
				{/if}
				{#if step.readBack}<div class="step-rb">{step.readBack}</div>{/if}
			</div>
		</li>
	{/each}
	{#if readBack}
		<li class="step s-readback">
			<span class="mark" aria-hidden="true"><Check size={11} strokeWidth={3} /></span>
			<div class="main">
				<div class="line">
					<span class="label">Read back from the system</span>
					{#if readBack.at}<span class="at num">{time(readBack.at)}</span>{/if}
				</div>
				<div class="readback">{readBack.text}</div>
			</div>
		</li>
	{/if}
</ol>

<style>
	.step-rb {
		margin-top: 2px;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		color: var(--text-3);
		overflow-wrap: anywhere;
	}
	.steps {
		position: relative;
		display: flex;
		flex-direction: column;
	}
	.step {
		position: relative;
		display: grid;
		grid-template-columns: 18px 1fr;
		gap: 10px;
		padding: 7px 0;
	}
	/* connector line */
	.step:not(:last-child)::before {
		content: '';
		position: absolute;
		left: 8.5px;
		top: 26px;
		bottom: -6px;
		width: 1px;
		background: var(--border);
	}
	.s-done:not(:last-child)::before {
		background: color-mix(in srgb, var(--success) 45%, var(--border));
	}
	.mark {
		display: grid;
		place-items: center;
		width: 18px;
		height: 18px;
		margin-top: 1px;
		border-radius: 50%;
		background: var(--surface);
		box-shadow: inset 0 0 0 1.5px var(--border-strong);
		color: var(--text-3);
	}
	.s-running .mark {
		box-shadow: none;
		color: var(--accent);
	}
	.s-done .mark,
	.s-readback .mark {
		background: var(--success);
		color: #fff;
		box-shadow: none;
		animation: mark-in var(--dur-3) var(--ease-spring);
	}
	.s-readback .mark {
		background: var(--success-soft-2);
		color: var(--success-text);
		box-shadow: inset 0 0 0 1px var(--success-border);
	}
	.s-failed .mark {
		background: var(--danger);
		color: #fff;
		box-shadow: none;
	}
	.s-skipped .mark {
		background: var(--surface-3);
		box-shadow: none;
	}
	@keyframes mark-in {
		from {
			transform: scale(0.4);
			opacity: 0;
		}
	}
	.main {
		min-width: 0;
	}
	.line {
		display: flex;
		align-items: baseline;
		gap: var(--space-2);
		min-height: 20px;
	}
	.label {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--text);
	}
	.s-pending .label,
	.s-skipped .label {
		color: var(--text-2);
		font-weight: var(--weight-regular);
	}
	.at {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 11px;
		color: var(--text-3);
	}
	.call {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 3px;
		font-family: var(--font-mono);
		font-size: 11.5px;
		line-height: 1.5;
		color: var(--text-2);
		min-width: 0;
	}
	.method {
		font-weight: 600;
		font-size: 10.5px;
		letter-spacing: 0.02em;
		color: var(--text-2);
	}
	.m-delete {
		color: var(--danger-text);
	}
	.m-post,
	.m-put,
	.m-patch {
		color: var(--accent-text);
	}
	.m-get {
		color: var(--success-text);
	}
	.path {
		overflow-wrap: anywhere;
		min-width: 0;
	}
	.code {
		padding: 0 5px;
		border-radius: 3px;
		font-size: 10.5px;
		font-weight: 600;
		line-height: 17px;
	}
	.c-ok {
		background: var(--success-soft);
		color: var(--success-text);
	}
	.c-info {
		background: var(--accent-soft);
		color: var(--accent-text);
	}
	.c-bad {
		background: var(--danger-soft);
		color: var(--danger-text);
	}
	.readback {
		margin-top: 4px;
		padding: 6px 9px;
		border-radius: var(--radius-sm);
		background: var(--success-soft);
		color: var(--success-text);
		font-family: var(--font-mono);
		font-size: 11.5px;
		overflow-wrap: anywhere;
	}
</style>
