import "./register-dom";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Resource } from "webappwiz/disposable";
import { holdHome, PageAddress, ruleAddress } from "./page-address";

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

	it("sets the Creds page on one cred and leaves it for the page", () => {
		address.openCred("API TOKEN");

		expect(location.hash).toBe("#creds/API%20TOKEN");
		expect(address.page).toBe("creds");
		expect(address.cred).toBe("API TOKEN");

		address.go("creds");

		expect(address.cred).toBeNull();
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

	it("opens an external agent's task, asked for as a conversation, as the task it is", () => {
		address.go("conversations", "task/alpha");

		expect(address.page).toBe("tasks");
		expect(address.task).toBe("alpha");
		expect(address.open).toBeNull();
		expect(location.hash).toBe("#tasks/alpha");
	});

	it("reads an old link to an external agent's view as its task", () => {
		history.replaceState(null, "", "#conversations/task/alpha");
		const read = new PageAddress();

		expect(read.page).toBe("tasks");
		expect(read.task).toBe("alpha");
		expect(read.open).toBeNull();
	});

	it("sets the Auto pick page on a rule under Automations, from its old place in the nav too", () => {
		history.replaceState(null, "", ruleAddress(1));
		const read = new PageAddress();
		history.replaceState(null, "", "#auto-pick/3");
		const old = new PageAddress();

		expect(ruleAddress(1)).toBe("#automations/auto-pick/2");
		expect([read.page, read.rule]).toEqual(["auto-pick", 1]);
		expect([old.page, old.rule]).toEqual(["auto-pick", 2]);
	});

	it("puts the Auto pick page under Automations", () => {
		history.replaceState(null, "", "#automations");
		const address = new PageAddress();

		address.go("auto-pick");

		expect(location.hash).toBe("#automations/auto-pick");
		expect(new PageAddress().page).toBe("auto-pick");
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

describe("holdHome", () => {
	it("tells of a back from the inbox and holds it there", async () => {
		history.replaceState(null, "", `${location.pathname}#conversations`);
		const start = history.length;
		let backs = 0;
		const stop = holdHome(() => backs++);
		expect(history.length).toBe(start + 1);
		await traverse(() => history.back());
		expect(backs).toBe(1);
		expect(history.length).toBe(start + 1);
		stop();
	});
});
