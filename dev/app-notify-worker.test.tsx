import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakeWorkers } from "./fake-workers";
import {
	act,
	cleanup,
	conversation,
	details,
	resize,
	Testing,
	waitFor,
} from "./testing";

/** A browser that lets the page notify, keeping what it showed. */
class FakeNotification {
	static permission: NotificationPermission = "granted";
	static shown: string[] = [];
	onclick: (() => void) | null = null;
	constructor(title: string) {
		FakeNotification.shown.push(title);
	}
	close(): void {}
}

describe("App's notifications through a service worker", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		FakeNotification.shown = [];
		Object.assign(globalThis, { Notification: FakeNotification });
		// On, and in front too, so the page notifies while the test has it.
		localStorage.setItem(
			"arbor.settings",
			JSON.stringify({
				"notifications.on": true,
				"notifications.inFront": true,
			}),
		);
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		Reflect.deleteProperty(globalThis, "Notification");
		Reflect.deleteProperty(navigator, "serviceWorker");
		resize(1024, 768);
	});

	/** Opens the page holding one running conversation. */
	const open = async () => {
		const runs = conversation({ id: "c1", title: "Fix", status: "running" });
		testing.talk = {
			agents: [{ id: "claude", name: "Claude", settings: [], limits: [] }],
			conversations: [runs],
		};
		const view = await testing.open({ tasks: [details({ task: "alpha" })] });
		return { view, runs };
	};

	it("notifies on a phone, which has no sidebar list", async () => {
		resize(390, 844);
		const { runs } = await open();

		await testing.say({ ...runs, status: "failed", error: "agent exited" });

		expect(FakeNotification.shown).toEqual(["Fix failed"]);
	});

	it("shows a notice through the worker, carrying where it opens, and opens the row its click names", async () => {
		const workers = new FakeWorkers(true).install();
		const { runs } = await open();

		await testing.say({ ...runs, status: "failed", error: "agent exited" });

		await waitFor(() =>
			expect(workers.shown).toEqual([
				{
					title: "Fix failed",
					data: {
						key: "conversation c1",
						url: `${location.origin}${location.pathname}${location.search}#conversations/c1`,
					},
				},
			]),
		);
		expect(FakeNotification.shown).toEqual([]);
		await act(async () => workers.clicked("conversation c1"));
		expect(location.hash).toBe("#conversations/c1");
	});

	it("shows a notice on its own when no worker is registered", async () => {
		new FakeWorkers(false).install();
		const { runs } = await open();

		await testing.say({ ...runs, status: "failed", error: "agent exited" });

		await waitFor(() => expect(FakeNotification.shown).toEqual(["Fix failed"]));
	});

	it("subscribes to the server's pushes, and lets them show the notices", async () => {
		const workers = new FakeWorkers(true, true).install();
		const { runs } = await open();
		await waitFor(() =>
			expect(
				testing.posts.some((each) =>
					each.path.startsWith("/api/push/subscription"),
				),
			).toBe(true),
		);

		await testing.say({ ...runs, status: "failed", error: "agent exited" });

		expect(workers.shown).toEqual([]);
		expect(FakeNotification.shown).toEqual([]);
	});
});
