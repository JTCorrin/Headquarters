import { describe, expect, it, vi } from 'vitest';
import {
	attachMeetingTranscriptFile,
	isMeetingTranscriptFile
} from './meeting-transcript-attachment.js';

const MEETING_ID = '11111111-2222-4333-8444-555555555555';
const DOCUMENT_ID = 'dddddddd-dddd-4eee-8fff-000000000000';

describe('meeting transcript attachment', () => {
	it('accepts text/markdown/vtt/pdf transcripts', () => {
		expect(isMeetingTranscriptFile(new File(['a'], 'a.txt', { type: 'text/plain' }))).toBe(
			true
		);
		expect(isMeetingTranscriptFile(new File(['a'], 'a.md', { type: '' }))).toBe(true);
		expect(isMeetingTranscriptFile(new File(['a'], 'a.vtt', { type: 'text/vtt' }))).toBe(
			true
		);
		expect(
			isMeetingTranscriptFile(new File(['a'], 'a.pdf', { type: 'application/pdf' }))
		).toBe(true);
		expect(isMeetingTranscriptFile(new File(['a'], 'a.bin', { type: 'application/octet-stream' }))).toBe(
			false
		);
	});

	it('uploads via intent → put → finalize → attachTranscript', async () => {
		const createUploadIntent = vi.fn(async () => ({
			document: {
				id: DOCUMENT_ID,
				version: 1,
				name: 'notes.txt',
				mime_type: 'text/plain',
				size_bytes: 5
			},
			link: { id: 'link-1' },
			upload: { signed_url: 'https://upload.test/put', token: 't', path: 'p', expires_in: 60 }
		}));
		const finalize = vi.fn(async () => ({
			document: {
				id: DOCUMENT_ID,
				version: 2,
				name: 'notes.txt',
				mime_type: 'text/plain',
				size_bytes: 5
			}
		}));
		const attachTranscript = vi.fn(async () => ({
			id: MEETING_ID,
			version: 4,
			transcript_status: 'ready'
		}));
		const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
		const api = {
			documents: { createUploadIntent, finalize },
			meetings: { attachTranscript }
		} as never;

		const result = await attachMeetingTranscriptFile(
			api,
			{
				id: MEETING_ID,
				version: 3
			} as never,
			new File(['hello'], 'notes.txt', { type: 'text/plain' }),
			{ fetchImpl }
		);

		expect(createUploadIntent).toHaveBeenCalledWith(
			'meeting',
			MEETING_ID,
			expect.objectContaining({
				name: 'notes.txt',
				category: 'transcript',
				mime_type: 'text/plain'
			}),
			undefined
		);
		expect(fetchImpl).toHaveBeenCalledWith(
			'https://upload.test/put',
			expect.objectContaining({ method: 'PUT' })
		);
		expect(attachTranscript).toHaveBeenCalledWith(
			MEETING_ID,
			{
				document_id: DOCUMENT_ID,
				plain_text: 'hello',
				status: 'ready'
			},
			3,
			undefined
		);
		expect(result.version).toBe(4);
		expect(result.transcript_status).toBe('ready');
	});
});
