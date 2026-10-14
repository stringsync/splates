import type { TriggerItem } from "@assistant-ui/react";
import { useAui, useAuiState } from "@assistant-ui/react";
import {
	$createDirectiveNodeWithFormatter,
	$isDirectiveNode,
} from "@assistant-ui/react-lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $dfs } from "@lexical/utils";
import {
	$createTextNode,
	$getRoot,
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	$isTextNode,
	COMMAND_PRIORITY_HIGH,
	getNearestEditorFromDOMNode,
	type LexicalEditor,
	type LexicalNode,
	PASTE_COMMAND,
	TextNode,
} from "lexical";
import {
	createContext,
	type RefObject,
	useEffect,
	useLayoutEffect,
} from "react";
import { DIRECTIVES } from "../prompts";
import {
	attachmentName,
	attachmentNumber,
	type Placed,
	shelfOf,
	wantsChip,
} from "./attachment-chips";
import { serialize } from "./composer-chips";
import { TOUCH } from "./hooks/use-touch";

/**
 * Makes each `[ARBOR ...]` directive typed or pasted into the composer's
 * editor a chip once its `]` closes it, the caret after it if it was there.
 */
export function TypedDirectivesPlugin(): null {
	const [editor] = useLexicalComposerContext();
	useEffect(
		() =>
			editor.registerNodeTransform(TextNode, (node) => {
				const text = node.getTextContent();
				const found = new RegExp(DIRECTIVES.source).exec(text);
				if (found === null || editor.isComposing()) {
					return;
				}
				const end = found.index + found[0].length;
				const parts = node.splitText(
					...[found.index, end].filter((at) => at > 0 && at < text.length),
				);
				const typed = parts[found.index === 0 ? 0 : 1];
				if (typed === undefined) {
					return;
				}
				const selection = $getSelection();
				const caretIn =
					$isRangeSelection(selection) &&
					selection.anchor.key === typed.getKey();
				const chip = $createDirectiveNodeWithFormatter(
					{ id: found[0], type: "directive", label: found[0] },
					{ serialize, parse: () => [] },
				);
				typed.replace(chip);
				if (caretIn) {
					chip.selectNext();
				}
			}),
		[editor],
	);
	return null;
}
/**
 * Adds the files pasted into the composer's editor as attachments, as the
 * composer's own box does, rather than leaving them out.
 */
export function PasteFilesPlugin(): null {
	const [editor] = useLexicalComposerContext();
	const aui = useAui();
	useEffect(
		() =>
			editor.registerCommand(
				PASTE_COMMAND,
				(event) => {
					const files = [
						...("clipboardData" in event
							? (event.clipboardData?.files ?? [])
							: []),
					];
					if (
						files.length === 0 ||
						!aui.thread.getState().capabilities.attachments
					) {
						return false;
					}
					event.preventDefault();
					for (const file of files) {
						// One the composer refuses is only left out.
						aui.composer.addAttachment(file).catch(() => undefined);
					}
					return true;
				},
				COMMAND_PRIORITY_HIGH,
			),
		[editor, aui],
	);
	return null;
}
/**
 * Keeps the composer's editor as it was when the agent starts a run on a touch
 * device, where assistant-ui's focus then would raise the keyboard over the
 * reply. Its listener focuses as the run starts, so this one, made in a layout
 * effect to run ahead of it, notes whether the editor had focus, and takes back
 * the focus it gave before the page paints.
 */
export function NoRefocusOnTouchPlugin(): null {
	const [editor] = useLexicalComposerContext();
	const aui = useAui();
	useLayoutEffect(
		() =>
			aui.on("thread.runStart", () => {
				const root = editor.getRootElement();
				if (
					!matchMedia(TOUCH).matches ||
					root === null ||
					root.contains(document.activeElement)
				) {
					return;
				}
				queueMicrotask(() => editor.blur());
			}),
		[editor, aui],
	);
	return null;
}
/**
 * Writes the chip of each attachment as it is attached, at the caret, once:
 * not when it comes back, marked up or with an unsent draft, or when its chip
 * is in the text already.
 */
export function AttachmentChipsPlugin(): null {
	const [editor] = useLexicalComposerContext();
	const attachments = useAuiState((state) => state.composer.attachments);
	useEffect(() => {
		// Each is named by its place on its shelf, images apart from the rest.
		for (const shelf of ["image", "file"] as const) {
			const shelved = attachments.filter(
				(each) => shelfOf(each.type) === shelf,
			);
			shelved.forEach((attachment, at) => {
				if (attachment.file === undefined || !wantsChip(attachment.file)) {
					return;
				}
				$write(editor, attachmentName(shelf, at));
			});
		}
	}, [editor, attachments]);
	return null;
}
/** Writes the chip of attachment `id` at the caret, unless it is there already. */
function $write(editor: LexicalEditor, id: string): void {
	editor.update(() => {
		if ($attachmentChips().some((chip) => chip.getDirectiveItem().id === id)) {
			return;
		}
		const chip = $chip(id);
		const found = $getSelection();
		const selection = $isRangeSelection(found) ? found : $getRoot().selectEnd();
		// Apart from a word it would otherwise run into.
		const { anchor } = selection;
		const node = anchor.getNode();
		if (
			$isTextNode(node) &&
			/\S$/.test(node.getTextContent().slice(0, anchor.offset))
		) {
			selection.insertText(" ");
		}
		selection.insertNodes([chip]);
		$spaceAfter(chip);
	});
}
/** The chip of attachment `id`. */
function $chip(id: string) {
	return $createDirectiveNodeWithFormatter(
		{ id, type: "attachment", label: id },
		{ serialize, parse: () => [] },
	);
}
/** The attachment chips in the composer's editor, in the order they stand. */
function $attachmentChips() {
	return $dfs()
		.map(({ node }) => node)
		.filter($isDirectiveNode)
		.filter((node) => node.getDirectiveItem().type === "attachment");
}
/** The composer's box, as the page finds it. */
const COMPOSER = '[aria-label="Message input"][contenteditable]';
/**
 * Puts the keyboard in the composer within `scope`, the caret where it was
 * left, or at the end.
 */
export function focusComposer(scope: ParentNode | null = document): void {
	const box = scope?.querySelector<HTMLElement>(COMPOSER) ?? null;
	const editor = getNearestEditorFromDOMNode(box);
	if (editor !== null) {
		editor.focus();
	} else {
		box?.focus();
	}
}
/** The composer within `scope`, for focus to land on. */
export function composerIn(scope: ParentNode): HTMLElement | null {
	return scope.querySelector<HTMLElement>(COMPOSER);
}
/**
 * Writes into the composer's editor from outside it: a chip in place of what
 * was typed just before the caret.
 */
export interface ChipWriter {
	/**
	 * Writes `item` as a chip in place of `typed`, the last thing before the
	 * caret, and a space after it, the caret past both; false when the caret
	 * is not just after `typed`.
	 */
	write(typed: string, item: TriggerItem): boolean;
	/** Writes a space after the chip just before the caret, unless one is there. */
	space(): void;
	/**
	 * Takes out the chips of attachment `placed` as it is removed, and names
	 * those after it on its shelf one lower, as they now are.
	 */
	forget(placed: Placed): void;
}
/**
 * Takes the chips of attachment `placed` out of the composer, as it is
 * removed.
 */
export const ForgetAttachment = createContext<(placed: Placed) => void>(
	() => undefined,
);
/** Wires the composer's editor to `writer`. */
export function ChipWriterPlugin({
	writer,
}: {
	writer: RefObject<ChipWriter | null>;
}): null {
	const [editor] = useLexicalComposerContext();
	useEffect(() => {
		writer.current = {
			write: (typed, item) => write(editor, typed, item),
			space: () =>
				editor.update(() => {
					const chip = $beforeCaret();
					if ($isDirectiveNode(chip)) {
						$spaceAfter(chip);
					}
				}),
			forget: (placed) => editor.update(() => $forget(placed)),
		};
		return () => {
			writer.current = null;
		};
	}, [editor, writer]);
	return null;
}
function $forget({ shelf, at }: Placed): void {
	for (const chip of $attachmentChips()) {
		const placed = attachmentNumber(chip.getDirectiveItem().id);
		if (placed?.shelf !== shelf) {
			continue;
		}
		const number = placed.at;
		if (number === at) {
			// With the space written after it.
			const next = chip.getNextSibling();
			if ($isTextNode(next) && next.getTextContent().startsWith(" ")) {
				next.spliceText(0, 1, "");
			}
			chip.remove();
		} else if (number > at) {
			chip.replace($chip(attachmentName(shelf, number - 2)));
		}
	}
}
function write(
	editor: LexicalEditor,
	typed: string,
	item: TriggerItem,
): boolean {
	// Read now, since a key the editor is still handling puts the update off.
	if (!editor.getEditorState().read(() => $endsWith(typed))) {
		return false;
	}
	editor.update(() => {
		const found = $typed(typed);
		if (found === null) {
			return;
		}
		const chip = $createDirectiveNodeWithFormatter(item, {
			serialize,
			parse: () => [],
		});
		found.replace(chip);
		$spaceAfter(chip);
	});
	return true;
}
/** Whether `typed` is the last thing before a collapsed caret. */
function $endsWith(typed: string): boolean {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
		return false;
	}
	const node = selection.anchor.getNode();
	return (
		$isTextNode(node) &&
		node.getTextContent().slice(0, selection.anchor.offset).endsWith(typed)
	);
}
/**
 * `typed`, the last thing before a collapsed caret, split off as a node of its
 * own; null when the caret is not just after it.
 */
function $typed(typed: string): TextNode | null {
	const selection = $getSelection();
	if (!$endsWith(typed) || !$isRangeSelection(selection)) {
		return null;
	}
	const { offset } = selection.anchor;
	const node = selection.anchor.getNode() as TextNode;
	const start = offset - typed.length;
	const parts = node.splitText(...[start, offset].filter((at) => at > 0));
	return parts[start === 0 ? 0 : 1] ?? null;
}
/** The node just before a collapsed caret, if any. */
function $beforeCaret(): LexicalNode | null {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
		return null;
	}
	const { anchor } = selection;
	const node = anchor.getNode();
	if ($isElementNode(node)) {
		return node.getChildAtIndex(anchor.offset - 1);
	}
	return anchor.offset === 0 ? node.getPreviousSibling() : null;
}
/** Puts the caret after `node` and a space, writing the space unless one is there. */
function $spaceAfter(node: LexicalNode): void {
	const next = node.getNextSibling();
	if ($isTextNode(next) && next.getTextContent().startsWith(" ")) {
		next.select(1, 1);
	} else {
		const space = $createTextNode(" ");
		node.insertAfter(space);
		space.select(1, 1);
	}
}
