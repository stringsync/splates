import type { Unstable_DirectiveFormatter } from "@assistant-ui/react";
import {
	$createDirectiveNodeWithFormatter,
	type DirectiveChipProps,
	DirectiveChipProvider,
	DirectiveNode,
} from "@assistant-ui/react-lexical";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { useReactive } from "@webappwiz/react";
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	$getSelection,
	$isRangeSelection,
	$isTextNode,
	$setSelection,
	COMMAND_PRIORITY_HIGH,
	COMMAND_PRIORITY_LOW,
	getNearestEditorFromDOMNode,
	KEY_DOWN_COMMAND,
	type LexicalNode,
	PASTE_COMMAND,
	type TextNode,
} from "lexical";
import {
	createContext,
	type JSX,
	type Ref,
	use,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { cn } from "#dev/lib/utils.ts";
import {
	attachmentName,
	attachmentNumber,
	ForgetAttachment,
	type Placed,
	wantsChip,
} from "./attachment-chips";
import { AttachedMenu } from "./attachment-menu";
import { useThreadSources } from "./box-references";
import { kindOf } from "./components/assistant-ui/elements/attachment-thumb";
import { ComposerChip, chipFormatter } from "./composer-chips";
import { AttachmentChips, TypedDirectivesPlugin } from "./composer-editor";
import type { Files } from "./files";
import { NamedContext } from "./mentioned";
import { MentionMenu, Mentions, placeList, typedAt } from "./mentions";

export interface BoxEditorProps {
	value: string;
	onValue: (text: string) => void;
	/** Where what is attached to it goes; null where a reply carries no files. */
	files: Files | null;
	"aria-label": string;
	/** Where the keys move the focus to, as the cards step through their boxes. */
	"data-stop"?: string | undefined;
	placeholder?: string | undefined;
	className?: string | undefined;
	/** The keys the editor leaves, such as an Enter that sends. */
	onKeyDown?: ((event: KeyboardEvent) => void) | undefined;
	ref?: Ref<HTMLDivElement> | undefined;
	/** The text's inset, which the placeholder keeps to. */
	inset: string;
}

/**
 * A card's answer box as the composer's editor, made small: a reference
 * picked from its `@` or `#` list, and each file attached to it, is the
 * composer's chip where it stands in the words, read as `@path`, `#name` or
 * `[Image 1]`, its files named in the box's own count.
 */
export function BoxEditor(props: BoxEditorProps): JSX.Element {
	const [config] = useState(() => ({
		namespace: "arbor-card-box",
		nodes: [DirectiveNode],
		onError: (error: Error) => {
			throw error;
		},
	}));
	return (
		<LexicalComposer initialConfig={config}>
			<BoxFilesContext value={props.files}>
				<Editor {...props} />
			</BoxFilesContext>
		</LexicalComposer>
	);
}

/** The files of the box being drawn, for its attachment chips. */
const BoxFilesContext = createContext<Files | null>(null);

function Editor({
	value,
	onValue,
	files,
	placeholder,
	className,
	onKeyDown,
	ref,
	inset,
	...props
}: BoxEditorProps): JSX.Element {
	const [editor] = useLexicalComposerContext();
	const named = use(NamedContext);
	const formatter = useMemo(() => chipFormatter(named), [named]);
	const list = useBoxMentions(formatter);
	return (
		<ForgetAttachment
			value={(placed) => new AttachmentChips(editor).forget(placed)}
		>
			<DirectiveChipProvider value={BoxChip}>
				<div className="relative min-w-0 flex-1">
					<PlainTextPlugin
						contentEditable={
							<ContentEditable
								{...props}
								ref={ref}
								className={cn(
									"min-w-0 whitespace-pre-wrap break-words outline-none",
									inset,
									className,
								)}
							/>
						}
						placeholder={
							<div
								className={cn(
									"pointer-events-none absolute top-0 left-0 select-none text-muted-foreground/70",
									inset,
									className,
								)}
							>
								{placeholder}
							</div>
						}
						ErrorBoundary={LexicalErrorBoundary}
					/>
					{list}
				</div>
				<HistoryPlugin />
				<SyncPlugin value={value} onValue={onValue} formatter={formatter} />
				<TypedDirectivesPlugin />
				<KeysPlugin onKeyDown={onKeyDown} />
				{files !== null && <FilesPlugin files={files} />}
			</DirectiveChipProvider>
		</ForgetAttachment>
	);
}

/**
 * Keeps the editor and `value` the same text: each edit is told through
 * `onValue`, and a `value` set from outside, as a take or a draft writes it,
 * is read into chips in place of what the editor holds.
 */
function SyncPlugin({
	value,
	onValue,
	formatter,
}: {
	value: string;
	onValue: (text: string) => void;
	formatter: Unstable_DirectiveFormatter;
}): null {
	const [editor] = useLexicalComposerContext();
	const shown = useRef<string | null>(null);
	const told = useRef(onValue);
	told.current = onValue;
	useLayoutEffect(() => {
		if (value === shown.current) {
			return;
		}
		shown.current = value;
		const typing = editor.getRootElement()?.contains(document.activeElement);
		editor.update(
			() => {
				const root = $getRoot().clear();
				for (const line of value.split("\n")) {
					root.append($line(line, formatter));
				}
				if (typing) {
					root.selectEnd();
				} else {
					$setSelection(null);
				}
			},
			{ discrete: true },
		);
	}, [editor, value, formatter]);
	useEffect(
		() =>
			editor.registerUpdateListener(({ editorState }) => {
				const text = editorState.read($text);
				if (text !== shown.current) {
					shown.current = text;
					told.current(text);
				}
			}),
		[editor],
	);
	return null;
}

/** The editor's text, a line to each paragraph and a chip as what it reads. */
function $text(): string {
	return $getRoot()
		.getChildren()
		.map((line) => (line === null ? "" : line.getTextContent()))
		.join("\n");
}

/** `line` as a paragraph, each reference in it read into its chip. */
function $line(line: string, formatter: Unstable_DirectiveFormatter) {
	const paragraph = $createParagraphNode();
	if (line !== "") {
		paragraph.append(...$nodesOf(line, formatter));
	}
	return paragraph;
}

/** The nodes `text` reads as: its words, and a chip for each reference. */
function $nodesOf(
	text: string,
	formatter: Unstable_DirectiveFormatter,
): LexicalNode[] {
	return formatter
		.parse(text)
		.flatMap((segment): LexicalNode[] =>
			segment.kind === "text"
				? segment.text === ""
					? []
					: [$createTextNode(segment.text)]
				: [
						$createDirectiveNodeWithFormatter(
							{ id: segment.id, type: segment.type, label: segment.label },
							formatter,
						),
					],
		);
}

/**
 * The `@` and `#` the thread's composer offers, as a list over the box: a
 * pick takes the place of what was typed after its sign, as a chip, but for
 * a directory, which keeps the list open on what is inside it.
 */
function useBoxMentions(
	formatter: Unstable_DirectiveFormatter,
): JSX.Element | null {
	const [editor] = useLexicalComposerContext();
	const sources = useThreadSources();
	const [mentions] = useState(() => new Mentions(sources));
	const { matches, active, place, sign } = useReactive(
		mentions,
		(each) => ({
			matches: each.matches,
			active: each.active,
			place: each.place,
			sign: each.sign,
		}),
		["changed"],
	);
	const open = matches.length > 0;
	const pick = useRef<(at?: number) => void>(() => undefined);
	pick.current = (at) => {
		const chosen = matches[at ?? active];
		if (chosen !== undefined) {
			editor.update(() => $pick(chosen.written, formatter));
		}
	};
	useEffect(() => {
		mentions.load();
		return () => mentions.dispose();
	}, [mentions]);
	useEffect(
		() =>
			editor.registerUpdateListener(({ editorState }) =>
				editorState.read(() => {
					const before = $beforeCaret();
					mentions.write(before ?? "", before?.length ?? 0);
				}),
			),
		[editor, mentions],
	);
	useEffect(
		() =>
			editor.registerCommand(
				KEY_DOWN_COMMAND,
				(event) => {
					if (!mentions.open) {
						return false;
					}
					const move = { ArrowDown: 1, ArrowUp: -1 }[event.key];
					if (move !== undefined) {
						mentions.move(move);
					} else if (event.key === "Enter" || event.key === "Tab") {
						pick.current();
					} else if (event.key === "Escape") {
						mentions.dismiss();
					} else {
						return false;
					}
					event.preventDefault();
					// Escape would otherwise close the dialog as well as the list.
					event.stopPropagation();
					return true;
				},
				COMMAND_PRIORITY_HIGH,
			),
		[editor, mentions],
	);
	useEffect(() => {
		const root = editor.getRootElement();
		if (open && root !== null) {
			placeList(mentions, root);
		}
	}, [open, editor, mentions]);
	return open ? (
		<MentionMenu
			label={sign === "@" ? "files" : "references"}
			matches={matches}
			active={active}
			place={place}
			onPick={(chosen) => pick.current(matches.indexOf(chosen))}
			onHover={(index) => mentions.hover(index)}
		/>
	) : null;
}

/** The words before a collapsed caret, back to the chip or line before them. */
function $beforeCaret(): string | null {
	const selection = $getSelection();
	if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
		return null;
	}
	const node = selection.anchor.getNode();
	return $isTextNode(node)
		? node.getTextContent().slice(0, selection.anchor.offset)
		: "";
}

/**
 * Writes `written` in place of the sign before the caret and what follows
 * it: as a chip and a space when it ends in one, and as words otherwise.
 */
function $pick(written: string, formatter: Unstable_DirectiveFormatter): void {
	const selection = $getSelection();
	const before = $beforeCaret();
	const mention = before === null ? null : typedAt(before, before.length);
	if (!$isRangeSelection(selection) || mention === null) {
		return;
	}
	const node = selection.anchor.getNode() as TextNode;
	const { offset } = selection.anchor;
	const done = written.endsWith(" ");
	if (!done) {
		node.spliceText(mention.start, offset - mention.start, written, true);
		return;
	}
	const typed = node.splitText(
		...[mention.start, offset].filter(
			(at) => at > 0 && at < node.getTextContentSize(),
		),
	);
	const replaced = typed[mention.start === 0 ? 0 : 1];
	if (replaced === undefined) {
		return;
	}
	const nodes = $nodesOf(written.trimEnd(), formatter);
	const space = $createTextNode(" ");
	const next = replaced.getNextSibling();
	replaced.replace(nodes[0] ?? space);
	let last = nodes[0] ?? space;
	for (const each of nodes.slice(1)) {
		last.insertAfter(each);
		last = each;
	}
	if ($isTextNode(next) && next.getTextContent().startsWith(" ")) {
		next.select(1, 1);
	} else if (last !== space) {
		last.insertAfter(space);
		space.select(1, 1);
	} else {
		space.select(1, 1);
	}
}

/**
 * Hands the keys the editor and its list leave to `onKeyDown`, and takes
 * each it handles, such as an Enter that sends rather than starts a line.
 */
function KeysPlugin({
	onKeyDown,
}: {
	onKeyDown: ((event: KeyboardEvent) => void) | undefined;
}): null {
	const [editor] = useLexicalComposerContext();
	const told = useRef(onKeyDown);
	told.current = onKeyDown;
	useEffect(
		() =>
			editor.registerCommand(
				KEY_DOWN_COMMAND,
				(event) => {
					told.current?.(event);
					return event.defaultPrevented;
				},
				COMMAND_PRIORITY_LOW,
			),
		[editor],
	);
	return null;
}

/**
 * Attaches the files pasted into the box, and writes the chip of each file
 * attached to it at the caret as it is attached.
 */
function FilesPlugin({ files }: { files: Files }): null {
	const [editor] = useLexicalComposerContext();
	useEffect(
		() =>
			editor.registerCommand(
				PASTE_COMMAND,
				(event) => {
					if (!("clipboardData" in event) || event.clipboardData === null) {
						return false;
					}
					files.paste(
						event as ClipboardEvent & { clipboardData: DataTransfer },
					);
					return event.defaultPrevented;
				},
				COMMAND_PRIORITY_HIGH,
			),
		[editor, files],
	);
	useEffect(() => {
		const chips = new AttachmentChips(editor);
		const write = () => {
			for (const shelf of ["image", "file"] as const) {
				files.on(shelf).forEach((file, at) => {
					if (wantsChip(file)) {
						chips.write(attachmentName(shelf, at));
					}
				});
			}
		};
		write();
		return files.events.on("changed", write);
	}, [editor, files]);
	return null;
}

/**
 * A reference in the box, drawn as the composer draws it, but for an
 * attachment, which is the box's own.
 */
function BoxChip(props: DirectiveChipProps): JSX.Element {
	if (props.directiveType !== "attachment") {
		return <ComposerChip {...props} />;
	}
	return (
		<span className="inline-flex h-lh items-center align-top">
			<BoxAttachment name={props.directiveId} />
		</span>
	);
}

/**
 * The chip of a file attached to the box; as it was written, once the box no
 * longer holds what it names.
 */
function BoxAttachment({ name }: { name: string }): JSX.Element {
	const files = use(BoxFilesContext);
	const placed = attachmentNumber(name);
	if (files === null || placed === null) {
		return <span>[{name}]</span>;
	}
	return <BoxAttached files={files} placed={placed} />;
}

function BoxAttached({
	files,
	placed,
}: {
	files: Files;
	placed: Placed;
}): JSX.Element {
	const forget = use(ForgetAttachment);
	const file = useReactive(
		files,
		(each) => each.on(placed.shelf)[placed.at - 1],
		["changed"],
	);
	if (file === undefined) {
		return <span>[{attachmentName(placed.shelf, placed.at - 1)}]</span>;
	}
	return (
		<AttachedMenu
			placed={placed}
			attached={{
				file,
				name: file.name,
				kind: kindOf(placed.shelf, file.type),
				image: placed.shelf === "image",
				uploading: false,
				failed: undefined,
				remove: () => {
					forget(placed);
					files.remove(file);
				},
				replace: async (marked) => files.replace(file, marked),
			}}
		/>
	);
}

/** Puts the caret at the end of `box`, when it is a box's editor. */
export function caretToEnd(box: HTMLElement): void {
	getNearestEditorFromDOMNode(box)?.update(() => $getRoot().selectEnd());
}
