import { getContext, setContext } from 'svelte';
import type {
	OrgMembershipSummary,
	ThemeOption,
	ThemePreferenceOption
} from '$lib/schemas/organisation.js';
import {
	readSelectedOrgId,
	writeSelectedOrgId,
	type StorageLike
} from './selected-org.js';

const ORG_SESSION_CONTEXT = Symbol('hq.org-session');

export interface OrgSession {
	/** Currently selected organisation id (persisted). */
	readonly selectedOrgId: string | null;
	/** Active memberships from discovery. */
	readonly memberships: OrgMembershipSummary[];
	/**
	 * Increments on every org switch / clear so org-scoped UI and caches
	 * can discard stale state.
	 */
	readonly cacheGeneration: number;
	/**
	 * Personal theme preference (`org_default` inherits the selected org's
	 * `theme_default`). Used by root layout to toggle `.dark` on `<html>`.
	 */
	readonly themePreference: ThemePreferenceOption;
	setMemberships(memberships: OrgMembershipSummary[]): void;
	setThemePreference(preference: ThemePreferenceOption): void;
	/** Patch `theme_default` on a membership after org config save. */
	patchOrgThemeDefault(orgId: string, themeDefault: ThemeOption): void;
	/** Persist selection and bump cache generation when the org changes. */
	selectOrg(orgId: string): void;
	clearSelection(): void;
	/** Force cache invalidation without changing selection. */
	invalidateCaches(): void;
}

export interface CreateOrgSessionOptions {
	storage?: StorageLike | null;
	initialOrgId?: string | null;
	initialMemberships?: OrgMembershipSummary[];
	initialThemePreference?: ThemePreferenceOption;
	onSwitch?: (orgId: string | null, cacheGeneration: number) => void;
}

export function createOrgSession(options: CreateOrgSessionOptions = {}): OrgSession {
	const storage = options.storage === undefined ? undefined : options.storage;
	let selectedOrgId = $state<string | null>(
		options.initialOrgId !== undefined
			? options.initialOrgId
			: readSelectedOrgId(storage)
	);
	let memberships = $state<OrgMembershipSummary[]>([...(options.initialMemberships ?? [])]);
	let cacheGeneration = $state(0);
	let themePreference = $state<ThemePreferenceOption>(
		options.initialThemePreference ?? 'org_default'
	);

	function selectOrg(orgId: string): void {
		const changed = selectedOrgId !== orgId;
		selectedOrgId = orgId;
		writeSelectedOrgId(orgId, storage);
		if (changed) {
			cacheGeneration += 1;
			options.onSwitch?.(orgId, cacheGeneration);
		}
	}

	function clearSelection(): void {
		const changed = selectedOrgId !== null;
		selectedOrgId = null;
		writeSelectedOrgId(null, storage);
		if (changed) {
			cacheGeneration += 1;
			options.onSwitch?.(null, cacheGeneration);
		}
	}

	return {
		get selectedOrgId() {
			return selectedOrgId;
		},
		get memberships() {
			return memberships;
		},
		get cacheGeneration() {
			return cacheGeneration;
		},
		get themePreference() {
			return themePreference;
		},
		setMemberships(next) {
			memberships = [...next];
			if (selectedOrgId && !memberships.some((m) => m.org_id === selectedOrgId)) {
				clearSelection();
			}
		},
		setThemePreference(preference) {
			if (themePreference === preference) return;
			themePreference = preference;
		},
		patchOrgThemeDefault(orgId, themeDefault) {
			const current = memberships.find((m) => m.org_id === orgId);
			if (!current || current.theme_default === themeDefault) return;
			memberships = memberships.map((m) =>
				m.org_id === orgId ? { ...m, theme_default: themeDefault } : m
			);
		},
		selectOrg,
		clearSelection,
		invalidateCaches() {
			cacheGeneration += 1;
			options.onSwitch?.(selectedOrgId, cacheGeneration);
		}
	};
}

export function setOrgSession(session: OrgSession): void {
	setContext(ORG_SESSION_CONTEXT, session);
}

export function getOrgSession(): OrgSession {
	const session = getContext<OrgSession | undefined>(ORG_SESSION_CONTEXT);
	if (!session) {
		throw new Error('OrgSession is not provided in context');
	}
	return session;
}
