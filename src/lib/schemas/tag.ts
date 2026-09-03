import { z } from 'zod';

export const tagFormSchema = z.object({
	name: z.string().min(1, 'Name is required').max(80),
	color: z.string().max(32).optional().or(z.literal(''))
});

export type TagFormSchema = typeof tagFormSchema;
export type TagFormData = z.infer<typeof tagFormSchema>;
