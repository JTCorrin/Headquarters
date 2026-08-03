/**
 * Visibility-aware interval: ticks only while the document is visible;
 * pauses when hidden; optional immediate callback when returning to visible.
 */

export type DocumentVisibility = 'visible' | 'hidden' | 'prerender' | string;

export type VisibilityPollOptions = {
	intervalMs: number;
	onTick: () => void;
	/** Fired when the tab becomes visible again (not on initial start). */
	onVisible?: () => void;
	/** Debounce for onVisible (default 250ms, plan allows ≤1s). */
	visibleDebounceMs?: number;
	getVisibilityState?: () => DocumentVisibility;
	setIntervalFn?: typeof setInterval;
	clearIntervalFn?: typeof clearInterval;
	addEventListener?: (type: 'visibilitychange', listener: () => void) => void;
	removeEventListener?: (type: 'visibilitychange', listener: () => void) => void;
};

const DEFAULT_VISIBLE_DEBOUNCE_MS = 250;

function defaultVisibility(): DocumentVisibility {
	if (typeof document === 'undefined') return 'visible';
	return document.visibilityState;
}

/**
 * Start a poll that only runs while the page is visible.
 * @returns cleanup function (stops interval + removes listeners)
 */
export function startVisibilityPoll(options: VisibilityPollOptions): () => void {
	const intervalMs = Math.max(1, Math.floor(options.intervalMs));
	const visibleDebounceMs = Math.max(
		0,
		Math.floor(options.visibleDebounceMs ?? DEFAULT_VISIBLE_DEBOUNCE_MS)
	);
	const getVisibilityState = options.getVisibilityState ?? defaultVisibility;
	const setIntervalFn = options.setIntervalFn ?? setInterval;
	const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
	const addEventListener =
		options.addEventListener ??
		((type, listener) => {
			if (typeof document !== 'undefined') {
				document.addEventListener(type, listener);
			}
		});
	const removeEventListener =
		options.removeEventListener ??
		((type, listener) => {
			if (typeof document !== 'undefined') {
				document.removeEventListener(type, listener);
			}
		});

	let timer: ReturnType<typeof setInterval> | undefined;
	let visibleDebounce: ReturnType<typeof setTimeout> | undefined;
	let lastVisible = getVisibilityState() === 'visible';

	function stopTimer() {
		if (timer !== undefined) {
			clearIntervalFn(timer);
			timer = undefined;
		}
	}

	function startTimer() {
		stopTimer();
		if (getVisibilityState() !== 'visible') return;
		timer = setIntervalFn(() => {
			if (getVisibilityState() !== 'visible') return;
			options.onTick();
		}, intervalMs);
	}

	function onVisibilityChange() {
		const visible = getVisibilityState() === 'visible';
		if (visible) {
			startTimer();
			if (!lastVisible) {
				if (visibleDebounce !== undefined) clearTimeout(visibleDebounce);
				visibleDebounce = setTimeout(() => {
					visibleDebounce = undefined;
					if (getVisibilityState() === 'visible') {
						options.onVisible?.();
					}
				}, visibleDebounceMs);
			}
		} else {
			stopTimer();
			if (visibleDebounce !== undefined) {
				clearTimeout(visibleDebounce);
				visibleDebounce = undefined;
			}
		}
		lastVisible = visible;
	}

	addEventListener('visibilitychange', onVisibilityChange);
	if (lastVisible) startTimer();

	return () => {
		stopTimer();
		if (visibleDebounce !== undefined) {
			clearTimeout(visibleDebounce);
			visibleDebounce = undefined;
		}
		removeEventListener('visibilitychange', onVisibilityChange);
	};
}

/** Keep selection when the id still exists; otherwise clear. */
export function preserveSelectedMessageId(
	selectedId: string | undefined,
	messageIds: Iterable<string>
): string | undefined {
	if (!selectedId) return undefined;
	for (const id of messageIds) {
		if (id === selectedId) return selectedId;
	}
	return undefined;
}
