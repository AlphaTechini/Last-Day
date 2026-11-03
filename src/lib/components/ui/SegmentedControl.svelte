<script lang="ts" generics="T extends string">
	let {
		options,
		value = $bindable(),
		label,
		size = 'md',
		onchange
	}: {
		options: { value: T; label: string; count?: number | null }[];
		value: T;
		label: string;
		size?: 'sm' | 'md';
		onchange?: (v: T) => void;
	} = $props();

	let buttons: HTMLButtonElement[] = $state([]);

	function select(v: T) {
		value = v;
		onchange?.(v);
	}

	function onKey(e: KeyboardEvent, i: number) {
		const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
		if (!dir) return;
		e.preventDefault();
		const next = (i + dir + options.length) % options.length;
		select(options[next].value);
		buttons[next]?.focus();
	}
</script>

<div class="seg size-{size}" role="radiogroup" aria-label={label}>
	{#each options as opt, i (opt.value)}
		<button
			bind:this={buttons[i]}
			type="button"
			role="radio"
			aria-checked={value === opt.value}
			tabindex={value === opt.value ? 0 : -1}
			class:active={value === opt.value}
			onclick={() => select(opt.value)}
			onkeydown={(e) => onKey(e, i)}
		>
			{opt.label}
			{#if opt.count != null}<span class="count num">{opt.count}</span>{/if}
		</button>
	{/each}
</div>

<style>
	.seg {
		display: inline-flex;
		padding: 2px;
		gap: 2px;
		background: var(--surface-3);
		border-radius: var(--radius-md);
		box-shadow: inset 0 0 0 1px var(--border-subtle);
		max-width: 100%;
		overflow-x: auto;
		scrollbar-width: none;
	}
	button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 0 10px;
		border-radius: 6px;
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--text-2);
		white-space: nowrap;
		transition:
			background-color var(--dur-1) var(--ease-out),
			color var(--dur-1) var(--ease-out);
	}
	.size-sm button {
		height: 24px;
		padding: 0 8px;
		font-size: var(--text-xs);
	}
	button:hover {
		color: var(--text);
	}
	button.active {
		background: var(--surface);
		color: var(--text);
		box-shadow:
			0 1px 2px rgb(16 24 40 / 0.08),
			0 0 0 1px var(--border);
	}
	.count {
		font-size: var(--text-2xs);
		color: var(--text-3);
		font-weight: var(--weight-medium);
	}
	.active .count {
		color: var(--text-2);
	}
</style>
