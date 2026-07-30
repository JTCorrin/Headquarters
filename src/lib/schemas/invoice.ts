import { z } from 'zod';

export const invoiceFormSchema = z.object({
	clientName: z.string().min(1, 'Client is required').max(160),
	number: z.string().min(1, 'Invoice number is required').max(40),
	currency: z.enum(['GBP', 'USD', 'EUR']),
	lineDescription: z.string().min(1, 'Line description is required').max(200),
	qty: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a quantity'),
	unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Use a number like 12.50'),
	dueOn: z.string().min(1, 'Due date is required'),
	status: z.enum(['draft', 'sent', 'partial', 'paid', 'void'])
});

export type InvoiceFormSchema = typeof invoiceFormSchema;
export type InvoiceFormData = z.infer<typeof invoiceFormSchema>;
