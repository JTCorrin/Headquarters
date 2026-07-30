import { z } from 'zod';

export const quoteFormSchema = z.object({
	clientName: z.string().min(1, 'Client is required').max(160),
	title: z.string().min(1, 'Title is required').max(160),
	currency: z.enum(['GBP', 'USD', 'EUR']),
	lineDescription: z.string().min(1, 'Line description is required').max(200),
	qty: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Enter a quantity'),
	unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Use a number like 12.50'),
	status: z.enum(['draft', 'sent', 'accepted', 'rejected'])
});

export type QuoteFormSchema = typeof quoteFormSchema;
export type QuoteFormData = z.infer<typeof quoteFormSchema>;
