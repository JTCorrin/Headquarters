/** Mutable API for lead Kanban card move controls (set by `leads-board.svelte`). */
export type LeadBoardCardApi = {
	resolveLeadId: (encoded: string | number | null | undefined) => string | null;
	canMove: (leadId: string, direction: 'up' | 'down') => boolean;
	onReorder: (leadId: string, direction: 'up' | 'down') => void;
	isMovable: (leadId: string) => boolean;
};

export const leadBoardCardApi: { current: LeadBoardCardApi | null } = $state({
	current: null
});
