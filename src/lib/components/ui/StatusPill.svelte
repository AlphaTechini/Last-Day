<script lang="ts">
	import { statusMeta, type AnyStatusKind, type Tone } from '#lib/ui/status.ts';

	let {
		kind,
		value,
		size = 'md',
		label
	}: { kind: AnyStatusKind; value: string; size?: 'sm' | 'md'; label?: string } = $props();

	const meta = $derived(statusMeta(kind, value));
	const tone: Tone = $derived(meta.tone);
</script>

<span class="pill tone-{tone} size-{size}" class:live={meta.live} title={meta.hint}>
	<span class="dot" aria-hidden="true"></span>
	<span class="text">{label ?? meta.label}</span>
</span>

<style>
	.pill {
		--c: var(--text-3);
		--bg: var(--neutral-soft);
		--fg: var(--neutral-text);
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 22px;
		padding: 0 8px 0 7px;
		border-radius: var(--radius-full);
		background: var(--bg);
		color: var(--fg);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		line-height: 1;
		white-space: nowrap;
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--c) 18%, transparent);
		transition:
			background-color var(--dur-3) var(--ease-out),
			color var(--dur-3) var(--ease-out);
	}
	.size-sm {
		height: 20px;
		padding: 0 7px 0 6px;
		gap: 5px;
		font-size: var(--text-2xs);
	}
	.dot {
		position: relative;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--c);
		flex: none;
	}
	.live .dot::after {
		content: '';
		position: absolute;
		inset: -3px;
		border-radius: 50%;
		background: var(--c);
		opacity: 0.35;
		animation: ping 1.4s var(--ease-out) infinite;
	}
	@keyframes ping {
		0% {
			transform: scale(0.6);
			opacity: 0.5;
		}
		100% {
			transform: scale(1.6);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.live .dot::after {
			display: none;
		}
	}

	.tone-neutral {
		--c: var(--gray-9);
	}
	.tone-accent {
		--c: var(--accent);
		--bg: var(--accent-soft);
		--fg: var(--accent-text);
	}
	.tone-success {
		--c: var(--success);
		--bg: var(--success-soft);
		--fg: var(--success-text);
	}
	.tone-warning {
		--c: var(--warning-strong);
		--bg: var(--warning-soft-2);
		--fg: var(--warning-text);
	}
	.tone-danger {
		--c: var(--danger);
		--bg: var(--danger-soft);
		--fg: var(--danger-text);
	}
	.tone-ai {
		--c: var(--ai);
		--bg: var(--ai-soft);
		--fg: var(--ai-text);
	}
</style>
