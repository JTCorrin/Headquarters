/** Row model for the org audit log table. */
export interface AuditLogListItem {
	id: string;
	occurredAt: string;
	actor: string;
	event: string;
	action: string;
	target: string;
	ip: string;
}
