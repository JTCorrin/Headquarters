import { redirect } from '@sveltejs/kit';
import {
	challengeCookie,
	proofCookie,
	pkceVerifierHash,
	readEmailProof,
	signEmailProof
} from '$lib/server/billing-email-proof.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ locals, cookies, url }) => {
	const challenge = readEmailProof(cookies.get(challengeCookie));
	const code = url.searchParams.get('code');
	const verifierHash = pkceVerifierHash(cookies.getAll());
	cookies.delete(challengeCookie, { path: '/billing' });
	if (
		!locals.supabase ||
		!code ||
		challenge?.purpose !== 'headquarters-email-challenge' ||
		!verifierHash ||
		challenge.verifierHash !== verifierHash
	) {
		redirect(303, '/billing?recovery_error=expired');
	}
	const { data, error } = await locals.supabase.auth.exchangeCodeForSession(code);
	if (
		error ||
		data.user?.id !== challenge.userId ||
		data.user.email?.toLowerCase() !== challenge.email.toLowerCase()
	) {
		redirect(303, '/billing?recovery_error=expired');
	}
	cookies.set(
		proofCookie,
		signEmailProof({
			purpose: 'headquarters-email-recovery',
			userId: data.user.id,
			email: data.user.email,
			expiresAt: Math.floor(Date.now() / 1000) + 600
		}),
		{
			path: '/billing',
			httpOnly: true,
			sameSite: 'lax',
			secure: url.protocol === 'https:',
			maxAge: 600
		}
	);
	redirect(303, '/billing?recover=email');
};
