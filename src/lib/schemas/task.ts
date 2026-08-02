import { z } from 'zod';

export const taskPriorities = ['p1', 'p2', 'p3', 'p4'] as const;
export type TaskPriority = (typeof taskPriorities)[number];

export const taskStatuses = [
	'open',
	'in_progress',
	'blocked',
	'done',
	'cancelled'
] as const;
export type TaskStatus = (typeof taskStatuses)[number];

/** Board columns omit cancelled — matches Storybook kanban shell. */
export const taskBoardStatuses = ['open', 'in_progress', 'blocked', 'done'] as const;
export type TaskBoardStatus = (typeof taskBoardStatuses)[number];

export const taskFormSchema = z.object({
	title: z.string().min(1, 'Title is required').max(200),
	description: z.string().max(4000).optional().or(z.literal('')),
	priority: z.enum(taskPriorities),
	status: z.enum(taskStatuses),
	assigneeMembershipId: z.string().optional().or(z.literal('')),
	dueOn: z.string().optional().or(z.literal(''))
});

export type TaskFormSchema = typeof taskFormSchema;
export type TaskFormData = z.infer<typeof taskFormSchema>;

export interface TaskAssigneeOption {
	id: string;
	label: string;
}

/** Row shape for the tasks data table (UI-facing). */
export interface TaskListItem {
	id: string;
	title: string;
	relatedTo: string;
	owner: string;
	status: string;
	priority: string;
	dueOn: string;
	version: number;
	assigneeMembershipId: string | null;
	rawStatus: TaskStatus;
	rawPriority: TaskPriority;
	description: string;
	dueAt: string | null;
	position: number;
}
