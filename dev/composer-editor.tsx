import type {
	TriggerItem,
	Unstable_DirectiveFormatter,
} from "@assistant-ui/react";
import { useAui, useAuiState } from "@assistant-ui/react";
import {
	$createDirectiveNodeWithFormatter,
	$isDirectiveNode,
	type DirectiveChipProps,
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
import { LoaderCircleIcon } from "lucide-react";
import { createContext, type JSX, type RefObject, use, useEffect } from "react";
import { DIRECTIVES } from "../prompts";
import {
	ATTACHMENT_REFERENCE,
	AttachmentChip,
	attachmentName,
	attachmentNumber,
	type Placed,
	shelfOf,
	wantsChip,
} from "./attachment-chips";
import { DirectiveChip } from "./directives";
import {
	NAMING,
	type Named,
	NamedChip,
	NamedContext,
	reading,
	untrailed,
} from "./mentioned";

/**
 * A reference as the agent reads it: `@path` for a file, `#name` for a
 * system, `/name` for a command, `[Image 2]` or `[File 1]` for an attachment,
 * and an `[ARBOR ...]` directive as itself.
 */
function serialize(item: TriggerItem): string {
	if (item.type === "attachment") {
		return `[${item.id}]`;
	}
	const sign = { file: "@", system: "#", command: "/" }[item.type] ?? "";
	return `${sign}${item.id}`;
}

/**
 * An `[ARBOR ...]` directive, a `#` or `@` reference, or an attachment's
 * `[Image 2]` or `[File 1]`, in a line.
 */
const REFERENCES = new RegExp(
	`${DIRECTIVES.source}|${NAMING.source}|${ATTACHMENT_REFERENCE.source}`,
	"gu",
);

/** What a system's name could be, for a `#` read before the systems come. */
const NAME = /^\p{L}[\p{L}\p{N}_-]*$/u;

/**
 * Reads the `[ARBOR ...]` directives, and the `@path` and `#system`
 * references, in a line of the composer's text, set from outside it, as a
 * draft or a prompt is, into chips. A directive or an attachment is always one; a
 * reference
 * that names a path or system of `named` is a chip, and so is any while what it
 * could name is still on its way, for its chip to resolve; one that names
 * nothing, such as `#12`, stays text.
 */
export function chipFormatter(named: Named): Unstable_DirectiveFormatter {
	/** What `called` reads as after `sign`, if it is a chip. */
	const chipped = (sign: string, called: string): string | undefined => {
		const resolving =
			sign === "@" ? named.resolving.paths : named.resolving.systems;
		if (!resolving) {
			return reading(named, sign, called)?.as;
		}
		const as = untrailed(called);
		return sign === "@" || NAME.test(as) ? as : undefined;
	};
	return {
		serialize,
		parse: (text) => {
			const segments: Segment[] = [];
			let at = 0;
			for (const found of text.matchAll(REFERENCES)) {
				const [whole, before = "", sign, called = "", attachment] = found;
				if (attachment !== undefined) {
					if (found.index > at) {
						segments.push({ kind: "text", text: text.slice(at, found.index) });
					}
					segments.push({
						kind: "mention",
						type: "attachment",
						id: attachment,
						label: attachment,
					});
					at = found.index + whole.length;
					continue;
				}
				const as = sign === undefined ? whole : chipped(sign, called);
				if (as === undefined) {
					continue;
				}
				const start = found.index + before.length;
				if (start > at) {
					segments.push({ kind: "text", text: text.slice(at, start) });
				}
				segments.push({
					kind: "mention",
					type:
						sign === undefined ? "directive" : sign === "@" ? "file" : "system",
					id: as,
					label: as,
				});
				at = start + (sign?.length ?? 0) + as.length;
			}
			if (at < text.length || segments.length === 0) {
				segments.push({ kind: "text", text: text.slice(at) });
			}
			return segments;
		},
	};
}

type Segment = ReturnType<Unstable_DirectiveFormatter["parse"]>[number];

/**
 * What each file or directory the composer names is called on its chip, told
 * apart from the others there.
 */
export const FileNames = createContext<ReadonlyMap<string, string>>(new Map());

/**
 * A reference in the composer, drawn as a message draws it: a file or system
 * chip, "Resolving…" while the paths or systems it could name are on their
 * way, and as it was written once they came without it. It sits in a box one
 * line of the composer's text tall, so a chip never makes its line taller.
 */
export function ComposerChip(props: DirectiveChipProps): JSX.Element {
	return (
		<span className="inline-flex h-lh items-center align-top">
			<Chip {...props} />
		</span>
	);
}

function Chip({
	directiveId,
	directiveType,
	label,
}: DirectiveChipProps): JSX.Element {
	const named = use(NamedContext);
	if (directiveType === "directive") {
		return <DirectiveChip directive={directiveId} inline />;
	}
	if (directiveType === "command") {
		return <span className={CHIP}>/{label}</span>;
	}
	if (directiveType === "attachment") {
		return <AttachedChip name={directiveId} />;
	}
	const file = directiveType === "file";
	if (file ? named.resolving.paths : named.resolving.systems) {
		return (
			<span
				title={serialize({ id: directiveId, type: directiveType, label })}
				className={`${CHIP} text-muted-foreground`}
			>
				<LoaderCircleIcon
					aria-hidden
					className="size-3 shrink-0 animate-spin"
				/>
				Resolving…
			</span>
		);
	}
	const names = use(FileNames);
	const found = reading(named, file ? "@" : "#", directiveId)?.target;
	if (found === undefined) {
		return (
			<span>{serialize({ id: directiveId, type: directiveType, label })}</span>
		);
	}
	return (
		<NamedChip
			named={file ? { file: found, name: names.get(found) } : { system: found }}
		/>
	);
}

/**
 * An attachment's chip; as it was written, once what it names is no longer
 * attached, as after a draft comes back without its attachments.
 */
function AttachedChip({ name }: { name: string }): JSX.Element {
	const placed = attachmentNumber(name);
	const attached = useAuiState(
		(state) =>
			state.composer.attachments.filter(
				(each) => shelfOf(each.type) === placed?.shelf,
			).length,
	);
	if (placed === null || placed.at > attached) {
		return <span>[{name}]</span>;
	}
	return <AttachmentChip {...placed} />;
}

const CHIP =
	"inline-flex h-6 items-center gap-1 rounded-md border px-1.5 align-middle font-mono text-xs";

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
