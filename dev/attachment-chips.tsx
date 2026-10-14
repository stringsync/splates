import { FileIcon, ImageIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#dev/lib/utils.ts";
import { outsideCode } from "./markdown";

/**
 * Which count an attachment is named in: its images, which an agent that
 * takes images sees, and every other file, which it gets as a link.
 */
export type Shelf = "image" | "file";

const WORDS: Record<Shelf, string> = { image: "Image", file: "File" };

/** The shelf an attachment of `type` is counted on. */
export function shelfOf(type: string): Shelf {
	return type === "image" ? "image" : "file";
}

/**
 * An attachment named in a line, as the composer writes its chip: `[Image 2]`
 * for the second image the message carries and `[File 1]` for its first
 * other file, the order the agent is sent each in.
 */
export const ATTACHMENT_REFERENCE = /\[((?:Image|File) (\d+))\]/;

/** Where a link written by `linkAttachments` points, read back by `attachmentIn`. */
const ATTACHMENT_LINK = /^#attached-(image|file)=(\d+)$/;

/** What the attachment at `at`, counted from 0, on its message's `shelf` is called. */
export function attachmentName(shelf: Shelf, at: number): string {
	return `${WORDS[shelf]} ${at + 1}`;
}

/** An attachment by its shelf and its place there, counted from 1. */
export interface Placed {
	shelf: Shelf;
	at: number;
}

/** Which attachment `name` calls, or null when it names none. */
export function attachmentNumber(name: string): Placed | null {
	const found = /^(Image|File) (\d+)$/.exec(name);
	return found === null
		? null
		: {
				shelf: found[1] === "Image" ? "image" : "file",
				at: Number(found[2]),
			};
}

/**
 * The files a message carries whose chip is written already or was left out
 * on purpose, so attaching one writes its chip once: not again when it comes
 * back, marked up or sent back unsent.
 */
const chipped = new WeakSet<File>();

/**
 * Whether `file` is newly attached and wants its chip written, which it
 * wants only once.
 */
export function wantsChip(file: File): boolean {
	if (chipped.has(file)) {
		return false;
	}
	chipped.add(file);
	return true;
}

/** Takes `file` as chipped already, for one that stands in for another. */
export function chippedAlready(file: File): void {
	chipped.add(file);
}

/**
 * `text` with each attachment chip outside code made a link that
 * `attachmentIn` reads back, so a sent message draws it as its chip where it
 * stands.
 */
export function linkAttachments(text: string): string {
	return outsideCode(text, (prose) =>
		prose.replace(
			new RegExp(ATTACHMENT_REFERENCE.source, "g"),
			(_, name: string, at: string) =>
				`[${name}](#attached-${attachmentNumber(name)?.shelf}=${at})`,
		),
	);
}

/** The attachment a link written by `linkAttachments` names, or null. */
export function attachmentIn(href: string | undefined): Placed | null {
	const link = ATTACHMENT_LINK.exec(href ?? "");
	return link === null
		? null
		: { shelf: link[1] as Shelf, at: Number(link[2]) };
}

/**
 * Marks an attachment's tile with its name, which its tooltip shows, for a
 * sent message's chips to open it by.
 */
export const TILE = "data-attachment";

/**
 * An attachment named in a line, as the composer and a sent message draw it.
 * Given `opens`, a tap opens the attachment it names in its message.
 */
export function AttachmentChip({
	shelf,
	at,
	opens = false,
}: Placed & { opens?: boolean }): JSX.Element {
	const name = attachmentName(shelf, at - 1);
	const Icon = shelf === "image" ? ImageIcon : FileIcon;
	const inside = (
		<>
			<Icon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
			{name}
		</>
	);
	if (!opens) {
		return <span className={CHIP}>{inside}</span>;
	}
	return (
		<button
			type="button"
			onClick={(event) => {
				// Opens the image, rather than the message it sits in.
				event.stopPropagation();
				tileOf(event.currentTarget, name)?.click();
			}}
			className={cn(CHIP, "cursor-pointer hover:bg-muted")}
		>
			{inside}
		</button>
	);
}

const CHIP =
	"inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 align-middle font-medium text-foreground/90 text-xs";

/** The tile of the attachment called `name` in the message `chip` sits in. */
function tileOf(chip: HTMLElement, name: string): HTMLElement | null {
	const message = chip.closest('[data-role="user"]');
	return message?.querySelector<HTMLElement>(`[${TILE}="${name}"]`) ?? null;
}
