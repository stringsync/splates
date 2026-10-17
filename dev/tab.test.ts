import "../../../setup";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { tabId } from "./tab";

describe("tabId", () => {
	const uuid = Object.getOwnPropertyDescriptor(crypto, "randomUUID");

	beforeEach(() => sessionStorage.clear());

	afterEach(() => {
		if (uuid === undefined) {
			Reflect.deleteProperty(crypto, "randomUUID");
		} else {
			Object.defineProperty(crypto, "randomUUID", uuid);
		}
		sessionStorage.clear();
	});

	it("keeps a terminal's tab key when randomUUID is unavailable, as over HTTP", () => {
		Object.defineProperty(crypto, "randomUUID", {
			configurable: true,
			value: undefined,
		});

		const first = tabId();

		expect(first).toMatch(/^[a-f0-9]{32}$/);
		expect(tabId()).toBe(first);
		expect(sessionStorage.getItem("arbor.tab")).toBe(first);
	});

	it("uses the key already saved before a reload", () => {
		sessionStorage.setItem("arbor.tab", "existing-tab");

		expect(tabId()).toBe("existing-tab");
	});
});
