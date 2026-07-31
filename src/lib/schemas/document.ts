import { z } from 'zod';

export const documentFormSchema = z.object({
	name: z.string().min(1, 'Name is required').max(160),
	category: z.enum(['contract', 'proposal', 'invoice', 'receipt', 'other']),
	notes: z.string().max(500).optional().or(z.literal(''))
});

export type DocumentFormSchema = typeof documentFormSchema;
export type DocumentFormData = z.infer<typeof documentFormSchema>;
