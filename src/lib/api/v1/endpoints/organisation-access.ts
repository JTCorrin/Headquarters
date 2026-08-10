import type { ApiRequestFn } from '../request.js';
import type {
	ApiOrganisationInvitation,
	ApiOrganisationInvitationAcceptBody,
	ApiOrganisationInvitationAcceptResult,
	ApiOrganisationInvitationCreateBody,
	ApiOrganisationManagedMember,
	ApiOrganisationMemberPatch,
	ApiOrganisationOwnershipTransferResult
} from '../types.js';
import type { OrganisationAccessEndpoints } from './types.js';

export function createOrganisationAccessEndpoints(
	request: ApiRequestFn
): OrganisationAccessEndpoints {
	return {
		listInvitations: async (signal) => {
			const { data } = await request<ApiOrganisationInvitation[]>(
				'/api/v1/organisation/invitations',
				{ orgScoped: true, signal }
			);
			return data;
		},
		invite: async (body: ApiOrganisationInvitationCreateBody, signal) => {
			const { data } = await request<ApiOrganisationInvitation>(
				'/api/v1/organisation/invitations',
				{ method: 'POST', body, orgScoped: true, signal }
			);
			return data;
		},
		revokeInvitation: async (id, signal) => {
			const { data } = await request<ApiOrganisationInvitation>(
				`/api/v1/organisation/invitations/${id}`,
				{ method: 'DELETE', orgScoped: true, signal }
			);
			return data;
		},
		acceptInvitation: async (body: ApiOrganisationInvitationAcceptBody, signal) => {
			const { data } = await request<ApiOrganisationInvitationAcceptResult>(
				'/api/v1/invitations/accept',
				{ method: 'POST', body, orgScoped: false, signal }
			);
			return data;
		},
		listMembers: async (signal) => {
			const { data } = await request<ApiOrganisationManagedMember[]>(
				'/api/v1/organisation/members',
				{ orgScoped: true, signal }
			);
			return data;
		},
		updateMember: async (id, body: ApiOrganisationMemberPatch, signal) => {
			const { data } = await request<ApiOrganisationManagedMember>(
				`/api/v1/organisation/members/${id}`,
				{ method: 'PATCH', body, orgScoped: true, signal }
			);
			return data;
		},
		removeMember: async (id, signal) => {
			await request<void>(`/api/v1/organisation/members/${id}`, {
				method: 'DELETE',
				orgScoped: true,
				signal
			});
		},
		transferOwnership: async (id, signal) => {
			const { data } = await request<ApiOrganisationOwnershipTransferResult>(
				`/api/v1/organisation/members/${id}/transfer-ownership`,
				{ method: 'POST', orgScoped: true, signal }
			);
			return data;
		}
	};
}
