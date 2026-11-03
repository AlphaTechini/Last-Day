<script lang="ts">
	import { dev } from '$app/env';
	import Logo from '#lib/components/ui/Logo.svelte';
	import ErrorPage from '#lib/components/pages/ErrorPage.svelte';
	import { previews } from '#lib/ui/preview-registry.ts';

	const groups = [...new Set(previews.map((p) => p.group))].map((g) => ({ g, items: previews.filter((p) => p.group === g) }));
</script>

<svelte:head><title>Design preview · Last Day</title></svelte:head>

{#if dev}
	<div class="idx">
		<header>
			<Logo size={26} />
			<h1>Design preview</h1>
			<p>Every page component rendered with fixtures from <code>src/lib/ui/fixtures.ts</code>. Dev server only. Forms are disabled here.</p>
		</header>
		{#each groups as { g, items } (g)}
			<section>
				<h2>{g}</h2>
				<ul>
					{#each items as p (p.slug)}
						<li>
							<a href="/preview/{p.slug}">
								<span class="t">{p.title}</span>
								<span class="s mono">/preview/{p.slug}</span>
								{#if p.note}<span class="n">{p.note}</span>{/if}
							</a>
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>
{:else}
	<ErrorPage status={404} />
{/if}

<style>
	.idx {
		max-width: 880px;
		margin: 0 auto;
		padding: 56px 24px 80px;
	}
	header {
		margin-bottom: 36px;
	}
	h1 {
		margin-top: 24px;
		font-size: var(--text-2xl);
		letter-spacing: var(--tracking-tighter);
	}
	header p {
		margin-top: 6px;
		color: var(--text-2);
	}
	section + section {
		margin-top: 28px;
	}
	h2 {
		font-size: var(--text-xs);
		text-transform: uppercase;
		letter-spacing: var(--tracking-caps);
		color: var(--text-3);
		margin-bottom: 8px;
	}
	ul {
		list-style: none;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 8px;
	}
	a {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px 14px;
		border-radius: var(--radius-md);
		background: var(--surface);
		border: 1px solid var(--border);
		color: var(--text);
	}
	a:hover {
		border-color: var(--border-strong);
		text-decoration: none;
	}
	.t {
		font-weight: var(--weight-semibold);
		font-size: var(--text-sm);
	}
	.s {
		font-size: 11.5px;
		color: var(--text-3);
	}
	.n {
		font-size: var(--text-xs);
		color: var(--ai-text);
	}
</style>
