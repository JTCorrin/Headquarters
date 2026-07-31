export const SELECTED_ORG_STORAGE_KEY = 'hq.selected-org-id';

export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export function readSelectedOrgId(
	storage: StorageLike | null | undefined = defaultStorage()
): string | null {
	if (!storage) return null;
	try {
		const value = storage.getItem(SELECTED_ORG_STORAGE_KEY);
		return value && value.trim() ? value.trim() : null;
	} catch {
		return null;
	}
}

export function writeSelectedOrgId(
	orgId: string | null,
	storage: StorageLike | null | undefined = defaultStorage()
): void {
	if (!storage) return;
	try {
		if (!orgId) {
			storage.removeItem(SELECTED_ORG_STORAGE_KEY);
			return;
		}
		storage.setItem(SELECTED_ORG_STORAGE_KEY, orgId);
	} catch {
		// Persistence is best-effort (private mode / quota).
	}
}

function defaultStorage(): StorageLike | null {
	if (typeof localStorage === 'undefined') return null;
	return localStorage;
}
