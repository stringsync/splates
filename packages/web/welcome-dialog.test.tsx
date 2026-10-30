import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resize } from "./drivers";
import { Settings } from "./settings";
import { setupProgress } from "./setup-testing";
import { act, cleanup, fireEvent, Testing, waitFor, within } from "./testing";

describe("the setup welcome", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		testing.welcome = true;
		testing.setup = setupProgress();
	});

	afterEach(() => {
		resize(1024, 768);
		cleanup();
		testing.dispose();
	});

	it("greets the first open with the setup areas, until it is closed", async () => {
		const view = await testing.open();
		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(within(dialog).getByText("Welcome to splates")).toBeTruthy();
		expect(
			within(dialog).getByRole("button", { name: "Set up Agents" }),
		).toBeTruthy();
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("button", { name: "Got it" })),
		);
		await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
		expect(new Settings(localStorage).get("welcome.show")).toBe(false);
	});

	it("stays away once dismissed in this browser", async () => {
		await new Settings(localStorage).set("welcome.show", false);
		testing.welcome = false;
		const view = await testing.open();
		await waitFor(() => view.getByRole("tab", { name: /Setup$/ }));
		expect(view.queryByText("Welcome to splates")).toBeNull();
	});

	it("does not greet a phone, which opens to the inbox", async () => {
		resize(390, 844);
		const view = await testing.open();
		await act(async () => {});
		expect(view.queryByRole("dialog")).toBeNull();
		expect(new Settings(localStorage).get("welcome.show")).toBe(true);
	});
});
