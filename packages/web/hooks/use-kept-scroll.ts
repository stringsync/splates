import { useMemo } from "react";

/** How far the list was scrolled, kept past the remount a switch of project makes. */
let kept = 0;

/**
 * Props for a scrolling `div` that stays where the person scrolled it,
 * even when the page remounts it, as a switch of project does.
 */
export function useKeptScroll() {
	const scroll = useMemo(() => new KeptScroll(), []);
	return {
		ref: scroll.ref,
		onScroll: scroll.onScroll,
		onWheel: scroll.settle,
		onPointerDown: scroll.settle,
		onKeyDown: scroll.settle,
	};
}

/**
 * Puts a scrolling element back where the person left it when it mounts
 * again. Its content may arrive after it mounts, so it keeps trying as the
 * content grows, and gives up at the person's first input.
 */
class KeptScroll {
	private node: HTMLDivElement | null = null;
	// Whether the element is still being put back, so the scrolls that
	// put or clamp it there are not taken for the person's.
	private restoring = false;

	readonly ref = (node: HTMLDivElement | null) => {
		this.node = node;
		if (node === null) {
			return;
		}
		this.restoring = kept > 0;
		this.restore();
		const watching = new ResizeObserver(() => this.restore());
		for (const child of node.children) {
			watching.observe(child);
		}
		return () => watching.disconnect();
	};

	readonly onScroll = () => {
		if (!this.restoring && this.node !== null) {
			kept = this.node.scrollTop;
		}
	};

	/** The person's own input, which ends any restoring. */
	readonly settle = () => {
		this.restoring = false;
	};

	private restore() {
		if (!this.restoring || this.node === null) {
			return;
		}
		this.node.scrollTop = kept;
		if (this.node.scrollTop >= kept) {
			this.restoring = false;
		}
	}
}
