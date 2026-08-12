import { z } from 'zod';
import { isValidAmountString } from '$lib/money.js';

/** Writable lead stages via PATCH/POST — `won` only through convert. */
export const leadWritableStages = ['new', 'qualified', 'proposal', 'lost'] as const;
export const leadStages = ['new', 'qualified', 'proposal', 'won', 'lost'] as const;

const dateOnly = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
	.refine((value) => {
		const year = Number(value.slice(0, 4));
		const month = Number(value.slice(5, 7));
		const day = Number(value.slice(8, 10));
		const date = new Date(Date.UTC(year, month - 1, day));
		return (
			date.getUTCFullYear() === year &&
			date.getUTCMonth() === month - 1 &&
			date.getUTCDate() === day
		);
	}, 'Must be a real calendar date')
	.optional()
	.or(z.literal(''));

export const leadFormSchema = z
	.object({
		name: z.string().trim().min(1, 'Name is required').max(200),
		companyName: z.string().max(200).optional().or(z.literal('')),
		primaryEmail: z
			.string()
			.max(320)
			.optional()
			.or(z.literal(''))
			.refine(
				(v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
				'Must be a valid email address'
			),
		clientId: z.string().uuid().optional().or(z.literal('')),
		stage: z.enum(leadWritableStages),
		/** Decimal major units for display — converted to/from cents at the API boundary. */
		valueAmount: z
			.string()
			.optional()
			.or(z.literal(''))
			.refine((v) => v === undefined || v === '' || isValidAmountString(v), 'Enter a valid amount'),
		currency: z
			.string()
			.regex(/^[A-Z]{3}$/, 'Use a 3-letter uppercase currency code'),
		probabilityPercent: z
			.string()
			.optional()
			.or(z.literal(''))
			.refine((v) => {
				if (v === undefined || v === '') return true;
				const n = Number(v);
				if (!Number.isFinite(n) || n < 0 || n > 100) return false;
				return Math.abs(n * 100 - Math.round(n * 100)) < 1e-8;
			}, 'Must be 0–100 with at most 2 decimal places'),
		source: z.string().max(120).optional().or(z.literal('')),
		expectedCloseOn: dateOnly,
		lostReason: z.string().max(2000).optional().or(z.literal('')),
		notes: z.string().max(20_000).optional().or(z.literal(''))
	})
	.superRefine((data, ctx) => {
		if (data.stage === 'lost' && !data.lostReason?.trim()) {
			ctx.addIssue({
				code: 'custom',
				path: ['lostReason'],
				message: 'Required when stage is lost'
			});
		}
	});

export type LeadFormSchema = typeof leadFormSchema;
export type LeadFormData = z.infer<typeof leadFormSchema>;

export const convertLeadFormSchema = z.object({
	clientName: z.string().max(200).optional().or(z.literal('')),
	clientStatus: z.enum(['prospect', 'active', 'on_hold', 'inactive', 'archived'])
});

export type ConvertLeadFormSchema = typeof convertLeadFormSchema;
export type ConvertLeadFormData = z.infer<typeof convertLeadFormSchema>;

/** API-shaped lead resource for Storybook props (callback-driven). */
export interface LeadResource {
	id: string;
	version: number;
	name: string;
	company_name?: string | null;
	primary_email?: string | null;
	stage: (typeof leadStages)[number];
	value_cents?: number | null;
	currency: string;
	probability_percent?: number | null;
	source?: string | null;
	expected_close_on?: string | null;
	lost_reason?: string | null;
	lost_at?: string | null;
	won_at?: string | null;
	converted_at?: string | null;
	client_id?: string | null;
	notes?: string | null;
	owner_label?: string | null;
}

export interface LeadClientOption {
	id: string;
	name: string;
	defaultCurrency?: string | null;
}
