import "./register-dom";
import { beforeEach, describe, expect, it } from "bun:test";
import { ReadingPlace } from "#web/components/assistant-ui/elements/thread-place.aui.ts";

describe("ReadingPlace", () => {
	let layout: Layout;
	let place: ReadingPlace;
	beforeEach(() => {
		layout = new Layout();
		place = new ReadingPlace(layout.scroller);
	});

	it("measures how far the message in view moved as earlier ones came in above it", () => {
		layout.scrolled = 300;
		const first = layout.message({ at: 0, height: 200 });
		const read = layout.message({ at: 200, height: 600 });
		place.take();

		layout.move(first, { at: 0, height: 450 });
		layout.move(read, { at: 450 });

		expect(place.drift()).toBe(250);
	});

	it("holds the paragraph read when a card higher in the same reply opens", () => {
		layout.scrolled = 400;
		const reply = layout.message({ at: 0, height: 1000 });
		const card = layout.box(reply, { at: 0, height: 100 });
		const paragraph = layout.box(reply, { at: 300, height: 300 });
		place.take();

		layout.move(card, { at: 0, height: 260 });
		layout.move(paragraph, { at: 460 });

		expect(place.drift()).toBe(160);
	});

	it("passes over a person's message stuck atop the view for the reply under it", () => {
		layout.scrolled = 600;
		const turn = layout.box(layout.scroller, { at: 0, height: 1300 });
		layout.message({ at: 0, height: 60, stuck: true }, turn);
		const reply = layout.message({ at: 100, height: 1200 }, turn);
		place.take();

		layout.move(reply, { at: 220 });

		expect(place.drift()).toBe(120);
	});

	it("holds a person's message put at the top, as one just sent, rather than the reply under it", () => {
		layout.scrolled = 600;
		const turn = layout.box(layout.scroller, { at: 600, height: 700 });
		layout.message({ at: 600, height: 60, stuck: true }, turn);
		const reply = layout.message({ at: 690, height: 600 }, turn);
		place.take();

		layout.move(reply, { at: 686 });

		expect(place.drift()).toBe(0);
	});

	it("falls back to the box around a paragraph the reply rendered away", () => {
		layout.scrolled = 400;
		const reply = layout.message({ at: 100, height: 1000 });
		const paragraph = layout.box(reply, { at: 350, height: 300 });
		place.take();

		paragraph.remove();
		layout.move(reply, { at: 180 });

		expect(place.drift()).toBe(80);
	});

	it("takes a reply starting below the top of the view whole, so what moves inside it is under the place", () => {
		layout.scrolled = 100;
		const reply = layout.message({ at: 180, height: 600 });
		const status = layout.box(reply, { at: 180, height: 40 });
		place.take();

		layout.move(status, { at: 184 });

		expect(place.drift()).toBe(0);
	});

	it("finds no drift where nothing above the place changed", () => {
		layout.scrolled = 100;
		const reply = layout.message({ at: 0, height: 400 });
		place.take();

		layout.move(reply, { at: 0, height: 900 });

		expect(place.drift()).toBe(0);
	});
});

type Box = { at: number; height: number };

/**
 * A thread laid out by hand, as the page has no layout to make: each box `at`
 * a height down the thread, the view 500 tall and scrolled `scrolled` down.
 */
class Layout {
	scrolled = 0;
	readonly scroller = document.createElement("div");
	private readonly boxes = new Map<Element, Box>();
	private count = 0;
	constructor() {
		document.body.replaceChildren(this.scroller);
		this.scroller.getBoundingClientRect = () => new DOMRect(0, 0, 100, 500);
	}
	/**
	 * A message in `turn`, or one that sticks atop it: held at the top of the
	 * view while the turn starts above it.
	 */
	message(
		box: Box & { stuck?: boolean },
		turn: HTMLElement = this.scroller,
	): HTMLElement {
		const element = this.box(turn, box);
		element.dataset.messageId = String(this.count++);
		if (box.stuck === true) {
			element.dataset.sticks = "";
			element.getBoundingClientRect = () =>
				new DOMRect(0, Math.max(box.at - this.scrolled, 0), 100, box.height);
		}
		return element;
	}
	box(parent: HTMLElement, box: Box): HTMLElement {
		const element = document.createElement("div");
		parent.append(element);
		this.boxes.set(element, { ...box });
		element.getBoundingClientRect = () => {
			const { at, height } = this.boxes.get(element) ?? box;
			return new DOMRect(0, at - this.scrolled, 100, height);
		};
		element.getClientRects = () => ({ length: 1 }) as unknown as DOMRectList;
		return element;
	}
	move(element: Element, to: Partial<Box>): void {
		const box = this.boxes.get(element);
		if (box !== undefined) {
			Object.assign(box, to);
		}
	}
}
