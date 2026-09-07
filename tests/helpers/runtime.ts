import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ runtimeErrors: void }>({
	runtimeErrors: [
		async ({ page }, use) => {
			const errors: string[] = [];
			page.on('pageerror', (error) => errors.push(error.message));
			await use();
			expect(errors, 'Unexpected browser runtime errors').toEqual([]);
		},
		{ auto: true }
	]
});
export { expect };
