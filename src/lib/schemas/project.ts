import { z } from 'zod';
import type { ApiProjectStatus } from '$lib/api/v1/types.js';

export const projectBoardStatuses = ['planning', 'active', 'blocked', 'done'] as const;
export type ProjectBoardStatus = (typeof projectBoardStatuses)[number];

export const projectFormSchema = z.object({
	name: z.string().min(1, 'Name is required').max(200),
	clientId: z.string().uuid('Client is required'),
	description: z.string().max(2000).optional().or(z.literal('')),
	status: z.enum(['planning', 'active', 'blocked', 'done'])
});

export type ProjectFormSchema = typeof projectFormSchema;
export type ProjectFormData = z.infer<typeof projectFormSchema>;

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
