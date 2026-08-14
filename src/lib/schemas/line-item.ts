import { z } from 'zod';

export const lineItemFormSchema = z.object({
	productId: z.string().optional().or(z.literal('')),
	description: z.string().min(1, 'Description is required').max(200),
	qty: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a quantity'),
	unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Use a number like 12.50'),
	discountPercent: z
		.string()
		.optional()
		.or(z.literal(''))
		.refine(
			(v) => v === undefined || v === '' || (/^\d+(\.\d{1,4})?$/.test(v) && Number(v) <= 100),
			'Discount must be between 0 and 100'
		),
	taxRatePercent: z
		.string()
		.optional()
		.or(z.literal(''))
		.refine(
			(v) => v === undefined || v === '' || (/^\d+(\.\d{1,4})?$/.test(v) && Number(v) <= 100),
			'Tax must be between 0 and 100'
		)
});

export type LineItemFormSchema = typeof lineItemFormSchema;
export type LineItemFormData = z.infer<typeof lineItemFormSchema>;

export interface CatalogProductOption {
	id: string;
	sku: string;
	name: string;
	unitPrice: string;
	/** Resolved % from product.tax_rate_id when available. */
	taxRatePercent?: string;
	taxRateId?: string | null;
}

/** Org default active tax rate %, or `'0'` when none. */
export function defaultTaxRatePercentString(
	rates: { rate_percent: number; is_default: boolean; active: boolean; deleted_at?: string | null }[]
): string {
	const active = rates.filter((r) => r.active && !r.deleted_at);
	const def = active.find((r) => r.is_default);
	if (def) return String(def.rate_percent);
	if (active[0]) return String(active[0].rate_percent);
	return '0';
}
