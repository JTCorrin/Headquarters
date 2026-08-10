import type { ApiMailboxAccount } from '$lib/api/v1/types.js';

/** True when the current member's personal mailbox can send invitation (and other) SMTP. */
export function isMailboxOutboundReady(
	account: ApiMailboxAccount | null | undefined
): boolean {
	if (!account?.credentials_configured) return false;
	if (!account.smtp_host?.trim()) return false;
	if (!Number.isInteger(account.smtp_port) || account.smtp_port < 1 || account.smtp_port > 65535) {
		return false;
	}
	if (!account.email_address?.trim()) return false;
	return account.smtp_security === 'tls' || account.smtp_security === 'starttls' || account.smtp_security === 'none';
}

export const MAILBOX_OUTBOUND_REQUIRED_MESSAGE =
	'Configure your personal mailbox SMTP under My settings → Mail before sending invitations.';
