// Theme preference: 'system' follows prefers-color-scheme; 'light'/'dark' set [data-theme] on <html>.
// app.html applies the stored value before first paint.

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'lastday.theme';

export function readTheme(): ThemePref {
	try {
		const v = localStorage.getItem(KEY);
		return v === 'light' || v === 'dark' ? v : 'system';
	} catch {
		return 'system';
	}
}

export function applyTheme(pref: ThemePref) {
	const root = document.documentElement;
	if (pref === 'system') root.removeAttribute('data-theme');
	else root.setAttribute('data-theme', pref);
	try {
		if (pref === 'system') localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, pref);
	} catch {
		/* storage blocked: preference lasts for this page only */
	}
}
