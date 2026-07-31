import { z } from 'zod';

export const billFormSchema = z.object({
	vendorName: z.string().min(1, 'Vendor is required').max(160),
	number: z.string().min(1, 'Bill number is required').max(40),
	currency: z.enum(['GBP', 'USD', 'EUR']),
	dueOn: z.string().min(1, 'Due date is required'),
	status: z.enum(['draft', 'received', 'scheduled', 'paid', 'void'])
});

export type BillFormSchema = typeof billFormSchema;
export type BillFormData = z.infer<typeof billFormSchema>;
