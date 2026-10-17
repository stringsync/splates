import { useAui, useAuiState } from "@assistant-ui/react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { mergeRegister } from "@lexical/utils";
import {
	BLUR_COMMAND,
	COMMAND_PRIORITY_HIGH,
	FOCUS_COMMAND,
	KEY_DOWN_COMMAND,
	type LexicalEditor,
} from "lexical";
import {
	AlertCircleIcon,
	EyeIcon,
	LoaderCircleIcon,
	PencilIcon,
	XIcon,
} from "lucide-react";
import { type JSX, use, useEffect, useRef, useState } from "react";
import { useAnnotate } from "./annotate";
import { Annotation } from "./annotation";
import {
	ATTACHMENT_CHIP,
	attachmentName,
	ChipFace,
	chippedAlready,
	ForgetAttachment,
	type Placed,
	shelfOf,
} from "./attachment-chips";
import {
	kindOf,
	shown,
} from "./components/assistant-ui/elements/attachment-thumb";
import { Button } from "./components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { Kbd } from "./components/ui/kbd";
import { Tooltip, TooltipContent } from "./components/ui/tooltip";
import { AttachmentChips } from "./composer-editor";
import { useFileSrc } from "./hooks/use-file-src";
import { useBinding, useShortcutLabel } from "./hooks/use-shortcut";
import { cn } from "./lib/utils";
import { useLightbox } from "./lightbox";
import { matches } from "./shortcuts";

/** Where an SVG is kept, which cannot be marked up. */
const SVG = /\.svg$/i;

/**
 * The chip of an attachment on its way in the composer, the only place the
 * composer shows it: a tap opens a menu to view it in the lightbox, mark it
 * up when it is an image, or remove it, its chips with it.
 */
export function AttachmentMenu({ placed }: { placed: Placed }): JSX.Element {
	const aui = useAui();
	const forget = use(ForgetAttachment);
	const attachment = useAuiState(
		(state) =>
			state.composer.attachments.filter(
				(each) => shelfOf(each.type) === placed.shelf,
			)[placed.at - 1],
	);
	const status = attachment?.status;
	return (
		<AttachedMenu
			placed={placed}
			attached={{
				file: attachment?.file,
				name: attachment?.name ?? "",
				kind: kindOf(attachment?.type ?? "", attachment?.contentType),
				image: attachment?.type === "image",
				uploading: status?.type === "running",
				failed:
					status?.type === "incomplete" && status.reason === "error"
						? (status.message ?? "Upload failed")
						: undefined,
				remove: () => {
					if (attachment === undefined) {
						return;
					}
					forget(placed);
					void aui.composer().attachment({ id: attachment.id }).remove();
				},
				replace: (marked) =>
					attachment === undefined
						? Promise.resolve()
						: replace(aui.composer(), attachment.id, marked),
			}}
		/>
	);
}

/** An attachment as its chip's menu works it, wherever it is attached. */
export interface Attached {
	file: File | undefined;
	name: string;
	kind: ReturnType<typeof kindOf>;
	/** Whether it is sent as an image, which can be marked up. */
	image: boolean;
	uploading: boolean;
	/** Why it failed to upload, if it did. */
	failed: string | undefined;
	/** Takes it off, its chips with it. */
	remove(): void;
	/** Puts `marked` in its place, as a mark up does. */
	replace(marked: File): Promise<void>;
}

/**
 * The chip of `attached`, an attachment on its way: a tap opens a menu to
 * view it in the lightbox, mark it up when it is an image, or remove it. While
 * the caret is just after the chip of an image, its shortcut marks it up
 * too, a hint from the chip saying so.
 */
export function AttachedMenu({
	placed,
	attached,
}: {
	placed: Placed;
	attached: Attached;
}): JSX.Element {
	const [editor] = useLexicalComposerContext();
	const { file, name, kind, failed, uploading } = attached;
	const src = useFileSrc(file);
	const markable = attached.image && file !== undefined && !SVG.test(name);
	// Marked up, the keyboard goes back to writing.
	const input = useRef<HTMLElement | null>(null);
	const annotator = useAnnotate(input);
	const markUp = async () => {
		if (file === undefined) {
			return;
		}
		input.current = editor.getRootElement();
		const marked = await annotator.open(file);
		if (marked !== file) {
			// It keeps the chip the image it stands in for has.
			chippedAlready(marked);
			await attached.replace(marked);
			input.current?.focus();
		}
	};
	const { open, lightbox } = useLightbox(markable ? markUp : undefined);
	const chip = useRef<HTMLButtonElement>(null);
	const offering = useMarkUpAtCaret(
		editor,
		markable ? attachmentName(placed.shelf, placed.at - 1) : null,
		markUp,
	);
	const view = () => {
		if (kind === "file") {
			window.open(src, "_blank", "noreferrer");
		} else if (chip.current !== null) {
			open(chip.current);
		}
	};
	const [asking, setAsking] = useState(false);
	const marks = Annotation.marksOn(file);
	const remove = () => attached.remove();
	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger
					ref={chip}
					{...(src !== undefined && kind !== "file"
						? shown(src, name, kind)
						: {})}
					title={failed === undefined ? name : `${name}: ${failed}`}
					className={cn(
						ATTACHMENT_CHIP,
						"cursor-pointer hover:bg-muted data-popup-open:bg-muted",
						failed !== undefined && "border-destructive/60",
					)}
				>
					{uploading ? (
						<LoaderCircleIcon
							aria-hidden
							className="size-3 shrink-0 animate-spin text-muted-foreground"
						/>
					) : failed !== undefined ? (
						<AlertCircleIcon
							aria-hidden
							className="size-3 shrink-0 text-destructive"
						/>
					) : null}
					<ChipFace {...placed} />
				</DropdownMenuTrigger>
				<DropdownMenuContent className="w-auto">
					<DropdownMenuItem disabled={src === undefined} onClick={view}>
						<EyeIcon />
						View
					</DropdownMenuItem>
					{markable && (
						<DropdownMenuItem onClick={() => void markUp()}>
							<PencilIcon />
							Mark up
						</DropdownMenuItem>
					)}
					<DropdownMenuSeparator />
					<DropdownMenuItem
						variant="destructive"
						onClick={() => (marks === 0 ? remove() : setAsking(true))}
					>
						<XIcon />
						Remove
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<Tooltip open={offering !== null}>
				<TooltipContent anchor={chip}>
					Mark up <Kbd>{offering}</Kbd>
				</TooltipContent>
			</Tooltip>
			{lightbox}
			{annotator.annotate}
			<Dialog open={asking} onOpenChange={setAsking}>
				<DialogContent showCloseButton={false}>
					<DialogHeader>
						<DialogTitle>Remove this image?</DialogTitle>
						<DialogDescription>
							{name} goes, and {marks === 1 ? "its mark" : `its ${marks} marks`}{" "}
							with it.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setAsking(false)}>
							Keep
						</Button>
						<Button
							variant="destructive"
							onClick={() => {
								setAsking(false);
								remove();
							}}
						>
							Remove
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

/**
 * The label of the shortcut that marks up attachment `id` with `markUp`,
 * while the caret in `editor` is just after its chip, and the shortcut
 * then; null otherwise, as for no `id` or on a touch device.
 */
function useMarkUpAtCaret(
	editor: LexicalEditor,
	id: string | null,
	// scry-ignore objects-over-callbacks: what the shortcut runs, kept in a ref so a fresh arrow does not re-listen
	markUp: () => Promise<void>,
): string | null {
	const label = useShortcutLabel("shortcuts.markUp");
	const shortcut = useBinding("shortcuts.markUp");
	const [at, setAt] = useState(false);
	const run = useRef(markUp);
	run.current = markUp;
	const on = id !== null && label !== null;
	useEffect(() => {
		if (!on) {
			return;
		}
		const chips = new AttachmentChips(editor);
		const here = () =>
			chips.beforeCaret() === id &&
			editor.getRootElement()?.contains(document.activeElement) === true;
		const check = () => setAt(here());
		check();
		return mergeRegister(
			editor.registerUpdateListener(check),
			// Focus lands after the command runs, and leaves after it too.
			editor.registerCommand(
				FOCUS_COMMAND,
				() => {
					queueMicrotask(check);
					return false;
				},
				COMMAND_PRIORITY_HIGH,
			),
			editor.registerCommand(
				BLUR_COMMAND,
				() => {
					setAt(false);
					return false;
				},
				COMMAND_PRIORITY_HIGH,
			),
			editor.registerCommand(
				KEY_DOWN_COMMAND,
				(event) => {
					if (!matches(event, shortcut) || !here()) {
						return false;
					}
					// Ahead of the paste it would otherwise be.
					event.preventDefault();
					void run.current();
					return true;
				},
				COMMAND_PRIORITY_HIGH,
			),
		);
	}, [editor, on, id, shortcut]);
	return on && at ? label : null;
}

/**
 * Puts `file` in the place of attachment `id` in `composer`. Nothing replaces
 * an attachment where it is, so it goes, with those after it, and they come
 * back in their order.
 */
async function replace(
	composer: ReturnType<ReturnType<typeof useAui>["composer"]>,
	id: string,
	file: File,
): Promise<void> {
	const all = composer.getState().attachments;
	const after = all.slice(all.findIndex((each) => each.id === id) + 1);
	for (const each of [{ id }, ...after]) {
		await composer.attachment({ id: each.id }).remove();
	}
	await composer.addAttachment(file);
	for (const each of after) {
		await composer.addAttachment(
			each.file ?? {
				type: each.type,
				name: each.name,
				contentType: each.contentType,
				content: each.content ?? [],
			},
		);
	}
}
