/**
 * Shared helpers for the day-1 capability checks (C1 to C8).
 * Run every script from the repository root so that `.env` is found.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Node 22: fills process.env from .env without overriding variables already set.
try {
	process.loadEnvFile?.('.env');
} catch {
	// No .env file: rely on the variables already in the environment.
}

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EVIDENCE_DIR = join(REPO_ROOT, 'evidence', 'capability-checks');

// ---------------------------------------------------------------- redaction

/** Env vars whose values must never reach the console or a log. */
const SECRET_VAR = /(?:^|_)(?:API_KEY|KEY|SECRET|TOKEN|PASSWORD)$/;
const secrets = new Set<string>();

/** Adds a value that must be redacted from every line the checks print or log. */
export function registerSecret(value: string | undefined | null): void {
	if (value && value.length >= 8) secrets.add(value);
}

for (const [name, value] of Object.entries(process.env)) {
	if (SECRET_VAR.test(name)) registerSecret(value);
}

/** JSON string fields whose name suggests a credential: "api_key": "...", "token": "...". */
const SECRET_JSON_FIELD =
	/"([\w.-]*(?:api[_-]?key|apikey|key|secret|token|password|authorization|credential)[\w.-]*)"(\s*:\s*)"(?:[^"\\]|\\.)*"/gi;

export function redact(text: string): string {
	let out = text;
	for (const secret of secrets) out = out.split(secret).join('[REDACTED]');
	return out
		.replace(SECRET_JSON_FIELD, (_match, field: string, sep: string) => `"${field}"${sep}"[REDACTED]"`)
		.replace(/(authorization["']?\s*[:=]\s*)[^\r\n,}]+/gi, '$1[REDACTED]')
		.replace(/Bearer\s+[\w.~+\/=-]+/gi, 'Bearer [REDACTED]')
		.replace(/github_pat_\w+|gh[pousr]_\w+/g, '[REDACTED]')
		.replace(/((?:password|client_secret|api_key|access_token)=)[^&\s]+/gi, '$1[REDACTED]');
}

// ---------------------------------------------------------------- HTTP

export interface Res {
	/** HTTP status, or 0 when no response arrived (see `error`). */
	status: number;
	json: any;
	text: string;
	ms: number;
	/** Response headers with lower-case names. */
	headers: Record<string, string>;
	error?: string;
}

export interface ReqOpts {
	headers?: Record<string, string>;
	/** Objects are sent as JSON. */
	body?: unknown;
	/** Form fields, sent as application/x-www-form-urlencoded. */
	form?: Record<string, string>;
	/** Default 20 seconds. */
	timeoutMs?: number;
}

/** fetch with a timeout. Never throws: failures come back as status 0 with `error` set. */
export async function req(method: string, url: string, opts: ReqOpts = {}): Promise<Res> {
	const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
	let body: string | undefined;
	if (opts.form) {
		body = new URLSearchParams(opts.form).toString();
		headers['content-type'] = 'application/x-www-form-urlencoded';
	} else if (opts.body !== undefined) {
		body = JSON.stringify(opts.body);
		headers['content-type'] ??= 'application/json';
	}

	const controller = new AbortController();
	const timeoutMs = opts.timeoutMs ?? 20_000;
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const started = performance.now();
	const elapsed = () => Math.round(performance.now() - started);
	try {
		const response = await fetch(url, { method, headers, body, signal: controller.signal });
		const text = await response.text();
		let json: any = null;
		try {
			json = text ? JSON.parse(text) : null;
		} catch {
			json = null;
		}
		const responseHeaders: Record<string, string> = {};
		response.headers.forEach((value, key) => {
			responseHeaders[key] = value;
		});
		return { status: response.status, json, text, ms: elapsed(), headers: responseHeaders };
	} catch (e) {
		const error = controller.signal.aborted ? `timeout after ${timeoutMs} ms` : errMsg(e);
		return { status: 0, json: null, text: '', ms: elapsed(), headers: {}, error };
	} finally {
		clearTimeout(timer);
	}
}

/** One-line view of a response body for the log. */
export function snippet(res: Res, max = 400): string {
	if (res.error) return `error: ${res.error}`;
	const flat = res.text.replace(/\s+/g, ' ').trim();
	if (!flat) return '(empty body)';
	return flat.length > max ? `${flat.slice(0, max)}... [${flat.length} chars]` : flat;
}

export function bearer(token: string): Record<string, string> {
	return { authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------- Vultr

export function vultrApiUrl(): string {
	return (process.env.VULTR_API_URL?.trim() || 'https://api.vultr.com/v2').replace(/\/+$/, '');
}

/** The first array under one of `names`, else the first array anywhere in the body. */
export function arrayIn(json: any, ...names: string[]): any[] {
	for (const name of names) {
		if (Array.isArray(json?.[name])) return json[name];
	}
	const found = Object.values(json ?? {}).find((value) => Array.isArray(value));
	return Array.isArray(found) ? found : [];
}

/** Follows Vultr cursor pagination (meta.links.next). `first` is the first response, for logging. */
export async function vultrAll(
	api: string,
	token: string,
	path: string,
	...names: string[]
): Promise<{ items: any[]; first?: Res }> {
	const items: any[] = [];
	let first: Res | undefined;
	let cursor = '';
	for (let page = 0; page < 50; page++) {
		const sep = path.includes('?') ? '&' : '?';
		const cur = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
		const res = await req('GET', `${api}${path}${sep}per_page=100${cur}`, { headers: bearer(token) });
		first ??= res;
		if (res.status !== 200) break;
		items.push(...arrayIn(res.json, ...names));
		cursor = res.json?.meta?.links?.next ?? '';
		if (!cursor) break;
	}
	return { items, first };
}

// ---------------------------------------------------------------- misc helpers

export function stamp(): string {
	return Date.now().toString(36);
}

/** dana@company.test + "x" -> dana+x@company.test */
export function addTag(email: string, tag: string): string {
	const at = email.indexOf('@');
	return at > 0 ? `${email.slice(0, at)}+${tag}${email.slice(at)}` : email;
}

/** Random password that meets common complexity rules. Registered as a secret. */
export function newPassword(): string {
	const password = `Aa1!${randomBytes(18).toString('base64url')}`;
	registerSecret(password);
	return password;
}

export function fmtMs(ms: number): string {
	return ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${(ms / 60_000).toFixed(1)} min`;
}

export function sleep(ms: number): Promise<void> {
	return new Promise((done) => setTimeout(done, ms));
}

/** Polls `ready` until it returns true or the timeout passes. */
export async function waitFor(ready: () => Promise<boolean>, timeoutMs: number, intervalMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (await ready()) return true;
		if (Date.now() >= deadline) return false;
		await sleep(intervalMs);
	}
}

export function errMsg(e: unknown): string {
	return e instanceof Error ? e.message : String(e);
}

function localDate(d = new Date()): string {
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ---------------------------------------------------------------- logging

export type Status = 'PASS' | 'FAIL' | 'SKIP';

export interface Outcome {
	name: string;
	status: Status;
	summary: string;
	/** Log path, relative to the repository root. */
	log: string;
}

/**
 * Collects the lines of one check, prints them with secrets redacted, and
 * appends them to evidence/capability-checks/<YYYY-MM-DD>-<check>.log.
 */
export class Checker {
	private readonly lines: string[] = [];
	private passed = 0;
	private failed = 0;
	private skipReason?: string;

	constructor(readonly name: string) {
		this.emit(`# ${name} run at ${new Date().toISOString()}`);
	}

	/** Number of failed assertions so far. Lets a helper report its own result. */
	get failureCount(): number {
		return this.failed;
	}

	private emit(text: string): void {
		const clean = redact(text);
		this.lines.push(clean);
		console.log(clean);
	}

	title(text: string): void {
		this.emit(`\n== ${text}`);
	}

	info(text: string): void {
		this.emit(`   ${text}`);
	}

	raw(label: string, res: Res): void {
		this.emit(`      ${label}: HTTP ${res.status || 'n/a'} in ${res.ms} ms: ${snippet(res)}`);
	}

	/** Prints PASS or FAIL with the raw response, and counts the result. */
	assert(ok: boolean, label: string, res?: Res, note?: string): boolean {
		if (ok) this.passed++;
		else this.failed++;
		this.emit(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
		if (res) this.raw('response', res);
		if (note) this.emit(`      note: ${note}`);
		return ok;
	}

	skip(text: string): void {
		this.skipReason = text;
		this.emit(`SKIP  ${text}`);
	}

	finish(): Outcome {
		const status: Status = this.failed > 0 ? 'FAIL' : this.passed > 0 ? 'PASS' : 'SKIP';
		const summary =
			status === 'SKIP'
				? `skipped: ${this.skipReason ?? 'no assertions ran'}`
				: `${this.passed} passed, ${this.failed} failed`;
		this.emit(`RESULT ${status}: ${summary}`);
		mkdirSync(EVIDENCE_DIR, { recursive: true });
		const file = join(EVIDENCE_DIR, `${localDate()}-${this.name}.log`);
		appendFileSync(file, `${this.lines.join('\n')}\n`);
		const shown = relative(REPO_ROOT, file);
		console.log(`log: ${shown}`);
		return { name: this.name, status, summary, log: shown };
	}
}

export function check(name: string): Checker {
	return new Checker(name);
}

// ---------------------------------------------------------------- running

export interface RunFlags {
	/** Create or change resources. Without it, only read-only probes run. */
	apply: boolean;
	/** C6 only: also run the escalation model. */
	escalation: boolean;
}

export function parseFlags(argv: string[] = process.argv.slice(2)): RunFlags {
	return { apply: argv.includes('--apply'), escalation: argv.includes('--escalation') };
}

/** True when the calling module is the script being executed (not imported by run-all). */
export function isMain(moduleUrl: string): boolean {
	const entry = process.argv[1];
	return entry !== undefined && moduleUrl === pathToFileURL(resolve(entry)).href;
}

export interface Ctx extends RunFlags {
	readonly c: Checker;
	/** A variable that runCheck has already confirmed is set. */
	need(name: string): string;
	/** An optional variable, or undefined when unset or blank. */
	opt(name: string): string | undefined;
}

export interface CheckSpec {
	name: string;
	title: string;
	/** Variables that must be set. Otherwise the check prints SKIP and exits normally. */
	required?: string[];
	/** Runs before the required-variable test, so manual steps show even on SKIP. */
	intro?: (c: Checker) => void;
	body: (x: Ctx) => Promise<void>;
}

export async function runCheck(spec: CheckSpec, flags: RunFlags): Promise<Outcome> {
	const c = check(spec.name);
	c.title(spec.title);
	spec.intro?.(c);

	const missing = (spec.required ?? []).filter((name) => !process.env[name]?.trim());
	if (missing.length > 0) {
		c.skip(`missing ${missing.join(', ')}: set in .env (see .env.example), then rerun`);
		return c.finish();
	}

	const x: Ctx = {
		...flags,
		c,
		need: (name) => {
			const value = process.env[name]?.trim();
			if (!value) throw new Error(`${name} is not set`);
			return value;
		},
		opt: (name) => process.env[name]?.trim() || undefined,
	};
	try {
		await spec.body(x);
	} catch (e) {
		c.assert(false, `unexpected error: ${errMsg(e)}`);
	}
	return c.finish();
}
