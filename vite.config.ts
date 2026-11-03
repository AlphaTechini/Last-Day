import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			// SvelteKit 3 reads its config from this plugin call; svelte.config.js is no longer used.
			adapter: adapter(),
			// adapter-node 6 assumes https unless PROTOCOL_HEADER says otherwise, so plain http://localhost would fail the CSRF
			// origin check. Allow local http origins (and any extra, comma-separated, via CSRF_TRUSTED_ORIGINS at build time).
			csrf: {
				trustedOrigins: [
					'http://localhost:3300',
					'http://127.0.0.1:3300',
					...(process.env.CSRF_TRUSTED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
				]
			},
			preprocess: vitePreprocess(),
			compilerOptions: {
				// Runes mode for project code only; leave node_modules (libraries) alone.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			}
		})
	]
});
