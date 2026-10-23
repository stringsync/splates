import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	fireEvent,
	message,
	Testing,
	waitFor,
} from "./testing";

describe("Conversation bottom after loading", () => {
	let testing: Testing;
	let height = 1600;
	const watchers = new Set<() => void>();
	const realObserver = globalThis.ResizeObserver;
	const realHeight = Object.getOwnPropertyDescriptor(
		HTMLElement.prototype,
		"scrollHeight",
	);

	beforeEach(() => {
		testing = new Testing();
		height = 1600;
		// happy-dom has no layout or resize delivery; model content settling.
		Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
			configurable: true,
			get: () => height,
		});
		globalThis.ResizeObserver = class {
			private readonly fire: () => void;
			constructor(changed: ResizeObserverCallback) {
				this.fire = () => changed([], this as unknown as ResizeObserver);
			}
			observe() {
				watchers.add(this.fire);
			}
			unobserve() {}
			disconnect() {
				watchers.delete(this.fire);
			}
		} as unknown as typeof ResizeObserver;
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		globalThis.ResizeObserver = realObserver;
		Reflect.deleteProperty(HTMLElement.prototype, "scrollHeight");
		Object.defineProperties(
			HTMLElement.prototype,
			realHeight ? { scrollHeight: realHeight } : {},
		);
		watchers.clear();
	});

	const resize = async (next: number) => {
		height = next;
		await act(async () => {
			// scry-ignore matchers-over-test-logic: delivers the browser's resize callbacks
			for (const fire of watchers) {
				fire();
			}
		});
	};

	it("stays at the bottom through late layout, releases when scrolled up, and follows again on return", async () => {
		const view = await testing.openConversations([
			conversation({
				messages: [
					message("user", "fix the footer"),
					message("agent", "The footer moved."),
				],
			}),
		]);
		const thread = view.container.querySelector(
			'[data-slot="aui_thread-viewport"]',
		) as HTMLElement;
		Object.defineProperty(thread, "clientHeight", { get: () => 500 });
		await waitFor(() => expect(thread.scrollTop).toBe(1600));
		// Confirm arrival before the delayed content, clearing initial scroll intent.
		thread.scrollTop = 1100;
		await act(async () => fireEvent.scroll(thread));

		await resize(2000);
		expect(thread.scrollTop).toBe(2000);
		await act(async () => fireEvent.scroll(thread));
		await resize(2200);
		expect(thread.scrollTop).toBe(2200);

		thread.scrollTop = 400;
		await act(async () => fireEvent.scroll(thread));
		await resize(2400);
		expect(thread.scrollTop).toBe(400);

		thread.scrollTop = 1900;
		await act(async () => fireEvent.scroll(thread));
		await resize(2600);
		expect(thread.scrollTop).toBe(2600);
	});
});
