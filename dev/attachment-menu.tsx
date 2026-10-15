import { useAui, useAuiState } from "@assistant-ui/react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	AlertCircleIcon,
	EyeIcon,
	LoaderCircleIcon,
	PencilIcon,
	XIcon,
} from "lucide-react";
import { type JSX, use, useRef, useState } from "react";
import { useAnnotate } from "./annotate";
import { Annotation } from "./annotation";
import {
	ATTACHMENT_CHIP,
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
import { useFileSrc } from "./hooks/use-file-src";
import { cn } from "./lib/utils";
import { useLightbox } from "./lightbox";

/** Where an SVG is kept, which cannot be marked up. */
const SVG = /\.svg$/i;

/**
 * The chip of an attachment on its way, the only place the composer shows it:
 * a tap opens a menu to view it in the lightbox, mark it up when it is an
 * image, or remove it, its chips with it.
 */
export function AttachmentMenu({ placed }: { placed: Placed }): JSX.Element {
	const aui = useAui();
	const [editor] = useLexicalComposerContext();
	const forget = use(ForgetAttachment);
	const attachment = useAuiState(
		(state) =>
			state.composer.attachments.filter(
				(each) => shelfOf(each.type) === placed.shelf,
			)[placed.at - 1],
	);
	const file = attachment?.file;
	const src = useFileSrc(file);
	const kind = kindOf(attachment?.type ?? "", attachment?.contentType);
	const name = attachment?.name ?? "";
	const markable =
		attachment?.type === "image" && file !== undefined && !SVG.test(name);
	// Marked up, the keyboard goes back to writing.
	const input = useRef<HTMLElement | null>(null);
	const annotator = useAnnotate(input);
	const markUp = async () => {
		if (attachment === undefined || file === undefined) {
			return;
		}
		input.current = editor.getRootElement();
		const marked = await annotator.open(file);
		if (marked !== file) {
			// It keeps the chip the image it stands in for has.
			chippedAlready(marked);
			await replace(aui.composer(), attachment.id, marked);
			input.current?.focus();
		}
	};
	const { open, lightbox } = useLightbox(markable ? markUp : undefined);
	const chip = useRef<HTMLButtonElement>(null);
	const view = () => {
		if (kind === "file") {
			window.open(src, "_blank", "noreferrer");
		} else if (chip.current !== null) {
			open(chip.current);
		}
	};
	const [asking, setAsking] = useState(false);
	const marks = Annotation.marksOn(file);
	const remove = () => {
		if (attachment === undefined) {
			return;
		}
		forget(placed);
		void aui.composer().attachment({ id: attachment.id }).remove();
	};
	const status = attachment?.status;
	const failed =
		status?.type === "incomplete" && status.reason === "error"
			? (status.message ?? "Upload failed")
			: undefined;
	const uploading = status?.type === "running";
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
