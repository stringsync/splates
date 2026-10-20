import { type JSX, type RefObject, useEffect, useRef, useState } from "react";
import { Annotation } from "./annotation";
import { Annotate } from "./lazy-pages";

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
	const shown = useRef(false);
	const finish = useRef<(file: File) => void>(() => {});
	// Each one opened lets go of its image once it closes, or the page does.
	useEffect(() => () => annotation?.dispose(), [annotation]);
	const open = async (file: File) => {
		const opened = await Annotation.open(file);
		shown.current = true;
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
			<>
				{shown.current && (
					<Annotate
						annotation={annotation}
						onDone={() => void done()}
						finalFocus={finalFocus}
					/>
				)}
			</>
		),
	};
}
