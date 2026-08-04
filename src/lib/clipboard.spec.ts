import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from './clipboard.js';

type FakeTextarea = {
	value: string;
	style: Record<string, string>;
	setAttribute: ReturnType<typeof vi.fn>;
	focus: ReturnType<typeof vi.fn>;
	select: ReturnType<typeof vi.fn>;
	setSelectionRange: ReturnType<typeof vi.fn>;
};

function stubDocument(execResult: boolean) {
	const ta: FakeTextarea = {
		value: '',
		style: {},
		setAttribute: vi.fn(),
		focus: vi.fn(),
		select: vi.fn(),
		setSelectionRange: vi.fn()
	};
	const body = {
		appendChild: vi.fn(),
		removeChild: vi.fn()
	};
	const execCommand = vi.fn(() => execResult);
	vi.stubGlobal('document', {
		createElement: vi.fn((tag: string) => {
			if (tag !== 'textarea') throw new Error(`unexpected tag ${tag}`);
			return ta;
		}),
		execCommand,
		body
	});
	return { ta, body, execCommand };
}

describe('copyText', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('uses navigator.clipboard when secure context', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		vi.stubGlobal('isSecureContext', true);
		vi.stubGlobal('navigator', { clipboard: { writeText } });

		await expect(copyText('crm_key_abc')).resolves.toEqual({ ok: true });
		expect(writeText).toHaveBeenCalledWith('crm_key_abc');
	});

	it('falls back to execCommand when not a secure context', async () => {
		const writeText = vi.fn();
		vi.stubGlobal('isSecureContext', false);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		const { execCommand, ta } = stubDocument(true);

		await expect(copyText('crm_key_insecure')).resolves.toEqual({ ok: true });
		expect(writeText).not.toHaveBeenCalled();
		expect(ta.value).toBe('crm_key_insecure');
		expect(execCommand).toHaveBeenCalledWith('copy');
	});

	it('falls back to execCommand when clipboard.writeText rejects', async () => {
		const writeText = vi.fn().mockRejectedValue(new Error('denied'));
		vi.stubGlobal('isSecureContext', true);
		vi.stubGlobal('navigator', { clipboard: { writeText } });
		const { execCommand } = stubDocument(true);

		await expect(copyText('crm_key_denied')).resolves.toEqual({ ok: true });
		expect(execCommand).toHaveBeenCalledWith('copy');
	});

	it('returns a visible error when both paths fail', async () => {
		vi.stubGlobal('isSecureContext', false);
		vi.stubGlobal('navigator', {});
		stubDocument(false);

		await expect(copyText('crm_key_fail')).resolves.toEqual({
			ok: false,
			error: 'Could not copy — select the key and press Ctrl/Cmd+C'
		});
	});
});
