<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { LucideIcon } from '@lucide/svelte';
	import type { Tone } from '#lib/ui/status.ts';

	let {
		tone = 'neutral',
		variant = 'soft',
		icon: Icon,
		mono = false,
		title,
		children
	}: {
		tone?: Tone;
		variant?: 'soft' | 'outline' | 'solid';
		icon?: LucideIcon;
		mono?: boolean;
		title?: string;
		children: Snippet;
	} = $props();
</script>

<span class="badge tone-{tone} v-{variant}" class:mono {title}>
	{#if Icon}<Icon size={12} strokeWidth={2} aria-hidden="true" />{/if}
	{@render children()}
</span>

<style>
	.badge {
		--bg: var(--neutral-soft);
		--fg: var(--neutral-text);
		--bd: var(--neutral-border);
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 20px;
		padding: 0 6px;
		border-radius: var(--radius-xs);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		line-height: 1;
		white-space: nowrap;
		color: var(--fg);
		vertical-align: middle;
	}
	.badge.mono {
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0;
	}
	.v-soft {
		background: var(--bg);
	}
	.v-outline {
		background: transparent;
		box-shadow: inset 0 0 0 1px var(--bd);
	}
	.v-solid {
		background: var(--fg);
		color: var(--surface);
	}
	.tone-accent {
		--bg: var(--accent-soft);
		--fg: var(--accent-text);
		--bd: var(--accent-border);
	}
	.tone-success {
		--bg: var(--success-soft);
		--fg: var(--success-text);
		--bd: var(--success-border);
	}
	.tone-warning {
		--bg: var(--warning-soft-2);
		--fg: var(--warning-text);
		--bd: var(--warning-border);
	}
	.tone-danger {
		--bg: var(--danger-soft);
		--fg: var(--danger-text);
		--bd: var(--danger-border);
	}
	.tone-ai {
		--bg: var(--ai-soft);
		--fg: var(--ai-text);
		--bd: var(--ai-border);
	}
</style>
