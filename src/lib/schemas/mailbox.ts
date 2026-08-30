import { z } from 'zod';

export const mailboxPresets = ['gmail', 'outlook', 'custom'] as const;
export type MailboxPreset = (typeof mailboxPresets)[number];

export const mailboxSecurityOptions = ['tls', 'starttls', 'none'] as const;
export type MailboxSecurity = (typeof mailboxSecurityOptions)[number];

export const mailboxStatusOptions = [
	'disconnected',
	'configured',
	'ok',
	'error',
	'auth_failed'
] as const;
export type MailboxStatus = (typeof mailboxStatusOptions)[number];

/** Superforms SPA shape — password is write-only (empty = keep existing). */
export const mailboxFormSchema = z.object({
	preset: z.enum(mailboxPresets),
	emailAddress: z
		.string()
		.trim()
		.min(1, 'Email address is required')
		.email('Enter a valid email address')
		.max(320),
	username: z.string().trim().max(320),
	password: z.string().max(512),
	fromName: z.string().trim().max(120),
	imapHost: z.string().trim().min(1, 'IMAP host is required').max(255),
	imapPort: z
		.string()
		.trim()
		.regex(/^\d+$/, 'IMAP port must be a number')
		.refine((v) => {
			const n = Number(v);
			return n >= 1 && n <= 65535;
		}, 'IMAP port must be 1–65535'),
	imapSecurity: z.enum(mailboxSecurityOptions),
	smtpHost: z.string().trim().min(1, 'SMTP host is required').max(255),
	smtpPort: z
		.string()
		.trim()
		.regex(/^\d+$/, 'SMTP port must be a number')
		.refine((v) => {
			const n = Number(v);
			return n >= 1 && n <= 65535;
		}, 'SMTP port must be 1–65535'),
	smtpSecurity: z.enum(mailboxSecurityOptions)
});

export type MailboxFormData = z.infer<typeof mailboxFormSchema>;

export interface MailboxTestFeedback {
	ok: boolean;
	message: string;
}

export interface MailboxAccountResource {
	id: string;
	email_address: string;
	username: string;
	from_name: string | null;
	imap_host: string;
	imap_port: number;
	imap_security: MailboxSecurity;
	smtp_host: string;
	smtp_port: number;
	smtp_security: MailboxSecurity;
	/** True when a password/secret is stored — never echo the secret itself. */
	credentials_configured: boolean;
	status: MailboxStatus;
	auth_mode: 'password' | 'oauth';
	oauth_provider: 'microsoft' | 'google' | null;
	last_checked_at: string | null;
	last_error_code: string | null;
	syncIntervalMinutes: number;
	sync_catchup_complete?: boolean;
	sync_high_uid?: number | null;
	sync_low_uid?: number | null;
}

export interface MailboxPresetDefaults {
	imapHost: string;
	imapPort: string;
	imapSecurity: MailboxSecurity;
	smtpHost: string;
	smtpPort: string;
	smtpSecurity: MailboxSecurity;
}

export const mailboxPresetDefaults: Record<MailboxPreset, MailboxPresetDefaults> = {
	gmail: {
		imapHost: 'imap.gmail.com',
		imapPort: '993',
		imapSecurity: 'tls',
		smtpHost: 'smtp.gmail.com',
		smtpPort: '465',
		smtpSecurity: 'tls'
	},
	outlook: {
		imapHost: 'outlook.office365.com',
		imapPort: '993',
		imapSecurity: 'tls',
		smtpHost: 'smtp-mail.outlook.com',
		smtpPort: '587',
		smtpSecurity: 'starttls'
	},
	custom: {
		imapHost: '',
		imapPort: '993',
		imapSecurity: 'tls',
		smtpHost: '',
		smtpPort: '465',
		smtpSecurity: 'tls'
	}
};

export function emptyMailboxFormData(preset: MailboxPreset = 'custom'): MailboxFormData {
	const defaults = mailboxPresetDefaults[preset];
	return {
		preset,
		emailAddress: '',
		username: '',
		password: '',
		fromName: '',
		imapHost: defaults.imapHost,
		imapPort: defaults.imapPort,
		imapSecurity: defaults.imapSecurity,
		smtpHost: defaults.smtpHost,
		smtpPort: defaults.smtpPort,
		smtpSecurity: defaults.smtpSecurity
	};
}

export type MailboxSyncErrorContext = {
	/** Pipeline step hint from Sync (connect/login/select/search/fetch/…). */
	step?: string | null;
	/** Safe API failure message — preferred for timeout when present. */
	message?: string | null;
};

/** Plain-language sync / connection errors for Mail settings. */
export function humanizeMailboxSyncError(
	code: string | null | undefined,
	context?: MailboxSyncErrorContext
): string | null {
	if (!code) return null;
	switch (code) {
		case 'auth_failed':
		case 'authentication_failed':
		case 'imap_auth_failed':
		case 'smtp_auth_failed':
			return 'Sign-in failed — reconnect your Microsoft/Google account, or check the password (or app password).';
		case 'connection_failed':
		case 'imap_connection_failed':
		case 'smtp_connection_failed':
			return 'Could not reach the mail server — check host, port, and security settings.';
		case 'timeout': {
			const apiMessage = context?.message?.trim();
			if (apiMessage) return apiMessage;
			const step = context?.step?.trim();
			if (step) {
				return `The mail server timed out during ${step} — check host, port, and security, or try again.`;
			}
			return 'The mail server timed out — check host, port, and security, or try again. Sync allows up to about 90 seconds.';
		}
		case 'tls_failed':
		case 'certificate_error':
			return 'Secure connection failed — try a different security setting (SSL / STARTTLS).';
		case 'circuit_open':
		case 'circuit_breaker':
			return 'Sync paused after repeated failures — fix credentials, then use Test connection.';
		case 'quota_exceeded':
			return 'The mail provider rejected the request (quota or rate limit). Try again later.';
		case 'credentials_missing':
			return 'Mailbox credentials are missing — connect your account or save a password, then try Sync again.';
		case 'lease_error':
		case 'not_claimed':
			return 'Another sync is already running — wait a moment and try again.';
		default:
			return `Sync issue (${code}). Try Sync now, or Test connection.`;
	}
}

export function describeMailboxSyncResult(result: {
	ok: boolean;
	ingested: number;
	error_code: string | null;
	message?: string | null;
	step?: string | null;
	catchup_complete?: boolean;
}): string {
	const hint = humanizeMailboxSyncError(result.error_code, {
		message: result.message,
		step: result.step
	});
	if (result.ingested > 0) {
		const more =
			result.catchup_complete === false
				? ' Catch-up continues — sync again (or wait for the next automatic sync) to pull older mail.'
				: '';
		return `Synced ${result.ingested} message${result.ingested === 1 ? '' : 's'}.${more}${hint ? ` ${hint}` : ''}`;
	}
	if (result.ok) {
		if (result.catchup_complete === false) {
			return hint ?? 'Sync completed this batch — older mail is still catching up.';
		}
		return hint ?? 'Sync completed — no new messages.';
	}
	return hint ?? 'Sync failed — try again or check mailbox settings.';
}

export function formatMailboxLastChecked(iso: string | null | undefined): string | null {
	if (!iso) return null;
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return date.toLocaleString();
}

export function mailboxFormFromResource(resource: MailboxAccountResource): MailboxFormData {
	const preset =
		resource.oauth_provider === 'microsoft'
			? 'outlook'
			: resource.oauth_provider === 'google'
				? 'gmail'
				: 'custom';
	return {
		preset,
		emailAddress: resource.email_address,
		username: resource.username,
		password: '',
		fromName: resource.from_name ?? '',
		imapHost: resource.imap_host,
		imapPort: String(resource.imap_port),
		imapSecurity: resource.imap_security,
		smtpHost: resource.smtp_host,
		smtpPort: String(resource.smtp_port),
		smtpSecurity: resource.smtp_security
	};
}

export function applyMailboxPreset(
	current: MailboxFormData,
	preset: MailboxPreset
): MailboxFormData {
	const defaults = mailboxPresetDefaults[preset];
	return {
		...current,
		preset,
		imapHost: defaults.imapHost || current.imapHost,
		imapPort: defaults.imapPort,
		imapSecurity: defaults.imapSecurity,
		smtpHost: defaults.smtpHost || current.smtpHost,
		smtpPort: defaults.smtpPort,
		smtpSecurity: defaults.smtpSecurity
	};
}
