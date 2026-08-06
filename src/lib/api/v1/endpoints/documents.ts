import type { ApiRequestFn } from '../request.js';
import type {
	ApiDocumentBrowseParams,
	ApiDocumentBrowseResult,
	ApiDocumentDownloadResult,
	ApiDocumentEntityType,
	ApiDocumentFinalizeBody,
	ApiDocumentFolderCreateBody,
	ApiDocumentFolderPatchBody,
	ApiDocumentFolderResult,
	ApiDocumentLinkResult,
	ApiDocumentMoveBody,
	ApiDocumentRenameBody,
	ApiDocumentResult,
	ApiDocumentUploadIntentBody,
	ApiDocumentUploadIntentResult
} from '../types.js';
import type { DocumentsEndpoints } from './types.js';

function entityDocumentsPath(
	entityType: ApiDocumentEntityType,
	entityId: string,
	suffix = ''
): string {
	return `/api/v1/entities/${entityType}/${entityId}/documents${suffix}`;
}

function entityFoldersPath(entityType: ApiDocumentEntityType, entityId: string): string {
	return `/api/v1/entities/${entityType}/${entityId}/folders`;
}

export function createDocumentsEndpoints(request: ApiRequestFn): DocumentsEndpoints {
	return {
		browse: async (entityType, entityId, params: ApiDocumentBrowseParams = {}, signal) => {
			const { data } = await request<ApiDocumentBrowseResult>(
				entityDocumentsPath(entityType, entityId),
				{
					orgScoped: true,
					query: {
						folder_id: params.folder_id === undefined ? undefined : params.folder_id
					},
					signal
				}
			);
			return data;
		},
		createFolder: async (
			entityType,
			entityId,
			body: ApiDocumentFolderCreateBody,
			signal
		) => {
			const { data } = await request<ApiDocumentFolderResult>(
				entityFoldersPath(entityType, entityId),
				{
					method: 'POST',
					body,
					orgScoped: true,
					signal
				}
			);
			return data;
		},
		updateFolder: async (
			folderId,
			body: ApiDocumentFolderPatchBody,
			version,
			signal
		) => {
			const { data } = await request<ApiDocumentFolderResult>(
				`/api/v1/document-folders/${folderId}`,
				{
					method: 'PATCH',
					body,
					orgScoped: true,
					ifMatchVersion: version,
					signal
				}
			);
			return data;
		},
		deleteFolder: async (folderId, version, signal) => {
			await request<undefined>(`/api/v1/document-folders/${folderId}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
		},
		restoreFolder: async (folderId, version, signal) => {
			const { data } = await request<ApiDocumentFolderResult>(
				`/api/v1/document-folders/${folderId}/restore`,
				{
					method: 'POST',
					orgScoped: true,
					ifMatchVersion: version,
					signal
				}
			);
			return data;
		},
		createUploadIntent: async (
			entityType,
			entityId,
			body: ApiDocumentUploadIntentBody,
			signal
		) => {
			const { data } = await request<ApiDocumentUploadIntentResult>(
				entityDocumentsPath(entityType, entityId, '/upload-intent'),
				{
					method: 'POST',
					body,
					orgScoped: true,
					signal
				}
			);
			return data;
		},
		finalize: async (documentId, body: ApiDocumentFinalizeBody = {}, signal) => {
			const { data } = await request<ApiDocumentResult>(
				`/api/v1/documents/${documentId}/finalize`,
				{
					method: 'POST',
					body,
					orgScoped: true,
					signal
				}
			);
			return data;
		},
		download: async (documentId, options) => {
			const opts =
				options instanceof AbortSignal ? { signal: options } : (options ?? {});
			const { data } = await request<ApiDocumentDownloadResult>(
				`/api/v1/documents/${documentId}/download`,
				{
					orgScoped: true,
					query: opts.inline ? { inline: '1' } : undefined,
					signal: opts.signal
				}
			);
			return data;
		},
		rename: async (documentId, body: ApiDocumentRenameBody, version, signal) => {
			const { data } = await request<ApiDocumentResult>(`/api/v1/documents/${documentId}`, {
				method: 'PATCH',
				body,
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
			return data;
		},
		move: async (documentId, body: ApiDocumentMoveBody, version, signal) => {
			const { data } = await request<ApiDocumentLinkResult>(
				`/api/v1/documents/${documentId}/move`,
				{
					method: 'POST',
					body,
					orgScoped: true,
					ifMatchVersion: version,
					signal
				}
			);
			return data;
		},
		delete: async (documentId, version, signal) => {
			await request<undefined>(`/api/v1/documents/${documentId}`, {
				method: 'DELETE',
				orgScoped: true,
				ifMatchVersion: version,
				signal
			});
		},
		restore: async (documentId, version, signal) => {
			const { data } = await request<ApiDocumentResult>(
				`/api/v1/documents/${documentId}/restore`,
				{
					method: 'POST',
					orgScoped: true,
					ifMatchVersion: version,
					signal
				}
			);
			return data;
		}
	};
}
