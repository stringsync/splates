import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { FakeSubscription } from "./fake-subscription";
import { FakeWorkers } from "./fake-workers";
import { syncPush } from "./push";
import { Settings } from "./settings";
import { Testing } from "./testing";

describe("syncPush", () => {
	let testing: Testing;
	let settings: Settings;

	beforeEach(() => {
		testing = new Testing();
		Object.assign(globalThis, { Notification: { permission: "granted" } });
		localStorage.setItem(
			"arbor.settings",
			JSON.stringify({
				"notifications.on": true,
				"notifications.quiet": false,
			}),
		);
		settings = new Settings(localStorage);
	});

	afterEach(() => {
		testing.dispose();
		localStorage.clear();
		Reflect.deleteProperty(globalThis, "Notification");
		Reflect.deleteProperty(navigator, "serviceWorker");
	});

	const sent = () =>
		testing.posts
			.filter((each) => each.path.startsWith("/api/push/subscription"))
			.map((each) => ({
				method: each.method,
				body: JSON.parse(String(each.body)) as unknown,
			}));

	it("subscribes with the server's key, telling it what the settings want", async () => {
		const workers = new FakeWorkers(true, true).install();

		expect(await syncPush(settings)).toBe(true);

		expect(workers.subscription?.endpoint).toBe("https://push.example/1");
		expect(sent()).toEqual([
			{
				method: "PUT",
				body: {
					subscription: {
						endpoint: "https://push.example/1",
						keys: { p256dh: "BKey", auth: "auth" },
					},
					wants: {
						waiting: true,
						finished: true,
						quiet: false,
						quietAfter: 10,
						inFront: false,
					},
				},
			},
		]);
	});

	it("keeps the subscription it holds, and makes a new one for a key the server changed", async () => {
		const workers = new FakeWorkers(true, true).install();
		await syncPush(settings);
		await syncPush(settings);
		expect(workers.subscribed).toBe(1);

		const old = new FakeSubscription("https://push.example/old", "BOld");
		workers.subscription = old;
		await syncPush(settings);

		expect(old.unsubscribed).toBe(true);
		expect(workers.subscription?.endpoint).toBe("https://push.example/2");
	});

	it("unsubscribes once notifying is off, telling the server", async () => {
		const workers = new FakeWorkers(true, true).install();
		await syncPush(settings);
		const held = workers.subscription;
		await settings.set("notifications.on", false);

		expect(await syncPush(settings)).toBe(false);

		expect(held?.unsubscribed).toBe(true);
		expect(sent().at(-1)).toEqual({
			method: "DELETE",
			body: { endpoint: "https://push.example/1" },
		});
	});

	it("leaves the page to notify where the browser cannot be pushed to", async () => {
		new FakeWorkers(true, false).install();

		expect(await syncPush(settings)).toBe(false);
		expect(sent()).toEqual([]);
	});
});
