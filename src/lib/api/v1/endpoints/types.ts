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
	ApiBill,
	ApiBillCreateBody,
	ApiBillDocument,
	ApiBillListParams,
	ApiBillUpdateBody,
	ApiBillVoidBody,
	ApiVendor,
	ApiVendorCreateBody,
	ApiVendorListParams,
	ApiVendorUpdateBody,
	ApiProduct,
	ApiProductAdjustStockBody,
	ApiProductCreateBody,
	ApiProductListParams,
	ApiProductUpdateBody,
	ApiQuote,
	ApiQuoteCreateBody,
	ApiQuoteDocument,
	ApiQuoteListParams,
	ApiQuoteUpdateBody,
	ApiTaxRate,
	ApiTaxRateCreateBody,
	ApiTaxRateListParams,
	ApiTaxRatePatchBody,
	ApiTask,
	ApiTaskCreateBody,
	ApiTaskListParams,
	ApiTaskUpdateBody,
	ApiMailboxAccount,
	ApiMailboxPutBody,
	ApiMailboxTestResult,
	ApiAiIntegration,
	ApiAiIntegrationConnectBody,
	ApiAiProvider,
	ApiAiSuggestion,
	ApiAiSuggestionGenerateBody,
	ApiEmailMessage,
	ApiEmailMessageShareBody,
	ApiEmailMessageShareResult,
	ApiEntityEmailType,
	ApiRecurringInvoiceCreateBody,
	ApiRecurringInvoiceDocument,
	ApiRecurringInvoiceListParams,
	ApiRecurringInvoicePreviewBody,
	ApiRecurringInvoicePreviewResult,
	ApiRecurringInvoiceRun,
	ApiRecurringInvoiceRunDocument,
	ApiRecurringInvoiceRunListParams,
	ApiRecurringInvoiceRunNowResult,
	ApiRecurringInvoiceSchedule,
	ApiRecurringInvoiceUpdateBody,
	ApiPayment,
	ApiPaymentAllocateBody,
	ApiPaymentCreateBody,
	ApiPaymentDocument,
	ApiPaymentListParams,
	ApiPaymentReverseBody
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

export interface ProductsEndpoints {
	list(
		params?: ApiProductListParams,
		signal?: AbortSignal
	): Promise<ApiResult<ApiProduct[]>>;
	create(body: ApiProductCreateBody, signal?: AbortSignal): Promise<ApiProduct>;
	get(id: string, signal?: AbortSignal): Promise<ApiResult<ApiProduct>>;
	update(
		id: string,
		body: ApiProductUpdateBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiProduct>;
	delete(id: string, version: number, signal?: AbortSignal): Promise<void>;
	adjustStock(
		id: string,
		body: ApiProductAdjustStockBody,
		signal?: AbortSignal
	): Promise<ApiProduct>;
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
	accept(id: string, version: number, signal?: AbortSignal): Promise<ApiQuoteDocument>;
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

export interface VendorsEndpoints {
	list(
		params?: ApiVendorListParams,
		signal?: AbortSignal
	): Promise<ApiResult<ApiVendor[]>>;
	create(body: ApiVendorCreateBody, signal?: AbortSignal): Promise<ApiVendor>;
	get(id: string, signal?: AbortSignal): Promise<ApiResult<ApiVendor>>;
	update(
		id: string,
		body: ApiVendorUpdateBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiVendor>;
}

export interface BillsEndpoints {
	list(
		params?: ApiBillListParams,
		signal?: AbortSignal
	): Promise<ApiResult<ApiBill[]>>;
	create(body: ApiBillCreateBody, signal?: AbortSignal): Promise<ApiBillDocument>;
	get(id: string, signal?: AbortSignal): Promise<ApiResult<ApiBillDocument>>;
	update(
		id: string,
		body: ApiBillUpdateBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiBillDocument>;
	delete(id: string, version: number, signal?: AbortSignal): Promise<void>;
	receive(id: string, version: number, signal?: AbortSignal): Promise<ApiBillDocument>;
	void(
		id: string,
		body: ApiBillVoidBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiBillDocument>;
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

export interface TasksEndpoints {
	list(params?: ApiTaskListParams, signal?: AbortSignal): Promise<ApiResult<ApiTask[]>>;
	create(body: ApiTaskCreateBody, signal?: AbortSignal): Promise<ApiTask>;
	get(id: string, signal?: AbortSignal): Promise<ApiResult<ApiTask>>;
	update(
		id: string,
		body: ApiTaskUpdateBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiTask>;
	delete(id: string, version: number, signal?: AbortSignal): Promise<void>;
}

export interface RecurringInvoiceSchedulesEndpoints {
	list(
		params?: ApiRecurringInvoiceListParams,
		signal?: AbortSignal
	): Promise<ApiResult<ApiRecurringInvoiceSchedule[]>>;
	create(
		body: ApiRecurringInvoiceCreateBody,
		signal?: AbortSignal
	): Promise<ApiRecurringInvoiceDocument>;
	get(id: string, signal?: AbortSignal): Promise<ApiResult<ApiRecurringInvoiceDocument>>;
	update(
		id: string,
		body: ApiRecurringInvoiceUpdateBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiRecurringInvoiceDocument>;
	delete(id: string, version: number, signal?: AbortSignal): Promise<void>;
	preview(
		body: ApiRecurringInvoicePreviewBody,
		signal?: AbortSignal
	): Promise<ApiRecurringInvoicePreviewResult>;
	listRuns(
		id: string,
		params?: ApiRecurringInvoiceRunListParams,
		signal?: AbortSignal
	): Promise<ApiResult<ApiRecurringInvoiceRun[]>>;
	getRun(
		scheduleId: string,
		runId: string,
		signal?: AbortSignal
	): Promise<ApiResult<ApiRecurringInvoiceRunDocument>>;
	activate(
		id: string,
		version: number,
		signal?: AbortSignal
	): Promise<ApiRecurringInvoiceDocument>;
	pause(
		id: string,
		version: number,
		signal?: AbortSignal
	): Promise<ApiRecurringInvoiceDocument>;
	resume(
		id: string,
		version: number,
		signal?: AbortSignal
	): Promise<ApiRecurringInvoiceDocument>;
	cancel(
		id: string,
		version: number,
		signal?: AbortSignal
	): Promise<ApiRecurringInvoiceDocument>;
	runNow(
		id: string,
		version: number,
		signal?: AbortSignal
	): Promise<ApiRecurringInvoiceRunNowResult>;
}

export interface PaymentsEndpoints {
	list(
		params?: ApiPaymentListParams,
		signal?: AbortSignal
	): Promise<ApiResult<ApiPayment[]>>;
	create(body: ApiPaymentCreateBody, signal?: AbortSignal): Promise<ApiPaymentDocument>;
	get(id: string, signal?: AbortSignal): Promise<ApiResult<ApiPaymentDocument>>;
	allocate(
		id: string,
		body: ApiPaymentAllocateBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiPaymentDocument>;
	reverse(
		id: string,
		body: ApiPaymentReverseBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiPaymentDocument>;
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

export interface MailboxEndpoints {
	get(signal?: AbortSignal): Promise<ApiMailboxAccount | null>;
	put(body: ApiMailboxPutBody, signal?: AbortSignal): Promise<ApiMailboxAccount>;
	test(signal?: AbortSignal): Promise<ApiMailboxTestResult>;
	disconnect(signal?: AbortSignal): Promise<void>;
}

export interface IntegrationsEndpoints {
	list(signal?: AbortSignal): Promise<ApiAiIntegration[]>;
	connectAi(
		provider: ApiAiProvider,
		body: ApiAiIntegrationConnectBody,
		signal?: AbortSignal
	): Promise<ApiAiIntegration>;
	disconnectAi(provider: ApiAiProvider, signal?: AbortSignal): Promise<void>;
}


export interface EmailMessagesEndpoints {
	listForEntity(
		entityType: ApiEntityEmailType,
		entityId: string,
		signal?: AbortSignal
	): Promise<ApiEmailMessage[]>;
	share(
		messageId: string,
		body: ApiEmailMessageShareBody,
		signal?: AbortSignal
	): Promise<ApiEmailMessageShareResult>;
	generateDraft(
		body: ApiAiSuggestionGenerateBody,
		signal?: AbortSignal
	): Promise<ApiAiSuggestion>;
	useDraft(
		suggestionId: string,
		acceptedText?: string | null,
		signal?: AbortSignal
	): Promise<ApiAiSuggestion>;
	discardDraft(suggestionId: string, signal?: AbortSignal): Promise<void>;
}
