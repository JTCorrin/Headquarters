import { z } from 'zod';

export const vendorFormSchema = z.object({
	name: z.string().trim().min(1, 'Name is required').max(200)
});

export type VendorFormSchema = typeof vendorFormSchema;
export type VendorFormData = z.infer<typeof vendorFormSchema>;

export interface BillVendorOption {
	id: string;
	name: string;
	defaultCurrency?: string | null;
}
