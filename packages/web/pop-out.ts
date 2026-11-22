import { useCallback, useEffect, useState } from "react";

/** Whether this browser can pop a card out into a window of its own. */
export function canPopOut(): boolean {
	return pictureInPicture() !== null;
}

/**
 * A window a card pops out into, titled `title`, carrying the page's styles
 * and theme; null until opened and once closed. Only one is open a tab, so
 * opening another closes this one. It closes with the card.
 */
export function usePopOut(title: string): {
	popped: Window | null;
	open: () => Promise<void>;
	close: () => void;
} {
	const [popped, setPopped] = useState<Window | null>(null);
	const open = useCallback(async () => {
		const pip = pictureInPicture();
		if (pip === null) {
			return;
		}
		const opened = await pip.requestWindow({ width: 380, height: 560 });
		opened.document.title = title;
		copyLook(document, opened.document);
		opened.addEventListener("pagehide", () => setPopped(null), {
			once: true,
		});
		setPopped(opened);
	}, [title]);
	const close = useCallback(() => popped?.close(), [popped]);
	// The theme switched while it is open follows it there.
	useEffect(() => {
		if (popped === null) {
			return;
		}
		const watch = new MutationObserver(() =>
			copyRoot(document, popped.document),
		);
		watch.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class", "style", "data-theme"],
		});
		return () => watch.disconnect();
	}, [popped]);
	useEffect(() => () => popped?.close(), [popped]);
	return { popped, open, close };
}

/** Copies `from`'s stylesheets and theme into `to`. */
function copyLook(from: Document, to: Document): void {
	for (const node of from.head.querySelectorAll(
		'style, link[rel="stylesheet"]',
	)) {
		to.head.append(node.cloneNode(true));
	}
	// Rules a script added to a sheet, not written in its node, are copied as text.
	for (const sheet of from.styleSheets) {
		if (sheet.ownerNode !== null) {
			continue;
		}
		try {
			const style = to.createElement("style");
			style.textContent = [...sheet.cssRules]
				.map((rule) => rule.cssText)
				.join("\n");
			to.head.append(style);
		} catch {
			// A sheet from another origin keeps its rules to itself.
		}
	}
	copyRoot(from, to);
	to.body.className = from.body.className;
}

function copyRoot(from: Document, to: Document): void {
	to.documentElement.className = from.documentElement.className;
	to.documentElement.style.cssText = from.documentElement.style.cssText;
	const theme = from.documentElement.dataset.theme;
	if (theme !== undefined) {
		to.documentElement.dataset.theme = theme;
	}
}

/**
 * Chrome's Document Picture-in-Picture: a small window that stays above
 * other windows and holds any of the page's markup. Only Chromium browsers
 * have it; elsewhere nothing pops out.
 */
interface DocumentPictureInPicture {
	requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
	readonly window: Window | null;
}

function pictureInPicture(): DocumentPictureInPicture | null {
	return (
		(globalThis as { documentPictureInPicture?: DocumentPictureInPicture })
			.documentPictureInPicture ?? null
	);
}
