import { beforeAll, beforeEach, describe, expect, it } from "bun:test";
import type { Opening, Pushed } from "./worker";

describe("the page's service worker", () => {
	let scope: FakeScope;

	beforeAll(async () => {
		scope = new FakeScope();
		const own = Object.getOwnPropertyDescriptor(globalThis, "self");
		Object.defineProperty(globalThis, "self", {
			configurable: true,
			value: scope,
		});
		try {
			await import("./worker");
		} finally {
			if (own !== undefined) {
				Object.defineProperty(globalThis, "self", own);
			}
		}
	});

	beforeEach(() => {
		scope.shown = [];
		scope.windows = [];
	});

	it("shows a pushed notice, its click opening the row on the page's own address", async () => {
		await scope.push(PUSHED);

		expect(scope.shown).toEqual([
			{
				title: "Fix finished",
				options: {
					body: "Merged it.",
					tag: "conversation c1",
					data: {
						key: "conversation c1",
						url: "https://arbor.example.com/?project=alpha#conversations/c1",
					} satisfies Opening,
				},
			},
		]);
	});

	it("shows nothing while a window is in front, unless asked to", async () => {
		scope.windows = [{ url: "https://arbor.example.com/", focused: true }];

		await scope.push(PUSHED);
		await scope.push({ ...PUSHED, inFront: true });

		expect(scope.shown).toHaveLength(1);
	});

	it("shows it while the page's window is in the background", async () => {
		scope.windows = [{ url: "https://arbor.example.com/", focused: false }];

		await scope.push(PUSHED);

		expect(scope.shown).toHaveLength(1);
	});
});

/** The parts of a worker's scope `worker.ts` uses, keeping what it showed. */
class FakeScope {
	readonly listeners = new Map<string, (event: unknown) => void>();
	shown: { title: string; options: NotificationOptions }[] = [];
	windows: { url: string; focused: boolean }[] = [];
	readonly registration = {
		scope: "https://arbor.example.com/",
		showNotification: async (title: string, opts: NotificationOptions) => {
			this.shown.push({ title, options: opts });
		},
	};
	readonly clients = {
		claim: async () => {},
		matchAll: async () => this.windows,
		openWindow: async () => {},
	};
	async skipWaiting(): Promise<void> {}
	addEventListener(type: string, listener: (event: unknown) => void): void {
		this.listeners.set(type, listener);
	}

	/** Delivers `pushed` as a push, settling once the worker has handled it. */
	async push(pushed: Pushed): Promise<void> {
		let done: Promise<unknown> = Promise.resolve();
		this.listeners.get("push")?.({
			data: { json: () => pushed },
			waitUntil: (work: Promise<unknown>) => {
				done = work;
			},
		});
		await done;
	}
}

const PUSHED: Pushed = {
	title: "Fix finished",
	body: "Merged it.",
	key: "conversation c1",
	url: "?project=alpha#conversations/c1",
	inFront: false,
};
