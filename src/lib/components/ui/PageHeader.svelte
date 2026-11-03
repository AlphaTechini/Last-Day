<script lang="ts">
	import type { Snippet } from 'svelte';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	let {
		title,
		description,
		crumbs,
		actions,
		meta,
		lead
	}: {
		title: string;
		description?: string | null;
		crumbs?: { label: string; href?: string }[];
		actions?: Snippet;
		meta?: Snippet;
		/** Left of the title, e.g. an avatar. */
		lead?: Snippet;
	} = $props();
</script>

<header class="ph">
	{#if crumbs?.length}
		<nav class="crumbs" aria-label="Breadcrumb">
			<ol role="list">
				{#each crumbs as c, i (c.label)}
					<li>
						{#if c.href}<a href={c.href}>{c.label}</a>{:else}<span aria-current="page">{c.label}</span>{/if}
						{#if i < crumbs.length - 1}<ChevronRight size={13} strokeWidth={2} aria-hidden="true" />{/if}
					</li>
				{/each}
			</ol>
		</nav>
	{/if}
	<div class="main">
		{#if lead}<div class="lead">{@render lead()}</div>{/if}
		<div class="titles">
			<h1>{title}</h1>
			{#if description}<p class="desc">{description}</p>{/if}
			{#if meta}<div class="meta">{@render meta()}</div>{/if}
		</div>
		{#if actions}<div class="actions">{@render actions()}</div>{/if}
	</div>
</header>

<style>
	.ph {
		margin-bottom: var(--space-6);
	}
	.crumbs ol {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: var(--space-3);
		font-size: var(--text-sm);
		color: var(--text-3);
	}
	.crumbs li {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.crumbs a {
		color: var(--text-2);
	}
	.crumbs a:hover {
		color: var(--text);
		text-decoration: none;
	}
	.crumbs [aria-current] {
		color: var(--text-3);
	}
	.main {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
	}
	.lead {
		flex: none;
	}
	.titles {
		flex: 1;
		min-width: 0;
	}
	h1 {
		font-size: var(--text-2xl);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-tighter);
		line-height: 1.2;
	}
	.desc {
		margin-top: 6px;
		color: var(--text-2);
		font-size: var(--text-base);
		max-width: 70ch;
	}
	.meta {
		margin-top: 8px;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 12px;
		color: var(--text-2);
		font-size: var(--text-sm);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		align-items: center;
		flex: none;
	}
	@media (max-width: 720px) {
		.main {
			flex-wrap: wrap;
		}
		.actions {
			width: 100%;
		}
		h1 {
			font-size: var(--text-xl);
		}
	}
</style>
