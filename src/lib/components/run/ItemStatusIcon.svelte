<script lang="ts">
	import type { RunItemStatus } from '#lib/types.ts';
	import X from '@lucide/svelte/icons/x';
	import Minus from '@lucide/svelte/icons/minus';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Clock from '@lucide/svelte/icons/clock-3';
	import Pause from '@lucide/svelte/icons/pause';
	import Spinner from '#lib/components/ui/Spinner.svelte';

	let { status, size = 22 }: { status: RunItemStatus; size?: number } = $props();
	const g = $derived(Math.round(size * 0.55));
</script>

<span class="ic st-{status}" style:--s="{size}px" aria-hidden="true">
	{#if status === 'verified' || status === 'removed'}
		<svg class="draw" width={g} height={g} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M5 12.5 10 17.5 19.5 7" pathLength="1" />
		</svg>
	{:else if status === 'failed'}
		<X size={g} strokeWidth={3} />
	{:else if status === 'running' || status === 'destroying'}
		<Spinner size={size - 4} />
	{:else if status === 'proposed'}
		<Sparkles size={g} strokeWidth={2.2} />
	{:else if status === 'rejected'}
		<Minus size={g} strokeWidth={2.6} />
	{:else if status === 'approved'}
		<Clock size={g} strokeWidth={2.3} />
	{:else if status === 'awaiting_manager'}
		<Pause size={g} strokeWidth={2.6} />
	{:else}
		<span class="ring"></span>
	{/if}
</span>

<style>
	.ic {
		display: inline-grid;
		place-items: center;
		flex: none;
		width: var(--s);
		height: var(--s);
		border-radius: 50%;
		color: var(--text-3);
		background: var(--surface);
		transition:
			background-color var(--dur-3) var(--ease-out),
			color var(--dur-3) var(--ease-out),
			box-shadow var(--dur-3) var(--ease-out);
	}
	.ring {
		width: 100%;
		height: 100%;
		border-radius: 50%;
		border: 1.5px dashed var(--border-strong);
	}
	.st-pending {
		background: transparent;
	}
	.st-approved {
		background: var(--surface-3);
		color: var(--text-2);
	}
	.st-running,
	.st-destroying {
		color: var(--accent);
		background: transparent;
	}
	.st-verified,
	.st-removed {
		background: var(--success);
		color: #fff;
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 16%, transparent);
		animation: pop 420ms var(--ease-spring);
	}
	.st-failed {
		background: var(--danger);
		color: #fff;
		box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 14%, transparent);
	}
	.st-proposed {
		background: var(--ai-soft);
		color: var(--ai-text);
		box-shadow: inset 0 0 0 1px var(--ai-border);
	}
	.st-rejected {
		background: var(--surface-3);
		color: var(--text-3);
	}
	.st-awaiting_manager {
		background: var(--warning-soft-2);
		color: var(--warning-text);
		box-shadow: inset 0 0 0 1px var(--warning-border);
	}
	.draw path {
		stroke-dasharray: 1;
		stroke-dashoffset: 0;
		animation: draw 420ms 80ms var(--ease-out) backwards;
	}
	@keyframes draw {
		from {
			stroke-dashoffset: 1;
		}
	}
	@keyframes pop {
		0% {
			transform: scale(0.6);
		}
		60% {
			transform: scale(1.08);
		}
		100% {
			transform: scale(1);
		}
	}
</style>
