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

export const projectFormSchema = z.object({
	name: z.string().min(1, 'Name is required').max(200),
	clientId: z.string().uuid('Client is required'),
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
