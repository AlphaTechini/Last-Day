<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import Plus from '@lucide/svelte/icons/plus';
	import Upload from '@lucide/svelte/icons/upload';
	import Users from '@lucide/svelte/icons/users';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Input from '#lib/components/ui/Input.svelte';
	import Select from '#lib/components/ui/Select.svelte';
	import Field from '#lib/components/ui/Field.svelte';
	import Dialog from '#lib/components/ui/Dialog.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import SegmentedControl from '#lib/components/ui/SegmentedControl.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Avatar from '#lib/components/ui/Avatar.svelte';
	import StatusPill from '#lib/components/ui/StatusPill.svelte';
	import SystemIcon from '#lib/components/ui/SystemIcon.svelte';
	import ActionForm from '#lib/components/ui/ActionForm.svelte';
	import type { EmployeeStatus } from '#lib/types.ts';
	import { date } from '#lib/ui/format.ts';
	import type { EmployeesPageData, PageProps } from '#lib/ui/page-data.ts';

	let { data, form }: PageProps<EmployeesPageData> = $props();

	let query = $state('');
	let status = $state<'all' | EmployeeStatus>('all');
	let department = $state('');
	let addOpen = $state(false);
	let importOpen = $state(false);

	const counts = $derived({
		all: data.employees.length,
		active: data.employees.filter((e) => e.status === 'active').length,
		offboarding: data.employees.filter((e) => e.status === 'offboarding').length,
		offboarded: data.employees.filter((e) => e.status === 'offboarded').length
	});

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return data.employees.filter(
			(e) =>
				(status === 'all' || e.status === status) &&
				(!department || e.department === department) &&
				(!q || `${e.name} ${e.workEmail} ${e.role} ${e.department}`.toLowerCase().includes(q))
		);
	});

	const err = (field: string) => (form?.error && form.field === field ? form.error : null);
	const generalErr = $derived(form?.error && !form.field ? form.error : null);

	function clear() {
		query = '';
		status = 'all';
		department = '';
	}
</script>

<svelte:head><title>Employees · Last Day</title></svelte:head>

<PageHeader title="Employees" description="Everyone in the employee record. Offboarding starts from a person's profile.">
	{#snippet actions()}
		{#if data.canEdit}
			<Button size="sm" icon={Upload} onclick={() => (importOpen = true)}>Import CSV</Button>
			<Button size="sm" variant="primary" icon={Plus} onclick={() => (addOpen = true)}>Add employee</Button>
		{/if}
	{/snippet}
</PageHeader>

{#if generalErr && !addOpen && !importOpen}
	<div class="block"><Alert tone="danger" live>{generalErr}</Alert></div>
{/if}

<div class="toolbar">
	<div class="search">
		<Input icon={Search} type="search" placeholder="Search by name, email or role" bind:value={query} aria-label="Search employees" size="sm" />
	</div>
	<SegmentedControl
		label="Status"
		size="sm"
		bind:value={status}
		options={[
			{ value: 'all', label: 'All', count: counts.all },
			{ value: 'active', label: 'Active', count: counts.active },
			{ value: 'offboarding', label: 'Offboarding', count: counts.offboarding },
			{ value: 'offboarded', label: 'Offboarded', count: counts.offboarded }
		]}
	/>
	<div class="dept">
		<Select bind:value={department} aria-label="Department" size="sm">
			<option value="">All departments</option>
			{#each data.departments as d (d)}<option value={d}>{d}</option>{/each}
		</Select>
	</div>
</div>

<Card padding="none">
	{#if filtered.length}
		<Table label="Employees">
			<thead>
				<tr>
					<th>Name</th>
					<th>Role</th>
					<th>Manager</th>
					<th>Systems</th>
					<th>Started</th>
					<th>Status</th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as e (e.id)}
					<tr>
						<td class="primary">
							<a class="person" href="/employees/{e.id}">
								<Avatar name={e.name} size={30} muted={e.status === 'offboarded'} />
								<span class="p-text">
									<span class="p-name">{e.name}</span>
									<span class="p-email">{e.workEmail}</span>
								</span>
							</a>
						</td>
						<td data-label="Role"><span class="role">{e.role}</span><span class="dept-sub">{e.department}</span></td>
						<td data-label="Manager" class="muted-cell">{e.managerName ?? 'None'}</td>
						<td data-label="Systems">
							<span class="systems" aria-label="{e.accountCount} accounts in {e.systems.length} systems">
								{#each e.systems as s (s)}<SystemIcon system={s} size={22} />{/each}
								{#if !e.systems.length}<span class="none">No active accounts</span>{/if}
							</span>
						</td>
						<td data-label="Started" class="muted-cell num">{date(e.startDate)}</td>
						<td data-label="Status"><StatusPill kind="employee" value={e.status} size="sm" /></td>
					</tr>
				{/each}
			</tbody>
		</Table>
	{:else}
		<EmptyState icon={Users} title={data.employees.length ? 'No one matches those filters' : 'No employees yet'} body={data.employees.length ? 'Try a different name, or clear the filters.' : 'Import a CSV from your HR system, or add people one at a time.'}>
			{#snippet actions()}
				{#if data.employees.length}
					<Button size="sm" onclick={clear}>Clear filters</Button>
				{:else if data.canEdit}
					<Button size="sm" icon={Upload} onclick={() => (importOpen = true)}>Import CSV</Button>
				{/if}
			{/snippet}
		</EmptyState>
	{/if}
</Card>
<p class="count-line num">Showing {filtered.length} of {data.employees.length}</p>

{#if data.canEdit}
	<Dialog bind:open={addOpen} title="Add employee" description="Last Day links their accounts on the next sweep." size="lg">
		<ActionForm action="create" reset successToast="Employee added" onsuccess={() => (addOpen = false)} id="create-form" class="form-grid">
			{#snippet children()}
				{#if generalErr}<div class="span2"><Alert tone="danger">{generalErr}</Alert></div>{/if}
				<Field id="f-name" label="Full name" required error={err('name')}>
					{#snippet children({ id, describedBy, invalid })}<Input {id} name="name" required autocomplete="off" {invalid} aria-describedby={describedBy} />{/snippet}
				</Field>
				<Field id="f-email" label="Work email" required error={err('workEmail')}>
					{#snippet children({ id, describedBy, invalid })}<Input {id} name="workEmail" type="email" required placeholder="name@company.com" {invalid} aria-describedby={describedBy} />{/snippet}
				</Field>
				<Field id="f-role" label="Job title" error={err('role')}>
					{#snippet children({ id, describedBy, invalid })}<Input {id} name="role" {invalid} aria-describedby={describedBy} />{/snippet}
				</Field>
				<Field id="f-dept" label="Department" error={err('department')}>
					{#snippet children({ id, describedBy, invalid })}
						<Input {id} name="department" list="dept-list" {invalid} aria-describedby={describedBy} />
						<datalist id="dept-list">{#each data.departments as d (d)}<option value={d}></option>{/each}</datalist>
					{/snippet}
				</Field>
				<Field id="f-mgr" label="Manager" hint="Approves destroying any servers they leave behind." error={err('managerId')}>
					{#snippet children({ id, describedBy, invalid })}
						<Select {id} name="managerId" {invalid} aria-describedby={describedBy}>
							<option value="">No manager</option>
							{#each data.managers as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
						</Select>
					{/snippet}
				</Field>
				<Field id="f-start" label="Start date" error={err('startDate')}>
					{#snippet children({ id, describedBy, invalid })}<Input {id} name="startDate" type="date" {invalid} aria-describedby={describedBy} />{/snippet}
				</Field>
				<div class="span2">
					<Field id="f-aliases" label="Known aliases" optional hint="Comma separated: personal emails, usernames, nicknames. They help the AI find accounts under other names." error={err('aliases')}>
						{#snippet children({ id, describedBy, invalid })}<Input {id} name="aliases" placeholder="dana.o@gmail.com, dokafor" {invalid} aria-describedby={describedBy} />{/snippet}
					</Field>
				</div>
			{/snippet}
		</ActionForm>
		{#snippet footer()}
			<Button onclick={() => (addOpen = false)}>Cancel</Button>
			<Button type="submit" form="create-form" variant="primary">Add employee</Button>
		{/snippet}
	</Dialog>

	<Dialog bind:open={importOpen} title="Import employees from CSV" description="People already in Last Day are matched by work email and updated.">
		<ActionForm action="importCsv" enctype="multipart/form-data" successToast="Import finished" onsuccess={() => (importOpen = false)} class="import">
			{#snippet children({ pending })}
				{#if generalErr}<Alert tone="danger">{generalErr}</Alert>{/if}
				<Field id="csv" label="CSV file" error={err('file')}>
					{#snippet children({ id, describedBy, invalid })}<Input {id} name="file" type="file" accept=".csv,text/csv" required {invalid} aria-describedby={describedBy} />{/snippet}
				</Field>
				<div class="csv-help">
					<p>The first row must be this header:</p>
					<code>name,work_email,role,department,manager_email,start_date,aliases</code>
					<p>Dates as YYYY-MM-DD. Separate several aliases with a semicolon.</p>
				</div>
				<div class="import-actions">
					<Button onclick={() => (importOpen = false)}>Cancel</Button>
					<Button type="submit" variant="primary" icon={Upload} loading={pending} loadingLabel="Importing">Import</Button>
				</div>
			{/snippet}
		</ActionForm>
	</Dialog>
{/if}

<style>
	.block {
		margin-bottom: var(--space-4);
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
	}
	.search {
		flex: 1 1 260px;
		max-width: 360px;
	}
	.dept {
		width: 190px;
		margin-left: auto;
	}
	.person {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--text);
		min-width: 0;
	}
	.person:hover {
		text-decoration: none;
	}
	.person:hover .p-name {
		text-decoration: underline;
		text-decoration-color: var(--border-strong);
	}
	.p-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		line-height: 1.3;
	}
	.p-name {
		font-weight: var(--weight-semibold);
		font-size: var(--text-base);
	}
	.p-email {
		font-size: var(--text-xs);
		color: var(--text-3);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.role {
		display: block;
	}
	.dept-sub {
		display: block;
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.muted-cell {
		color: var(--text-2);
		white-space: nowrap;
	}
	.systems {
		display: inline-flex;
		gap: 4px;
	}
	.none {
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	.count-line {
		margin-top: 10px;
		font-size: var(--text-xs);
		color: var(--text-3);
	}
	:global(.form-grid) {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}
	.span2 {
		grid-column: 1 / -1;
	}
	:global(.import) {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.csv-help {
		padding: 10px 12px;
		border-radius: var(--radius-md);
		background: var(--surface-2);
		font-size: var(--text-xs);
		color: var(--text-2);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.csv-help code {
		font-size: 11px;
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.import-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	@media (max-width: 720px) {
		.search {
			max-width: none;
			flex-basis: 100%;
		}
		.dept {
			margin-left: 0;
			flex: 1;
		}
		:global(.form-grid) {
			grid-template-columns: 1fr;
		}
		.systems {
			justify-content: flex-end;
		}
	}
</style>
