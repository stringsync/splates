import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { act, cleanup, details, fireEvent, Testing, waitFor } from "./testing";

describe("App's tasks", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("flags only the statuses that are news, and opens a task's plan", async () => {
		const view = await testing.openTasks({
			tasks: [
				details({ task: "alpha" }),
				details({
					task: "beta",
					status: "escalated",
					escalation: "needs eyes",
					plan: "# beta\n\n## Goal\n\nship the thing\n",
				}),
			],
		});

		expect(view.queryByText("working")).toBeNull();
		expect(view.queryByRole("progressbar")).toBeNull();
		expect(view.getByText("escalated")).toBeTruthy();

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: /beta/ })),
		);

		const dialog = await waitFor(() => view.getByRole("dialog"));
		expect(dialog.textContent).toContain("ship the thing");
		expect(dialog.textContent).toContain("needs eyes");
	});

	it("fills a bar with the steps its plan has checked off", async () => {
		const view = await testing.openTasks({
			tasks: [
				details({
					task: "alpha",
					plan: "# alpha\n\n## Done\n\n- [x] one\n\n## Next\n\n- [ ] two\n- [ ] three\n- [ ] four\n",
				}),
			],
		});

		const bar = view.getByRole("progressbar", { name: "progress" });
		expect(bar.getAttribute("aria-valuenow")).toBe("1");
		expect(bar.getAttribute("aria-valuemax")).toBe("4");
		expect(view.getByText("1/4")).toBeTruthy();
	});
});
