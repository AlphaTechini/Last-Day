import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			// SvelteKit 3 reads its config from this plugin call; svelte.config.js is no longer used.
			adapter: adapter(),
			preprocess: vitePreprocess(),
			compilerOptions: {
				// Runes mode for project code only; leave node_modules (libraries) alone.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			}
		})
	]
});
