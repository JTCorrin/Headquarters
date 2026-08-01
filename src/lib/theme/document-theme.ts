import type { ThemeOption, ThemePreferenceOption } from '$lib/schemas/organisation.js';

export type ResolvedAppearance = 'light' | 'dark';

/**
 * Personal preference wins when concrete; `org_default` / null inherits the org default.
 */
export function resolveThemeChoice(
	personal: ThemePreferenceOption | ThemeOption | null | undefined,
	orgDefault: ThemeOption | null | undefined
): ThemeOption {
	if (personal && personal !== 'org_default') return personal;
	return orgDefault ?? 'system';
}

export function resolveAppearance(
	theme: ThemeOption,
	prefersDark: boolean = false
): ResolvedAppearance {
	if (theme === 'dark') return 'dark';
	if (theme === 'light') return 'light';
	return prefersDark ? 'dark' : 'light';
}

/** Toggle the Tailwind/shadcn `.dark` class on `<html>`. Browser-only. */
export function applyDocumentAppearance(appearance: ResolvedAppearance): void {
	if (typeof document === 'undefined') return;
	document.documentElement.classList.toggle('dark', appearance === 'dark');
}

export function readPrefersDark(): boolean {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
	return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyResolvedTheme(
	personal: ThemePreferenceOption | ThemeOption | null | undefined,
	orgDefault: ThemeOption | null | undefined
): ResolvedAppearance {
	const appearance = resolveAppearance(resolveThemeChoice(personal, orgDefault), readPrefersDark());
	applyDocumentAppearance(appearance);
	return appearance;
}

/**
 * Subscribe to `prefers-color-scheme` changes. Only useful when the resolved
 * choice is `system`. Returns an unsubscribe function (no-op outside the browser).
 */
export function subscribePrefersDark(onChange: (prefersDark: boolean) => void): () => void {
	if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
		return () => {};
	}
	const media = window.matchMedia('(prefers-color-scheme: dark)');
	const listener = (event: MediaQueryListEvent) => onChange(event.matches);
	media.addEventListener('change', listener);
	return () => media.removeEventListener('change', listener);
}
