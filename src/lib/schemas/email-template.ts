import { z } from 'zod';

export const emailTemplateFormSchema = z.object({
	name: z.string().min(1, 'Name is required').max(160),
	subject: z.string().min(1, 'Subject is required').max(200),
	body: z.string().min(1, 'Body is required').max(8000),
	category: z.enum(['transactional', 'campaign', 'chase', 'onboarding', 'other']),
	status: z.enum(['draft', 'active', 'archived'])
});

export type EmailTemplateFormSchema = typeof emailTemplateFormSchema;
export type EmailTemplateFormData = z.infer<typeof emailTemplateFormSchema>;
