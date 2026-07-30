import { z } from 'zod';

export const lineItemFormSchema = z.object({
	productId: z.string().optional().or(z.literal('')),
	description: z.string().min(1, 'Description is required').max(200),
	qty: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a quantity'),
	unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Use a number like 12.50')
});

export type LineItemFormSchema = typeof lineItemFormSchema;
export type LineItemFormData = z.infer<typeof lineItemFormSchema>;

export interface CatalogProductOption {
	id: string;
	sku: string;
	name: string;
	unitPrice: string;
}
