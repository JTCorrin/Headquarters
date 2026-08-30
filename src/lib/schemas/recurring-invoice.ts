import { z } from 'zod';
import {
	documentRecipientsFieldSchema,
	type DocumentContactOption
} from '$lib/schemas/document-recipients.js';

export const recurringInvoiceFrequencies = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type RecurringInvoiceFrequency = (typeof recurringInvoiceFrequencies)[number];

export const recurringInvoiceStatuses = [
	'draft',
	'active',
	'paused',
	'completed',
	'cancelled'
] as const;
export type RecurringInvoiceStatus = (typeof recurringInvoiceStatuses)[number];

export const recurringInvoiceFormSchema = z.object({
	name: z.string().min(1, 'Name is required').max(160),
	clientId: z.uuid('Select a client'),
	clientName: z.string().max(160).optional().or(z.literal('')),
	recipients: documentRecipientsFieldSchema,
	currency: z.enum(['GBP', 'USD', 'EUR']),
	frequency: z.enum(recurringInvoiceFrequencies),
	intervalCount: z.coerce.number().int().min(1).max(99),
	anchorOn: z.string().min(1, 'Anchor date is required'),
	/** ISO weekday 1–7 for weekly schedules (single day MVP). */
	weekday: z.string().optional().or(z.literal('')),
	dayOfMonth: z.coerce.number().int().min(1).max(31).optional().nullable(),
	monthOfYear: z.coerce.number().int().min(1).max(12).optional().nullable(),
	monthEndPolicy: z.enum(['clamp', 'last_day', 'skip']),
	timezone: z.string().min(1, 'Timezone is required'),
	localRunTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Use HH:MM or HH:MM:SS'),
	startOn: z.string().min(1, 'Start date is required'),
	endOn: z.string().optional().or(z.literal('')),
	maxOccurrences: z.string().optional().or(z.literal('')),
	dueDays: z.coerce.number().int().min(0).max(365),
	deliveryMode: z.enum(['draft', 'auto_send']),
	pricingMode: z.enum(['fixed', 'catalog_at_generation']),
	catchUpPolicy: z.enum(['skip', 'latest', 'all']),
	maxCatchUpRuns: z.coerce.number().int().min(1).max(10),
	purchaseOrderNumber: z.string().max(80).optional().or(z.literal('')),
	paymentTerms: z.string().max(200).optional().or(z.literal('')),
	notes: z.string().max(2000).optional().or(z.literal('')),
	internalNotes: z.string().max(2000).optional().or(z.literal('')),
	status: z.enum(recurringInvoiceStatuses)
});

export type RecurringInvoiceFormSchema = typeof recurringInvoiceFormSchema;
export type RecurringInvoiceFormData = z.infer<typeof recurringInvoiceFormSchema>;

export const recurringLineFormSchema = z.object({
	productId: z.string().optional().or(z.literal('')),
	descriptionTemplate: z.string().min(1, 'Description is required').max(200),
	qty: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Enter a quantity'),
	unitPrice: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Use a number like 12.50'),
	taxRatePercent: z.string().optional().or(z.literal(''))
});

export type RecurringLineFormSchema = typeof recurringLineFormSchema;
export type RecurringLineFormData = z.infer<typeof recurringLineFormSchema>;

/** Row shape for the recurring schedules data table (UI-facing). */
export interface RecurringInvoiceListItem {
	id: string;
	name: string;
	client: string;
	status: string;
	frequency: string;
	nextRunAt: string;
	deliveryMode: string;
	version: number;
}

export interface RecurringInvoiceClientOption {
	id: string;
	name: string;
	taxExempt?: boolean;
}

export type RecurringInvoiceContactOption = DocumentContactOption;

export interface RecurringInvoiceRunListItem {
	id: string;
	scheduledFor: string;
	trigger: string;
	status: string;
	periodStart: string;
	periodEnd: string;
	invoiceId: string | null;
	invoiceNumber: string | null;
	errorMessage?: string | null;
}

export function formatRecurringRunStatus(status: string): string {
	switch (status) {
		case 'delivery_pending':
			return 'Delivery pending';
		case 'delivery_failed':
			return 'Delivery failed';
		case 'delivery_unknown':
			return 'Delivery unknown';
		case 'generation_failed':
			return 'Generation failed';
		default:
			return status.replaceAll('_', ' ');
	}
}
