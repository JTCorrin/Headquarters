import type { ApiRequestFn } from '../request.js';
import type {
	ApiNote,
	ApiNoteCreateBody,
	ApiNoteListItem,
	ApiNoteListParams,
	ApiNoteUpdateBody
} from '../types.js';
import type { NotesEndpoints } from './types.js';

export function createNotesEndpoints(request: ApiRequestFn): NotesEndpoints {
	return {
		list: async (params: ApiNoteListParams = {}, signal) => {
			return request<ApiNoteListItem[]>('/api/v1/notes', {
				orgScoped: true,
				query: {
					limit: params.limit,
					cursor: params.cursor,
					q: params.q,
					pinned: params.pinned
				},
				signal
			});
		},
		create: async (body: ApiNoteCreateBody = {}, signal) => {
			const { data } = await request<ApiNote>('/api/v1/notes', {
				method: 'POST',
				body,
				orgScoped: true,
				signal
			});
			return data;
		},
		get: async (id, signal) => {
			return request<ApiNote>(`/api/v1/notes/${id}`, {
				orgScoped: true,
				signal
			});
		},
		update: async (id, body: ApiNoteUpdateBody, version, signal) => {
			const { data } = await request<ApiNote>(`/api/v1/notes/${id}`, {
				method: 'PATCH',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		delete: async (id, version, signal) => {
			await request<undefined>(`/api/v1/notes/${id}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
		}
	};
}
