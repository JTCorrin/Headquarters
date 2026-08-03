import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	preserveSelectedMessageId,
	startVisibilityPoll,
	type DocumentVisibility
} from './visibility-poll.js';

describe('preserveSelectedMessageId', () => {
	it('keeps the id when it still exists', () => {
		expect(preserveSelectedMessageId('a', ['b', 'a', 'c'])).toBe('a');
	});

	it('clears the id when the message disappeared', () => {
		expect(preserveSelectedMessageId('gone', ['a', 'b'])).toBeUndefined();
	});

	it('returns undefined when nothing was selected', () => {
		expect(preserveSelectedMessageId(undefined, ['a'])).toBeUndefined();
	});
});

describe('startVisibilityPoll', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('ticks on the interval while visible and stops after cleanup', () => {
		vi.useFakeTimers();
		let visibility: DocumentVisibility = 'visible';
		const onTick = vi.fn();
		const listeners = new Set<() => void>();
		const intervals = new Map<number, () => void>();
		let nextId = 1;

		const stop = startVisibilityPoll({
			intervalMs: 45_000,
			onTick,
			getVisibilityState: () => visibility,
			setIntervalFn: ((fn: () => void, _ms?: number) => {
				const id = nextId++;
				intervals.set(id, fn);
				return id as unknown as ReturnType<typeof setInterval>;
			}) as typeof setInterval,
			clearIntervalFn: ((id: ReturnType<typeof setInterval>) => {
				intervals.delete(id as unknown as number);
			}) as typeof clearInterval,
			addEventListener: (_type, listener) => {
				listeners.add(listener);
			},
			removeEventListener: (_type, listener) => {
				listeners.delete(listener);
			}
		});

		expect(intervals.size).toBe(1);
		for (const fn of intervals.values()) fn();
		expect(onTick).toHaveBeenCalledTimes(1);

		stop();
		expect(intervals.size).toBe(0);
		expect(listeners.size).toBe(0);
	});

	it('pauses ticks while hidden and resumes when visible again', () => {
		vi.useFakeTimers();
		let visibility: DocumentVisibility = 'visible';
		const onTick = vi.fn();
		const onVisible = vi.fn();
		const listeners = new Set<() => void>();
		const intervals = new Map<number, () => void>();
		let nextId = 1;

		startVisibilityPoll({
			intervalMs: 45_000,
			onTick,
			onVisible,
			visibleDebounceMs: 250,
			getVisibilityState: () => visibility,
			setIntervalFn: ((fn: () => void) => {
				const id = nextId++;
				intervals.set(id, fn);
				return id as unknown as ReturnType<typeof setInterval>;
			}) as typeof setInterval,
			clearIntervalFn: ((id: ReturnType<typeof setInterval>) => {
				intervals.delete(id as unknown as number);
			}) as typeof clearInterval,
			addEventListener: (_type, listener) => {
				listeners.add(listener);
			},
			removeEventListener: (_type, listener) => {
				listeners.delete(listener);
			}
		});

		visibility = 'hidden';
		for (const listener of listeners) listener();
		expect(intervals.size).toBe(0);

		visibility = 'visible';
		for (const listener of listeners) listener();
		expect(intervals.size).toBe(1);
		expect(onVisible).toHaveBeenCalledTimes(0);

		vi.advanceTimersByTime(250);
		expect(onVisible).toHaveBeenCalledTimes(1);

		for (const fn of intervals.values()) fn();
		expect(onTick).toHaveBeenCalledTimes(1);
	});

	it('does not fire onVisible on the initial visible start', () => {
		const onVisible = vi.fn();
		const stop = startVisibilityPoll({
			intervalMs: 45_000,
			onTick: () => {},
			onVisible,
			getVisibilityState: () => 'visible',
			setIntervalFn: ((fn: () => void) =>
				setInterval(fn, 45_000)) as typeof setInterval,
			clearIntervalFn: clearInterval,
			addEventListener: () => {},
			removeEventListener: () => {}
		});
		expect(onVisible).not.toHaveBeenCalled();
		stop();
	});
});
