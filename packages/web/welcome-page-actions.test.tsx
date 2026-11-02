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
				complete: true,
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

	it("offers a conversation and drops the suggestions once no area is left", async () => {
		const view = testing.render();
		await waitFor(() => view.getByRole("button", { name: "New conversation" }));
		await waitFor(() =>
			expect(view.queryByLabelText("checking setup")).toBeNull(),
		);
		expect(view.queryByText("Suggested next")).toBeNull();
	});
});
