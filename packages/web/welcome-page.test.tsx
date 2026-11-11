import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resize } from "./drivers";
import { setupProgress } from "./setup-testing";
import { act, cleanup, fireEvent, Testing, waitFor } from "./testing";

describe("the welcome page", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		testing.welcome = true;
		testing.setup = setupProgress();
		location.hash = "";
	});

	afterEach(() => {
		resize(1024, 768);
		cleanup();
		testing.dispose();
		location.hash = "";
	});

	it("is where a desktop's first open lands, listing the setup areas", async () => {
		const view = testing.render();
		await waitFor(() => view.getByRole("region", { name: "welcome" }));
		await waitFor(() => view.getByRole("button", { name: "Set up Agents" }));
		expect(location.hash).toBe("#welcome");
	});

	it("is where every open lands, not only the first", async () => {
		const first = testing.render();
		await waitFor(() => first.getByRole("region", { name: "welcome" }));
		const tab = await waitFor(() => first.getByRole("tab", { name: /Setup$/ }));
		await act(async () => fireEvent.click(tab));
		await waitFor(() => first.getByRole("region", { name: "setup" }));
		cleanup();
		location.hash = "";
		const again = testing.render();
		await waitFor(() => again.getByRole("region", { name: "welcome" }));
	});

	it("stays out of the way once its checkbox is cleared", async () => {
		const view = testing.render();
		await waitFor(() => view.getByRole("region", { name: "welcome" }));
		await act(async () =>
			fireEvent.click(
				view.getByRole("checkbox", { name: "Show welcome page on startup" }),
			),
		);
		cleanup();
		location.hash = "";
		const again = testing.render();
		await act(async () => {});
		expect(again.queryByRole("region", { name: "welcome" })).toBeNull();
	});

	it("is reachable again from the Setup page", async () => {
		testing.welcome = false;
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: /Setup$/ })),
		);
		const back = await waitFor(() =>
			view.getByRole("button", { name: "Back to the welcome page" }),
		);
		await act(async () => fireEvent.click(back));
		await waitFor(() => view.getByRole("region", { name: "welcome" }));
	});

	it("always suggests the ships and evals journeys while they are left", async () => {
		const progress = setupProgress();
		const extra = progress.areas.slice(1).flatMap((dictation) =>
			[
				{ id: "a", title: "a" },
				{ id: "b", title: "b" },
				{ id: "c", title: "c" },
				{ id: "ships", title: "Ships" },
				{ id: "evals", title: "Evals" },
			].map((area) => ({ ...dictation, ...area })),
		);
		testing.setup = { ...progress, areas: [...progress.areas, ...extra] };
		const view = testing.render();
		await waitFor(() => view.getByRole("button", { name: "Set up Ships" }));
		view.getByRole("button", { name: "Set up Evals" });
		expect(view.queryByRole("button", { name: "Set up c" })).toBeNull();
	});

	it("is not where a phone lands", async () => {
		resize(390, 844);
		const view = testing.render();
		await act(async () => {});
		expect(view.queryByRole("region", { name: "welcome" })).toBeNull();
	});
});
