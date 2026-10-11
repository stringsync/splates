import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Settings, search } from "./settings";
import "./testing";

/** A browser that answers a request to notify with `answer`. */
const browser = (answer: NotificationPermission) => {
	const fake = {
		permission: "default" as NotificationPermission,
		requestPermission: async () => {
			fake.permission = answer;
			return answer;
		},
	};
	Object.assign(globalThis, { Notification: fake });
	return fake;
};

describe("Settings", () => {
	beforeEach(() => localStorage.clear());
	afterEach(() => Reflect.deleteProperty(globalThis, "Notification"));

	it("reads each setting as its default until set, and keeps what is set", async () => {
		const settings = new Settings(localStorage);
		expect(settings.get("notifications.quietAfter")).toBe(10);
		expect(settings.get("notifications.sound")).toBe(false);

		await settings.set("notifications.quietAfter", 3);
		await settings.set("notifications.sound", true);
		const next = new Settings(localStorage);
		expect(next.get("notifications.quietAfter")).toBe(3);
		expect(next.get("notifications.sound")).toBe(true);
	});

	it("turns notifications on only once the browser allows them, and reads them off once it takes that back", async () => {
		const fake = browser("denied");
		const settings = new Settings(localStorage);
		expect(await settings.set("notifications.on", true)).toBe(false);
		expect(settings.get("notifications.on")).toBe(false);

		fake.requestPermission = async () => {
			fake.permission = "granted";
			return "granted";
		};
		expect(await settings.set("notifications.on", true)).toBe(true);
		expect(new Settings(localStorage).get("notifications.on")).toBe(true);

		fake.permission = "denied";
		expect(settings.get("notifications.on")).toBe(false);
	});

	it("leaves out what it no longer knows of, or of the wrong kind", () => {
		localStorage.setItem(
			"arbor.settings",
			JSON.stringify({ gone: true, "notifications.quietAfter": "soon" }),
		);
		expect(new Settings(localStorage).get("notifications.quietAfter")).toBe(10);
		localStorage.setItem("arbor.settings", "not json");
		expect(new Settings(localStorage).get("notifications.quietAfter")).toBe(10);
	});

	it("searches by every word, in titles, descriptions and categories", () => {
		expect(search("")).toHaveLength(7);
		expect(search("quiet")).toEqual([
			"notifications.on",
			"notifications.quiet",
			"notifications.quietAfter",
		]);
		expect(search("SOUND chime")).toEqual(["notifications.sound"]);
		expect(search("notifications")).toHaveLength(7);
		expect(search("nothing like it")).toEqual([]);
	});
});
