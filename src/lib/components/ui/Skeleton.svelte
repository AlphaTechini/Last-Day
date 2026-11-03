<script lang="ts">
	let { width = '100%', height = '12px', radius = '4px' }: { width?: string; height?: string; radius?: string } = $props();
</script>

<span class="skeleton" style:width style:height style:border-radius={radius} aria-hidden="true"></span>

<style>
	.skeleton {
		display: block;
		background: linear-gradient(90deg, var(--surface-3) 0%, var(--surface-2) 50%, var(--surface-3) 100%);
		background-size: 200% 100%;
		animation: shimmer 1.4s ease-in-out infinite;
	}
	@keyframes shimmer {
		from {
			background-position: 100% 0;
		}
		to {
			background-position: -100% 0;
		}
	}
</style>
