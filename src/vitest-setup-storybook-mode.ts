/** Enable sveltekit-superforms Storybook-safe page handling under Vitest. */
(globalThis as typeof globalThis & { STORIES?: boolean }).STORIES = true;
