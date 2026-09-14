import {
	AIHighlight,
	Callout,
	SlashCommand,
	SvelteNodeViewRenderer,
	useEditor
} from '../tiptap/index.ts';
import { all, createLowlight } from 'lowlight';
import { getDefaultExtensions } from '../extensions.ts';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import CodeBlock from './components/CodeBlock.svelte';
import SlashCommandComp from './components/SlashCommand.svelte';
import CalloutComp from './components/Callout.svelte';
import TableOfContents, { getHierarchicalIndexes } from '@tiptap/extension-table-of-contents';
import { setTocItems } from './toc.svelte';
import type { Extensions } from '@tiptap/core';

const lowlight = createLowlight(all);

export interface EdraEditorProps {
	extensions?: Extensions;
	onUpdate?: () => void;
	/**
	 * When true, disables StarterKit history (undo/redo) for use with
	 * Yjs Collaboration. Required because Collaboration handles its own history.
	 */
	collaborative?: boolean;
	callAI?: (
		prompt: string,
		onChunk: (chunk: string) => void,
		onError: (error: Error) => void
	) => Promise<void>;
}

/**
 * Headquarters trim of the upstream Edra editor: media embeds (image, video,
 * audio, iframe) and Mermaid diagrams are removed to keep notes lightweight.
 */
export const createEditor = (props?: EdraEditorProps) =>
	useEditor({
		extensions: [
			...getDefaultExtensions({ undoRedo: !props?.collaborative }),
			...(props?.extensions || []),
			CodeBlockLowlight.configure({
				lowlight
			}).extend({
				addNodeView() {
					return SvelteNodeViewRenderer(CodeBlock);
				}
			}),
			SlashCommand(SlashCommandComp),
			Callout(CalloutComp),
			AIHighlight.configure({
				callAI: props?.callAI || null
			}),
			TableOfContents.configure({
				getIndex: getHierarchicalIndexes,
				onUpdate: (indexes) => {
					setTocItems(indexes);
				}
			})
		],
		onUpdate: props?.onUpdate || (() => {})
	});
