import { env } from '$env/dynamic/private';
import { betterAuth } from 'better-auth/minimal';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { Pool } from 'pg';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

export const auth = betterAuth({
	baseURL: env.ORIGIN,
	secret: env.BETTER_AUTH_SECRET,
	database: new Pool({
		connectionString: env.DATABASE_URL
	}),
	emailAndPassword: { enabled: true },
	socialProviders: {
		github: {
			clientId: env.GITHUB_CLIENT_ID,
			clientSecret: env.GITHUB_CLIENT_SECRET
		}
	},
	plugins: [
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
