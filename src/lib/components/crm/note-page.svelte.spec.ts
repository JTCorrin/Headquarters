import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { createApiV1Client } from '$lib/api/v1/client.js';
import { apiError, createMockFetch } from '$lib/api/v1/mock-fetch.js';
import { createOrgSession } from '$lib/org/session.svelte.js';
import NotePage from './note-page.svelte';

const ORG_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const MEMBERSHIP_ID = 'bbbbbbbb-bbbb-4ccc-8ddd-ffffffffffff';
const NOTE_A = '11111111-2222-4333-8444-555555555555';

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
		body: {
			type: 'doc',
			content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Milk and eggs' }] }]
		},
		body_text: 'Milk and eggs',
		color: 'yellow',
		pinned: false,
		...overrides
	};
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
		}
	};
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

describe('NotePage integration', () => {
	it('loads the note into the editor and autosaves title, colour and pin with If-Match', async () => {
		const patches: Array<{ body: Record<string, unknown>; ifMatch: string | null }> = [];
		let version = 1;

		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			[`GET /api/v1/notes/${NOTE_A}`]: async () => ({ body: { data: sampleNote() } }),
			[`PATCH /api/v1/notes/${NOTE_A}`]: async (request) => {
				const body = (await request.json()) as Record<string, unknown>;
				patches.push({ body, ifMatch: request.headers.get('if-match') });
				version += 1;
				return { body: { data: sampleNote({ ...body, version }) } };
			}
		});

		const session = sessionForOrg();
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(NotePage, {
			api,
			session,
			noteId: NOTE_A,
			autosaveDebounceMs: 20,
			savedIndicatorMs: 10_000
		});

		await expect.element(page.getByTestId('note-title')).toHaveValue('Groceries');
		await expect.element(page.getByText('Milk and eggs')).toBeInTheDocument();
		await expect.element(page.getByTestId('note-surface')).toHaveAttribute('data-color', 'yellow');

		await page.getByTestId('note-title').fill('Groceries for Sunday');
		await expect.poll(() => patches.length).toBe(1);
		expect(patches[0].ifMatch).toBe('"1"');
		expect(patches[0].body).toMatchObject({
			title: 'Groceries for Sunday',
			body_text: 'Milk and eggs',
			color: 'yellow',
			pinned: false
		});
		expect(patches[0].body.body).toMatchObject({ type: 'doc' });
		await expect.element(page.getByTestId('note-save-status')).toHaveAttribute(
			'data-status',
			'saved'
		);

		await page.getByTestId('note-pin').click();
		await expect.poll(() => patches.length).toBe(2);
		expect(patches[1].ifMatch).toBe('"2"');
		expect(patches[1].body).toMatchObject({ pinned: true });
		await expect.element(page.getByRole('button', { name: 'Unpin note' })).toBeInTheDocument();

		await page.getByTestId('note-color-trigger').click();
		await page.getByTestId('note-color-blue').click();
		await expect.poll(() => patches.length).toBe(3);
		expect(patches[2].ifMatch).toBe('"3"');
		expect(patches[2].body).toMatchObject({ color: 'blue' });
		await expect.element(page.getByTestId('note-surface')).toHaveAttribute('data-color', 'blue');
	});

	it('shows a conflict state on 412 and recovers via reload', async () => {
		let gets = 0;

		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			[`GET /api/v1/notes/${NOTE_A}`]: async () => {
				gets += 1;
				return {
					body: {
						data: sampleNote(
							gets > 1 ? { title: 'Groceries (edited elsewhere)', version: 7 } : {}
						)
					}
				};
			},
			[`PATCH /api/v1/notes/${NOTE_A}`]: async () =>
				apiError(412, 'PRECONDITION_FAILED', 'Note version does not match If-Match')
		});

		const session = sessionForOrg();
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(NotePage, { api, session, noteId: NOTE_A, autosaveDebounceMs: 20 });

		await expect.element(page.getByTestId('note-title')).toHaveValue('Groceries');
		await page.getByTestId('note-title').fill('Local edit');

		const status = page.getByTestId('note-save-status');
		await expect.element(status).toHaveAttribute('data-status', 'conflict');
		await expect.element(page.getByText(/changed elsewhere/i).first()).toBeInTheDocument();

		await status.getByRole('button', { name: 'Reload' }).click();
		await expect.element(page.getByTestId('note-title')).toHaveValue(
			'Groceries (edited elsewhere)'
		);
		await expect.element(status).toHaveAttribute('data-status', 'idle');
	});

	it('deletes with If-Match after confirmation', async () => {
		let deleted: { ifMatch: string | null } | null = null;
		let onDeletedCalls = 0;

		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			[`GET /api/v1/notes/${NOTE_A}`]: async () => ({ body: { data: sampleNote({ version: 4 }) } }),
			[`DELETE /api/v1/notes/${NOTE_A}`]: async (request) => {
				deleted = { ifMatch: request.headers.get('if-match') };
				return { status: 204 };
			}
		});

		const session = sessionForOrg();
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(NotePage, {
			api,
			session,
			noteId: NOTE_A,
			onDeleted: () => {
				onDeletedCalls += 1;
			}
		});

		await expect.element(page.getByTestId('note-title')).toHaveValue('Groceries');
		const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
		await page.getByTestId('note-delete').click();
		confirmSpy.mockRestore();

		await expect.poll(() => deleted?.ifMatch).toBe('"4"');
		await expect.poll(() => onDeletedCalls).toBe(1);
	});

	it('shows not found for a missing note', async () => {
		const fetchMock = createMockFetch({
			'GET /api/v1/organisations': async () => ({ body: organisationsListBody() }),
			[`GET /api/v1/notes/${NOTE_A}`]: async () => apiError(404, 'NOT_FOUND', 'Note not found')
		});

		const session = sessionForOrg();
		const api = createApiV1Client({ fetch: fetchMock, getOrgId: () => session.selectedOrgId });
		render(NotePage, { api, session, noteId: NOTE_A });

		await expect.element(page.getByText('Note not found.')).toBeInTheDocument();
	});
});
