const CLAIM_STORAGE_KEY = 'hq_hosted_claim';

export function storeHostedClaimToken(token: string): void {
	try {
		sessionStorage.setItem(CLAIM_STORAGE_KEY, token);
	} catch {
		/* ignore quota / private mode */
	}
}

export function readHostedClaimToken(): string | null {
	try {
		return sessionStorage.getItem(CLAIM_STORAGE_KEY);
	} catch {
		return null;
	}
}

export function clearHostedClaimToken(): void {
	try {
		sessionStorage.removeItem(CLAIM_STORAGE_KEY);
	} catch {
		/* ignore */
	}
}
