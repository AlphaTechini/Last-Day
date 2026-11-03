<script lang="ts">
	import { fly } from 'svelte/transition';
	import { flip } from 'svelte/animate';
	import { toast } from '#lib/ui/toast.svelte.ts';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Info from '@lucide/svelte/icons/info';
	import X from '@lucide/svelte/icons/x';
</script>

<div class="toaster" aria-live="polite" aria-relevant="additions">
	{#each toast.items as t (t.id)}
		<div class="toast tone-{t.tone}" role={t.tone === 'danger' ? 'alert' : 'status'} in:fly={{ y: 8, duration: 220 }} out:fly={{ y: 4, duration: 160 }} animate:flip={{ duration: 200 }}>
			<span class="icon" aria-hidden="true">
				{#if t.tone === 'success'}<CircleCheck size={16} strokeWidth={2} />{:else if t.tone === 'danger'}<CircleAlert size={16} strokeWidth={2} />{:else}<Info size={16} strokeWidth={2} />{/if}
			</span>
			<div class="text">
				<p class="title">{t.title}</p>
				{#if t.body}<p class="body">{t.body}</p>{/if}
			</div>
			<button class="x" type="button" aria-label="Dismiss" onclick={() => toast.dismiss(t.id)}><X size={14} /></button>
		</div>
	{/each}
</div>

<style>
	.toaster {
		position: fixed;
		z-index: var(--z-toast);
		right: 20px;
		bottom: 20px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: min(380px, calc(100vw - 32px));
		pointer-events: none;
	}
	.toast {
		pointer-events: auto;
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 11px 12px;
		border-radius: var(--radius-md);
		background: var(--surface-raised);
		border: 1px solid var(--border);
		box-shadow: var(--shadow-lg);
	}
	.icon {
		display: flex;
		margin-top: 1px;
		color: var(--accent-text);
	}
	.tone-success .icon {
		color: var(--success-text);
	}
	.tone-danger .icon {
		color: var(--danger-text);
	}
	.text {
		flex: 1;
		min-width: 0;
	}
	.title {
		font-weight: var(--weight-semibold);
		font-size: var(--text-sm);
	}
	.body {
		margin-top: 2px;
		font-size: var(--text-sm);
		color: var(--text-2);
	}
	.x {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: var(--radius-xs);
		color: var(--text-3);
	}
	.x:hover {
		background: var(--surface-3);
		color: var(--text);
	}
	@media (max-width: 640px) {
		.toaster {
			right: 16px;
			left: 16px;
			bottom: 16px;
			width: auto;
		}
	}
</style>
