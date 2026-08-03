import { z } from 'zod';
import type { ApiMeetingStatus } from '$lib/api/v1/types.js';

export const meetingAttendeeFormSchema = z.object({
	email: z.string().trim().email('Valid email is required').max(320),
	name: z.string().max(200).optional().or(z.literal('')),
	contactId: z.string().uuid().optional().or(z.literal('')),
	membershipId: z.string().uuid().optional().or(z.literal('')),
	organiser: z.boolean().optional()
});

export const meetingFormSchema = z
	.object({
		title: z.string().min(1, 'Title is required').max(200),
		startsAt: z.string().min(1, 'Start is required'),
		endsAt: z.string().min(1, 'End is required'),
		timezone: z.string().min(1, 'Timezone is required').max(64),
		location: z.string().max(500).optional().or(z.literal('')),
		meetingUrl: z.string().max(2000).optional().or(z.literal('')),
		relatedEntityType: z.enum(['none', 'client', 'contact', 'lead']),
		relatedEntityId: z.string().optional().or(z.literal('')),
		attendees: z.array(meetingAttendeeFormSchema).default([]),
		status: z.enum(['scheduled', 'in_progress', 'completed', 'cancelled'])
	})
	.superRefine((data, ctx) => {
		const hasType = data.relatedEntityType !== 'none';
		const hasId = Boolean(data.relatedEntityId?.trim());
		if (hasType !== hasId) {
			ctx.addIssue({
				code: 'custom',
				path: hasType ? ['relatedEntityId'] : ['relatedEntityType'],
				message: 'Related entity type and id must be set together'
			});
		}
		if (hasId) {
			const id = data.relatedEntityId!.trim();
			if (!z.string().uuid().safeParse(id).success) {
				ctx.addIssue({
					code: 'custom',
					path: ['relatedEntityId'],
					message: 'Related entity id must be a UUID'
				});
			}
		}
	});

export type MeetingFormSchema = typeof meetingFormSchema;
export type MeetingFormData = z.infer<typeof meetingFormSchema>;
export type MeetingAttendeeFormData = z.infer<typeof meetingAttendeeFormSchema>;

export interface MeetingListItem {
	id: string;
	title: string;
	when: string;
	withWhom: string;
	relatedTo: string;
	status: string;
	version: number;
	rawStatus: ApiMeetingStatus;
	startsAt: string;
	endsAt: string;
	timezone: string;
}
