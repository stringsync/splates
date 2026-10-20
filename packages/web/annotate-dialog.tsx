import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { type JSX, type RefObject, useRef } from "react";
import { AnnotateBoard } from "./annotate-board";
import type { Annotation } from "./annotation";

/**
 * The image at the size of the window, to mark up: a drag draws a box or an
 * arrow, picked with R and A, a click drops a pin, and each mark takes a
 * note. Marks may go past the image into a framed margin around it, which
 * the image sent grows to take in. Done, the close button, a click past that
 * frame or Escape keeps what is drawn; Escape with a note open closes only
 * the note.
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
