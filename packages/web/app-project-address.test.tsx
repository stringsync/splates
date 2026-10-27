import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { snapshot } from "./fixtures";
import { cleanup, Testing, waitFor, within } from "./testing";

/** Puts the page at `url`, which `history` cannot do from `about:blank`. */
function visit(url: string): void {
	(
		window as unknown as { happyDOM: { setURL(url: string): void } }
	).happyDOM.setURL(url);
}

describe("App at a project's address", () => {
	let testing: Testing;

	beforeEach(() => {
		visit("http://localhost/?project=shop");
		testing = new Testing();
		testing.projects = [
			{
				slug: "webappwiz",
				root: "/code/webappwiz",
				gone: false,
				focused: true,
				conversations: [],
				waiting: 0,
				ships: false,
			},
			{
				slug: "shop",
				root: "/code/shop",
				gone: false,
				focused: false,
				conversations: [],
				waiting: 2,
				ships: false,
			},
		];
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		visit("about:blank");
		sessionStorage.clear();
	});

	it("asks the server for the project the address names", async () => {
		testing.served = snapshot();

		await testing.open();

		expect(testing.asked).toContain("/api/snapshot?project=shop");
	});

	it("says it is opening the project the address names until its snapshot arrives", async () => {
		const arrive = testing.holdSnapshots();

		const opening = testing.open();
		const screen = within(document.body);
		const status = await waitFor(() => screen.getByText("Opening shop"));
		expect(status.getAttribute("role")).toBe("status");
		arrive();
		await opening;

		expect(screen.queryByText("Opening shop")).toBeNull();
	});
});
