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
