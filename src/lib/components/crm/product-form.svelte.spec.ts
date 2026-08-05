import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import ProductFormStoryHost from './product-form.story-host.svelte';

const CATEGORY_ID = 'cccccccc-cccc-4ddd-8eee-ffffffffffff';

describe('ProductForm category', () => {
	it('exposes a category select and shows the chosen catalog category', async () => {
		render(ProductFormStoryHost, {
			categoryOptions: [{ id: CATEGORY_ID, label: 'Widgets' }]
		});

		const trigger = page.getByTestId('product-category-trigger');
		await expect.element(trigger).toBeInTheDocument();
		await expect.element(trigger).toHaveTextContent('No category');

		await trigger.click();
		await page.getByRole('option', { name: 'Widgets' }).click();

		await expect.element(trigger).toHaveTextContent('Widgets');
	});
});
