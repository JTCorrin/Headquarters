/** Structured mention attached to a timeline note create payload. */
export interface TimelineMentionRef {
	membership_id: string;
	display_name: string;
}

export interface ActiveMentionQuery {
	/** Index of the `@` that started this query. */
	start: number;
	/** Text text after `@` (may be empty). */
	query: string;
}

/**
 * Detect an in-progress `@mention` query immediately before the caret.
 * Stops at whitespace so multi-word display names are inserted as a whole token.
 */
export function parseActiveMentionQuery(
	text: string,
	caret: number
): ActiveMentionQuery | null {
	if (caret < 0 || caret > text.length) return null;
	const before = text.slice(0, caret);
	const match = before.match(/@([^\s@]*)$/);
	if (!match || match.index === undefined) return null;
	return { start: match.index, query: match[1] ?? '' };
}

/** Insert `@Display Name` over the active `@query` range and place caret after it. */
export function insertMentionAtQuery(
	text: string,
	caret: number,
	start: number,
	displayName: string
): { text: string; caret: number } {
	const token = `@${displayName}`;
	const next = `${text.slice(0, start)}${token} ${text.slice(caret)}`;
	return { text: next, caret: start + token.length + 1 };
}

/** Keep only mentions whose `@Display Name` token still appears in the body. */
export function pruneMentionsByBody(
	body: string,
	mentions: TimelineMentionRef[]
): TimelineMentionRef[] {
	return mentions.filter((m) => body.includes(`@${m.display_name}`));
}

export function dedupeMentions(mentions: TimelineMentionRef[]): TimelineMentionRef[] {
	const seen = new Set<string>();
	const out: TimelineMentionRef[] = [];
	for (const m of mentions) {
		if (!m.membership_id || seen.has(m.membership_id)) continue;
		seen.add(m.membership_id);
		out.push(m);
	}
	return out;
}

export function filterMentionCandidates<T extends { display_name: string }>(
	members: T[],
	query: string
): T[] {
	const q = query.trim().toLowerCase();
	if (!q) return members;
	return members.filter((m) => m.display_name.toLowerCase().includes(q));
}
