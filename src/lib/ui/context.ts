// Context keys shared by the shell, pages and the dev preview.
import { getContext, setContext } from 'svelte';

const PREVIEW = Symbol('last-day:preview');

/** The dev preview sets this so forms do not post to routes that do not exist there. */
export function setPreviewMode(on: boolean) {
	setContext(PREVIEW, on);
}

export function isPreviewMode(): boolean {
	return getContext<boolean | undefined>(PREVIEW) ?? false;
}
