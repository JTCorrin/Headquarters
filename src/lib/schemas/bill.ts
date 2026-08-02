import { z } from 'zod';

export const billFormSchema = z.object({
	vendorId: z.uuid('Select a vendor'),
	vendorName: z.string().max(160).optional().or(z.literal('')),
	number: z.string().min(1, 'Bill number is required').max(64),
	internalReference: z.string().max(64).optional().or(z.literal('')),
	currency: z.enum(['GBP', 'USD', 'EUR']),
	issueOn: z.string().optional().or(z.literal('')),
	/** Optional on draft; required server-side once status leaves draft (except void). */
	receivedOn: z.string().optional().or(z.literal('')),
	dueOn: z.string().min(1, 'Due date is required'),
	notes: z.string().max(4000).optional().or(z.literal('')),
	status: z.enum(['draft', 'received', 'scheduled', 'partial', 'paid', 'void'])
});

export type BillFormSchema = typeof billFormSchema;
export type BillFormData = z.infer<typeof billFormSchema>;

/** Row shape for the bills data table (UI-facing). */
export interface BillListItem {
	id: string;
	number: string;
	vendor: string;
	total: string;
	status: string;
	dueOn: string;
}
