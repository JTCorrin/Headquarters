const COPY_FALLBACK_ERROR = 'Could not copy — select the key and press Ctrl/Cmd+C';

export type CopyTextResult = { ok: true } | { ok: false; error: string };

function isSecureClipboardContext(): boolean {
	if (typeof globalThis !== 'undefined') {
		const flag = (globalThis as { isSecureContext?: boolean }).isSecureContext;
		if (typeof flag === 'boolean') return flag;
	}
	return typeof window !== 'undefined' && Boolean(window.isSecureContext);
}

/**
 * Copy text to the clipboard. Prefers `navigator.clipboard` in a secure
 * context; falls back to `document.execCommand('copy')` for HTTP LAN hosts
 * (e.g. staging `http://192.168.x.x:4173`) where Clipboard API is blocked.
 */
export async function copyText(text: string): Promise<CopyTextResult> {
	if (
		isSecureClipboardContext() &&
		typeof navigator !== 'undefined' &&
		navigator.clipboard?.writeText
	) {
		try {
			await navigator.clipboard.writeText(text);
			return { ok: true };
		} catch {
			// Fall through to execCommand — some browsers still reject clipboard
			// even when isSecureContext is true (permissions / focus).
		}
	}

	if (typeof document === 'undefined') {
		return { ok: false, error: COPY_FALLBACK_ERROR };
	}

	try {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.setAttribute('readonly', '');
		ta.style.position = 'fixed';
		ta.style.top = '0';
		ta.style.left = '-9999px';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.focus();
		ta.select();
		ta.setSelectionRange(0, text.length);
		const ok = document.execCommand('copy');
		document.body.removeChild(ta);
		if (ok) return { ok: true };
	} catch {
		// ignore
	}

	return { ok: false, error: COPY_FALLBACK_ERROR };
}

/** Select all text inside an element (click-to-select for reveal-once secrets). */
export function selectElementText(el: HTMLElement): void {
	const selection = window.getSelection();
	if (!selection) return;
	const range = document.createRange();
	range.selectNodeContents(el);
	selection.removeAllRanges();
	selection.addRange(range);
}
