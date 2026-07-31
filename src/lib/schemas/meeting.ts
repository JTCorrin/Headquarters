import { z } from 'zod';

export const meetingFormSchema = z.object({
	title: z.string().min(1, 'Title is required').max(160),
	relatedTo: z.string().max(160).optional().or(z.literal('')),
	startsAt: z.string().min(1, 'Start is required'),
	endsAt: z.string().min(1, 'End is required'),
	attendees: z.string().max(500).optional().or(z.literal('')),
	status: z.enum(['scheduled', 'completed', 'cancelled'])
});

export type MeetingFormSchema = typeof meetingFormSchema;
export type MeetingFormData = z.infer<typeof meetingFormSchema>;
