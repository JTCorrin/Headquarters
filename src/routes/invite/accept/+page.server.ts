import { fail, redirect } from '@sveltejs/kit';
import type {
	ApiEnvelope,
	ApiErrorBody,
	ApiOrganisationInvitationAcceptResult
} from '$lib/api/v1/types.js';
import type { Actions, PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ locals, url }) => {
	const token = url.searchParams.get('token')?.trim() ?? '';
	const next = `${url.pathname}${url.search}`;
	const { session, user } = await locals.getValidatedSession();

	if (!session || !user) {
		redirect(303, `/login?next=${encodeURIComponent(next)}`);
	}

	if (!token) {
		return {
			error: {
				status: 422,
				code: 'VALIDATION_ERROR',
				message: 'This invitation link is missing its token.'
			},
			userEmail: user.email ?? null
		};
	}

	return {
		error: null,
		userEmail: user.email ?? null
	};
};

export const actions: Actions = {
	default: async ({ fetch, locals, url }) => {
		const token = url.searchParams.get('token')?.trim() ?? '';
		const { session, user } = await locals.getValidatedSession();

		if (!session || !user) {
			return fail(401, {
				error: {
					status: 401,
					code: 'UNAUTHENTICATED',
					message: 'Sign in before accepting this invitation.'
				}
			});
		}

		if (!token) {
			return fail(422, {
				error: {
					status: 422,
					code: 'VALIDATION_ERROR',
					message: 'This invitation link is missing its token.'
				}
			});
		}

		const response = await fetch('/api/v1/invitations/accept', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${session.access_token}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify({ token })
		});

		if (!response.ok) {
			const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
			return fail(response.status, {
				error: {
					status: response.status,
					code: body?.error.code ?? 'UNKNOWN',
					message:
						response.status === 403
							? 'This invitation belongs to a different verified email address.'
							: (body?.error.message ?? 'Could not accept this invitation.')
				}
			});
		}

		const body = (await response.json()) as ApiEnvelope<ApiOrganisationInvitationAcceptResult>;
		return { acceptance: body.data };
	}
};
