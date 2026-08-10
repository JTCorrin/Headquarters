import type { Handle } from '@sveltejs/kit';
import {
	createSupabaseServerClient,
	getValidatedSession
} from '$lib/server/auth/supabase.js';

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createSupabaseServerClient(event);
	event.locals.getValidatedSession = () => getValidatedSession(event.locals.supabase);

	return resolve(event, {
		filterSerializedResponseHeaders: (name) =>
			name === 'content-range' || name === 'x-supabase-api-version'
	});
};
