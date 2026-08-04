/** Fresh Idempotency-Key for mutating API commands that require one. */
export function newIdempotencyKey(prefix = 'idem'): string {
	return typeof crypto !== 'undefined' && 'randomUUID' in crypto
		? crypto.randomUUID()
		: `${prefix}-${Date.now()}`;
}
