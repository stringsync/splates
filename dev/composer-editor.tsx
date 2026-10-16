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
	$setSelection,
	COMMAND_PRIORITY_HIGH,
	COMMAND_PRIORITY_LOW,
	FOCUS_COMMAND,
	getNearestEditorFromDOMNode,
	type LexicalEditor,
	type LexicalNode,
	PASTE_COMMAND,
	TextNode,
} from "lexical";
import { type RefObject, useEffect, useLayoutEffect } from "react";
import { Debouncer, Duration, SystemTimer } from "webappwiz/time";
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
 * Keeps the keyboard down after a send on a touch device, so the reply can be
 * read; a message being typed as the agent's run starts keeps its focus.
 * Render it among the composer editor's plugins.
 */
export function KeyboardDownOnTouchPlugin(): null {
	const [editor] = useLexicalComposerContext();
	const aui = useAui();
	// The editor lets go of focus once its message is sent, and keeps it off
	// when the agent starts a run, where assistant-ui's focus would raise the
	// keyboard over the reply; the message just sent, still in the editor as
	// its run starts, is not one being typed.
	// assistant-ui's run listener focuses as the run starts, so this one, made
	// in a layout effect to run ahead of it, notes whether the editor had
	// focus, and takes back the focus it gave before the page paints.
	useLayoutEffect(() => {
		// The run a send starts can begin before the send's blur lands, the
		// page showing the message at once, so it is not one being typed,
		// until the person comes back to the editor.
		let sending = false;
		const back = editor.registerCommand(
			FOCUS_COMMAND,
			() => {
				sending = false;
				return false;
			},
			COMMAND_PRIORITY_LOW,
		);
		const sent = aui.on("composer.send", () => {
			if (matchMedia(TOUCH).matches) {
				sending = true;
				queueMicrotask(() => letGo(editor));
			}
		});
		const started = aui.on("thread.runStart", () => {
			const root = editor.getRootElement();
			const typing = !sending && root?.contains(document.activeElement);
			sending = false;
			if (!matchMedia(TOUCH).matches || root === null || typing) {
				return;
			}
			queueMicrotask(() => letGo(editor));
		});
		return () => {
			back();
			sent();
			started();
		};
	}, [editor, aui]);
	return null;
}
/**
 * Puts the caret back in the editor once what moved it settles, on a touch
 * device, where iOS Safari otherwise leaves it floating over the thread or
 * below the box. Render it inside the editor's composer.
 */
export function CaretInPlacePlugin(): null {
	const [editor] = useLexicalComposerContext();
	// iOS Safari draws the caret where it was placed and leaves it there when
	// the editor moves without an edit; setting the same selection again makes
	// it draw the caret anew. The editor's place is watched each frame while it
	// has the focus, rather than the events that move it: the screen is pinned
	// to the keyboard by a style React sets after the viewport's events, and
	// what sits in the footer can move the box with no event at all.
	useEffect(() => {
		if (!matchMedia(TOUCH).matches) {
			return;
		}
		return editor.registerRootListener((root) => {
			if (root === null) {
				return;
			}
			const settled = new Debouncer(new SystemTimer(), CARET_SETTLE);
			let frame = 0;
			let last = "";
			const watch = () => {
				const box = root.getBoundingClientRect();
				// Where it sits on the page, which is where iOS keeps its caret:
				// the page scrolls under a pinned screen as Safari pans.
				const place = `${box.left + scrollX},${box.top + scrollY}`;
				if (place !== last) {
					if (last !== "") {
						settled.call(() => redrawCaret(root));
					}
					last = place;
				}
				frame = requestAnimationFrame(watch);
			};
			const focused = () => {
				cancelAnimationFrame(frame);
				last = "";
				frame = requestAnimationFrame(watch);
			};
			const blurred = (event: FocusEvent) => {
				if (!root.contains(event.relatedTarget as Node | null)) {
					cancelAnimationFrame(frame);
				}
			};
			root.addEventListener("focusin", focused);
			root.addEventListener("focusout", blurred);
			if (root.contains(document.activeElement)) {
				focused();
			}
			return () => {
				cancelAnimationFrame(frame);
				settled.dispose();
				root.removeEventListener("focusin", focused);
				root.removeEventListener("focusout", blurred);
			};
		});
	}, [editor]);
	return null;
}
/** How long the screen must keep still before the caret is drawn again. */
const CARET_SETTLE = Duration.ms(100);

function redrawCaret(root: HTMLElement): void {
	const selection = getSelection();
	if (
		selection === null ||
		selection.rangeCount === 0 ||
		!root.contains(selection.anchorNode) ||
		!root.contains(document.activeElement)
	) {
		return;
	}
	const range = selection.getRangeAt(0);
	selection.removeAllRanges();
	selection.addRange(range);
}
/**
 * Takes the focus off `editor`, and its selection with it: Lexical puts a
 * selection it still holds back on the page at its next update, which would
 * focus it again.
 */
function letGo(editor: LexicalEditor): void {
	editor.update(() => $setSelection(null), { discrete: true });
	editor.blur();
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
		const chips = new AttachmentChips(editor);
		// Each is named by its place on its shelf, images apart from the rest.
		for (const shelf of ["image", "file"] as const) {
			const shelved = attachments.filter(
				(each) => shelfOf(each.type) === shelf,
			);
			shelved.forEach((attachment, at) => {
				if (attachment.file === undefined || !wantsChip(attachment.file)) {
					return;
				}
				chips.write(attachmentName(shelf, at));
			});
		}
	}, [editor, attachments]);
	return null;
}
/**
 * The attachment chips in an editor's words: write one at the caret as its
 * file is attached, and take one out as its file is removed.
 */
export class AttachmentChips {
	constructor(private readonly editor: LexicalEditor) {}

	/** Writes the chip of attachment `id` at the caret, unless it is there already. */
	write(id: string): void {
		this.editor.update(() => $write(id));
	}

	/**
	 * Takes out the chips of attachment `placed` as it is removed, and names
	 * those after it on its shelf one lower, as they now are.
	 */
	forget(placed: Placed): void {
		this.editor.update(() => $forget(placed));
	}

	/**
	 * The attachment whose chip the caret sits just after, or just after the
	 * space that follows it, as it does once the chip is written; null when
	 * it sits anywhere else.
	 */
	beforeCaret(): string | null {
		return this.editor.getEditorState().read($attachmentBeforeCaret);
	}
}
function $attachmentBeforeCaret(): string | null {
	const selection = $getSelection();
	const anchor = $isRangeSelection(selection) ? selection.anchor : null;
	const node = anchor?.getNode();
	// Past the space written after it, where the caret lands with the chip.
	const before =
		anchor?.type === "text" &&
		node?.getTextContent().slice(0, anchor.offset) === " "
			? node.getPreviousSibling()
			: $beforeCaret();
	return $isDirectiveNode(before) &&
		before.getDirectiveItem().type === "attachment"
		? before.getDirectiveItem().id
		: null;
}
function $write(id: string): void {
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
	focusBox(scope?.querySelector<HTMLElement>(COMPOSER) ?? null);
}
function focusBox(box: HTMLElement | null): void {
	const editor = getNearestEditorFromDOMNode(box);
	if (editor !== null) {
		editor.focus();
	} else {
		box?.focus();
	}
}
/**
 * Where a bare `/` is the user's to type, or a control's own key: a box, a
 * menu, a list, or a dialog over the page.
 */
const KEEPS_SLASH =
	"input, textarea, select, [contenteditable], [role=menu], [role=listbox], [role=dialog], [role=alertdialog]";
/**
 * Puts the keyboard in the page's composer on a bare `/`, as GitHub and Slack
 * do, while it is on screen and the key is not being typed somewhere else.
 * The `/` itself is not typed, so the commands popover stays shut.
 */
export function useSlashFocusesComposer(): void {
	useEffect(() => {
		const press = (event: KeyboardEvent) => {
			if (
				event.key !== "/" ||
				event.defaultPrevented ||
				event.isComposing ||
				event.ctrlKey ||
				event.metaKey ||
				event.altKey ||
				(event.target instanceof Element &&
					event.target.closest(KEEPS_SLASH) !== null)
			) {
				return;
			}
			const box = document.querySelector<HTMLElement>(COMPOSER);
			if (
				box === null ||
				box.getClientRects().length === 0 ||
				box.closest("[inert], [aria-hidden=true]") !== null
			) {
				return;
			}
			event.preventDefault();
			focusBox(box);
		};
		window.addEventListener("keydown", press);
		return () => window.removeEventListener("keydown", press);
	}, []);
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
			forget: (placed) => new AttachmentChips(editor).forget(placed),
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
