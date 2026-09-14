import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import { NOTES_VIEW_MODE_STORAGE_KEY } from '$lib/crm/notes.js';
import NotesPage from './notes-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const MEMBERSHIP_ID = 'bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff';
const NOTE_A = '11111111-2222-4333-8444-555555555555';
const NOTE_B = '22222222-3333-4444-8555-666666666666';
const NOTE_NEW = '33333333-4444-4555-8666-777777777777';

function sampleNote(overrides: Record<string, unknown> = {}) {
	return {
		id: NOTE_A,
		org_id: ORG_A,
		owner_membership_id: MEMBERSHIP_ID,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		created_by: null,
		updated_by: null,
		deleted_at: null,
		version: 1,
		title: 'Groceries',
		color: 'yellow',
		pinned: false,
		excerpt: 'Milk, eggs, bread',
		...overrides
	};
}

function fullNote(overrides: Record<string, unknown> = {}) {
	const rest: Record<string, unknown> = { ...sampleNote(overrides) };
	delete rest.excerpt;
	return { ...rest, body: { type: 'doc', content: [] }, body_text: '' };
}

function memoryStorage(seed: Record<string, string> = {}) {
	const map = new Map(Object.entries(seed));
	return {
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => {
			map.set(key, value);
		},
		removeItem: (key: string) => {
			map.delete(key);
		},
		clear: () => map.clear(),
		key: (index: number) => [...map.keys()][index] ?? null,
		get length() {
			return map.size;
		}
	} as Storage;
}

function sessionForOrg() {
	return createOrgSession({
		storage: memoryStorage({ 'hq.selected-org-id': ORG_A }),
		initialOrgId: ORG_A,
		initialMemberships: [
			{
				org_id: ORG_A,
				org_name: 'Corrin Data',
				org_slug: 'corrin-data',
				logo_url: null,
				role: 'owner',
				membership_id: MEMBERSHIP_ID,
				theme_default: 'system'
			}
		]
	});
}

function organisationsListBody() {
	return {
		data: [
			{
				membership: {
					id: MEMBERSHIP_ID,
					role: 'owner',
					status: 'active',
					joined_at: '2026-01-01T00:00:00Z'
				},
				organisation: {
					id: ORG_A,
					name: 'Corrin Data',
					slug: 'corrin-data',
					logo_path: null,
					default_currency: 'GBP',
					timezone: 'UTC',
					locale: 'en-GB',
					country_code: 'GB',
					theme_default: 'system'
				}
			}
		]
	};
}

describe('NotesPage integration', () => {
	it('renders the masonry grid by default, remembers the table toggle, and searches via q', async () => {
		const seenQueries: string[] = [];
		const storage = memoryStorage();

		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			'GET /api/v1/notes': async (request) => {
				const url = new URL(request.url);
				seenQueries.push(url.searchParams.get('q') ?? '');
				const q = url.searchParams.get('q');
				const roadmap = sampleNote({
					id: NOTE_B,
					title: 'Roadmap',
					pinned: true,
					color: 'blue',
					excerpt: 'Q4 launch, hiring'
				});
				const data = q ? [roadmap] : [sampleNote(), roadmap];
				return { body: { data, meta: { next_cursor: null } } };
			}
		});

		const session = sessionForOrg();
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(NotesPage, { api, session, storage, searchDebounceMs: 10 });

		await expect.element(page.getByTestId('notes-grid')).toBeInTheDocument();
		const cards = page.getByTestId('note-card');
		await expect.element(cards.first()).toHaveAttribute('data-note-id', NOTE_B);
		await expect.element(cards.first()).toHaveAttribute('data-pinned', 'true');
		await expect.element(page.getByText('Milk, eggs, bread')).toBeInTheDocument();

		await page.getByRole('button', { name: 'Table view' }).click();
		await expect.element(page.getByRole('table')).toBeInTheDocument();
		await expect
			.element(page.getByRole('link', { name: /Groceries/ }))
			.toHaveAttribute('href', `/notes/${NOTE_A}`);
		expect(storage.getItem(NOTES_VIEW_MODE_STORAGE_KEY)).toBe('table');

		await page.getByLabelText('Search notes').fill('roadmap');
		await expect.poll(() => seenQueries.includes('roadmap')).toBe(true);
		await expect.element(page.getByRole('link', { name: /Groceries/ })).not.toBeInTheDocument();
		await expect.element(page.getByRole('link', { name: /Roadmap/ })).toBeInTheDocument();
	});

	it('creates a blank note and hands off to the editor', async () => {
		let createBody: unknown;
		let created: string | null = null;

		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			'GET /api/v1/notes': async () => ({ body: { data: [], meta: { next_cursor: null } } }),
			'POST /api/v1/notes': async (request) => {
				createBody = await request.json();
				return { status: 201, body: { data: fullNote({ id: NOTE_NEW, title: '' }) } };
			}
		});

		const session = sessionForOrg();
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(NotesPage, {
			api,
			session,
			storage: memoryStorage(),
			onCreated: (id: string) => {
				created = id;
			}
		});

		await expect.element(page.getByTestId('notes-grid-empty')).toBeInTheDocument();
		await page.getByTestId('notes-new').click();

		await expect.poll(() => created).toBe(NOTE_NEW);
		expect(createBody).toEqual({});
		await expect.element(page.getByText('Untitled')).toBeInTheDocument();
	});

	it('pins optimistically with If-Match and deletes after confirmation', async () => {
		const calls: {
			lastPatch: { body: unknown; ifMatch: string | null } | null;
			deleted: { ifMatch: string | null } | null;
		} = { lastPatch: null, deleted: null };

		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			'GET /api/v1/notes': async () => ({
				body: {
					data: [
						sampleNote({ version: 2 }),
						sampleNote({ id: NOTE_B, title: 'Roadmap', version: 5 })
					],
					meta: { next_cursor: null }
				}
			}),
			[`PATCH /api/v1/notes/${NOTE_A}`]: async (request) => {
				calls.lastPatch = { body: await request.json(), ifMatch: request.headers.get('if-match') };
				return {
					body: { data: fullNote({ version: 3, pinned: true, updated_at: '2026-02-01T00:00:00Z' }) }
				};
			},
			[`DELETE /api/v1/notes/${NOTE_B}`]: async (request) => {
				calls.deleted = { ifMatch: request.headers.get('if-match') };
				return { status: 204 };
			}
		});

		const session = sessionForOrg();
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(NotesPage, { api, session, storage: memoryStorage() });

		const groceries = page.getByTestId('note-card').filter({ hasText: 'Groceries' });
		await expect.element(groceries).toBeInTheDocument();
		await groceries.getByRole('button', { name: 'Pin note' }).click();

		await expect.poll(() => calls.lastPatch?.ifMatch).toBe('"2"');
		expect(calls.lastPatch?.body).toEqual({ pinned: true });
		await expect
			.element(page.getByTestId('note-card').first())
			.toHaveAttribute('data-note-id', NOTE_A);
		await expect.element(groceries).toHaveAttribute('data-pinned', 'true');

		const roadmap = page.getByTestId('note-card').filter({ hasText: 'Roadmap' });
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
		await roadmap.getByRole('button', { name: 'Delete note' }).click();
		confirmSpy.mockRestore();

		await expect.poll(() => calls.deleted?.ifMatch).toBe('"5"');
		await expect.element(roadmap).not.toBeInTheDocument();
	});
});
