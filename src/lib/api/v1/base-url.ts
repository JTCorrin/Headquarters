/**
 * Normalize optional `PUBLIC_API_BASE_URL` from SvelteKit `$env/dynamic/public`
 * for `createApiV1Client({ baseUrl })`. Empty/whitespace/absent → same-origin (undefined).
 */
export function resolveApiV1BaseUrl(publicApiBaseUrl: string | undefined): string | undefined {
	const trimmed = publicApiBaseUrl?.trim();
	if (!trimmed) return undefined;
	return trimmed.replace(/\/+$/, '');
}
