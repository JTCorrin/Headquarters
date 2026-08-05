import { z } from 'zod';

/** Shared contact option for quote / invoice / recurring recipient pickers. */
export interface DocumentContactOption {
	id: string;
	label: string;
	clientId: string | null;
}

export const documentRecipientFormSchema = z.object({
	contactId: z.uuid(),
	isBilling: z.boolean()
});

export type DocumentRecipientFormRow = z.infer<typeof documentRecipientFormSchema>;

/** Optional recipients list — empty OK; when non-empty exactly one billing. */
export const documentRecipientsFieldSchema = z
	.array(documentRecipientFormSchema)
	.max(25)
	.superRefine((rows, ctx) => {
		if (rows.length === 0) return;
		const billingCount = rows.filter((row) => row.isBilling).length;
		if (billingCount !== 1) {
			ctx.addIssue({
				code: 'custom',
				message: 'Select exactly one billing contact'
			});
		}
		const seen = new Set<string>();
		for (let i = 0; i < rows.length; i++) {
			const id = rows[i].contactId;
			if (seen.has(id)) {
				ctx.addIssue({
					code: 'custom',
					message: 'Duplicate contact',
					path: [i, 'contactId']
				});
			}
			seen.add(id);
		}
	});

export function billingContactIdFromRecipients(
	recipients: DocumentRecipientFormRow[]
): string | null {
	const billing = recipients.find((row) => row.isBilling);
	return billing?.contactId ?? recipients[0]?.contactId ?? null;
}

export function attentionLineFromRecipients(
	recipients: DocumentRecipientFormRow[],
	options: DocumentContactOption[]
): string | undefined {
	if (recipients.length === 0) return undefined;
	const labelFor = (id: string) => options.find((o) => o.id === id)?.label ?? id;
	const billing = recipients.find((row) => row.isBilling) ?? recipients[0];
	const billingLabel = labelFor(billing.contactId);
	const others = recipients
		.filter((row) => row.contactId !== billing.contactId)
		.map((row) => labelFor(row.contactId));
	if (others.length === 0) return `Attn: ${billingLabel}`;
	return `Attn: ${billingLabel}; ${others.join(', ')}`;
}

export function chaseGreetingName(
	recipients: DocumentRecipientFormRow[],
	options: DocumentContactOption[],
	clientName: string | undefined
): string {
	const billingId = billingContactIdFromRecipients(recipients);
	if (billingId) {
		const label = options.find((o) => o.id === billingId)?.label;
		if (label) return label;
	}
	return clientName?.trim() || 'there';
}
