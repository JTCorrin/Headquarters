import { json, type RequestHandler } from '@sveltejs/kit';
import { claimHostedSubscription, lookupHostedClaim } from '$lib/server/hosted-billing.js';

export const GET: RequestHandler = async ({ url }) => {
	const token = url.searchParams.get('token')?.trim();
	if (!token) {
		return json({ error: 'Missing token' }, { status: 400 });
	}
	try {
		const claim = await lookupHostedClaim(token);
		if (!claim) {
			return json({ error: 'Claim not found' }, { status: 404 });
		}
		return json(claim);
	} catch (err) {
		console.error(err);
		return json({ error: 'Claim lookup failed' }, { status: 502 });
	}
};

export const POST: RequestHandler = async ({ request, locals }) => {
	const { session, user } = await locals.getValidatedSession();
	if (!session || !user?.id || !user.email) {
		return json({ error: 'Not authenticated' }, { status: 401 });
	}

	let body: { token?: string };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON' }, { status: 400 });
	}

	const token = body.token?.trim();
	if (!token) {
		return json({ error: 'Missing token' }, { status: 400 });
	}

	const result = await claimHostedSubscription({
		token,
		userId: user.id,
		email: user.email
	});

	if (!result.ok) {
		return json({ error: result.error ?? 'Claim failed' }, { status: result.status ?? 400 });
	}

	return json({ ok: true });
};
