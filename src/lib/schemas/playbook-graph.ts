import { z } from 'zod';

/** Trigger kinds for v1 Playbooks (see PLANS/CRM_PLAYBOOKS_TRIGGERS_ACTIONS.md). */
export const playbookTriggerKindSchema = z.enum([
	'email.received',
	'invoice.outstanding_days',
	'payment.received',
	'invoice.sent',
	'schedule.cron',
	'manual.run'
]);

export const playbookTriggerNodeDataSchema = z.object({
	kind: playbookTriggerKindSchema,
	/** Kind-specific config (filters, N days, cron, etc.). Opaque in Phase A. */
	config: z.record(z.string(), z.unknown()).default({})
});

export const playbookWaitNodeDataSchema = z.object({
	duration: z.number().positive('Duration must be positive'),
	unit: z.enum(['minutes', 'hours', 'days'])
});

export const playbookWaitUntilNodeDataSchema = z.object({
	/** Local time HH:mm (24h). */
	time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be HH:mm'),
	/** IANA timezone; empty means org default at runtime. */
	timezone: z.string().default('')
});

export const playbookEmailSendNodeDataSchema = z.object({
	templateId: z.string(),
	mailboxId: z.string().default(''),
	/** to: entity primary | related contact | fixed — opaque string for Phase A. */
	to: z.string().default('entity_primary')
});

export const playbookTaskCreateNodeDataSchema = z.object({
	title: z.string().default(''),
	description: z.string().default(''),
	assigneeMembershipId: z.string().default(''),
	priority: z.enum(['p1', 'p2', 'p3', 'p4']).default('p3'),
	dueOffsetDays: z.number().int().nonnegative().default(0)
});

export const playbookTimelineNoteNodeDataSchema = z.object({
	kind: z.string().default('note'),
	body: z.string().default('')
});

export const playbookNotificationCreateNodeDataSchema = z.object({
	title: z.string().default(''),
	body: z.string().default(''),
	/** Membership ids; empty = entity owner at runtime. */
	recipientMembershipIds: z.array(z.string()).default([])
});

export const playbookStopNodeDataSchema = z.object({
	reason: z.string().default('')
});

export const playbookLoopRelatedNodeDataSchema = z.object({
	relation: z.enum(['client.contacts'])
});

export const playbookNodeTypeSchema = z.enum([
	'trigger',
	'wait',
	'waitUntil',
	'emailSend',
	'taskCreate',
	'timelineNote',
	'notificationCreate',
	'playbookStop',
	'loopRelated'
]);

const positionSchema = z.object({
	x: z.number(),
	y: z.number()
});

export const playbookGraphNodeSchema = z.discriminatedUnion('type', [
	z.object({
		id: z.string().min(1),
		type: z.literal('trigger'),
		position: positionSchema,
		data: playbookTriggerNodeDataSchema
	}),
	z.object({
		id: z.string().min(1),
		type: z.literal('wait'),
		position: positionSchema,
		data: playbookWaitNodeDataSchema
	}),
	z.object({
		id: z.string().min(1),
		type: z.literal('waitUntil'),
		position: positionSchema,
		data: playbookWaitUntilNodeDataSchema
	}),
	z.object({
		id: z.string().min(1),
		type: z.literal('emailSend'),
		position: positionSchema,
		data: playbookEmailSendNodeDataSchema
	}),
	z.object({
		id: z.string().min(1),
		type: z.literal('taskCreate'),
		position: positionSchema,
		data: playbookTaskCreateNodeDataSchema
	}),
	z.object({
		id: z.string().min(1),
		type: z.literal('timelineNote'),
		position: positionSchema,
		data: playbookTimelineNoteNodeDataSchema
	}),
	z.object({
		id: z.string().min(1),
		type: z.literal('notificationCreate'),
		position: positionSchema,
		data: playbookNotificationCreateNodeDataSchema
	}),
	z.object({
		id: z.string().min(1),
		type: z.literal('playbookStop'),
		position: positionSchema,
		data: playbookStopNodeDataSchema
	}),
	z.object({
		id: z.string().min(1),
		type: z.literal('loopRelated'),
		position: positionSchema,
		data: playbookLoopRelatedNodeDataSchema
	})
]);

export const playbookGraphEdgeSchema = z.object({
	id: z.string().min(1),
	source: z.string().min(1),
	target: z.string().min(1)
});

export const playbookGraphSchema = z.object({
	nodes: z.array(playbookGraphNodeSchema).min(1, 'Graph must contain at least one node'),
	edges: z.array(playbookGraphEdgeSchema)
});

export type PlaybookGraph = z.infer<typeof playbookGraphSchema>;
export type PlaybookGraphNode = z.infer<typeof playbookGraphNodeSchema>;
export type PlaybookGraphEdge = z.infer<typeof playbookGraphEdgeSchema>;
export type PlaybookTriggerKind = z.infer<typeof playbookTriggerKindSchema>;
