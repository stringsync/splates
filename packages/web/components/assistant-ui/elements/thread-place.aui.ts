/** How many levels into a message a mark looks for what is read. */
const DEPTH = 12;
const OUT_OF_FLOW = new Set(["sticky", "absolute", "fixed"]);
/**
 * Where the person is reading in a scrolled thread, and how to keep it there.
 * The mark is the first message in view, but a user message stuck atop its
 * turn never moves, so it is passed over for the reply under it. Within the
 * message it is the innermost box crossing the top of the view, a paragraph
 * or a card, so a disclosure or an image higher up in the same long reply
 * counts as content above it. Each box on the way down is kept too: one the
 * message re-renders away gives its place to the box around it.
 */
export class ReadingPlace {
	private marks: { element: HTMLElement; offset: number }[] = [];
	constructor(private readonly scroller: HTMLElement) {}
	/** Takes the place being read now, as after a scroll. */
	take(): void {
		const top = this.top();
		const message = this.message(top);
		this.marks = [];
		for (
			let at: HTMLElement | undefined = message, depth = 0;
			at !== undefined && depth < DEPTH;
			at = this.crossing(at, top), depth++
		) {
			this.marks.push({ element: at, offset: this.offsetOf(at, top) });
		}
	}
	/**
	 * How far to scroll the thread by to put the place taken last back where
	 * it was on screen; 0 when nothing above it moved.
	 */
	drift(): number {
		// The innermost mark still shown: one folded away has nowhere to be.
		const top = this.top();
		for (const { element, offset } of this.marks.toReversed()) {
			if (
				this.scroller.contains(element) &&
				element.getClientRects().length > 0
			) {
				return this.offsetOf(element, top) - offset;
			}
		}
		return 0;
	}
	private top(): number {
		return this.scroller.getBoundingClientRect().top;
	}
	private offsetOf(element: HTMLElement, top: number): number {
		return element.getBoundingClientRect().top - top;
	}
	private message(top: number): HTMLElement | undefined {
		let stuck: HTMLElement | undefined;
		for (const message of this.scroller.querySelectorAll<HTMLElement>(
			"[data-message-id]",
		)) {
			const box = message.getBoundingClientRect();
			if (box.bottom <= top) {
				continue;
			}
			// Stuck atop the view, it stays put whatever moves, so the reply
			// under it is the place; unless nothing comes under it.
			if (this.stuck(message, box)) {
				stuck ??= message;
				continue;
			}
			return message;
		}
		return stuck;
	}
	/**
	 * Whether `message` is held atop its turn, which then starts above it.
	 * One put at the top, as a message just sent is, sits where it lies.
	 */
	private stuck(message: HTMLElement, box: DOMRect): boolean {
		const turn = message.parentElement;
		return (
			message.hasAttribute("data-sticks") &&
			turn !== null &&
			turn.firstElementChild === message &&
			turn.getBoundingClientRect().top < box.top - 0.5
		);
	}
	/**
	 * The child of `element` in its flow crossing `top`, none when the first
	 * reaching below it starts below it too: then what changes in `element`
	 * is under the place, not above it. One pinned or laid over the rest
	 * moves apart from what is read.
	 */
	private crossing(element: HTMLElement, top: number): HTMLElement | undefined {
		for (const child of element.children) {
			if (
				!(child instanceof HTMLElement) ||
				OUT_OF_FLOW.has(getComputedStyle(child).position)
			) {
				continue;
			}
			const box = child.getBoundingClientRect();
			if (box.height > 0 && box.bottom > top) {
				return box.top < top ? child : undefined;
			}
		}
		return undefined;
	}
}
