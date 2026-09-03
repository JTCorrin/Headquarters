import { z } from 'zod';

const entityTypeSchema = z.enum(['lead', 'contact', 'client']);

export const campaignFormSchema = z.object({
	name: z.string().min(1, 'Name is required').max(200),
	template_id: z.string().min(1, 'Select a template').uuid('Select a template'),
	mailbox_id: z.string().min(1, 'Select a mailbox').uuid('Select a mailbox'),
	tag_ids: z.array(z.string().uuid()).default([]),
	entity_types: z.array(entityTypeSchema).min(1, 'Select at least one audience type'),
	scheduled_at: z.string().optional().or(z.literal(''))
});

export type CampaignFormSchema = typeof campaignFormSchema;
export type CampaignFormData = z.infer<typeof campaignFormSchema>;
