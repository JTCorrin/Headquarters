import { z } from 'zod';

export const contactFormSchema = z.object({
	name: z.string().min(1, 'Name is required').max(120),
	email: z.email('Enter a valid email'),
	phone: z.string().max(40).optional().or(z.literal('')),
	company: z.string().max(120).optional().or(z.literal('')),
	title: z.string().max(120).optional().or(z.literal('')),
	status: z.enum(['contact', 'lead', 'client'])
});

export type ContactFormSchema = typeof contactFormSchema;
export type ContactFormData = z.infer<typeof contactFormSchema>;
