const DEFAULT_POST_AUTH_PATH = '/';

export function safeNextPath(value: string | null | undefined): string {
	if (!value || !value.startsWith('/') || value.startsWith('//')) {
		return DEFAULT_POST_AUTH_PATH;
	}

	try {
		const url = new URL(value, 'http://localhost');
		if (url.origin !== 'http://localhost') return DEFAULT_POST_AUTH_PATH;
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return DEFAULT_POST_AUTH_PATH;
	}
}

export function authCallbackUrl(origin: string, next?: string | null): string {
	const callback = new URL('/auth/callback', origin);
	const safe = safeNextPath(next);
	if (safe !== DEFAULT_POST_AUTH_PATH) callback.searchParams.set('next', safe);
	return callback.toString();
}
