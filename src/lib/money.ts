/** Convert integer minor units to a decimal display string (trim trailing zeros). */
export function centsToAmountString(cents: number | null | undefined): string {
	if (cents == null || !Number.isFinite(cents)) return '';
	const major = cents / 100;
	if (Number.isInteger(major)) return String(major);
	return major.toFixed(2).replace(/0$/, '').replace(/\.$/, '');
}

/**
 * Parse a user-entered decimal money string into integer minor units.
 * Accepts optional thousands separators and up to 2 decimal places.
 * Returns null for empty input; throws on invalid.
 */
export function amountStringToCents(value: string | null | undefined): number | null {
	if (value == null) return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	const normalized = trimmed.replace(/,/g, '');
	if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
		throw new Error('Invalid money amount');
	}
	const [whole, frac = ''] = normalized.split('.');
	const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
	if (!Number.isSafeInteger(cents) || cents < 0) {
		throw new Error('Invalid money amount');
	}
	return cents;
}

export function isValidAmountString(value: string | null | undefined): boolean {
	try {
		amountStringToCents(value);
		return true;
	} catch {
		return false;
	}
}

export function currencySymbol(code: string): string {
	try {
		const parts = new Intl.NumberFormat('en-GB', {
			style: 'currency',
			currency: code,
			currencyDisplay: 'narrowSymbol'
		}).formatToParts(0);
		return parts.find((p) => p.type === 'currency')?.value ?? code;
	} catch {
		return code;
	}
}

/** Resolve lead currency: selected client default → org default → GBP. */
export function resolveLeadCurrency(options: {
	clientCurrency?: string | null;
	orgCurrency?: string | null;
}): string {
	const client = options.clientCurrency?.trim().toUpperCase();
	if (client && /^[A-Z]{3}$/.test(client)) return client;
	const org = options.orgCurrency?.trim().toUpperCase();
	if (org && /^[A-Z]{3}$/.test(org)) return org;
	return 'GBP';
}

/**
 * Compute a fractional board position for inserting `movingId` into `columnLeads`
 * immediately before `beforeId` (or at the end when beforeId is null).
 */
export function computeBoardPosition(
	columnLeads: { id: string; position?: number | null }[],
	beforeId: string | null,
	movingId: string
): number {
	const others = columnLeads
		.filter((lead) => lead.id !== movingId)
		.slice()
		.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

	if (others.length === 0) return 0;

	if (beforeId == null) {
		return (others[others.length - 1]!.position ?? 0) + 1000;
	}

	const beforeIdx = others.findIndex((lead) => lead.id === beforeId);
	if (beforeIdx <= 0) {
		return (others[0]!.position ?? 0) - 1000;
	}

	const prev = others[beforeIdx - 1]!.position ?? 0;
	const next = others[beforeIdx]!.position ?? prev + 1000;
	return (prev + next) / 2;
}
