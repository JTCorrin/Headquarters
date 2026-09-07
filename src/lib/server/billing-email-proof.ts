import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';

export const challengeCookie = 'hq-billing-email-challenge';
export const proofCookie = 'hq-billing-email-proof';
export type EmailProof = {
	purpose: 'headquarters-email-challenge' | 'headquarters-email-recovery';
	userId: string;
	email: string;
	expiresAt: number;
	verifierHash?: string;
};

export function signEmailProof(proof: EmailProof): string {
	const secret = env.BILLING_CLAIM_SECRET?.trim();
	if (!secret) throw new Error('Billing is not configured');
	const payload = Buffer.from(JSON.stringify(proof)).toString('base64url');
	return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
}

export function readEmailProof(value: string | undefined): EmailProof | null {
	try {
		if (!value || value.length > 4096 || !env.BILLING_CLAIM_SECRET?.trim()) return null;
		const parts = value.split('.');
		if (parts.length !== 2) return null;
		const actual = Buffer.from(parts[1], 'base64url');
		const expected = createHmac('sha256', env.BILLING_CLAIM_SECRET.trim())
			.update(parts[0])
			.digest();
		if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
		const proof = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as EmailProof;
		const now = Math.floor(Date.now() / 1000);
		return Number.isInteger(proof.expiresAt) &&
			proof.expiresAt > now &&
			proof.expiresAt <= now + 3600
			? proof
			: null;
	} catch {
		return null;
	}
}

export function pkceVerifierHash(cookies: { name: string; value: string }[]): string | null {
	const verifier = cookies
		.filter((cookie) => cookie.name.includes('-auth-token-code-verifier'))
		.sort((a, b) => a.name.localeCompare(b.name));
	return verifier.length
		? createHash('sha256').update(JSON.stringify(verifier)).digest('hex')
		: null;
}
