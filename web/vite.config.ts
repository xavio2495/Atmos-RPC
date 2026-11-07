import { mdsvex } from 'mdsvex';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig, type Plugin } from 'vite';
const repo = decodeURIComponent(new URL('../', import.meta.url).pathname);
const sdk = repo + 'sdk/';

// The demo imports the SDK from the repository (sdk/ and client/), whose packages are
// installed in sdk/node_modules: bare imports from those files resolve from there.
function sdkDependencies(): Plugin {
	return {
		name: 'atmos-sdk-dependencies',
		enforce: 'pre',
		async resolveId(id, importer) {
			if (!importer || /^[./\\\0]/.test(id) || id.includes(':')) return null;
			const inRepoCode = importer.startsWith(repo + 'client/') || (importer.startsWith(sdk) && !importer.includes('node_modules'));
			return inRepoCode ? this.resolve(id, sdk + 'index.js', { skipSelf: true }) : null;
		}
	};
}

export default defineConfig({
	resolve: { alias: { 'atmos-rpc': sdk + 'index.js' } },
	server: { fs: { allow: [repo + 'sdk', repo + 'client'] } },
	plugins: [
		sdkDependencies(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter(),
			preprocess: [mdsvex({ extensions: ['.svx'] })],
			extensions: ['.svelte', '.svx']
		})
	]
});
