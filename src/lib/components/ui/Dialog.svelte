<script lang="ts">
	import type { Snippet } from 'svelte';
	import X from '@lucide/svelte/icons/x';

	let {
		open = $bindable(false),
		title,
		description,
		size = 'md',
		role = 'dialog',
		dismissible = true,
		icon,
		children,
		footer,
		onclose
	}: {
		open?: boolean;
		title: string;
		description?: string;
		size?: 'sm' | 'md' | 'lg';
		/** Use 'alertdialog' for confirmations. */
		role?: 'dialog' | 'alertdialog';
		/** False while an action is pending: Esc and backdrop clicks are ignored. */
		dismissible?: boolean;
		icon?: Snippet;
		children?: Snippet;
		footer?: Snippet;
		onclose?: () => void;
	} = $props();

	let el: HTMLDialogElement | undefined = $state();
	const uid = $props.id();

	$effect(() => {
		if (!el) return;
		if (open && !el.open) el.showModal();
		if (!open && el.open) el.close();
	});

	function handleClose() {
		open = false;
		onclose?.();
	}

	function onCancel(e: Event) {
		if (!dismissible) e.preventDefault();
	}

	function onBackdrop(e: MouseEvent) {
		if (dismissible && e.target === el) open = false;
	}
</script>

<dialog
	bind:this={el}
	class="dialog size-{size}"
	{role}
	aria-modal="true"
	aria-labelledby="{uid}-title"
	aria-describedby={description ? `${uid}-desc` : undefined}
	onclose={handleClose}
	oncancel={onCancel}
	onclick={onBackdrop}
>
	{#if open}
		<div class="panel">
			<header class="head">
				{#if icon}<div class="icon">{@render icon()}</div>{/if}
				<div class="titles">
					<h2 id="{uid}-title">{title}</h2>
					{#if description}<p id="{uid}-desc">{description}</p>{/if}
				</div>
				{#if dismissible}
					<button type="button" class="close" aria-label="Close" onclick={() => (open = false)}>
						<X size={16} strokeWidth={1.9} />
					</button>
				{/if}
			</header>
			{#if children}<div class="body">{@render children()}</div>{/if}
			{#if footer}<footer class="foot">{@render footer()}</footer>{/if}
		</div>
	{/if}
</dialog>

<style>
	.dialog {
		--w: 480px;
		width: min(var(--w), calc(100vw - 32px));
		max-height: min(720px, calc(100dvh - 48px));
		padding: 0;
		margin: auto;
		border: 1px solid var(--border);
		border-radius: var(--radius-xl);
		background: var(--surface-raised);
		box-shadow: var(--shadow-xl);
		overflow: hidden;
	}
	.size-sm {
		--w: 420px;
	}
	.size-lg {
		--w: 640px;
	}
	.dialog[open] {
		animation: pop var(--dur-3) var(--ease-out);
	}
	.dialog::backdrop {
		background: var(--overlay);
		backdrop-filter: blur(2px);
		animation: fade var(--dur-2) var(--ease-out);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(6px) scale(0.985);
		}
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	.panel {
		display: flex;
		flex-direction: column;
		max-height: inherit;
	}
	.head {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-5) var(--space-5) 0;
	}
	.icon {
		flex: none;
	}
	.titles {
		flex: 1;
		min-width: 0;
		padding-top: 1px;
	}
	h2 {
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
		letter-spacing: var(--tracking-tight);
	}
	.titles p {
		margin-top: 6px;
		color: var(--text-2);
		font-size: var(--text-base);
		line-height: var(--leading-normal);
	}
	.close {
		flex: none;
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		margin: -4px -6px 0 0;
		border-radius: var(--radius-sm);
		color: var(--text-3);
	}
	.close:hover {
		background: var(--surface-3);
		color: var(--text);
	}
	.body {
		padding: var(--space-4) var(--space-5) var(--space-5);
		overflow: auto;
	}
	.foot {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-5);
		border-top: 1px solid var(--border-subtle);
		background: var(--surface-2);
	}
	@media (max-width: 520px) {
		.foot {
			flex-direction: column-reverse;
		}
		.foot :global(.btn) {
			width: 100%;
		}
	}
</style>
