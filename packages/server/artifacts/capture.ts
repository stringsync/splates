/**
 * Runs inside the sandboxed plan, where the live DOM is accessible. It sends
 * only a self-contained picture to the parent; the frame keeps no app origin.
 */
function reportCapture(): void {
	addEventListener("message", (event: MessageEvent) => {
		if (event.source !== parent || event.data?.splates !== "capture-plan") {
			return;
		}
		try {
			const copy = (source: Element): Element => {
				if (source instanceof HTMLCanvasElement) {
					const image = document.createElement("img");
					image.src = source.toDataURL();
					image.style.cssText = getComputedStyle(source).cssText;
					image.width = source.clientWidth;
					image.height = source.clientHeight;
					return image;
				}
				const clone = source.cloneNode(false) as Element;
				const style = getComputedStyle(source);
				const css = Array.from(
					style,
					(key) => `${key}:${style.getPropertyValue(key)};`,
				).join("");
				clone.setAttribute("style", `${css}animation:none;transition:none;`);
				for (const attr of Array.from(clone.attributes)) {
					if (attr.name.startsWith("on")) {
						clone.removeAttribute(attr.name);
					}
				}
				if (source instanceof HTMLInputElement) {
					clone.setAttribute("value", source.value);
				}
				for (const child of source.childNodes) {
					if (child instanceof Element) {
						if (["SCRIPT", "STYLE", "LINK"].includes(child.tagName)) {
							continue;
						}
						clone.append(copy(child));
					} else {
						clone.append(child.cloneNode());
					}
				}
				if (source instanceof HTMLTextAreaElement) {
					clone.textContent = source.value;
				}
				return clone;
			};
			const root = copy(document.documentElement);
			root.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
			const width = innerWidth;
			const height = innerHeight;
			const html = new XMLSerializer().serializeToString(root);
			const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject x="${-scrollX}" y="${-scrollY}" width="${width}" height="${Math.max(document.documentElement.scrollHeight, height)}">${html}</foreignObject></svg>`;
			parent.postMessage({ splates: "plan-capture", svg }, "*");
		} catch {
			parent.postMessage(
				{ splates: "plan-capture", error: "The plan could not be captured." },
				"*",
			);
		}
	});
}

/** Script for capturing the visible plan; append it to a page framed for feedback. */
export const CAPTURE_REPORT = `<script>(${reportCapture.toString()})()</script>`;
