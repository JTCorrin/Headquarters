import { describe, expect, it } from 'vitest';
import { resolveAppearance, resolveThemeChoice } from './document-theme.js';

describe('resolveThemeChoice', () => {
	it('prefers a concrete personal theme over the org default', () => {
		expect(resolveThemeChoice('dark', 'light')).toBe('dark');
		expect(resolveThemeChoice('light', 'dark')).toBe('light');
		expect(resolveThemeChoice('system', 'dark')).toBe('system');
	});

	it('inherits the org default when personal is org_default or null', () => {
		expect(resolveThemeChoice('org_default', 'dark')).toBe('dark');
		expect(resolveThemeChoice(null, 'light')).toBe('light');
		expect(resolveThemeChoice(undefined, 'system')).toBe('system');
	});

	it('falls back to system when nothing is set', () => {
		expect(resolveThemeChoice('org_default', null)).toBe('system');
		expect(resolveThemeChoice(null, undefined)).toBe('system');
	});
});

describe('resolveAppearance', () => {
	it('maps concrete themes without consulting system preference', () => {
		expect(resolveAppearance('dark', false)).toBe('dark');
		expect(resolveAppearance('light', true)).toBe('light');
	});

	it('maps system from prefers-color-scheme', () => {
		expect(resolveAppearance('system', true)).toBe('dark');
		expect(resolveAppearance('system', false)).toBe('light');
	});
});
