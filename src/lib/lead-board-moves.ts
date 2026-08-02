import { computeBoardPosition } from '$lib/money.js';
import { leadStages, leadWritableStages } from '$lib/schemas/lead.js';

export type LeadBoardStage = (typeof leadStages)[number];

export interface LeadBoardMoveInput {
	id: string;
	stage: LeadBoardStage;
	position?: number | null;
}

export interface LeadBoardMoveResult {
	id: string;
	stage: LeadBoardStage;
	position: number;
	beforeId: string | null;
}

function sortedColumn(
	leads: LeadBoardMoveInput[],
	stage: LeadBoardStage
): LeadBoardMoveInput[] {
	return leads
		.filter((lead) => lead.stage === stage)
		.slice()
		.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/** Append a lead to the end of a writable stage (Won is convert-only). */
export function buildStageMove(
	leads: LeadBoardMoveInput[],
	id: string,
	stage: LeadBoardStage
): LeadBoardMoveResult | null {
	const current = leads.find((lead) => lead.id === id);
	if (!current) return null;
	if (current.stage === 'won') return null;
	if (!(leadWritableStages as readonly string[]).includes(stage)) return null;
	if (current.stage === stage) return null;

	const column = sortedColumn(leads, stage);
	const beforeId = null;
	const optimistic = [...column, { ...current, stage }];
	const position = computeBoardPosition(optimistic, beforeId, id);
	return { id, stage, position, beforeId };
}

/** Move one slot up/down within the current stage. */
export function buildReorderMove(
	leads: LeadBoardMoveInput[],
	id: string,
	direction: 'up' | 'down'
): LeadBoardMoveResult | null {
	const current = leads.find((lead) => lead.id === id);
	if (!current || current.stage === 'won') return null;

	const column = sortedColumn(leads, current.stage);
	const idx = column.findIndex((lead) => lead.id === id);
	if (idx < 0) return null;

	let beforeId: string | null;
	if (direction === 'up') {
		if (idx <= 0) return null;
		beforeId = column[idx - 1]!.id;
	} else {
		if (idx >= column.length - 1) return null;
		beforeId = column[idx + 2]?.id ?? null;
	}

	const position = computeBoardPosition(column, beforeId, id);
	return { id, stage: current.stage, position, beforeId };
}
