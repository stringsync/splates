import type { D2Draw } from "./d2-draw";

/** The longest D2 source a frame may ask to draw. */
const MOST = 50_000;

/**
 * Draws the D2 diagrams a framed page (a plan page, an HTML artifact) asks
 * for, as the page's served script sends them: `{ splates: "d2", id,
 * source }` in, `{ splates: "d2-drawn", id, svg }` back to that frame.
 * Only frames of this page are answered. Returns what stops listening.
 */
export function answerFrameDiagrams(view: Window, engine: D2Draw): () => void {
	let drawn = 0;
	const heard = (event: MessageEvent) => {
		const data = event.data as {
			splates?: unknown;
			id?: unknown;
			source?: unknown;
		} | null;
		const frame = event.source;
		if (
			data?.splates !== "d2" ||
			typeof data.id !== "string" ||
			typeof data.source !== "string" ||
			data.source.length > MOST ||
			frame === null ||
			!framed(view, frame)
		) {
			return;
		}
		const id = data.id;
		engine
			.draw(data.source, `frame${drawn++}`)
			.then((svg) =>
				(frame as Window).postMessage({ splates: "d2-drawn", id, svg }, "*"),
			)
			.catch(() =>
				(frame as Window).postMessage({ splates: "d2-drawn", id }, "*"),
			);
	};
	view.addEventListener("message", heard);
	return () => view.removeEventListener("message", heard);
}

function framed(view: Window, source: MessageEventSource): boolean {
	return Array.from(view.document.querySelectorAll("iframe")).some(
		(frame) => frame.contentWindow === source,
	);
}
