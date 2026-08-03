import { describe, expect, it } from 'vitest';
import {
	COMPOSABLE_TIMELINE_EVENT_KINDS,
	isComposableTimelineEventKind,
	isTimelineEventKind,
	timelineKindLabel,
	timelineKindMarkerClass
} from './timeline-kinds.js';

describe('timeline-kinds', () => {
	it('labels conversion with a distinct marker', () => {
		expect(isTimelineEventKind('conversion')).toBe(true);
		expect(timelineKindLabel('conversion')).toBe('Conversion');
		expect(timelineKindMarkerClass('conversion')).toBe('bg-fuchsia-500');
	});

	it('keeps conversion out of the composer kind list', () => {
		expect(COMPOSABLE_TIMELINE_EVENT_KINDS).not.toContain('conversion');
		expect(isComposableTimelineEventKind('conversion')).toBe(false);
		expect(isComposableTimelineEventKind('note')).toBe(true);
	});

	it('falls back for unknown kinds', () => {
		expect(timelineKindLabel('custom')).toBe('custom');
		expect(timelineKindMarkerClass('custom')).toBe('bg-muted-foreground');
	});
});
