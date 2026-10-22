import { type JSX, useContext, useState } from "react";
import { useAnnotate } from "./annotate";
import { answered, WAITS } from "./api";
import { Composing } from "./composing";
import { Lightbox } from "./lazy-pages";

/** One screenshot or recording the lightbox can show. */
export interface Shown {
	/** Where the page loads it from. */
	url: string;
	alt: string;
	video: boolean;
	/** Its file's name, where `url` does not end in it. */
	name?: string;
}

/** Marks the media one lightbox steps through: the media of one document. */
export const GROUP = "data-lightbox-group";

/** Marks a screenshot or recording, carrying what the lightbox shows of it. */
export const ITEM = "data-lightbox";

/**
 * Every screenshot and recording in the document `from` sits in, in the order
 * they read, so the lightbox steps through what the reader sees around the
 * one they opened. Outside a document, `from` is shown alone.
 */
export function gallery(from: Element): Shown[] {
	const group = from.closest(`[${GROUP}]`);
	const items = group ? [...group.querySelectorAll(`[${ITEM}]`)] : [from];
	return items.flatMap((item) => {
		const shown = item.getAttribute(ITEM);
		return shown ? [JSON.parse(shown) as Shown] : [];
	});
}

/**
 * A lightbox to render beside the media, and `open`, which shows the media
 * `from` is, or sits in, among the others of its document. Given `markUp`,
 * its Mark up button hands it the image shown, rather than adding a marked
 * up copy to the composer.
 */
export function useLightbox(markUp?: (image: Shown) => Promise<void>): {
	open: (from: Element) => void;
	/** Shows `items[at]`, stepping through `items`. */
	show: (items: Shown[], at: number) => void;
	lightbox: JSX.Element;
} {
	const [items, setItems] = useState<Shown[]>([]);
	const [index, setIndex] = useState<number | null>(null);
	const open = (from: Element) => {
		const item = from.closest(`[${ITEM}]`) ?? from;
		const all = gallery(item);
		const url = (JSON.parse(item.getAttribute(ITEM) ?? "{}") as Partial<Shown>)
			.url;
		setItems(all);
		setIndex(
			Math.max(
				0,
				all.findIndex((item) => item.url === url),
			),
		);
	};
	const show = (items: Shown[], at: number) => {
		setItems(items);
		setIndex(at);
	};
	return {
		open,
		show,
		lightbox: (
			<>
				{items.length > 0 && (
					<Lightbox
						items={items}
						index={index}
						onIndex={setIndex}
						onClose={() => setIndex(null)}
						markUp={markUp}
					/>
				)}
			</>
		),
	};
}

/**
 * Marks up an image in a conversation and adds it to the composer, to go back
 * to the agent; `markUp` is null where no conversation is open. Render
 * `annotate` beside whatever calls it.
 */
export function useSendBack(): {
	markUp: ((image: Shown) => Promise<void>) | null;
	annotate: JSX.Element;
} {
	const composer = useContext(Composing);
	const annotator = useAnnotate();
	const markUp = async (image: Shown) => {
		const response = await answered(image.url, { within: WAITS.upload });
		const blob = await response.blob();
		const marked = await annotator.open(
			new File([blob], nameOf(image), { type: blob.type }),
		);
		await composer?.addAttachment(marked);
	};
	return {
		markUp: composer === null ? null : markUp,
		annotate: annotator.annotate,
	};
}

/**
 * A file name for `image`: its own, else from where it is kept, the file a
 * `/api/file` link reads, or the link's own last step.
 */
export function nameOf(image: Shown): string {
	if (image.name !== undefined) {
		return image.name;
	}
	const [link = "", query = ""] = image.url.split("?");
	const path = new URLSearchParams(query).get("path") ?? link;
	// Less the id splates keeps an attached file under.
	const last = (path.split("/").pop() ?? "").replace(/^[0-9a-f-]{36}-/, "");
	return /\.\w+$/.test(last) ? last : "image.png";
}
