import { z } from 'zod';

export const quoteFormSchema = z.object({
	clientName: z.string().min(1, 'Client is required').max(160),
	title: z.string().min(1, 'Title is required').max(160),
	currency: z.enum(['GBP', 'USD', 'EUR']),
	status: z.enum(['draft', 'sent', 'accepted', 'rejected'])
});

export type QuoteFormSchema = typeof quoteFormSchema;
export type QuoteFormData = z.infer<typeof quoteFormSchema>;
