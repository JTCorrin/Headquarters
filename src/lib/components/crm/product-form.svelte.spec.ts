import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import ProductFormStoryHost from './product-form.story-host.svelte';

const CATEGORY_ID = 'cccccccc-cccc-4ddd-8eee-ffffffffffff';
const NEW_CATEGORY_ID = 'dddddddd-dddd-4eee-8fff-000000000001';

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

	it('creates a category by name, appends it, and selects it', async () => {
		const onCreateCategory = vi.fn(async (name: string) => ({
			id: NEW_CATEGORY_ID,
			label: name
		}));

		render(ProductFormStoryHost, {
			categoryOptions: [],
			onCreateCategory
		});

		await expect.element(page.getByTestId('product-new-category-input')).toBeInTheDocument();
		await page.getByTestId('product-new-category-input').fill('Services');
		await page.getByTestId('product-new-category-add').click();

		await expect.poll(() => onCreateCategory.mock.calls.length).toBe(1);
		expect(onCreateCategory).toHaveBeenCalledWith('Services');
		await expect.element(page.getByTestId('product-category-trigger')).toHaveTextContent('Services');
	});
});
