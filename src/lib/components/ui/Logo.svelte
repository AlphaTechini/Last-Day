<script lang="ts">
	let { size = 22, wordmark = true }: { size?: number; wordmark?: boolean } = $props();
</script>

<span class="logo" aria-label="Last Day" role="img">
	<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
		<rect width="24" height="24" rx="6.5" fill="var(--primary)" />
		<!-- a sun resting on the horizon: the end of a working day -->
		<path d="M6.75 14.25a5.25 5.25 0 0 1 10.5 0Z" fill="var(--primary-text)" />
		<rect x="4.5" y="16" width="15" height="1.6" rx="0.8" fill="var(--primary-text)" />
	</svg>
	{#if wordmark}<span class="word">Last Day</span>{/if}
</span>

<style>
	.logo {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		color: var(--text);
	}
	.word {
		font-size: 15px;
		font-weight: 640;
		letter-spacing: -0.022em;
		line-height: 1;
	}
</style>
