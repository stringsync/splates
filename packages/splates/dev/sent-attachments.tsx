import { EyeIcon, PencilIcon } from "lucide-react";
import { createContext, type JSX, use } from "react";
import {
	ATTACHMENT_CHIP,
	ATTACHMENT_REFERENCE,
	attachmentName,
	ChipFace,
	type Placed,
	shelfOf,
} from "./attachment-chips";
import { kindOf } from "./components/assistant-ui/elements/attachment-thumb";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
import { type Shown, useLightbox, useSendBack } from "./lightbox";
import { outsideCode } from "./markdown";

/** A file a sent message carries, where the page loads it from. */
export interface Sent {
	src: string;
	name: string;
	type: string;
	contentType: string | undefined;
}

/** The files the message being drawn carries, in the order it holds them. */
export const SentAttachments = createContext<readonly Sent[]>([]);

/** Where an SVG is kept, which cannot be marked up. */
const SVG = /\.svg$/i;

/** The attachments of `sent` that `text` names no chip for, as chips name them. */
export function unnamed(sent: readonly Sent[], text: string): Placed[] {
	const named = new Set<string>();
	outsideCode(text, (prose) => {
		for (const found of prose.matchAll(
			new RegExp(ATTACHMENT_REFERENCE.source, "g"),
		)) {
			named.add(found[1] as string);
		}
		return prose;
	});
	return placed(sent).filter(
		(each) => !named.has(attachmentName(each.shelf, each.at - 1)),
	);
}

/** Each of `sent` by its shelf and its place there, counted from 1. */
function placed(sent: readonly Sent[]): Placed[] {
	const counts = { image: 0, file: 0 };
	return sent.map((each) => {
		const shelf = shelfOf(each.type);
		counts[shelf] += 1;
		return { shelf, at: counts[shelf] };
	});
}

/**
 * A sent message's chip of attachment `placed`, as the composer drew it: a tap
 * opens a menu to view it, among the message's other images and recordings,
 * or to mark up a copy of an image into the composer.
 */
export function SentAttachmentChip({
	placed,
}: {
	placed: Placed;
}): JSX.Element {
	const sent = use(SentAttachments);
	const attachment = sent.filter((each) => shelfOf(each.type) === placed.shelf)[
		placed.at - 1
	];
	const { show, lightbox } = useLightbox();
	const sendBack = useSendBack();
	if (attachment === undefined) {
		return (
			<span className={ATTACHMENT_CHIP}>
				<ChipFace {...placed} />
			</span>
		);
	}
	const kind = kindOf(attachment.type, attachment.contentType);
	const viewable = sent.filter(
		(each) => kindOf(each.type, each.contentType) !== "file",
	);
	const view = () => {
		if (kind === "file") {
			window.open(attachment.src, "_blank", "noreferrer");
		} else {
			show(viewable.map(shownOf), viewable.indexOf(attachment));
		}
	};
	const markUp = sendBack.markUp;
	const markable =
		markUp !== null && kind === "image" && !SVG.test(attachment.name);
	return (
		// Its menu, the lightbox and the annotator open from the chip, rather
		// than open the message it sits in: their events come up through it.
		// biome-ignore lint/a11y/noStaticElementInteractions: it only keeps events in
		<span
			className="contents"
			onClick={(event) => event.stopPropagation()}
			onKeyDown={(event) => event.stopPropagation()}
		>
			<DropdownMenu>
				<DropdownMenuTrigger
					title={attachment.name}
					className={`${ATTACHMENT_CHIP} cursor-pointer hover:bg-muted data-popup-open:bg-muted`}
				>
					<ChipFace {...placed} />
				</DropdownMenuTrigger>
				<DropdownMenuContent className="w-auto">
					<DropdownMenuItem onClick={view}>
						<EyeIcon />
						View
					</DropdownMenuItem>
					{markable && (
						<DropdownMenuItem
							onClick={() => void markUp(shownOf(attachment)).catch(() => {})}
						>
							<PencilIcon />
							Mark up
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
			{lightbox}
			{sendBack.annotate}
		</span>
	);
}

/** What the lightbox shows of `sent`. */
function shownOf(sent: Sent): Shown {
	return {
		url: sent.src,
		alt: sent.name,
		video: kindOf(sent.type, sent.contentType) === "video",
	};
}
