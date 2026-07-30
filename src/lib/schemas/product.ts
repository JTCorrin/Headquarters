import { z } from 'zod';

export const productFormSchema = z.object({
	sku: z.string().min(1, 'SKU is required').max(64),
	name: z.string().min(1, 'Name is required').max(160),
	description: z.string().max(2000).optional().or(z.literal('')),
	unitPrice: z
		.string()
		.min(1, 'Unit price is required')
		.regex(/^\d+(\.\d{1,2})?$/, 'Use a number like 12.50'),
	trackStock: z.boolean(),
	stockQty: z
		.string()
		.optional()
		.or(z.literal(''))
		.refine((v) => v === undefined || v === '' || /^\d+$/.test(v), 'Stock must be a whole number'),
	status: z.enum(['active', 'archived'])
});

export type ProductFormSchema = typeof productFormSchema;
export type ProductFormData = z.infer<typeof productFormSchema>;
