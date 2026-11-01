import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resize } from "./drivers";
import { setupProgress } from "./setup-testing";
import { cleanup, Testing, waitFor } from "./testing";

describe("the welcome page's calls to action", () => {
	let testing: Testing;

	beforeEach(() => {
		const progress = setupProgress();
		testing = new Testing();
		testing.welcome = true;
		testing.setup = {
			...progress,
			areas: progress.areas.map((area) => ({
				...area,
				done: area.steps.length,
				steps: area.steps.map((step) => ({ ...step, warning: null })),
			})),
		};
		location.hash = "";
	});

	afterEach(() => {
		resize(1024, 768);
		cleanup();
		testing.dispose();
		location.hash = "";
	});

	it("still offers a conversation, a ship and an eval once no area is left", async () => {
		const view = testing.render();
		await waitFor(() => view.getByText("You're all set"));
		expect(
			view.getByRole("button", { name: "Start a new conversation" }),
		).toBeDefined();
		expect(
			view.getByRole("button", { name: "Help me write a ship" }),
		).toBeDefined();
		expect(
			view.getByRole("button", { name: "Help me add an eval" }),
		).toBeDefined();
	});
});
