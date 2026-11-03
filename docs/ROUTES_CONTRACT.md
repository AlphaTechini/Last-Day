# Last Day: Route and Data Contract (internal)

Shared contract between the UI (`*.svelte`, `src/lib/components`, `src/lib/styles`) and the server (`+page.server.ts`, `+layout.server.ts`, `+server.ts`, `src/lib/server`). All DTO types live in `src/lib/types.ts`. Import via `#lib/types.ts` (SvelteKit 3 uses `#lib/*` package.json subpath imports, not `$lib`; always include the file extension, e.g. `#lib/server/db/index.ts`, `#lib/components/Button.svelte`).

Ownership:
- **UI owner:** every `.svelte` file, `src/lib/components/**`, `src/lib/styles/**`, `src/lib/ui/**` (client helpers like formatters).
- **Server owner:** every `+page.server.ts`, `+layout.server.ts`, `+server.ts`, `hooks.server.ts`, `src/lib/server/**`, `scripts/**`.
- Neither edits the other's files. `src/lib/types.ts` changes only through the orchestrator.

Forms use SvelteKit form actions with `use:enhance` and progressive enhancement. Action names below are the `?/name` keys. Every action returns either `fail(400, { error: string, field?: string })` or `{ ok: true, message?: string }` (or a `redirect`).

## Layouts

### `src/routes/+layout.server.ts`
Returns `{ user: SessionUser | null }`.

### `src/routes/(app)/+layout.server.ts`
Redirects to `/login` when no user. Returns `{ user: SessionUser, nav: { unknownCount: number, needsAttentionCount: number, pendingDestroyCount: number }, isDemo: boolean }`.
`(app)/+layout.svelte` renders the app shell (sidebar nav: Dashboard, Employees, Runs, Unknown owners, Connections, Audit log, Settings; user menu with Sign out; demo banner when `isDemo`).

## Pages

| Route | load returns | Actions (form fields) |
|---|---|---|
| `/login` | `{ demoHint: { email: string, password: string } \| null }` | `login` (email, password) -> redirect `/` |
| `/logout` (`+server.ts`, POST) | - | clears session, redirect `/login` |
| `/(app)` dashboard (`src/routes/(app)/+page`) | `DashboardData` | `sweep` (no fields), `resetDemo` (no fields; admin/judge only) |
| `/(app)/employees` | `{ employees: EmployeeListItem[], departments: string[], managers: {id, name}[], canEdit: boolean }` | `create` (name, workEmail, role, department, managerId, startDate, aliases comma-separated), `importCsv` (file: csv with header name,work_email,role,department,manager_email,start_date,aliases) |
| `/(app)/employees/[id]` | `{ employee: EmployeeDetail, accounts: AccountView[], runs: RunSummary[], canOffboard: boolean }` | `offboard` (no fields) -> redirect `/runs/{runId}` |
| `/(app)/runs` | `{ runs: RunSummary[] }` | - |
| `/(app)/runs/[id]` | `{ run: RunDetail }` | `decide` (itemId, decision: 'yes'\|'no'), `approve` (itemIds: repeated field, or all='1'), `retry` (itemId), `destroy` (itemId), `recheck` (no fields) |
| `/(app)/unknown` | `{ accounts: UnknownAccount[], employees: {id, name, workEmail}[] }` | `link` (accountId, employeeId), `markService` (accountId), `flag` (accountId) |
| `/(app)/connections` | `{ connections: ConnectionCard[] }` | `save` (system, plus each configFields key and secretFields key; empty secret = keep existing), `test` (system) |
| `/(app)/audit` | `{ entries: AuditEntry[], total: number, page: number, pageSize: number, filters: { employee?: string, runId?: string, system?: string, actor?: string, kind?: string }, employees: {id,name}[] }` | - (filters are GET query params: employee, run, system, actor, kind, page) |
| `/(app)/settings` | `SettingsData` | `save` (recheckDelaySeconds, aiConfidenceThreshold, defaultModel, escalationModel) |

## JSON endpoints (for live updates)

| Endpoint | Returns |
|---|---|
| `GET /api/runs/[id]` | `RunDetail` (same shape as the page load). The run page polls this every 1500 ms while `status === 'executing'` or any item is `running`/`approved`/`destroying`, and every 5000 ms while a recheck is `pending` with `dueAt` in the next 10 minutes. Stop polling otherwise. |
| `GET /api/health` | `{ ok: true, db: boolean, version: string }` |

## Behaviour the UI can rely on

- `offboard` creates the run synchronously (re-sweep scoped to the employee + AI resolve happens inside the action, typically 1-6 s). The UI should show a pending state on the button.
- `approve` returns immediately; the executor runs in the background. Items move `approved -> running -> verified|failed`. Server items move `approved -> running -> awaiting_manager`, then after `destroy`: `destroying -> removed`.
- `ActionStep[]` per item is pre-populated at run creation with `status: 'pending'` so the UI can show the full checklist before execution.
- Probable matches arrive with `status: 'proposed'`; exact matches and servers with `status: 'pending'`. `approve` with `all=1` approves every `pending` item (proposed ones must be decided first; the UI should disable "Approve revocation" while any item is `proposed`, and say why).
- Role permissions: `judge` can do everything on the demo company except `connections.save`, `connections.test` and `settings.save` (UI shows those read-only via `canEdit`). `manager` can only `destroy` for their reports' runs. `hr` and `admin` can do everything else.
- Money: numbers in USD, render with 2 decimals (`$5.00/mo`). AI cost per run is tiny; render with 4 decimals when below $0.01 (`$0.0012`).
