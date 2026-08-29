import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';

export function isHostedBillingEnabled(): boolean {
	const flag = (publicEnv.PUBLIC_HOSTED_BILLING ?? '').trim().toLowerCase();
	return flag === '1' || flag === 'true' || flag === 'yes';
}

export function billingApiBaseUrl(): string | null {
	const url = (publicEnv.PUBLIC_BILLING_API_URL ?? '').trim().replace(/\/$/, '');
	return url || null;
}

export interface HostedClaimLookup {
	id: string;
	email: string | null;
	status: string;
	claim_expires_at: string;
	expired: boolean;
	already_claimed: boolean;
	usable: boolean;
	seats_included: number;
}

export async function lookupHostedClaim(token: string): Promise<HostedClaimLookup | null> {
	const base = billingApiBaseUrl();
	if (!base) return null;
	const res = await fetch(`${base}/v1/claim?token=${encodeURIComponent(token)}`, {
		headers: { Accept: 'application/json' }
	});
	if (res.status === 404) return null;
	if (!res.ok) {
		throw new Error(`Claim lookup failed (${res.status})`);
	}
	return (await res.json()) as HostedClaimLookup;
}

export async function claimHostedSubscription(input: {
	token: string;
	userId: string;
	email: string;
}): Promise<{ ok: boolean; error?: string; status?: number }> {
	const base = billingApiBaseUrl();
	const secret = (privateEnv.BILLING_CLAIM_SECRET ?? '').trim();
	if (!base || !secret) {
		return { ok: false, error: 'Billing is not configured', status: 503 };
	}

	const res = await fetch(`${base}/v1/claim`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-claim-secret': secret
		},
		body: JSON.stringify({
			token: input.token,
			user_id: input.userId,
			email: input.email
		})
	});

	if (res.ok) {
		return { ok: true };
	}

	const data = (await res.json().catch(() => ({}))) as { error?: string };
	return { ok: false, error: data.error ?? 'Claim failed', status: res.status };
}

export async function hostedEntitlementForUser(
	userId: string
): Promise<{ id: string; status: string } | null> {
	const base = billingApiBaseUrl();
	const secret = (privateEnv.BILLING_CLAIM_SECRET ?? '').trim();
	if (!base || !secret) return null;

	const res = await fetch(`${base}/v1/entitlement?user_id=${encodeURIComponent(userId)}`, {
		headers: {
			Accept: 'application/json',
			'x-claim-secret': secret
		}
	});
	if (!res.ok) return null;
	const data = (await res.json()) as { entitlement: { id: string; status: string } | null };
	return data.entitlement;
}
