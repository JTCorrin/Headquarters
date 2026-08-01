import { z } from 'zod';

export const contactLifecycleStatuses = ['active', 'inactive', 'archived'] as const;

export const contactFormSchema = z.object({
	name: z.string().min(1, 'Name is required').max(200),
	email: z.email('Enter a valid email').or(z.literal('')),
	phone: z.string().max(64).optional().or(z.literal('')),
	company: z.string().max(200).optional().or(z.literal('')),
	title: z.string().max(200).optional().or(z.literal('')),
	status: z.enum(contactLifecycleStatuses)
});

export type ContactFormSchema = typeof contactFormSchema;
export type ContactFormData = z.infer<typeof contactFormSchema>;
export type ContactLifecycleStatus = (typeof contactLifecycleStatuses)[number];

/** Row shape for the contacts data table (UI-facing). */
export interface ContactListItem {
	id: string;
	name: string;
	email: string;
	company?: string;
	status: string;
	owner?: string;
}
