// Formatting helpers shared by every page. Pure functions, safe on server and client.

const usd2 = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD',
	minimumFractionDigits: 2,
	maximumFractionDigits: 2
});
const usd4 = new Intl.NumberFormat('en-US', {
	style: 'currency',
	currency: 'USD',
	minimumFractionDigits: 4,
	maximumFractionDigits: 4
});
const int = new Intl.NumberFormat('en-US');

/** Money per contract: 2 decimals ("$5.00"). */
export function money(value: number | null | undefined): string {
	if (value == null || Number.isNaN(value)) return '$0.00';
	return usd2.format(value);
}

/** Monthly money: "$5.00/mo". */
export function moneyMonthly(value: number | null | undefined): string {
	return `${money(value)}/mo`;
}

/** AI cost per contract: 4 decimals when below $0.01 ("$0.0012"), otherwise 2. */
export function aiCost(value: number | null | undefined): string {
	if (value == null || Number.isNaN(value)) return '$0.00';
	if (value > 0 && value < 0.01) return usd4.format(value);
	return usd2.format(value);
}

export function count(value: number | null | undefined): string {
	return int.format(value ?? 0);
}

export function percent(value: number | null | undefined, digits = 0): string {
	if (value == null) return '';
	return `${(value * 100).toFixed(digits)}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
	return `${count(n)} ${n === 1 ? one : many}`;
}

/** "47s", "2m 14s", "1h 05m", "3d 4h". */
export function duration(totalSeconds: number | null | undefined): string {
	if (totalSeconds == null || Number.isNaN(totalSeconds)) return '';
	const s = Math.max(0, Math.round(totalSeconds));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	const rs = s % 60;
	if (m < 60) return rs ? `${m}m ${String(rs).padStart(2, '0')}s` : `${m}m`;
	const h = Math.floor(m / 60);
	const rm = m % 60;
	if (h < 48) return rm ? `${h}h ${String(rm).padStart(2, '0')}m` : `${h}h`;
	const d = Math.floor(h / 24);
	const rh = h % 24;
	return rh ? `${d}d ${rh}h` : `${d}d`;
}

/** Human delay for settings: 120 -> "2 minutes", 86400 -> "24 hours". */
export function humanDelay(seconds: number): string {
	if (seconds % 86400 === 0 && seconds >= 172800) return plural(seconds / 86400, 'day');
	if (seconds % 3600 === 0) return plural(seconds / 3600, 'hour');
	if (seconds % 60 === 0) return plural(seconds / 60, 'minute');
	return plural(seconds, 'second');
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'long' });

/** "just now", "3 minutes ago", "in 2 hours", "yesterday". */
export function relative(iso: string | null | undefined, now = Date.now()): string {
	if (!iso) return '';
	const t = new Date(iso).getTime();
	if (Number.isNaN(t)) return '';
	const diff = (t - now) / 1000;
	const abs = Math.abs(diff);
	if (abs < 45) return diff < 0 ? 'just now' : 'in a few seconds';
	if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
	if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
	if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day');
	if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), 'month');
	return rtf.format(Math.round(diff / (86400 * 365)), 'year');
}

/** Short relative: "4m", "3h", "2d". */
export function relativeShort(iso: string | null | undefined, now = Date.now()): string {
	if (!iso) return '';
	const s = Math.abs(now - new Date(iso).getTime()) / 1000;
	if (s < 60) return 'now';
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	if (s < 86400 * 365) return `${Math.floor(s / 86400)}d`;
	return `${Math.floor(s / (86400 * 365))}y`;
}

/** Countdown to a future time: "1m 52s", or "now" when past. */
export function countdown(iso: string | null | undefined, now = Date.now()): string {
	if (!iso) return '';
	const s = (new Date(iso).getTime() - now) / 1000;
	if (s <= 0) return 'now';
	return duration(s);
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit'
});
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const shortDateTimeFmt = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	hour: '2-digit',
	minute: '2-digit'
});

/** "14 Mar 2023" */
export function date(iso: string | null | undefined): string {
	if (!iso) return '';
	return dateFmt.format(new Date(iso));
}

/** "3 Nov 2026, 14:02" */
export function dateTime(iso: string | null | undefined): string {
	if (!iso) return '';
	return dateTimeFmt.format(new Date(iso));
}

/** "3 Nov, 14:02" */
export function shortDateTime(iso: string | null | undefined): string {
	if (!iso) return '';
	return shortDateTimeFmt.format(new Date(iso));
}

/** "14:02:11" */
export function time(iso: string | null | undefined): string {
	if (!iso) return '';
	return timeFmt.format(new Date(iso));
}

export function firstName(name: string | null | undefined): string {
	return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

export function initials(name: string | null | undefined): string {
	const parts = (name ?? '')
		.replace(/[^\p{L}\p{N}\s.'-]/gu, '')
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	if (parts.length === 0) return '?';
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Seconds between two ISO timestamps. */
export function secondsBetween(a: string | null | undefined, b: string | null | undefined): number | null {
	if (!a || !b) return null;
	return Math.max(0, (new Date(b).getTime() - new Date(a).getTime()) / 1000);
}

/** Identity line for an account: display name in full, the primary email, then "+N more" (tooltip lists the rest). */
export function identityLine(name: string | null | undefined, emails: string[], skipName?: string | null): { text: string; title: string | undefined } {
	const parts = [name && name !== skipName ? name : null, ...emails].filter((p): p is string => !!p);
	const shown = parts.slice(0, 2);
	const rest = parts.slice(2);
	return { text: [...shown, ...(rest.length ? [`+${rest.length} more`] : [])].join(' · '), title: rest.length ? rest.join('\n') : undefined };
}
