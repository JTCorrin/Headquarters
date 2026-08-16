/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';

import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';

const dirname =
	typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// CJS / Storybook browser deps that must be prebundled (Vitest browser serves them raw otherwise).
const browserOptimizeDepsInclude = [
	'storybook/test',
	'@testing-library/dom',
	'aria-query',
	'lz-string',
	'pretty-format',
	'@storybook/addon-themes',
	'@storybook/addon-vitest/internal/setup-file',
	'@storybook/addon-vitest/internal/setup-file.browser.4',
	'@storybook/addon-vitest/internal/global-setup',
	'@storybook/addon-vitest/internal/test-utils',
	'storybook/preview-api',
	'@svar-ui/svelte-kanban',
	'bits-ui',
	'zod',
	'tailwind-merge',
	'tailwind-variants',
	'sveltekit-superforms',
	'sveltekit-superforms/adapters',
	'pdfmake-html-renderer',
	'pdfmake/build/pdfmake',
	'pdfmake/build/vfs_fonts',
	'vaul-svelte',
	'@lucide/svelte/icons/arrow-left'
];

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
	optimizeDeps: {
		include: browserOptimizeDepsInclude
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			alias: {
				'@/*': './src/lib/*'
			},

			// Node adapter for Railway (and similar Node hosts).
			// See https://svelte.dev/docs/kit/adapter-node
			adapter: adapter()
		})
	],
	test: {
		expect: { requireAssertions: true },
		coverage: {
			provider: 'v8',
			thresholds: {
				statements: 60,
				branches: 40,
				functions: 55,
				lines: 60
			}
		},
		// Keep Vitest projects from overlapping browser Vite servers / optimizeDeps caches.
		fileParallelism: false,
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					setupFiles: ['./src/vitest-setup-storybook-mode.ts'],
					fileParallelism: false,
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }],
						fileParallelism: false
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			},

			{
				extends: true,
				plugins: [storybookTest({ configDir: path.join(dirname, '.storybook') })],
				optimizeDeps: {
					// Storybook CSF virtual modules keep `import type` in scanned entries; Rolldown's
					// dep scanner parses those as JS and fails (`Expected from but found {`), which
					// skips prebundling and races the client browser project on a cold CI cache.
					// Pin includes and disable discovery so stories are never crawled by Rolldown.
					noDiscovery: true,
					include: browserOptimizeDepsInclude
				},
				test: {
					name: 'storybook',
					setupFiles: ['./src/vitest-setup-storybook-mode.ts'],
					fileParallelism: false,
					browser: {
						enabled: true,
						headless: true,
						provider: playwright({}),
						instances: [{ browser: 'chromium' }],
						fileParallelism: false
					}
				}
			}
		]
	}
});
