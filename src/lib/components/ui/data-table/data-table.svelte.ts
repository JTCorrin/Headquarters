import {
	type RowData,
	type TableOptions,
	type TableOptionsResolved,
	type TableState,
	type Updater,
	createTable
} from '@tanstack/table-core';
import { untrack } from 'svelte';

/**
 * Creates a reactive TanStack table object for Svelte 5.
 * Controlled state getters are read in `$effect.pre`; `setOptions` is untracked
 * so option writes cannot feedback into the same effect.
 */
export function createSvelteTable<TData extends RowData>(options: TableOptions<TData>) {
	const resolvedOptions: TableOptionsResolved<TData> = mergeObjects(
		{
			state: {},
			onStateChange() {},
			renderFallbackValue: null,
			mergeOptions: (
				defaultOptions: TableOptions<TData>,
				opts: Partial<TableOptions<TData>>
			) => {
				return mergeObjects(defaultOptions, opts);
			}
		},
		options
	);

	const table = createTable(resolvedOptions);
	let state = $state<TableState>(table.initialState);

	function updateOptions() {
		table.setOptions((prev) => {
			return {
				...prev,
				...flatMerge(resolvedOptions, options),
				state: {
					...state,
					...flatMerge(options.state ?? {})
				},
				onStateChange: (updater: Updater<TableState>) => {
					if (updater instanceof Function) state = updater(state);
					else state = { ...state, ...updater };

					options.onStateChange?.(updater);
				}
			};
		});
	}

	updateOptions();

	$effect.pre(() => {
		// Subscribe to controlled state / data getters (outside untrack).
		const optState = options.state;
		if (optState) {
			for (const key of Object.keys(optState)) {
				void (optState as Record<string, unknown>)[key];
			}
		}
		void options.data;
		void state.sorting;
		void state.pagination;
		void state.columnFilters;
		void state.columnVisibility;
		void state.rowSelection;

		untrack(() => {
			updateOptions();
		});
	});

	return table;
}

type MaybeThunk<T extends object> = T | (() => T | null | undefined);
type Intersection<T extends readonly unknown[]> = (T extends [infer H, ...infer R]
	? H & Intersection<R>
	: unknown) & {};

/** Eager plain merge — resolves getters once so TanStack does not nest Proxies. */
function flatMerge<T extends Record<string, unknown>>(...sources: Array<T | null | undefined>): T {
	const out: Record<string, unknown> = {};
	for (const src of sources) {
		if (!src) continue;
		for (const key of Object.keys(src)) {
			const value = (src as Record<string, unknown>)[key];
			if (value !== undefined) out[key] = value;
		}
	}
	return out as T;
}

/**
 * Lazily merges several objects (or thunks) while preserving
 * getter semantics from every source. Used at init only.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mergeObjects<Sources extends readonly MaybeThunk<any>[]>(
	...sources: Sources
): Intersection<{ [K in keyof Sources]: Sources[K] }> {
	const resolve = <T extends object>(src: MaybeThunk<T>): T | undefined =>
		typeof src === 'function' ? (src() ?? undefined) : src;

	const findSourceWithKey = (key: PropertyKey) => {
		for (let i = sources.length - 1; i >= 0; i--) {
			const obj = resolve(sources[i]);
			if (obj && key in obj) return obj;
		}
		return undefined;
	};

	return new Proxy(Object.create(null), {
		get(_, key) {
			const src = findSourceWithKey(key);
			return src?.[key as never];
		},
		has(_, key) {
			return !!findSourceWithKey(key);
		},
		ownKeys(): (string | symbol)[] {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const all = new Set<string | symbol>();
			for (const s of sources) {
				const obj = resolve(s);
				if (obj) {
					for (const k of Reflect.ownKeys(obj) as (string | symbol)[]) {
						all.add(k);
					}
				}
			}
			return [...all];
		},
		getOwnPropertyDescriptor(_, key) {
			const src = findSourceWithKey(key);
			if (!src) return undefined;
			return {
				configurable: true,
				enumerable: true,
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				value: (src as any)[key],
				writable: true
			};
		}
	}) as Intersection<{ [K in keyof Sources]: Sources[K] }>;
}
