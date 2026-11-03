<script lang="ts">
	import { initials } from '#lib/ui/format.ts';

	let { name, size = 28, muted = false }: { name: string | null | undefined; size?: number; muted?: boolean } = $props();

	// Deterministic, calm hue per person.
	const hue = $derived.by(() => {
		let h = 0;
		for (const ch of name ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
		const palette = [222, 262, 190, 160, 28, 340, 205, 290, 140, 12];
		return palette[h % palette.length];
	});
</script>

<span
	class="avatar"
	class:muted
	style:--h={hue}
	style:--s="{size}px"
	style:font-size="{Math.max(9, Math.round(size * 0.38))}px"
	aria-hidden="true">{initials(name)}</span
>

<style>
	.avatar {
		display: inline-grid;
		place-items: center;
		flex: none;
		width: var(--s);
		height: var(--s);
		border-radius: 50%;
		font-weight: var(--weight-semibold);
		letter-spacing: 0.01em;
		line-height: 1;
		color: light-dark(hsl(var(--h) 38% 30%), hsl(var(--h) 60% 82%));
		background: light-dark(hsl(var(--h) 55% 93%), hsl(var(--h) 22% 22%));
		box-shadow: inset 0 0 0 1px light-dark(hsl(var(--h) 40% 84%), hsl(var(--h) 20% 30%));
		user-select: none;
	}
	.muted {
		filter: grayscale(1);
		opacity: 0.75;
	}
</style>
