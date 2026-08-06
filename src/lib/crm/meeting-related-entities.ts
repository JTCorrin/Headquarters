import type { ApiV1Client } from '$lib/api/v1/client.js';

export type MeetingRelatedEntityType = 'client' | 'contact' | 'lead' | 'project';

export interface MeetingRelatedEntityOption {
	id: string;
	name: string;
}

/** Load name options for the meeting related-entity picker. */
export async function loadMeetingRelatedEntityOptions(
	api: ApiV1Client,
	type: MeetingRelatedEntityType,
	signal?: AbortSignal
): Promise<MeetingRelatedEntityOption[]> {
	switch (type) {
		case 'client': {
			const { data } = await api.clients.list({ limit: 100 }, signal);
			return data.map((row) => ({ id: row.id, name: row.name }));
		}
		case 'contact': {
			const { data } = await api.contacts.list({ limit: 100 }, signal);
			return data.map((row) => ({ id: row.id, name: row.display_name }));
		}
		case 'lead': {
			const { data } = await api.leads.list({ limit: 100 }, signal);
			return data.map((row) => ({ id: row.id, name: row.name }));
		}
		case 'project': {
			const { data } = await api.projects.list({ limit: 100 }, signal);
			return data.map((row) => ({ id: row.id, name: row.name }));
		}
	}
}
