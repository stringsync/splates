import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { FinishedPlan } from "@stringsync/splates-server/tasks";
import {
	act,
	cleanup,
	clickShown,
	details,
	fireEvent,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's finished tasks", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("folds them away, reading none until opened", async () => {
		testing.finished = [finished()];
		const view = await testing.openTasks({
			tasks: [details({ task: "beta" })],
		});

		expect(view.getByRole("button", { name: /Finished/ })).toBeTruthy();
		expect(testing.asked.some((path) => path.startsWith("/api/finished"))).toBe(
			false,
		);
	});

	it("marks the tasks that have a demo", async () => {
		testing.finished = [
			finished({ hasDemo: true }),
			finished({
				key: "8-1760000000000",
				id: 8,
				task: "gamma",
				subject: "try gamma",
			}),
		];
		const view = await testing.openTasks({ tasks: [] });

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Finished/ })),
		);
		const list = await waitFor(() =>
			view.getByRole("list", { name: "finished task list" }),
		);

		expect(within(list).getAllByLabelText("has a demo")).toHaveLength(1);
		expect(
			within(
				within(list).getByRole("button", { name: /alpha/ }),
			).getByLabelText("has a demo"),
		).toBeTruthy();
	});

	it("lists each with how it ended, and opens the plan it ended on", async () => {
		testing.finished = [
			finished(),
			finished({
				key: "8-1760000000000",
				id: 8,
				task: "gamma",
				subject: "try gamma",
				ended: "removed",
				reason: "moot",
				commit: null,
				took: [],
				plan: "",
			}),
		];
		const view = await testing.openTasks({ tasks: [] });

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Finished/ })),
		);
		const list = await waitFor(() =>
			view.getByRole("list", { name: "finished task list" }),
		);
		expect(list.textContent).toContain("alpha");
		expect(list.textContent).toContain("ship alpha");
		expect(list.textContent).toContain("gamma");

		await act(async () =>
			fireEvent.click(within(list).getByRole("button", { name: /alpha/ })),
		);
		const dialog = await waitFor(() => view.getByRole("dialog"));
		// Finished tasks retain their legacy Notes tab.
		await waitFor(() => {
			expect(dialog.textContent).toContain("ship alpha");
		});
		expect(within(dialog).getByText("Merged")).toBeTruthy();
		expect(dialog.textContent).toContain("onto main as abc1234");
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("tab", { name: "Notes" })),
		);
		expect(dialog.textContent).toContain("kept the old flag");
		await act(async () =>
			fireEvent.click(within(dialog).getByRole("tab", { name: "Details" })),
		);
		expect(dialog.textContent).toContain("#7 Ship alpha");
	});

	it("says why a removed one went", async () => {
		testing.finished = [
			finished({ ended: "removed", reason: "superseded", commit: null }),
		];
		const view = await testing.openTasks({ tasks: [] });

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /Finished/ })),
		);
		await clickShown(() =>
			within(view.getByRole("list", { name: "finished task list" })).getByRole(
				"button",
				{ name: /alpha/ },
			),
		);

		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(within(dialog).getByText("Removed")).toBeTruthy();
		expect(dialog.textContent).toContain("as superseded");
	});
});

function finished(more: Partial<FinishedPlan> = {}): FinishedPlan {
	return {
		key: "7-1760000000000",
		id: 7,
		task: "alpha",
		subject: "ship alpha",
		ended: "merged",
		reason: null,
		base: "main",
		commit: "abc1234",
		startedAt: new Date(Date.now() - 7_200_000).toISOString(),
		endedAt: new Date(Date.now() - 3_600_000).toISOString(),
		conversation: null,
		took: [{ id: 7, subject: "Ship alpha" }],
		plan: "# alpha\n\n## Goal\n\nship alpha\n\n## Notes\n\nkept the old flag\n",
		hasDemo: false,
		...more,
	};
}
