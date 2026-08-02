import {
	emptyMailboxFormData,
	mailboxFormFromResource,
	type MailboxAccountResource,
	type MailboxFormData
} from '$lib/schemas/mailbox.js';

/** Module-scoped drafts survive controller remounts until save, disconnect, or forced reload. */
const draftsByOrg = new Map<string, MailboxFormData>();

export function getMailboxDraft(orgId: string): MailboxFormData | undefined {
	const draft = draftsByOrg.get(orgId);
	return draft ? structuredClone(draft) : undefined;
}

export function setMailboxDraft(orgId: string, data: MailboxFormData): void {
	draftsByOrg.set(orgId, structuredClone(data));
}

export function clearMailboxDraft(orgId: string): void {
	draftsByOrg.delete(orgId);
}

export function hasMailboxDraft(orgId: string): boolean {
	return draftsByOrg.has(orgId);
}

/** Test helper — reset module state between specs. */
export function resetMailboxDraftsForTests(): void {
	draftsByOrg.clear();
}

function normalizeMailboxForm(data: MailboxFormData): MailboxFormData {
	return {
		...data,
		emailAddress: data.emailAddress.trim(),
		username: data.username.trim(),
		fromName: data.fromName.trim(),
		imapHost: data.imapHost.trim(),
		smtpHost: data.smtpHost.trim(),
		password: data.password
	};
}

/** True when the form has user-entered values beyond an empty preset shell. */
export function mailboxFormHasUserInput(data: MailboxFormData): boolean {
	const normalized = normalizeMailboxForm(data);
	if (
		normalized.emailAddress ||
		normalized.username ||
		normalized.password ||
		normalized.fromName
	) {
		return true;
	}
	const presetDefaults = emptyMailboxFormData(normalized.preset);
	const baseline = normalizeMailboxForm(presetDefaults);
	return (
		normalized.imapHost !== baseline.imapHost ||
		normalized.smtpHost !== baseline.smtpHost ||
		normalized.imapPort !== baseline.imapPort ||
		normalized.smtpPort !== baseline.smtpPort ||
		normalized.imapSecurity !== baseline.imapSecurity ||
		normalized.smtpSecurity !== baseline.smtpSecurity ||
		normalized.preset !== baseline.preset
	);
}

export function mailboxFormMatchesAccount(
	data: MailboxFormData,
	account: MailboxAccountResource
): boolean {
	const fromAccount = normalizeMailboxForm(mailboxFormFromResource(account));
	const current = normalizeMailboxForm(data);
	return (
		current.preset === fromAccount.preset &&
		current.emailAddress === fromAccount.emailAddress &&
		current.username === fromAccount.username &&
		current.fromName === fromAccount.fromName &&
		current.imapHost === fromAccount.imapHost &&
		current.imapPort === fromAccount.imapPort &&
		current.imapSecurity === fromAccount.imapSecurity &&
		current.smtpHost === fromAccount.smtpHost &&
		current.smtpPort === fromAccount.smtpPort &&
		current.smtpSecurity === fromAccount.smtpSecurity &&
		!current.password
	);
}

export function shouldRetainMailboxDraft(
	orgId: string,
	account: MailboxAccountResource | null,
	currentForm?: MailboxFormData
): boolean {
	if (!hasMailboxDraft(orgId)) return false;
	const draft = getMailboxDraft(orgId);
	if (!draft) return false;
	if (!account) return mailboxFormHasUserInput(draft);
	if (currentForm && mailboxFormMatchesAccount(currentForm, account)) {
		return false;
	}
	return mailboxFormHasUserInput(draft);
}

export function mailboxFormFromServer(
	account: MailboxAccountResource | null,
	preset: MailboxFormData['preset'] = 'gmail'
): MailboxFormData {
	return account ? mailboxFormFromResource(account) : emptyMailboxFormData(preset);
}
