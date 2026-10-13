import { ImageIcon } from "lucide-react";
import type { JSX } from "react";
import { cn } from "#dev/lib/utils.ts";
import { ITEM } from "./lightbox";
import { outsideCode } from "./markdown";

/**
 * An image named in a line, as the composer writes its chip: `[Image 2]` for
 * the second image the message carries, the order the agent is sent them in.
 */
export const IMAGE_REFERENCE = /\[(Image (\d+))\]/;

/** Where a link written by `linkImages` points, read back by `imageIn`. */
const IMAGE_LINK = /^#image=(\d+)$/;

/** What the image at `at`, counted from 0, among a message's is called. */
export function imageName(at: number): string {
	return `Image ${at + 1}`;
}

/** Which image, counted from 1, `name` calls, or null when it names none. */
export function imageNumber(name: string): number | null {
	const found = /^Image (\d+)$/.exec(name);
	return found === null ? null : Number(found[1]);
}

/**
 * The images a message carries, by file, whose chip is written already or
 * was left out on purpose, so attaching one writes its chip once: not again
 * when it comes back, marked up or sent back unsent.
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
 * `text` with each image chip outside code made a link that `imageIn` reads
 * back, so a sent message draws it as its chip where it stands.
 */
export function linkImages(text: string): string {
	return outsideCode(text, (prose) =>
		prose.replace(
			new RegExp(IMAGE_REFERENCE.source, "g"),
			(_, name: string, at: string) => `[${name}](#image=${at})`,
		),
	);
}

/** The image, counted from 1, a link written by `linkImages` names, or null. */
export function imageIn(href: string | undefined): number | null {
	const link = IMAGE_LINK.exec(href ?? "");
	return link === null ? null : Number(link[1]);
}

/**
 * An image named in a line, as the composer and a sent message draw it. Given
 * `opens`, a tap opens the image it names among those of its message.
 */
export function ImageChip({
	at,
	opens = false,
}: {
	at: number;
	opens?: boolean;
}): JSX.Element {
	const name = imageName(at - 1);
	const inside = (
		<>
			<ImageIcon aria-hidden className="size-3.5 shrink-0" />
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
				tileOf(event.currentTarget, at)?.click();
			}}
			className={cn(CHIP, "cursor-pointer hover:bg-primary/15")}
		>
			{inside}
		</button>
	);
}

const CHIP =
	"inline-flex h-6 shrink-0 items-center gap-1.5 rounded-md border border-primary/25 bg-primary/10 ps-1.5 pe-2 align-middle font-medium text-primary text-xs";

/** The tile of image `at`, counted from 1, in the message `chip` sits in. */
function tileOf(chip: HTMLElement, at: number): HTMLElement | null {
	const message = chip.closest('[data-role="user"]');
	const tiles = message?.querySelectorAll<HTMLElement>(`[${ITEM}]`) ?? [];
	return tiles[at - 1] ?? null;
}
