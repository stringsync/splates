/**
 * Runs inside a sandboxed page: each `<pre class="d2">` holds D2 source,
 * which the frame cannot draw itself (it has no origin to load the engine
 * from), so it asks the splates page around it, which answers with the SVG.
 * Also reports document height changes to the parent so inline frames can size
 * to their content, and forwards unconsumed Escape presses so the parent
 * lightbox can close even when focus is inside the frame. Opened on its own,
 * with no page around it, does nothing.
 */
function requestDiagrams(): void {
	if (parent === window) {
		return;
	}
	addEventListener("keydown", (event: KeyboardEvent) => {
		if (event.key !== "Escape" || event.defaultPrevented) {
			return;
		}
		parent.postMessage({ splates: "escape" }, "*");
	});
	let reported = 0;
	const reportHeight = () => {
		const body = document.body;
		const root = document.documentElement;
		const height = Math.ceil(
			body
				? Math.max(body.scrollHeight, body.offsetHeight)
				: (root?.scrollHeight ?? 0),
		);
		if (height > 0 && height !== reported) {
			reported = height;
			parent.postMessage({ splates: "frame-height", height }, "*");
		}
	};
	const waiting = new Map<string, Element>();
	addEventListener("message", (event: MessageEvent) => {
		const data = event.data;
		if (event.source !== parent || data?.splates !== "d2-drawn") {
			return;
		}
		const pre = waiting.get(data.id);
		waiting.delete(data.id);
		if (pre === undefined || typeof data.svg !== "string") {
			return;
		}
		const figure = document.createElement("div");
		figure.className = "d2-diagram";
		figure.style.cssText = "max-width:100%;overflow-x:auto";
		figure.innerHTML = data.svg;
		const svg = figure.querySelector("svg");
		if (svg !== null) {
			// D2 sizes its outer SVG by viewBox alone, which would stretch it to
			// the page's width: draw it at its own width, shrunk to fit.
			const width = svg.viewBox?.baseVal?.width;
			if (!svg.hasAttribute("width") && width) {
				svg.setAttribute("width", String(width));
			}
			svg.style.maxWidth = "100%";
			svg.style.height = "auto";
		}
		pre.replaceWith(figure);
		reportHeight();
	});
	const ask = () => {
		document.querySelectorAll("pre.d2").forEach((pre, at) => {
			const source = pre.textContent?.trim() ?? "";
			if (source === "") {
				return;
			}
			const id = `d2-${at}`;
			waiting.set(id, pre);
			parent.postMessage({ splates: "d2", id, source }, "*");
		});
		reportHeight();
		if (typeof ResizeObserver === "function" && document.documentElement) {
			new ResizeObserver(reportHeight).observe(document.documentElement);
		}
	};
	if (document.readyState === "loading") {
		addEventListener("DOMContentLoaded", ask);
	} else {
		ask();
	}
	addEventListener("load", reportHeight);
}

/** Script that draws a page's `<pre class="d2">` blocks, reports its height, and forwards Escape; served with every page. */
export const DIAGRAM_REQUEST = `<script>(${requestDiagrams.toString()})()</script>`;
