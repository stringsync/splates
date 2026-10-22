import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	snapshot,
	Testing,
	todo,
	waitFor,
} from "./testing";

describe("App, on a project whose records failed to migrate", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		testing.refuse(
			"migration_failed",
			"this repository's splates records could not move from format 1 to 4",
		);
		testing.migration = {
			failure: {
				from: 1,
				to: 4,
				step: "splits lanes",
				error: "lanes are tangled",
				release: "0.0.48",
				fallback: "0.0.47",
			},
			fix: "claude 'fix the lanes'",
			trunk: "main",
		};
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("says what failed, that nothing is lost, and the release that still reads the records", async () => {
		const view = testing.render();

		await waitFor(() => view.getByText("lanes are tangled"));
		expect(
			view.getByText(
				/could not move from format 1 to 4, at the step that splits lanes/,
			),
		).toBeTruthy();
		expect(view.getByText(/nothing is lost/)).toBeTruthy();
		expect(
			view.getByText("bunx @stringsync/splates@0.0.47 server"),
		).toBeTruthy();
		expect(view.queryByText(/Can't reach splates/)).toBeNull();
	});

	it("retries at once, then shows the project once the server opens it", async () => {
		const view = testing.render();
		const retry = await waitFor(() =>
			view.getByRole("button", { name: "Retry" }),
		);
		testing.served = snapshot({ todos: [todo({ subject: "back again" })] });
		testing.stopRefusing();

		await act(async () => fireEvent.click(retry));

		expect(testing.posts.map((each) => each.path)).toContain(
			"/api/migration/retry",
		);
		await waitFor(() => expect(view.getByText(/back again/)).toBeTruthy());
		expect(view.queryByText("lanes are tangled")).toBeNull();
	});

	it("says a retry that fails again, and stays", async () => {
		const view = testing.render();
		const retry = await waitFor(() =>
			view.getByRole("button", { name: "Retry" }),
		);
		testing.refuseWrites = {
			reason: "migration_failed",
			message: "lanes are still tangled\nFix what stopped it",
		};

		await act(async () => fireEvent.click(retry));

		const said = await waitFor(() => view.getByRole("alert"));
		expect(said.textContent).toBe("Still failing: lanes are still tangled");
		expect(
			view.getByRole("button", { name: "Fix with an agent" }),
		).toBeTruthy();
	});

	it("opens a terminal at the project's root that starts an agent told what failed", async () => {
		const view = testing.render();
		const fix = await waitFor(() =>
			view.getByRole("button", { name: "Fix with an agent" }),
		);

		await act(async () => fireEvent.click(fix));

		await waitFor(() => expect(testing.shells).toHaveLength(1));
		const [shell] = testing.shells;
		expect(shell?.task).toBeNull();
		await act(async () => shell?.accept());
		expect(shell?.sent).toContain("claude 'fix the lanes'");
	});
});
