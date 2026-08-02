import type { ApiResult } from '../request.js';
import type {
	ApiClient,
	ApiClientCreateBody,
	ApiClientListParams,
	ApiClientUpdateBody,
	ApiContact,
	ApiContactCreateBody,
	ApiContactListParams,
	ApiContactUpdateBody,
	ApiLead,
	ApiLeadConvertBody,
	ApiLeadConvertResult,
	ApiLeadCreateBody,
	ApiLeadListParams,
	ApiLeadUpdateBody,
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
	ApiDocumentUploadIntentResult,
	ApiOrganisationConfiguration,
	ApiOrganisationConfigurationPatch,
	ApiOrganisationCreateBody,
	ApiOrganisationCreateResult,
	ApiOrganisationMembership,
	ApiProfilePreferences,
	ApiProfilePreferencesPatch,
	ApiInvoice,
	ApiInvoiceCreateBody,
	ApiInvoiceDocument,
	ApiInvoiceFromQuoteBody,
	ApiInvoiceListParams,
	ApiInvoiceUpdateBody,
	ApiInvoiceVoidBody,
	ApiQuote,
	ApiQuoteCreateBody,
	ApiQuoteDocument,
	ApiQuoteListParams,
	ApiQuoteUpdateBody,
	ApiTaxRate,
	ApiTaxRateCreateBody,
	ApiTaxRateListParams,
	ApiTaxRatePatchBody
} from '../types.js';

export interface OrganisationsEndpoints {
	list(signal?: AbortSignal): Promise<ApiOrganisationMembership[]>;
	create(body: ApiOrganisationCreateBody, signal?: AbortSignal): Promise<ApiOrganisationCreateResult>;
}

export interface OrganisationConfigEndpoints {
	get(signal?: AbortSignal): Promise<ApiOrganisationConfiguration>;
	update(
		body: ApiOrganisationConfigurationPatch,
		version: number,
		signal?: AbortSignal
	): Promise<ApiOrganisationConfiguration>;
}

export interface TaxRatesEndpoints {
	list(params?: ApiTaxRateListParams, signal?: AbortSignal): Promise<ApiTaxRate[]>;
	create(body: ApiTaxRateCreateBody, signal?: AbortSignal): Promise<ApiTaxRate>;
	update(
		id: string,
		body: ApiTaxRatePatchBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiTaxRate>;
	delete(id: string, version: number, signal?: AbortSignal): Promise<void>;
}

export interface ProfilePreferencesEndpoints {
	get(signal?: AbortSignal): Promise<ApiProfilePreferences>;
	update(body: ApiProfilePreferencesPatch, signal?: AbortSignal): Promise<ApiProfilePreferences>;
}

export interface QuotesEndpoints {
	list(
		params?: ApiQuoteListParams,
		signal?: AbortSignal
	): Promise<ApiResult<ApiQuote[]>>;
	create(body: ApiQuoteCreateBody, signal?: AbortSignal): Promise<ApiQuoteDocument>;
	get(id: string, signal?: AbortSignal): Promise<ApiResult<ApiQuoteDocument>>;
	update(
		id: string,
		body: ApiQuoteUpdateBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiQuoteDocument>;
	delete(id: string, version: number, signal?: AbortSignal): Promise<void>;
}

export interface InvoicesEndpoints {
	list(
		params?: ApiInvoiceListParams,
		signal?: AbortSignal
	): Promise<ApiResult<ApiInvoice[]>>;
	create(body: ApiInvoiceCreateBody, signal?: AbortSignal): Promise<ApiInvoiceDocument>;
	/** Primary conversion contract — copies accepted-quote snapshots into a draft invoice. */
	createFromQuote(
		body: ApiInvoiceFromQuoteBody,
		signal?: AbortSignal
	): Promise<ApiInvoiceDocument>;
	get(id: string, signal?: AbortSignal): Promise<ApiResult<ApiInvoiceDocument>>;
	update(
		id: string,
		body: ApiInvoiceUpdateBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiInvoiceDocument>;
	delete(id: string, version: number, signal?: AbortSignal): Promise<void>;
	send(id: string, version: number, signal?: AbortSignal): Promise<ApiInvoiceDocument>;
	void(
		id: string,
		body: ApiInvoiceVoidBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiInvoiceDocument>;
}

export interface ContactsEndpoints {
	list(
		params?: ApiContactListParams,
		signal?: AbortSignal
	): Promise<ApiResult<ApiContact[]>>;
	create(body: ApiContactCreateBody, signal?: AbortSignal): Promise<ApiContact>;
	get(id: string, signal?: AbortSignal): Promise<ApiResult<ApiContact>>;
	update(
		id: string,
		body: ApiContactUpdateBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiContact>;
	delete(id: string, version: number, signal?: AbortSignal): Promise<void>;
}

export interface ClientsEndpoints {
	list(
		params?: ApiClientListParams,
		signal?: AbortSignal
	): Promise<ApiResult<ApiClient[]>>;
	create(body: ApiClientCreateBody, signal?: AbortSignal): Promise<ApiClient>;
	get(id: string, signal?: AbortSignal): Promise<ApiResult<ApiClient>>;
	update(
		id: string,
		body: ApiClientUpdateBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiClient>;
	delete(id: string, version: number, signal?: AbortSignal): Promise<void>;
}

export interface LeadsEndpoints {
	list(params?: ApiLeadListParams, signal?: AbortSignal): Promise<ApiResult<ApiLead[]>>;
	create(body: ApiLeadCreateBody, signal?: AbortSignal): Promise<ApiLead>;
	get(id: string, signal?: AbortSignal): Promise<ApiResult<ApiLead>>;
	update(
		id: string,
		body: ApiLeadUpdateBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiLead>;
	delete(id: string, version: number, signal?: AbortSignal): Promise<void>;
	convert(
		id: string,
		body?: ApiLeadConvertBody,
		signal?: AbortSignal
	): Promise<ApiLeadConvertResult>;
}

export interface DocumentsEndpoints {
	browse(
		entityType: ApiDocumentEntityType,
		entityId: string,
		params?: ApiDocumentBrowseParams,
		signal?: AbortSignal
	): Promise<ApiDocumentBrowseResult>;
	createFolder(
		entityType: ApiDocumentEntityType,
		entityId: string,
		body: ApiDocumentFolderCreateBody,
		signal?: AbortSignal
	): Promise<ApiDocumentFolderResult>;
	updateFolder(
		folderId: string,
		body: ApiDocumentFolderPatchBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiDocumentFolderResult>;
	deleteFolder(folderId: string, version: number, signal?: AbortSignal): Promise<void>;
	restoreFolder(
		folderId: string,
		version: number,
		signal?: AbortSignal
	): Promise<ApiDocumentFolderResult>;
	createUploadIntent(
		entityType: ApiDocumentEntityType,
		entityId: string,
		body: ApiDocumentUploadIntentBody,
		signal?: AbortSignal
	): Promise<ApiDocumentUploadIntentResult>;
	finalize(
		documentId: string,
		body?: ApiDocumentFinalizeBody,
		signal?: AbortSignal
	): Promise<ApiDocumentResult>;
	download(documentId: string, signal?: AbortSignal): Promise<ApiDocumentDownloadResult>;
	rename(
		documentId: string,
		body: ApiDocumentRenameBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiDocumentResult>;
	move(
		documentId: string,
		body: ApiDocumentMoveBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiDocumentLinkResult>;
	delete(documentId: string, version: number, signal?: AbortSignal): Promise<void>;
	restore(
		documentId: string,
		version: number,
		signal?: AbortSignal
	): Promise<ApiDocumentResult>;
}
