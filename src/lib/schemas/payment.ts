import { z } from 'zod';

export const paymentFormSchema = z.object({
	clientName: z.string().min(1, 'Client is required').max(160),
	invoiceNumber: z.string().max(40).optional().or(z.literal('')),
	amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Use a number like 12.50'),
	currency: z.enum(['GBP', 'USD', 'EUR']),
	method: z.enum(['bank', 'card', 'cash', 'other']),
	receivedOn: z.string().min(1, 'Received date is required'),
	reference: z.string().max(120).optional().or(z.literal('')),
	status: z.enum(['pending', 'matched', 'unallocated', 'refunded'])
});

export type PaymentFormSchema = typeof paymentFormSchema;
export type PaymentFormData = z.infer<typeof paymentFormSchema>;
