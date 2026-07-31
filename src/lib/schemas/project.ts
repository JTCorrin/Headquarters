import { z } from 'zod';

export const projectFormSchema = z.object({
	name: z.string().min(1, 'Name is required').max(160),
	clientId: z.string().min(1, 'Client is required'),
	description: z.string().max(2000).optional().or(z.literal('')),
	owner: z.string().max(120).optional().or(z.literal('')),
	status: z.enum(['planning', 'active', 'blocked', 'done'])
});

export type ProjectFormSchema = typeof projectFormSchema;
export type ProjectFormData = z.infer<typeof projectFormSchema>;
