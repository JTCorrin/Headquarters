export const SELECTED_ORG_STORAGE_KEY = 'hq.selected-org-id';

export function selectedOrgStorageKey(userId?: string | null): string {
	return userId ? `${SELECTED_ORG_STORAGE_KEY}:${userId}` : SELECTED_ORG_STORAGE_KEY;
}

/** True for the legacy unscoped key or `hq.selected-org-id:<userId>`. */
export function isSelectedOrgStorageKey(key: string): boolean {
	return key === SELECTED_ORG_STORAGE_KEY || key.startsWith(`${SELECTED_ORG_STORAGE_KEY}:`);
}

export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export function readSelectedOrgId(
	storage: StorageLike | null | undefined = defaultStorage(),
	userId?: string | null
): string | null {
	if (!storage) return null;
	try {
		const value = storage.getItem(selectedOrgStorageKey(userId));
		return value && value.trim() ? value.trim() : null;
	} catch {
		return null;
	}
}

export function writeSelectedOrgId(
	orgId: string | null,
	storage: StorageLike | null | undefined = defaultStorage(),
	userId?: string | null
): void {
	if (!storage) return;
	try {
		const key = selectedOrgStorageKey(userId);
		if (!orgId) {
			storage.removeItem(key);
			return;
		}
		storage.setItem(key, orgId);
	} catch {
		// Persistence is best-effort (private mode / quota).
	}
}

function defaultStorage(): StorageLike | null {
	if (typeof localStorage === 'undefined') return null;
	return localStorage;
}
