export const API_ERROR_CODES = [
	'BAD_REQUEST',
	'CONFLICT',
	'FORBIDDEN',
	'INTERNAL_ERROR',
	'METHOD_NOT_ALLOWED',
	'NETWORK_ERROR',
	'NOT_FOUND',
	'ORG_CONTEXT_REQUIRED',
	'PAYLOAD_TOO_LARGE',
	'PRECONDITION_FAILED',
	'PRECONDITION_REQUIRED',
	'UNAUTHENTICATED',
	'UPSTREAM_ERROR',
	'UNSUPPORTED_MEDIA_TYPE',
	'VALIDATION_ERROR',
	'UNKNOWN'
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export class ApiClientError extends Error {
	readonly status: number;
	readonly code: ApiErrorCode;
	readonly fields?: Record<string, string>;
	readonly requestId?: string;

	constructor(options: {
		status: number;
		code: ApiErrorCode;
		message: string;
		fields?: Record<string, string>;
		requestId?: string;
	}) {
		super(options.message);
		this.name = 'ApiClientError';
		this.status = options.status;
		this.code = options.code;
		this.fields = options.fields;
		this.requestId = options.requestId;
	}

	get isForbidden(): boolean {
		return this.status === 403;
	}

	get isPreconditionFailed(): boolean {
		return this.status === 412;
	}

	get isValidationError(): boolean {
		return this.status === 422;
	}

	get isNetworkError(): boolean {
		return this.code === 'NETWORK_ERROR';
	}
}

export function isApiClientError(error: unknown): error is ApiClientError {
	return error instanceof ApiClientError;
}

export interface UserMessageOptions {
	/** Replaces the server message when the API reports 404. */
	notFoundMessage?: string;
	/** Shown on 412 conflicts when the server did not provide a message. */
	conflictMessage?: string;
	/** Replaces the server message when the API reports 403. */
	forbiddenMessage?: string;
	/** Domain-specific hook evaluated after network/forbidden handling. */
	customMessage?: (error: ApiClientError) => string | null;
	/** Skips joining validation fields (forms that place field errors themselves). */
	ignoreValidationFields?: boolean;
	/** Renders validation fields as "field: message" pairs instead of messages only. */
	keyedValidationFields?: boolean;
}

/**
 * Translate an API error into a user-facing banner message.
 * Shared replacement for the per-component userMessage() copies.
 */
export function userMessage(
	error: unknown,
	fallback: string,
	options: UserMessageOptions = {}
): string {
	if (isApiClientError(error)) {
		if (error.isNetworkError) return 'Network error — check your connection and retry.';
		if (error.isForbidden) {
			if (options.forbiddenMessage) return options.forbiddenMessage;
			return error.message || 'You do not have permission for this action.';
		}
		const custom = options.customMessage?.(error);
		if (custom) return custom;
		if (error.status === 404 || error.code === 'NOT_FOUND') {
			if (options.notFoundMessage) return options.notFoundMessage;
			return error.message || fallback;
		}
		if (error.isPreconditionFailed) {
			return (
				error.message ||
				options.conflictMessage ||
				'This record changed elsewhere — reload and try again.'
			);
		}
		if (error.isValidationError) {
			if (error.fields && !options.ignoreValidationFields) {
				if (options.keyedValidationFields) {
					const keyed = Object.entries(error.fields)
						.map(([field, message]) => `${field}: ${message}`)
						.join(' · ');
					return keyed || error.message;
				}
				return Object.values(error.fields).join(' · ') || error.message;
			}
			return error.message;
		}
		return error.message || fallback;
	}
	return fallback;
}
