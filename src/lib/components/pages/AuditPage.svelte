<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import ScrollText from '@lucide/svelte/icons/scroll-text';
	import X from '@lucide/svelte/icons/x';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import { SYSTEM_NAMES, type AuditEntry, type SystemId } from '#lib/types.ts';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Select from '#lib/components/ui/Select.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import SystemIcon from '#lib/components/ui/SystemIcon.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { AUDIT_KIND, auditKind } from '#lib/ui/status.ts';
	import { aiCost, count, date, time } from '#lib/ui/format.ts';
	import type { AuditPageData, PageProps } from '#lib/ui/page-data.ts';

	let { data }: PageProps<AuditPageData> = $props();

	const SYSTEMS = Object.keys(SYSTEM_NAMES) as SystemId[];
	const f = $derived(data.filters);
	const activeFilters = $derived(Object.values(f).filter(Boolean).length);
	let open = $state<Record<string, boolean>>({});

	const from = $derived(data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1);
	const to = $derived(Math.min(data.page * data.pageSize, data.total));
	const pages = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));

	function href(page: number) {
		const p = new URLSearchParams();
		if (f.employee) p.set('employee', f.employee);
		if (f.runId) p.set('run', f.runId);
		if (f.system) p.set('system', f.system);
		if (f.actor) p.set('actor', f.actor);
		if (f.kind) p.set('kind', f.kind);
		if (page > 1) p.set('page', String(page));
		const qs = p.toString();
		return qs ? `?${qs}` : '?';
	}

	function autoSubmit(e: Event) {
		(e.currentTarget as HTMLSelectElement).form?.requestSubmit();
	}

	// Group rows under a day heading.
	const groups = $derived.by(() => {
		const out: { day: string; entries: AuditEntry[] }[] = [];
		for (const e of data.entries) {
			const d = date(e.at);
			const last = out[out.length - 1];
			if (last && last.day === d) last.entries.push(e);
			else out.push({ day: d, entries: [e] });
		}
		return out;
	});

	const KNOWN = new Set(['method', 'endpoint', 'status', 'readBack', 'model', 'tokens', 'costUsd', 'evidence']);
	const extras = (d: AuditEntry['detail']) => Object.entries(d).filter(([k, v]) => !KNOWN.has(k) && v != null);
	const codeTone = (s: number) => (s < 300 ? 'ok' : s < 400 ? 'info' : 'bad');
</script>

<svelte:head><title>Audit log · Last Day</title></svelte:head>

<PageHeader title="Audit log" description="Every sweep, decision, approval and API call, with what each system said back." />

<form method="GET" class="filters" data-sveltekit-keepfocus data-sveltekit-noscroll aria-label="Filter the audit log">
	<Select name="employee" size="sm" value={f.employee ?? ''} onchange={autoSubmit} aria-label="Employee">
		<option value="">All employees</option>
		{#each data.employees as e (e.id)}<option value={e.id}>{e.name}</option>{/each}
	</Select>
	<Select name="system" size="sm" value={f.system ?? ''} onchange={autoSubmit} aria-label="System">
		<option value="">All systems</option>
		{#each SYSTEMS as s (s)}<option value={s}>{SYSTEM_NAMES[s]}</option>{/each}
	</Select>
	<Select name="kind" size="sm" value={f.kind ?? ''} onchange={autoSubmit} aria-label="Kind">
		<option value="">All kinds</option>
		{#each Object.entries(AUDIT_KIND) as [k, v] (k)}<option value={k}>{v.label}</option>{/each}
	</Select>
	<Input name="actor" size="sm" value={f.actor ?? ''} placeholder="Actor" aria-label="Actor" />
	<Input name="run" size="sm" value={f.runId ?? ''} placeholder="Run ID" aria-label="Run ID" mono />
	<div class="f-actions">
		<Button type="submit" size="sm">Apply</Button>
		{#if activeFilters}
			<Button href="?" size="sm" variant="ghost" icon={X}>Clear {activeFilters}</Button>
		{/if}
	</div>
</form>

<Card padding="none">
	{#if data.entries.length}
		<div class="log">
			{#each groups as g (g.day)}
				<div class="day">{g.day}</div>
				{#each g.entries as e (e.id)}
					{@const k = auditKind(e.kind)}
					{@const d = e.detail}
					<div class="entry" class:open={open[e.id]}>
						<button class="line" type="button" aria-expanded={!!open[e.id]} aria-controls="d-{e.id}" onclick={() => (open[e.id] = !open[e.id])}>
							<span class="t num">{time(e.at)}</span>
							<span class="k"><Badge tone={k.tone} variant="soft">{k.label}</Badge></span>
							<span class="s">{#if e.system}<SystemIcon system={e.system} size={18} bare />{/if}</span>
							<span class="sum">
								<span class="sum-text">{e.summary}</span>
								<span class="who">{e.actor === 'system' ? 'Last Day' : e.actor}{#if e.employeeName} · {e.employeeName}{/if}</span>
							</span>
							<span class="call">
								{#if d.method && d.status != null}
									<span class="m">{d.method}</span><span class="code c-{codeTone(d.status)} num">{d.status}</span>
								{:else if d.costUsd != null}
									<span class="cost num">{aiCost(d.costUsd)}</span>
								{/if}
							</span>
							<ChevronDown size={14} strokeWidth={2} class="chev" aria-hidden="true" />
						</button>
						{#if open[e.id]}
							<div class="detail" id="d-{e.id}">
								<dl class="kv">
									{#if d.endpoint}<div class="wide"><dt>Request</dt><dd class="mono">{d.method} {d.endpoint}</dd></div>{/if}
									{#if d.status != null}<div><dt>HTTP status</dt><dd class="mono">{d.status}</dd></div>{/if}
									{#if d.readBack}<div class="wide"><dt>Read back</dt><dd class="mono rb">{d.readBack}</dd></div>{/if}
									{#if d.model}<div><dt>Model</dt><dd class="mono">{d.model}</dd></div>{/if}
									{#if d.tokens != null}<div><dt>Tokens</dt><dd class="num">{count(d.tokens)}</dd></div>{/if}
									{#if d.costUsd != null}<div><dt>Cost</dt><dd class="num">{aiCost(d.costUsd)}</dd></div>{/if}
									{#if e.runId}<div><dt>Run</dt><dd><a href="/runs/{e.runId}" class="mono">{e.runId}</a></dd></div>{/if}
									<div><dt>When</dt><dd class="mono">{e.at}</dd></div>
									{#each extras(d) as [key, val] (key)}
										<div><dt>{key}</dt><dd class="mono">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</dd></div>
									{/each}
								</dl>
								{#if d.evidence?.length}
									<div class="evidence">
										<p class="ev-title"><Sparkles size={12} strokeWidth={2.2} aria-hidden="true" /> Evidence the model gave</p>
										<ul>{#each d.evidence as ev (ev)}<li>{ev}</li>{/each}</ul>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			{/each}
		</div>
		<footer class="pager">
			<span class="num">Showing {count(from)} to {count(to)} of {count(data.total)}</span>
			<span class="pg">
				<Button size="xs" variant="secondary" icon={ChevronLeft} href={data.page > 1 ? href(data.page - 1) : undefined} disabled={data.page <= 1}>Newer</Button>
				<span class="num pg-n">Page {data.page} of {pages}</span>
				<Button size="xs" variant="secondary" iconRight={ChevronRight} href={data.page < pages ? href(data.page + 1) : undefined} disabled={data.page >= pages}>Older</Button>
			</span>
		</footer>
	{:else}
		<EmptyState icon={ScrollText} title={activeFilters ? 'Nothing matches these filters' : 'The audit log is empty'} body={activeFilters ? 'Try removing a filter.' : 'Every sweep, approval and API call will be recorded here.'}>
			{#snippet actions()}{#if activeFilters}<Button href="?" size="sm">Clear filters</Button>{/if}{/snippet}
		</EmptyState>
	{/if}
</Card>

<style>
	.filters {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 170px)) minmax(0, 150px) minmax(0, 150px) auto;
		gap: 8px;
		margin-bottom: var(--space-4);
		align-items: center;
	}
	.f-actions {
		display: flex;
		gap: 6px;
	}
	.day {
		position: sticky;
		top: 0;
		z-index: 1;
		padding: 7px 20px;
		font-size: var(--text-xs);
		font-weight: var(--weight-semibold);
		color: var(--text-2);
		background: var(--surface-2);
		border-bottom: 1px solid var(--border-subtle);
	}
	.day:not(:first-child) {
		border-top: 1px solid var(--border-subtle);
	}
	.entry + .entry {
		border-top: 1px solid var(--border-subtle);
	}
	.line {
		display: grid;
		grid-template-columns: 64px 88px 20px minmax(0, 1fr) 82px 16px;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 8px 20px;
		text-align: left;
		font-size: var(--text-sm);
		border-radius: 0;
	}
	.line:hover {
		background: var(--surface-2);
	}
	.line:focus-visible {
		box-shadow: inset 0 0 0 2px var(--accent);
		border-radius: 0;
	}
	.t {
		font-family: var(--font-mono);
		font-size: 11.5px;
		color: var(--text-3);
	}
	.s {
		display: flex;
	}
	.sum {
		display: flex;
		align-items: baseline;
		gap: 10px;
		min-width: 0;
	}
	.sum-text {
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		min-width: 0;
	}
	.who {
		flex: none;
		font-size: var(--text-xs);
		color: var(--text-3);
		white-space: nowrap;
	}
	.call {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 6px;
		font-family: var(--font-mono);
		font-size: 11px;
	}
	.m {
		color: var(--text-3);
		font-weight: 600;
	}
	.code {
		padding: 0 5px;
		border-radius: 3px;
		font-weight: 600;
		line-height: 17px;
	}
	.c-ok {
		background: var(--success-soft);
		color: var(--success-text);
	}
	.c-info {
		background: var(--accent-soft);
		color: var(--accent-text);
	}
	.c-bad {
		background: var(--danger-soft);
		color: var(--danger-text);
	}
	.cost {
		color: var(--ai-text);
	}
	.line :global(.chev) {
		color: var(--text-3);
		transition: transform var(--dur-2) var(--ease-out);
	}
	.open .line :global(.chev) {
		transform: rotate(180deg);
	}
	.open .line {
		background: var(--surface-2);
	}
	.detail {
		padding: 4px 20px 16px 196px;
		background: var(--surface-2);
	}
	.kv {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px 20px;
		padding: 12px 14px;
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.kv .wide {
		grid-column: 1 / -1;
	}
	.kv dt {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.kv dd {
		margin: 1px 0 0;
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}
	.kv dd.mono {
		font-size: 12px;
	}
	.rb {
		color: var(--success-text);
	}
	.evidence {
		margin-top: 10px;
		padding: 10px 14px;
		border-radius: var(--radius-md);
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--ai-border);
	}
	.ev-title {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: var(--text-xs);
		font-weight: var(--weight-semibold);
		color: var(--ai-text);
	}
	.evidence ul {
		margin-top: 4px;
		padding-left: 16px;
		font-size: var(--text-sm);
		color: var(--text-2);
	}
	.pager {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 20px;
		border-top: 1px solid var(--border);
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.pg {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.pg-n {
		color: var(--text-2);
	}

	@media (max-width: 1100px) {
		.filters {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
		.detail {
			padding-left: 20px;
		}
	}
	@media (max-width: 720px) {
		.filters {
			grid-template-columns: 1fr 1fr;
		}
		.f-actions {
			grid-column: 1 / -1;
		}
		.line {
			grid-template-columns: 56px minmax(0, 1fr) auto;
			grid-template-areas: 't k call' 'sum sum sum';
			row-gap: 4px;
			padding: 10px 16px;
		}
		.t {
			grid-area: t;
		}
		.k {
			grid-area: k;
		}
		.s,
		.line :global(.chev) {
			display: none;
		}
		.call {
			grid-area: call;
		}
		.sum {
			grid-area: sum;
			flex-direction: column;
			gap: 0;
		}
		.sum-text {
			white-space: normal;
		}
		.detail {
			padding: 4px 16px 14px;
		}
		.kv {
			grid-template-columns: 1fr 1fr;
		}
		.pager {
			flex-direction: column;
			align-items: flex-start;
			padding: 10px 16px;
		}
	}
</style>
