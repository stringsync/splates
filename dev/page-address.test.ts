import "../../../setup";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Resource } from "webappwiz/disposable";
import { PageAddress } from "./page-address";

/** Waits for the browser to move through its history, as a swipe does. */
function traverse(step: () => void): Promise<void> {
	return new Promise((resolve) => {
		addEventListener("popstate", () => resolve(), { once: true });
		step();
	});
}

describe("PageAddress", () => {
	let attached: Resource;
	let address: PageAddress;
	beforeEach(() => {
		history.replaceState(null, "", `${location.pathname}${location.search}`);
		address = new PageAddress();
		attached = address.attach();
	});
	afterEach(() => attached.dispose());

	it("goes back and forward through each page opened, as a swipe does", async () => {
		const start = history.length;
		address.go("conversations", "c1");
		address.go("conversations", "c2");
		address.go("stats");

		expect(history.length).toBe(start + 3);
		await traverse(() => history.back());
		expect(address.page).toBe("conversations");
		expect(address.open).toBe("c2");
		await traverse(() => history.back());
		expect(address.open).toBe("c1");
		await traverse(() => history.forward());
		expect(address.open).toBe("c2");
	});

	it("goes back, rather than on, to the entry just left, so a back button and a swipe agree", async () => {
		address.go("conversations", null);
		address.go("conversations", "c1");
		const length = history.length;

		await traverse(() => address.go("conversations", null));

		expect(history.length).toBe(length);
		expect(location.hash).toBe("#conversations");
		await traverse(() => history.forward());
		expect(address.open).toBe("c1");
	});

	it("leaves no entry for a move made in place of the one open", () => {
		address.go("conversations", "new");
		const length = history.length;

		address.go("conversations", "c1", "replace");

		expect(history.length).toBe(length);
		expect(location.hash).toBe("#conversations/c1");
	});

	it("leaves no terminal to go back to once it is left", async () => {
		address.go("conversations", "c1");
		address.go("conversations", "terminal/1");
		const length = history.length;

		address.go("creds");

		expect(history.length).toBe(length);
		await traverse(() => history.back());
		expect(address.open).toBe("c1");
	});

	it("goes back from a terminal opened in place of New to where New was opened", async () => {
		address.go("conversations", null);
		address.go("conversations", "new");
		address.go("conversations", "terminal/1", "replace");
		const length = history.length;

		await traverse(() => address.go("conversations", null));

		expect(history.length).toBe(length);
		expect(location.hash).toBe("#conversations");
	});

	it("leaves no entry for a move to where the page already is", () => {
		address.go("stats");
		const length = history.length;

		address.go("stats");

		expect(history.length).toBe(length);
	});

	it("opens a task from another page in one entry", async () => {
		address.go("stats");
		const length = history.length;

		address.openTask("alpha");

		expect(history.length).toBe(length + 1);
		expect(address.page).toBe("tasks");
		expect(location.hash).toBe("#tasks/alpha");
		await traverse(() => history.back());
		expect(address.page).toBe("stats");
		expect(address.task).toBeNull();
	});

	it("puts back how far the page was scrolled when it left an entry", async () => {
		address.go("conversations", null);
		scrollTo(0, 240);
		address.go("conversations", "c1");
		expect(address.takeScroll()).toBeNull();

		await traverse(() => history.back());

		expect(address.takeScroll()).toBe(240);
		expect(address.takeScroll()).toBeNull();
	});
});
