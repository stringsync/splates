import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { type JSX, type RefObject, useEffect, useRef, useState } from "react";
import { AnnotateBoard } from "./annotate-board";
import { Annotation } from "./annotation";

/**
 * An annotator to render beside an image, and `open`, which marks up `file`
 * and settles on what to send in its place once the person is done: the
 * image with the marks drawn in, or `file` itself when there are none. The
 * keyboard goes back to `finalFocus` once it closes, when there is one, and
 * otherwise to where it was before.
 */
export function useAnnotate(finalFocus?: RefObject<HTMLElement | null>): {
	open: (file: File) => Promise<File>;
	annotate: JSX.Element;
} {
	const [annotation, setAnnotation] = useState<Annotation | null>(null);
	const finish = useRef<(file: File) => void>(() => {});
	// Each one opened lets go of its image once it closes, or the page does.
	useEffect(() => () => annotation?.dispose(), [annotation]);
	const open = async (file: File) => {
		const opened = await Annotation.open(file);
		setAnnotation(opened);
		return new Promise<File>((resolve) => {
			finish.current = resolve;
		});
	};
	const done = async () => {
		if (annotation === null) {
			return;
		}
		// Left as it was when the browser cannot draw it.
		const file = await annotation.flatten().catch(() => annotation.original);
		setAnnotation(null);
		finish.current(file);
	};
	return {
		open,
		annotate: (
			<Annotate
				annotation={annotation}
				onDone={() => void done()}
				finalFocus={finalFocus}
			/>
		),
	};
}

/**
 * The image at the size of the window, to mark up: a drag draws a box or an
 * arrow, picked with R and A, a click drops a pin, and each mark takes a
 * note. Marks may go past the image onto the dimmed space around it, which
 * the image sent grows to take in. Done, the close button, a click on the
 * margin around that space or Escape keeps what is drawn; Escape with a note
 * open closes only the note.
 */
export function Annotate({
	annotation,
	onDone,
	finalFocus,
}: {
	/** What is being marked up, or `null` when the dialog is closed. */
	annotation: Annotation | null;
	onDone: () => void;
	/** Where the keyboard goes once it closes, rather than where it was. */
	finalFocus?: RefObject<HTMLElement | null> | undefined;
}): JSX.Element {
	// The board stays while the dialog closes: base-ui holds the backdrop until
	// the popup's own closing animation ends, and a popup gone never ends it.
	const last = useRef(annotation);
	if (annotation !== null) {
		last.current = annotation;
	}
	return (
		<DialogPrimitive.Root
			open={annotation !== null}
			onOpenChange={(open) => {
				if (open || annotation === null) {
					return;
				}
				if (annotation.selected !== null) {
					annotation.select(null);
				} else {
					onDone();
				}
			}}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Backdrop
					forceRender
					className="fixed inset-0 z-50 bg-black/85 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
				/>
				{last.current !== null && (
					<AnnotateBoard
						annotation={last.current}
						onDone={onDone}
						finalFocus={finalFocus}
					/>
				)}
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}
