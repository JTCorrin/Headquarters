import { z } from 'zod';
import type { ApiProjectStatus } from '$lib/api/v1/types.js';

export const projectBoardStatuses = ['planning', 'active', 'blocked', 'done'] as const;
export type ProjectBoardStatus = (typeof projectBoardStatuses)[number];

export const projectFormStatuses = [
	'planning',
	'active',
	'blocked',
	'done',
	'archived'
] as const;
export type ProjectFormStatus = (typeof projectFormStatuses)[number];

/** Form/select sentinel for a project that is not attached to a client. */
export const INTERNAL_PROJECT_CLIENT_ID = 'internal';
export const INTERNAL_PROJECT_LABEL = 'Internal';

export function isInternalProjectClientId(clientId: string | null | undefined): boolean {
	return !clientId || clientId === INTERNAL_PROJECT_CLIENT_ID;
}

export function projectClientDisplayName(project: {
	client_id: string | null;
	client_label?: string | null;
}): string {
	if (!project.client_id) return INTERNAL_PROJECT_LABEL;
	return project.client_label?.trim() || 'Client';
}

export const projectFormSchema = z.object({
	name: z.string().min(1, 'Name is required').max(200),
	clientId: z
		.string()
		.min(1, 'Select Internal or a client')
		.refine(
			(value) => value === INTERNAL_PROJECT_CLIENT_ID || z.uuid().safeParse(value).success,
			'Select Internal or a client'
		),
	description: z.string().max(2000).optional().or(z.literal('')),
	status: z.enum(projectFormStatuses)
});

export type ProjectFormSchema = typeof projectFormSchema;
export type ProjectFormData = z.infer<typeof projectFormSchema>;

export const projectCardFormSchema = z.object({
	title: z.string().min(1, 'Title is required').max(200),
	description: z.string().max(4000).optional().or(z.literal('')),
	dueAt: z.string().optional().or(z.literal(''))
});

export type ProjectCardFormSchema = typeof projectCardFormSchema;
export type ProjectCardFormData = z.infer<typeof projectCardFormSchema>;

export interface ProjectListItem {
	id: string;
	name: string;
	clientId: string;
	clientName: string;
	owner?: string;
	cardCount?: number;
	stage: ProjectBoardStatus;
	version: number;
	position: number;
	rawStatus: ApiProjectStatus;
}
