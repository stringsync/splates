import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Settings } from "./settings";
import { notifyBrowserSteps } from "./setup-notify-steps";
import "./testing";

describe("notifyBrowserSteps", () => {
	beforeEach(() => {
		localStorage.clear();
		Object.assign(globalThis, {
			Notification: {
				permission: "default",
				requestPermission: async () => "denied",
			},
		});
	});
	afterEach(() => Reflect.deleteProperty(globalThis, "Notification"));

	it("says so, and turns nothing on, when the browser refuses notifications", async () => {
		const settings = new Settings(localStorage);

		await expect(
			notifyBrowserSteps(settings)["notifications-device"]?.({}),
		).rejects.toThrow("did not allow notifications");
		expect(settings.get("notifications.on")).toBe(false);
	});
});
