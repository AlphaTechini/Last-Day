<script lang="ts">
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import Eye from '@lucide/svelte/icons/eye';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import Select from '#lib/components/ui/Select.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import ActionForm from '#lib/components/ui/ActionForm.svelte';
	import { aiCost, humanDelay } from '#lib/ui/format.ts';
	import type { PageProps, SettingsPageData } from '#lib/ui/page-data.ts';

	let { data, form }: PageProps<SettingsPageData> = $props();

	const PRESETS = [
		{ seconds: 120, label: '2 minutes', note: 'For demos' },
		{ seconds: 3600, label: '1 hour', note: 'Quick confidence' },
		{ seconds: 86400, label: '24 hours', note: 'Recommended' },
		{ seconds: 604800, label: '7 days', note: 'Notice periods' }
	];
	const UNITS = [
		{ value: 60, label: 'minutes' },
		{ value: 3600, label: 'hours' },
		{ value: 86400, label: 'days' }
	];

	// Local editable copy of the saved settings; reset whenever the server data changes.
	const initial = $derived({
		preset: PRESETS.some((p) => p.seconds === data.recheckDelaySeconds) ? String(data.recheckDelaySeconds) : 'custom',
		unit: data.recheckDelaySeconds % 86400 === 0 ? 86400 : data.recheckDelaySeconds % 3600 === 0 ? 3600 : 60
	});
	let preset = $derived(initial.preset);
	let unit = $derived(String(initial.unit));
	let customAmount = $derived(Math.max(1, Math.round(data.recheckDelaySeconds / initial.unit)));
	let threshold = $derived(data.aiConfidenceThreshold);
	let defaultModel = $derived(data.defaultModel);
	let escalationModel = $derived(data.escalationModel);

	const seconds = $derived(preset === 'custom' ? Math.max(60, Math.round(Number(customAmount) || 1) * Number(unit)) : Number(preset));
	const pct = $derived(Math.round(threshold * 100));

	const modelById = $derived(new Map(data.availableModels.map((m) => [m.id, m])));
	const priceLabel = (id: string) => {
		const m = modelById.get(id);
		return m ? `$${m.inputPer1M.toFixed(2)} in, $${m.outputPer1M.toFixed(2)} out per 1M tokens` : '';
	};
	// A typical match: ~1,200 input tokens, ~400 output.
	const perMatch = (id: string) => {
		const m = modelById.get(id);
		return m ? (1200 * m.inputPer1M + 400 * m.outputPer1M) / 1e6 : 0;
	};

	const err = (f: string) => (form?.error && form.field === f ? form.error : null);
	const ro = $derived(!data.canEdit);
</script>

<svelte:head><title>Settings · Last Day</title></svelte:head>

<PageHeader title="Settings" description="How Last Day re-checks finished runs and how the AI resolver matches accounts." />

{#if ro}
	<div class="block"><Alert tone="info" title="View only">Only an admin can change these settings.</Alert></div>
{/if}
{#if form?.error && !form.field}
	<div class="block"><Alert tone="danger" live>{form.error}</Alert></div>
{/if}

<ActionForm action="save" class="settings" successToast="Settings saved">
	{#snippet children({ pending })}
		<fieldset disabled={ro}>
			<legend class="sr-only">Settings</legend>

			<section class="sec" aria-labelledby="s-recheck">
				<div class="sec-intro">
					<span class="sec-ico"><CalendarClock size={16} strokeWidth={2} aria-hidden="true" /></span>
					<h2 id="s-recheck">Re-check delay</h2>
					<p>When every line in a run is green, Last Day schedules exactly one re-check after this delay. It re-reads every revoked account and turns the run red if anything came back.</p>
				</div>
				<div class="sec-body">
					<input type="hidden" name="recheckDelaySeconds" value={seconds} />
					<div class="presets" role="radiogroup" aria-label="Re-check delay">
						{#each PRESETS as p (p.seconds)}
							<label class="preset" class:on={preset === String(p.seconds)}>
								<input type="radio" name="_preset" value={String(p.seconds)} bind:group={preset} />
								<span class="p-label">{p.label}</span>
								<span class="p-note">{p.note}</span>
							</label>
						{/each}
						<label class="preset" class:on={preset === 'custom'}>
							<input type="radio" name="_preset" value="custom" bind:group={preset} />
							<span class="p-label">Custom</span>
							<span class="p-note">Any delay</span>
						</label>
					</div>
					{#if preset === 'custom'}
						<div class="custom">
							<Input type="number" min="1" step="1" bind:value={customAmount} aria-label="Delay amount" size="sm" />
							<Select bind:value={unit} aria-label="Delay unit" size="sm">
								{#each UNITS as u (u.value)}<option value={String(u.value)}>{u.label}</option>{/each}
							</Select>
						</div>
					{/if}
					<p class="result">Re-check runs <strong>{humanDelay(seconds)}</strong> after a run turns fully green.</p>
					{#if err('recheckDelaySeconds')}<p class="field-err">{err('recheckDelaySeconds')}</p>{/if}
				</div>
			</section>

			<section class="sec" aria-labelledby="s-ai">
				<div class="sec-intro">
					<span class="sec-ico ai"><Sparkles size={16} strokeWidth={2} aria-hidden="true" /></span>
					<h2 id="s-ai">AI matching</h2>
					<p>The AI only proposes owners for accounts the rules cannot link. It sees account metadata, never credentials, and a person confirms every match before anything is revoked.</p>
				</div>
				<div class="sec-body">
					<div class="slider-field">
						<div class="slider-head">
							<label for="threshold">Escalation threshold</label>
							<span class="slider-val num">{pct}%</span>
						</div>
						<input id="threshold" class="range" type="range" name="aiConfidenceThreshold" min="0.5" max="0.99" step="0.01" bind:value={threshold} style:--p="{((threshold - 0.5) / 0.49) * 100}%" aria-describedby="threshold-hint" />
						<div class="scale" aria-hidden="true"><span>50%</span><span>75%</span><span>99%</span></div>
						<p class="hint" id="threshold-hint">
							Matches below {pct}% go once to the escalation model for a second opinion. Either way, they are shown to you as probable matches.
						</p>
						{#if err('aiConfidenceThreshold')}<p class="field-err">{err('aiConfidenceThreshold')}</p>{/if}
					</div>

					<div class="models">
						<Field id="defaultModel" label="Default model" hint={priceLabel(defaultModel)} error={err('defaultModel')}>
							{#snippet children({ id, describedBy, invalid })}
								<Select {id} name="defaultModel" bind:value={defaultModel} {invalid} aria-describedby={describedBy}>
									{#each data.availableModels as m (m.id)}<option value={m.id}>{m.id}</option>{/each}
								</Select>
							{/snippet}
						</Field>
						<Field id="escalationModel" label="Escalation model" hint={priceLabel(escalationModel)} error={err('escalationModel')}>
							{#snippet children({ id, describedBy, invalid })}
								<Select {id} name="escalationModel" bind:value={escalationModel} {invalid} aria-describedby={describedBy}>
									{#each data.availableModels as m (m.id)}<option value={m.id}>{m.id}</option>{/each}
								</Select>
							{/snippet}
						</Field>
					</div>
					<div class="estimate">
						<div><span class="e-label">Typical match</span><span class="e-val num">{aiCost(perMatch(defaultModel))}</span></div>
						<div><span class="e-label">With escalation</span><span class="e-val num">{aiCost(perMatch(defaultModel) + perMatch(escalationModel))}</span></div>
						<p class="e-note">Estimated at about 1,200 input and 400 output tokens. Real costs are recorded per call in the audit log.</p>
					</div>
				</div>
			</section>
		</fieldset>

		<div class="savebar">
			{#if ro}
				<span class="ro"><Eye size={13} strokeWidth={2} aria-hidden="true" /> View only</span>
			{:else}
				<span class="muted-note">Changes apply to new runs.</span>
				<Button type="submit" variant="primary" loading={pending} loadingLabel="Saving">Save settings</Button>
			{/if}
		</div>
	{/snippet}
</ActionForm>

<style>
	.block {
		margin-bottom: var(--space-4);
	}
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
		min-width: 0;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		box-shadow: var(--shadow-xs);
	}
	.sec {
		display: grid;
		grid-template-columns: minmax(0, 320px) minmax(0, 1fr);
		gap: 40px;
		padding: 24px;
	}
	.sec + .sec {
		border-top: 1px solid var(--border-subtle);
	}
	.sec-ico {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		margin-bottom: 12px;
		border-radius: var(--radius-md);
		background: var(--surface-3);
		color: var(--text-2);
	}
	.sec-ico.ai {
		background: var(--ai-soft);
		color: var(--ai-text);
	}
	.sec-intro h2 {
		font-size: var(--text-md);
	}
	.sec-intro p {
		margin-top: 6px;
		font-size: var(--text-sm);
		color: var(--text-2);
	}
	.sec-body {
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-width: 0;
	}
	.presets {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(124px, 1fr));
		gap: 8px;
	}
	.preset {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 10px 12px;
		border-radius: var(--radius-md);
		border: 1px solid var(--border-input);
		background: var(--surface);
		cursor: pointer;
		transition:
			border-color var(--dur-1) var(--ease-out),
			box-shadow var(--dur-1) var(--ease-out);
	}
	.preset:hover {
		border-color: var(--border-strong);
	}
	.preset.on {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
		background: color-mix(in srgb, var(--accent-soft) 40%, var(--surface));
	}
	.preset input {
		position: absolute;
		opacity: 0;
		inset: 0;
		cursor: pointer;
	}
	.preset:has(input:focus-visible) {
		box-shadow: var(--focus-ring);
	}
	.p-label {
		font-weight: var(--weight-semibold);
		font-size: var(--text-sm);
	}
	.p-note {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.on .p-note {
		color: var(--accent-text);
	}
	.custom {
		display: grid;
		grid-template-columns: 110px 140px;
		gap: 8px;
	}
	.result {
		font-size: var(--text-sm);
		color: var(--text-2);
	}
	.result strong {
		color: var(--text);
	}
	.field-err {
		font-size: var(--text-xs);
		color: var(--danger-text);
		font-weight: var(--weight-medium);
	}

	.slider-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 8px;
	}
	.slider-head label {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
	}
	.slider-val {
		font-size: var(--text-lg);
		font-weight: var(--weight-semibold);
		color: var(--ai-text);
	}
	.range {
		appearance: none;
		width: 100%;
		height: 20px;
		background: transparent;
		cursor: pointer;
	}
	.range::-webkit-slider-runnable-track {
		height: 4px;
		border-radius: 4px;
		background: linear-gradient(90deg, var(--ai) var(--p), var(--surface-3) var(--p));
		box-shadow: inset 0 0 0 1px var(--border-subtle);
	}
	.range::-moz-range-track {
		height: 4px;
		border-radius: 4px;
		background: var(--surface-3);
	}
	.range::-moz-range-progress {
		height: 4px;
		border-radius: 4px;
		background: var(--ai);
	}
	.range::-webkit-slider-thumb {
		appearance: none;
		width: 18px;
		height: 18px;
		margin-top: -7px;
		border-radius: 50%;
		background: var(--surface);
		border: 1.5px solid var(--ai);
		box-shadow: var(--shadow-sm);
	}
	.range::-moz-range-thumb {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--surface);
		border: 1.5px solid var(--ai);
	}
	.range:focus-visible {
		box-shadow: none;
	}
	.range:focus-visible::-webkit-slider-thumb {
		box-shadow: var(--focus-ring);
	}
	.range:disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}
	.scale {
		display: flex;
		justify-content: space-between;
		margin-top: 2px;
		font-size: var(--text-2xs);
		color: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	.hint {
		margin-top: 8px;
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.models {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}
	.estimate {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 28px;
		padding: 12px 14px;
		border-radius: var(--radius-md);
		background: var(--surface-2);
		box-shadow: inset 0 0 0 1px var(--border-subtle);
	}
	.estimate div {
		display: flex;
		flex-direction: column;
	}
	.e-label {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.e-val {
		font-size: var(--text-md);
		font-weight: var(--weight-semibold);
	}
	.e-note {
		flex-basis: 100%;
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.savebar {
		position: sticky;
		bottom: 0;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
		padding: 12px 24px;
		background: color-mix(in srgb, var(--surface-2) 94%, transparent);
		backdrop-filter: blur(8px);
		border: 1px solid var(--border);
		border-top: 0;
		border-radius: 0 0 var(--radius-lg) var(--radius-lg);
	}
	.muted-note,
	.ro {
		font-size: var(--text-sm);
		color: var(--text-3);
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.muted-note {
		margin-right: auto;
	}
	@media (max-width: 900px) {
		.sec {
			grid-template-columns: minmax(0, 1fr);
			gap: 16px;
			padding: 20px 16px;
		}
		.models {
			grid-template-columns: 1fr;
		}
		.savebar {
			padding: 12px 16px;
		}
	}
</style>
