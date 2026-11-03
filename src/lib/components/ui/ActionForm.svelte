<script lang="ts">
	// A SvelteKit form action wrapper: <form method="POST" action="?/name" use:enhance>
	// with a pending state, success / error toasts, and a no-op in the dev preview.
	import type { Snippet } from 'svelte';
	import type { HTMLFormAttributes } from 'svelte/elements';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { toast } from '#lib/ui/toast.svelte.ts';
	import { isPreviewMode } from '#lib/ui/context.ts';

	interface Props extends Omit<HTMLFormAttributes, 'action' | 'method' | 'children'> {
		/** Action name, e.g. "approve" posts to ?/approve. */
		action: string;
		/** Reset fields after success (default false: most of our forms are buttons). */
		reset?: boolean;
		/** Toast on success. String, or true to use the server's message. */
		successToast?: string | boolean;
		/** Toast server errors too (in addition to the page's inline error). */
		errorToast?: boolean;
		onsuccess?: (data: Record<string, unknown> | undefined) => void;
		onfailure?: (data: Record<string, unknown> | undefined) => void;
		/** Called before submit; return false to cancel. */
		onbefore?: (formData: FormData) => boolean | void;
		children: Snippet<[{ pending: boolean; submitter: string | null }]>;
	}

	let {
		action,
		reset = false,
		successToast = true,
		errorToast = false,
		onsuccess,
		onfailure,
		onbefore,
		children,
		...rest
	}: Props = $props();

	const preview = isPreviewMode();
	let pending = $state(false);
	let submitter = $state<string | null>(null);

	const submit: SubmitFunction = ({ cancel, formData, submitter: btn }) => {
		if (onbefore && onbefore(formData) === false) {
			cancel();
			return;
		}
		const which =
			btn?.getAttribute('formaction')?.replace(/^\?\//, '') ?? (btn as HTMLButtonElement | null)?.value ?? action;
		if (preview) {
			cancel();
			pending = true;
			submitter = which;
			setTimeout(() => {
				pending = false;
				submitter = null;
				toast.info('Preview only', `The "${which}" action is not wired up in the design preview.`);
			}, 900);
			return;
		}
		pending = true;
		submitter = which;
		return async ({ result, update }) => {
			try {
				await update({ reset });
				if (result.type === 'success') {
					const data = result.data as Record<string, unknown> | undefined;
					const msg = typeof data?.message === 'string' ? data.message : null;
					if (typeof successToast === 'string') toast.success(successToast, msg ?? undefined);
					else if (successToast && msg) toast.success(msg);
					onsuccess?.(data);
				} else if (result.type === 'failure') {
					const data = result.data as Record<string, unknown> | undefined;
					if (errorToast && typeof data?.error === 'string') toast.error('That did not work', data.error);
					onfailure?.(data);
				} else if (result.type === 'error') {
					toast.error('Something went wrong', result.error?.message ?? 'Please try again.');
				}
			} finally {
				pending = false;
				submitter = null;
			}
		};
	};
</script>

<form method="POST" action="?/{action}" use:enhance={submit} aria-busy={pending || undefined} {...rest}>
	{@render children({ pending, submitter })}
</form>
