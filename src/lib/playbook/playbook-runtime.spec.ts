import { describe, expect, it } from 'vitest';

/** Mirror of supabase/functions/_shared/playbook-runtime waitDurationMs for unit coverage. */
function waitDurationMs(data: { duration?: number; unit?: string }): number {
	const duration = Number(data.duration);
	const unit = String(data.unit ?? '');
	if (!Number.isFinite(duration) || duration <= 0) return 0;
	if (unit === 'minutes') return duration * 60_000;
	if (unit === 'hours') return duration * 3_600_000;
	if (unit === 'days') return duration * 86_400_000;
	return 0;
}

describe('waitDurationMs', () => {
	it('computes day waits', () => {
		expect(waitDurationMs({ duration: 2, unit: 'days' })).toBe(2 * 86_400_000);
	});
	it('rejects invalid', () => {
		expect(waitDurationMs({ duration: 0, unit: 'hours' })).toBe(0);
	});
});
