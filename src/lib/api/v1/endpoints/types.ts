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
	ApiAuditEvent,
	ApiAuditEventListParams,
	ApiTimelineEntityType,
	ApiTimelineEvent,
	ApiTimelineEventCreateBody,
	ApiTimelineEventListParams,
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
	ApiMeeting,
	ApiMeetingCreateBody,
	ApiMeetingDocument,
	ApiMeetingListParams,
	ApiMeetingTranscriptAttachBody,
	ApiMeetingUpdateBody,
	ApiProject,
	ApiProjectCard,
	ApiProjectCardCreateBody,
	ApiProjectCardUpdateBody,
	ApiProjectColumn,
	ApiProjectColumnCreateBody,
	ApiProjectColumnUpdateBody,
	ApiProjectCreateBody,
	ApiProjectDocument,
	ApiProjectListParams,
	ApiProjectUpdateBody,
	ApiCalendarConnection,
	ApiCalendarCaldavPutBody,
	ApiCalendarOAuthStart,
	ApiCalendarProvider,
	ApiCalendarTestResult,
	ApiNotificationListParams,
	ApiNotificationUnreadCount,
	ApiUserNotification,
	ApiMailboxAccount,
	ApiMailboxPutBody,
	ApiMailboxSyncResult,
	ApiMailboxTestResult,
	ApiAiIntegration,
	ApiAiIntegrationConnectBody,
	ApiAiProvider,
	ApiOrgApiKey,
	ApiOrgApiKeyCreateBody,
	ApiOrgApiKeyCreateResult,
	ApiAiSuggestion,
	ApiAiSuggestionGenerateBody,
	ApiEmailMessage,
	ApiEmailMessageReplyBody,
	ApiEmailMessageShareBody,
	ApiEmailMessageShareResult,
	ApiEmailTemplate,
	ApiEmailTemplateCreateBody,
	ApiEmailTemplateListParams,
	ApiEmailTemplateUpdateBody,
	ApiEntityEmailType,
	ApiMyEmailMessageListParams,
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
	send(id: string, version: number, signal?: AbortSignal): Promise<ApiQuoteDocument>;
	reject(id: string, version: number, signal?: AbortSignal): Promise<ApiQuoteDocument>;
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

export interface MeetingsEndpoints {
	list(params?: ApiMeetingListParams, signal?: AbortSignal): Promise<ApiResult<ApiMeeting[]>>;
	create(body: ApiMeetingCreateBody, signal?: AbortSignal): Promise<ApiMeetingDocument>;
	get(id: string, signal?: AbortSignal): Promise<ApiResult<ApiMeetingDocument>>;
	update(
		id: string,
		body: ApiMeetingUpdateBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiMeetingDocument>;
	delete(id: string, version: number, signal?: AbortSignal): Promise<void>;
	/** Attach a finalized document as the meeting transcript (M2). */
	attachTranscript(
		id: string,
		body: ApiMeetingTranscriptAttachBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiMeetingDocument>;
	/** Stub-capable summary generation; returns meeting + proposals when ready (M2). */
	generateSummary(
		id: string,
		version: number,
		signal?: AbortSignal
	): Promise<ApiMeetingDocument>;
	acceptTaskProposal(
		meetingId: string,
		proposalId: string,
		version: number,
		signal?: AbortSignal
	): Promise<ApiMeetingDocument>;
	dismissTaskProposal(
		meetingId: string,
		proposalId: string,
		version: number,
		signal?: AbortSignal
	): Promise<ApiMeetingDocument>;
}

export interface ProjectsEndpoints {
	list(params?: ApiProjectListParams, signal?: AbortSignal): Promise<ApiResult<ApiProject[]>>;
	create(body: ApiProjectCreateBody, signal?: AbortSignal): Promise<ApiProjectDocument>;
	get(id: string, signal?: AbortSignal): Promise<ApiResult<ApiProjectDocument>>;
	update(
		id: string,
		body: ApiProjectUpdateBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiProjectDocument>;
	delete(id: string, version: number, signal?: AbortSignal): Promise<void>;
	createColumn(
		projectId: string,
		body: ApiProjectColumnCreateBody,
		signal?: AbortSignal
	): Promise<ApiProjectColumn>;
	updateColumn(
		projectId: string,
		columnId: string,
		body: ApiProjectColumnUpdateBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiProjectColumn>;
	deleteColumn(
		projectId: string,
		columnId: string,
		version: number,
		signal?: AbortSignal
	): Promise<void>;
	createCard(
		projectId: string,
		body: ApiProjectCardCreateBody,
		signal?: AbortSignal
	): Promise<ApiProjectCard>;
	updateCard(
		projectId: string,
		cardId: string,
		body: ApiProjectCardUpdateBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiProjectCard>;
	deleteCard(
		projectId: string,
		cardId: string,
		version: number,
		signal?: AbortSignal
	): Promise<void>;
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
	sync(signal?: AbortSignal): Promise<ApiMailboxSyncResult>;
	disconnect(signal?: AbortSignal): Promise<void>;
}

/** Personal calendar (Google OAuth + CalDAV credentials) — never echoes secrets. */
export interface CalendarEndpoints {
	get(
		signal?: AbortSignal,
		options?: { provider?: ApiCalendarProvider }
	): Promise<ApiCalendarConnection>;
	put(body: ApiCalendarCaldavPutBody, signal?: AbortSignal): Promise<ApiCalendarConnection>;
	test(
		body?: { password?: string },
		signal?: AbortSignal
	): Promise<ApiCalendarTestResult>;
	startOAuth(signal?: AbortSignal): Promise<ApiCalendarOAuthStart>;
	disconnect(options?: {
		provider?: ApiCalendarProvider;
		signal?: AbortSignal;
	}): Promise<void>;
}

/** Personal notifications bell — `/api/v1/me/notifications*`. */
export interface NotificationsEndpoints {
	list(
		params?: ApiNotificationListParams,
		signal?: AbortSignal
	): Promise<ApiResult<ApiUserNotification[]>>;
	unreadCount(signal?: AbortSignal): Promise<ApiNotificationUnreadCount>;
	markRead(id: string, signal?: AbortSignal): Promise<ApiUserNotification>;
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

/** Org API keys — `/api/v1/api-keys` (Owner/Admin; secret reveal-once on create). */
export interface ApiKeysEndpoints {
	list(signal?: AbortSignal): Promise<ApiOrgApiKey[]>;
	create(body: ApiOrgApiKeyCreateBody, signal?: AbortSignal): Promise<ApiOrgApiKeyCreateResult>;
	revoke(id: string, signal?: AbortSignal): Promise<ApiOrgApiKey>;
}


export interface EmailMessagesEndpoints {
	listMine(
		params?: ApiMyEmailMessageListParams,
		signal?: AbortSignal
	): Promise<ApiEmailMessage[]>;
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
	/** Reply-first SMTP send — requires Idempotency-Key (generated by the client). */
	reply(
		messageId: string,
		body: ApiEmailMessageReplyBody,
		signal?: AbortSignal
	): Promise<ApiEmailMessage>;
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

export interface EmailTemplatesEndpoints {
	list(
		params?: ApiEmailTemplateListParams,
		signal?: AbortSignal
	): Promise<ApiResult<ApiEmailTemplate[]>>;
	create(body: ApiEmailTemplateCreateBody, signal?: AbortSignal): Promise<ApiEmailTemplate>;
	get(id: string, signal?: AbortSignal): Promise<ApiResult<ApiEmailTemplate>>;
	update(
		id: string,
		body: ApiEmailTemplateUpdateBody,
		version: number,
		signal?: AbortSignal
	): Promise<ApiEmailTemplate>;
	delete(id: string, version: number, signal?: AbortSignal): Promise<void>;
}

export interface TimelineEventsEndpoints {
	/** Entity profile rail: `GET …/entities/{type}/{id}/timeline-events`. */
	list(
		entityType: ApiTimelineEntityType,
		entityId: string,
		signal?: AbortSignal
	): Promise<ApiTimelineEvent[]>;
	/** Org-wide Home feed: `GET /api/v1/timeline-events`. */
	list(
		params?: ApiTimelineEventListParams,
		signal?: AbortSignal
	): Promise<ApiResult<ApiTimelineEvent[]>>;
	create(
		entityType: ApiTimelineEntityType,
		entityId: string,
		body: ApiTimelineEventCreateBody,
		signal?: AbortSignal
	): Promise<ApiTimelineEvent>;
}

export interface AuditEventsEndpoints {
	list(
		params?: ApiAuditEventListParams,
		signal?: AbortSignal
	): Promise<ApiResult<ApiAuditEvent[]>>;
}
