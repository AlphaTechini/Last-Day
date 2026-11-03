<script lang="ts">
	import type { AuditEntry } from '#lib/types.ts';
	import SystemIcon from '#lib/components/ui/SystemIcon.svelte';
	import RelativeTime from '#lib/components/ui/RelativeTime.svelte';
	import { auditKind } from '#lib/ui/status.ts';

	let { entries }: { entries: AuditEntry[] } = $props();
</script>

<ol class="feed" role="list">
	{#each entries as e (e.id)}
		{@const k = auditKind(e.kind)}
		<li>
			<span class="rail" aria-hidden="true"><span class="pip tone-{k.tone}"></span></span>
			<div class="body">
				<p class="summary">
					{#if e.system}<span class="sys"><SystemIcon system={e.system} size={16} bare /></span>{/if}
					{e.summary}
				</p>
				<p class="meta">
					<span>{e.actor === 'system' ? 'Last Day' : e.actor}</span>
					{#if e.employeeName}<span class="sep">·</span><span>{e.employeeName}</span>{/if}
					{#if e.detail.status != null}<span class="sep">·</span><span class="code num">{e.detail.method} {e.detail.status}</span>{/if}
					<span class="time"><RelativeTime date={e.at} mode="short" /></span>
				</p>
			</div>
		</li>
	{/each}
</ol>

<style>
	.feed {
		padding: 8px 0;
	}
	li {
		display: grid;
		grid-template-columns: 14px 1fr;
		gap: 10px;
		padding: 7px 16px;
		position: relative;
	}
	.rail {
		position: relative;
		display: flex;
		justify-content: center;
		padding-top: 6px;
	}
	li:not(:last-child) .rail::after {
		content: '';
		position: absolute;
		top: 16px;
		bottom: -14px;
		width: 1px;
		background: var(--border-subtle);
	}
	.pip {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--gray-8);
		box-shadow: 0 0 0 3px var(--surface);
		position: relative;
		z-index: 1;
	}
	.tone-success {
		background: var(--success);
	}
	.tone-accent {
		background: var(--accent);
	}
	.tone-ai {
		background: var(--ai);
	}
	.tone-warning {
		background: var(--warning-strong);
	}
	.tone-danger {
		background: var(--danger);
	}
	.body {
		min-width: 0;
	}
	.summary {
		display: flex;
		gap: 6px;
		font-size: var(--text-sm);
		color: var(--text);
		line-height: 1.4;
	}
	.sys {
		display: inline-flex;
		margin-top: 2px;
		flex: none;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0 5px;
		margin-top: 1px;
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.sep {
		opacity: 0.7;
	}
	.code {
		font-family: var(--font-mono);
		font-size: 11px;
	}
	.time {
		margin-left: auto;
		font-family: var(--font-mono);
		font-size: 11px;
	}
</style>
