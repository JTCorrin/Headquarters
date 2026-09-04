import { z } from 'zod';

const entityTypeSchema = z.enum(['lead', 'contact', 'client']);

/** Optional uuid field: empty string means unset (draft-friendly). */
const optionalUuid = z.union([z.literal(''), z.string().uuid()]);

export const campaignFormSchema = z.object({
	name: z.string().min(1, 'Name is required').max(200),
	/** Required to launch; optional while drafting. */
	template_id: optionalUuid,
	/** Required to launch; optional while drafting. */
	mailbox_id: optionalUuid,
	tag_ids: z.array(z.string().uuid()).default([]),
	entity_types: z.array(entityTypeSchema).min(1, 'Select at least one audience type'),
	scheduled_at: z.string().optional().or(z.literal(''))
});

export type CampaignFormSchema = typeof campaignFormSchema;
export type CampaignFormData = z.infer<typeof campaignFormSchema>;
