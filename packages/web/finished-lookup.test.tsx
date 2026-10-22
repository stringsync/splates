import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { Dialog } from "#web/components/ui/dialog.tsx";
import { FinishedByName } from "./finished-tasks";
import { act, cleanup, fireEvent, render, Testing, waitFor } from "./testing";

describe("FinishedByName's lookup", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		testing.answerWithin(Duration.ms(300));
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	const lookup = () =>
		render(
			<Dialog open>
				<FinishedByName name="alpha" />
			</Dialog>,
		);

	it("says the read gave up rather than that no record is kept, and reads again on Try again", async () => {
		testing.hang("/api/finished");
		const view = lookup();

		await waitFor(() =>
			expect(view.getByRole("alert").textContent).toContain(
				"Couldn't read the finished tasks",
			),
		);
		expect(view.queryByText("No record of this task is kept.")).toBeNull();
		testing.unhang();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Try again" })),
		);

		await waitFor(() =>
			expect(view.getByText("No record of this task is kept.")).toBeTruthy(),
		);
	});
});
