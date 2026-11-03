// End-to-end walkthrough of the whole product in a real browser (USER_FLOWS 1-8) against the dev sandbox.
// Prereqs: Postgres migrated, `pnpm mock` + `pnpm connect:mock` running, the app running (node build) with
// VULTR_INFERENCE_BASE_URL/VULTR_INFERENCE_API_KEY pointing at the mock and RECHECK_DELAY_SECONDS set.
// Usage: BASE_URL=http://localhost:3300 MOCK_URL=http://localhost:4010 node tests/e2e/demo-flow.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const BASE = (process.env.BASE_URL || 'http://localhost:3300').replace(/\/+$/, '');
const MOCK = (process.env.MOCK_URL || 'http://localhost:4010').replace(/\/+$/, '');
const OUT = process.env.SHOT_DIR || join(dirname(fileURLToPath(import.meta.url)), '../../evidence/screenshots/sandbox');
mkdirSync(OUT, { recursive: true });

const USERS = {
	admin: ['admin@lastday.local', 'lastday-admin'],
	hr: ['hr@northwind.example', 'demo-hr'],
	manager: ['priya.raman@northwind.example', 'demo-manager'],
	judge: ['judge@lastday.local', 'judge-demo']
};

const browser = await chromium.launch();
const problems = [];
const metrics = {};
let n = 0;

function check(cond, msg) {
	if (cond) console.log(`  ok   ${msg}`);
	else {
		console.log(`  FAIL ${msg}`);
		problems.push(msg);
	}
}
const step = (t) => console.log(`\n== ${t}`);

async function newSession(role, viewport = { width: 1440, height: 900 }) {
	const context = await browser.newContext({ viewport, deviceScaleFactor: 2, baseURL: BASE });
	const page = await context.newPage();
	page.setDefaultTimeout(20000);
	page.on('console', (m) => {
		if (m.type() === 'error') {
			console.log(`  [console.error:${role}] ${m.text()}`);
			problems.push(`console error (${role}): ${m.text()}`);
		}
	});
	page.on('pageerror', (e) => {
		console.log(`  [pageerror:${role}] ${e.message}`);
		problems.push(`page error (${role}): ${e.message}`);
	});
	page.on('response', (r) => {
		if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`);
	});
	await page.goto('/login');
	await page.fill('input[name=email]', USERS[role][0]);
	await page.fill('input[name=password]', USERS[role][1]);
	await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login')), page.click('button[type=submit]')]);
	return { context, page };
}

async function shot(page, name) {
	await page.evaluate(() => document.fonts.ready);
	await page.waitForTimeout(900);
	await page.screenshot({ path: join(OUT, `${String(++n).padStart(2, '0')}-${name}.png`) });
}

const text = (page) => page.innerText('body');
const dialog = (page) => page.locator('dialog[open]');

async function waitToast(page, re) {
	await page.getByText(re).first().waitFor({ timeout: 15000 });
}

// ---------------------------------------------------------------- 1. admin: connections
step('1. Admin: connections');
const admin = await newSession('admin');
{
	const p = admin.page;
	await p.goto('/connections');
	const tests = p.getByRole('button', { name: 'Test connection' });
	check((await tests.count()) === 4, 'four connection cards');
	await shot(p, 'connections-untested');
	for (let i = 0; i < 4; i++) {
		await tests.nth(i).click();
		await p.waitForFunction((i) => {
			const cards = document.querySelectorAll('section, article, .card');
			return true;
		}, i);
		await p.waitForTimeout(1800);
	}
	await p.reload();
	const body = await text(p);
	const healthy = (body.match(/Healthy|Connected/g) || []).length;
	check(healthy >= 4, `all four connections healthy (saw ${healthy} healthy pills)`);
	check(!/Failed|Error|Unreachable/.test(body), 'no failed connection pill');
	await shot(p, 'connections-healthy');
}

// ---------------------------------------------------------------- 2. dashboard: reset + sweep
step('2. Dashboard: reset demo, sweep');
{
	const p = admin.page;
	await p.goto('/');
	await p.getByRole('button', { name: 'Reset demo company' }).click();
	await dialog(p).getByRole('button', { name: 'Reset demo company' }).click();
	await p.getByText(/30 employees|reset|Demo company/i).first().waitFor({ timeout: 120000 });
	await p.waitForFunction(() => !document.querySelector('dialog[open]'), null, { timeout: 120000 });
	await p.waitForTimeout(500);
	await p.reload();
	const body = await text(p);
	check(/\b30\b/.test(body), 'dashboard shows 30 employees after reset');
	await p.getByRole('button', { name: 'Sweep now' }).click();
	await p.getByText(/Swept|Sweep complete|accounts/i).first().waitFor();
	await p.waitForFunction(() => !document.body.innerText.includes('Sweeping 4 systems'), null, { timeout: 120000 });
	await p.waitForTimeout(800);
	await p.reload();
	await shot(p, 'dashboard-after-sweep');
}

// ---------------------------------------------------------------- 3. unknown owners
step('3. Unknown owners');
{
	const p = admin.page;
	await p.goto('/unknown');
	const body = await text(p);
	check(/swhitlock/.test(body), 'unknown owners lists the contractor (swhitlock)');
	check(/ops-bot|opsbot|ops_bot/i.test(body), 'unknown owners lists ops-bot');
	await shot(p, 'unknown-owners');
	const row = p.locator('li.row', { hasText: /ops-bot|opsbot|ops_bot/i }).first();
	await row.getByRole('button', { name: 'Mark as service' }).click();
	await waitToast(p, /Marked as a service account/);
	await p.waitForTimeout(600);
	await p.getByRole('radio', { name: /Service accounts/ }).click().catch(() => {});
	await p.waitForTimeout(500);
	check(/ops-bot/.test(await text(p)) && /Shared or service account/.test(await text(p)), 'ops-bot marked as service');
	await p.getByRole('radio', { name: /Unlinked/ }).click().catch(() => {});
	// link the contractor to someone
	const crow = p.locator('li.row', { hasText: /swhitlock/ }).first();
	const sel = crow.locator('select');
	const pick = (await sel.locator('option').allTextContents()).find((o) => /Whitlock/i.test(o)) ?? (await sel.locator('option').allTextContents())[1];
	await sel.selectOption({ label: pick });
	await crow.getByRole('button', { name: 'Link' }).click();
	await waitToast(p, /Linked/);
	console.log(`  linked contractor to ${pick}`);
	await p.waitForTimeout(600);
	await shot(p, 'unknown-owners-resolved');
}
await admin.context.close();

// ---------------------------------------------------------------- 4. HR: offboard Dana
step('4. HR: offboard Dana Okafor');
const hr = await newSession('hr');
let runUrl;
{
	const p = hr.page;
	await p.goto('/employees');
	await shot(p, 'employees');
	await p.getByRole('link', { name: /Dana Okafor/ }).first().click();
	await p.waitForURL(/\/employees\/.+/);
	await shot(p, 'employee-profile-dana');
	await p.getByRole('button', { name: 'Offboard now' }).click();
	await shot(p, 'offboard-confirm');
	await dialog(p).getByRole('button', { name: /Offboard Dana/ }).click();
	await p.waitForURL(/\/runs\/.+/, { timeout: 60000 });
	runUrl = new URL(p.url()).pathname;
	await p.getByText(/Probable matches/i).first().waitFor();
	await p.waitForTimeout(800);
	const body = await text(p);
	check(/Matched by work email/i.test(body), 'run page has exact matches');
	check(/Probable match/i.test(body), 'run page has probable matches');
	check(/\b\d{2}%/.test(body), 'confidence percentages shown');
	check(/dok-dev/.test(body), 'probable match dok-dev present');
	check(/Why Last Day thinks/.test(body), 'evidence is shown');
	check(/\$\d+\.\d{2}\/mo/.test(body), 'server card shows $/month');
	check(/build-runner/i.test(body), 'leftover server shown');
	check(/Decide \d+ probable match/.test(body), 'approval bar blocked while matches are undecided');
	const disabled = await p.getByRole('button', { name: /Approve revocation/ }).isDisabled();
	check(disabled, 'Approve revocation disabled before decisions');
	await shot(p, 'run-review');
	// mobile check of review
	await p.setViewportSize({ width: 390, height: 844 });
	await p.waitForTimeout(500);
	await shot(p, 'run-review-mobile');
	check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal scroll on mobile run page');
	await p.setViewportSize({ width: 1440, height: 900 });
	await p.waitForTimeout(400);
}

// ---------------------------------------------------------------- 5. decide, approve, live run
step('5. Decide, approve, live run');
{
	const p = hr.page;
	// Expand evidence on first probable card if collapsed
	const yesBtn = p.getByRole('button', { name: /Yes, (that|\w+ launched)/ });
	const nYes = await yesBtn.count();
	console.log(`  ${nYes} probable matches to decide`);
	check(nYes >= 1, 'at least one probable match to decide');
	for (let i = 0; i < nYes; i++) {
		await yesBtn.first().click();
		await p.waitForTimeout(900);
	}
	await p.waitForFunction(() => !/Decide \d+ probable/.test(document.body.innerText));
	const approve = p.getByRole('button', { name: /Approve revocation/ });
	check(await approve.isEnabled(), 'Approve revocation enabled after all decided');
	await shot(p, 'run-decided');
	await p.evaluate(() => (window.__noReload = true));
	const t0 = Date.now();
	await approve.click();
	await p.getByText(/Approved. Revoking now/).first().waitFor();
	await shot(p, 'run-executing-start');
	// capture mid-run frame once something is running/verified but not everything
	await p.waitForFunction(() => /\b[1-9] of \d+ confirmed/.test(document.body.innerText), null, { timeout: 60000 }).catch(() => {});
	await shot(p, 'run-executing-midway');
	await p.waitForFunction(() => /All \d+ confirmed/.test(document.body.innerText), null, { timeout: 180000 });
	metrics.wallSeconds = (Date.now() - t0) / 1000;
	check(await p.evaluate(() => window.__noReload === true), 'lines turned green via polling without a page reload');
	await p.waitForTimeout(1500);
	const body = await text(p);
	check(/awaiting manager/i.test(body), 'server awaiting manager');
	check(/Still billing/i.test(body), 'server card shows still billing');
	check(!/\bfailed\b/i.test((await p.locator('main').innerText().catch(() => body)).replace(/Failed or came back/g, '')), 'no failed lines');
	const green = await p.locator('dl.ov-stats').innerText();
	console.log('  summary:', green.replace(/\n+/g, ' | '));
	metrics.summary = green.replace(/\n+/g, ' | ');
	check(/Click to green/.test(green), 'summary shows click to green');
	check(/AI cost/.test(green) && /\$0\.\d{4}/.test(green), 'AI cost formatted with 4 decimals');
	check(/Found by rules\s*\n?\s*\d+/.test(green) && /Found only by AI/.test(green), 'summary shows rules vs AI counts');
	await p.waitForTimeout(800);
	await shot(p, 'run-all-green');
	await p.setViewportSize({ width: 390, height: 844 });
	await p.waitForTimeout(500);
	await shot(p, 'run-all-green-mobile');
	check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal scroll on mobile (green)');
	await p.setViewportSize({ width: 1440, height: 900 });
}

// ---------------------------------------------------------------- 6. manager destroys
step('6. Manager destroys the server');
const mgr = await newSession('manager');
{
	const p = mgr.page;
	await p.goto('/');
	const body = await text(p);
	check(/left a server|Anything to keep|Dana/i.test(body), 'manager sees pending destroy on dashboard');
	await shot(p, 'manager-dashboard');
	const mobile = await mgr.context.newPage();
	await mobile.setViewportSize({ width: 390, height: 844 });
	await mobile.goto('/');
	await shot(mobile, 'dashboard-mobile');
	check(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal scroll on mobile dashboard');
	await mobile.close();
	const before = await text(p);
	await p.goto(runUrl);
	await p.getByRole('button', { name: 'Destroy server' }).first().click();
	await shot(p, 'manager-destroy-confirm');
	await dialog(p).getByRole('button', { name: 'Destroy server' }).click();
	await p.getByText(/Removed/).first().waitFor({ timeout: 60000 });
	await p.waitForTimeout(1500);
	const after = await text(p);
	check(/Removed/.test(after), 'server shows Removed');
	check(/snapshot/i.test(after), 'snapshot cost mentioned after destroy');
	await shot(p, 'manager-server-removed');
}
await mgr.context.close();

// ---------------------------------------------------------------- 7. recheck clean, tamper, regress
step('7. Re-check: clean, then regressed');
{
	const p = hr.page;
	await p.goto(runUrl);
	await p.getByRole('button', { name: /Re-check now/ }).click();
	await p.getByText(/Nothing came back/).first().waitFor({ timeout: 60000 });
	check(true, 'recheck -> clean');
	await p.waitForTimeout(600);
	await shot(p, 'run-recheck-clean');
	const r = await fetch(`${MOCK}/__admin/tamper`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ system: 'keycloak' }) });
	check(r.ok, 'sandbox tamper accepted');
	await p.getByRole('button', { name: /Re-check now/ }).click();
	await p.getByText(/\d+ things? came back/).first().waitFor({ timeout: 60000 });
	await p.waitForTimeout(1200);
	const body = await text(p);
	check(/Regressed/i.test(body), 'run turned regressed');
	await shot(p, 'run-regressed');
	await p.goto('/');
	const dash = await text(p);
	check(/Dana/.test(dash) && /Needs attention/i.test(dash), 'regressed run appears in Needs attention');
	await shot(p, 'dashboard-needs-attention');
}

// ---------------------------------------------------------------- 8. audit log
step('8. Audit log');
{
	const p = hr.page;
	await p.goto('/audit');
	let body = await text(p);
	check(/API call/i.test(body), 'audit has api_call entries');
	check(/\b(GET|POST|PUT|PATCH|DELETE)\b/.test(body) && /\b2\d\d\b/.test(body), 'audit shows method and status');
	await p.locator('button.line', { hasText: /\bGET\b|\bPOST\b|\bPUT\b|\bDELETE\b|\bPATCH\b/ }).first().click();
	await p.waitForTimeout(400);
	check(/Request/.test(await text(p)), 'api_call detail expands with request');
	await shot(p, 'audit-api-call');
	await p.goto('/audit?kind=ai_call');
	body = await text(p);
	check(/AI call|AI match|AI/i.test(body), 'ai_call filter lists AI entries');
	await p.locator('button.line').first().click();
	await p.waitForTimeout(400);
	const d = await text(p);
	check(/Model/.test(d) && /Tokens/.test(d) && /\$0\.\d+/.test(d), 'ai_call detail shows model, tokens, cost');
	await shot(p, 'audit-ai-call');
	await p.goto('/audit?system=github');
	const rows = await p.locator('button.line').count();
	check(rows > 0, `system filter works (${rows} github rows)`);
	const rowsText = await p.locator('button.line').allInnerTexts();
	check(rowsText.every((t) => !/Keycloak/.test(t)), 'github filter excludes keycloak rows');
	await p.goto(`/audit?run=${runUrl.split('/').pop()}`);
	check((await p.locator('button.line').count()) > 0, 'run filter works');
	// Use the dropdown UI as well
	await p.goto('/audit');
	await p.getByLabel('Kind').selectOption({ index: 1 }).catch(() => {});
	await p.waitForTimeout(800);
	await shot(p, 'audit-filtered');
}
await hr.context.close();

// ---------------------------------------------------------------- 9. judge
step('9. Judge');
const judge = await newSession('judge');
{
	const p = judge.page;
	await p.goto('/');
	check(await p.getByRole('button', { name: 'Reset demo company' }).isVisible(), 'judge can see Reset demo company');
	await p.goto('/connections');
	check((await p.getByRole('button', { name: 'Test connection' }).count()) === 0, 'connections are read-only for judge');
	check(/Only an admin can edit/.test(await text(p)), 'read-only notice on connections');
	await shot(p, 'judge-connections-readonly');
	await p.goto('/settings');
	check((await p.getByRole('button', { name: 'Save settings' }).count()) === 0 || (await p.getByRole('button', { name: 'Save settings' }).isDisabled()), 'settings read-only for judge');
	await shot(p, 'judge-settings-readonly');
	// forged settings save
	const res = await judge.context.request.post(`${BASE}/settings?/save`, {
		headers: { origin: BASE, 'x-sveltekit-action': 'true' },
		form: { recheckDelaySeconds: '5', aiConfidenceThreshold: '0.5', defaultModel: 'glm-5.3-flash', escalationModel: 'glm-5.2' }
	});
	const bodyTxt = await res.text();
	console.log(`  forged save -> HTTP ${res.status()} ${bodyTxt.slice(0, 120)}`);
	check(res.status() === 403 || /"status":403|403/.test(bodyTxt), 'server rejects forged settings save with 403');
	const forgedTest = await judge.context.request.post(`${BASE}/connections?/test`, {
		headers: { origin: BASE, 'x-sveltekit-action': 'true' },
		form: { system: 'keycloak' }
	});
	const ft = await forgedTest.text();
	check(forgedTest.status() === 403 || /403/.test(ft), 'server rejects forged connection test with 403');
	// judge resets demo and offboards
	await p.goto('/');
	await p.getByRole('button', { name: 'Reset demo company' }).click();
	await dialog(p).getByRole('button', { name: 'Reset demo company' }).click();
	await p.waitForFunction(() => !document.querySelector('dialog[open]'), null, { timeout: 120000 });
	await p.waitForTimeout(800);
	await p.goto('/employees');
	await p.getByRole('link', { name: /Dana Okafor/ }).first().click();
	await p.getByRole('button', { name: 'Offboard now' }).click();
	await dialog(p).getByRole('button', { name: /Offboard Dana/ }).click();
	await p.waitForURL(/\/runs\/.+/, { timeout: 60000 });
	await p.getByText(/Probable matches/i).first().waitFor();
	check(true, 'judge can reset demo and offboard Dana');
	await shot(p, 'judge-run-review');
}
await judge.context.close();

// ---------------------------------------------------------------- 10. settings
step('10. Settings save (admin)');
const admin2 = await newSession('admin');
{
	const p = admin2.page;
	await p.goto('/settings');
	await shot(p, 'settings');
	await p.locator('#threshold').fill('0.8');
	await p.getByRole('button', { name: 'Save settings' }).click();
	await waitToast(p, /Saved|saved|Settings/);
	await p.reload();
	check(Number(await p.locator('#threshold').inputValue()) === 0.8, 'settings persisted (threshold 0.80)');
	await p.locator('#threshold').fill('0.7');
	await p.getByRole('button', { name: 'Save settings' }).click();
	await waitToast(p, /Saved|saved|Settings/);
}
await admin2.context.close();

await browser.close();
console.log('\nmetrics', JSON.stringify(metrics));
if (problems.length) {
	console.log(`\n${problems.length} problem(s):`);
	for (const x of [...new Set(problems)]) console.log(' - ' + x);
	process.exit(1);
}
console.log('\nAll e2e checks passed.');
