import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "core/time";
import { setupProgress } from "./setup-testing";
import { act, cleanup, fireEvent, Testing, waitFor } from "./testing";

/** How long a hung read waits before giving up, short so the tests are fast. */
const ANSWER_WITHIN = Duration.ms(50);
const NO_ANSWER = "no answer in 50ms";

describe("App's reads that never answer", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		testing.answerWithin(ANSWER_WITHIN);
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	/** Opens the page at its `tab`, as a person does from the sidebar. */
	const openTab = async (tab: RegExp) => {
		const view = await testing.open();
		await act(async () =>
			fireEvent.click(view.getByRole("tab", { name: tab })),
		);
		return view;
	};

	it("says Setup's read gave up, counts the next one down, and shows setup once one answers", async () => {
		testing.setup = setupProgress();
		testing.hang("/api/setup");
		const view = await openTab(/Setup$/);
		const gaveUp = () =>
			waitFor(() =>
				expect(view.getByRole("alert").textContent).toBe(
					`Couldn't read your setup: ${NO_ANSWER}`,
				),
			);

		await gaveUp();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Try again" })),
		);
		expect(view.getByText("Reading your setup…")).toBeTruthy();
		await gaveUp();
		testing.unhang();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Try again" })),
		);

		await waitFor(() =>
			expect(view.getByRole("button", { name: "Set up Agents" })).toBeTruthy(),
		);
		expect(view.queryByText(/Couldn't read your setup/)).toBeNull();
	});

	it("says Billing's budgets gave up rather than reading on, and reads again on Try again", async () => {
		testing.hang("/api/budgets");
		const view = await openTab(/Billing$/);

		await waitFor(() =>
			expect(view.getByText("Reading budgets…")).toBeTruthy(),
		);
		await waitFor(() => expect(view.getByText(NO_ANSWER)).toBeTruthy());
		expect(view.queryByText("Reading budgets…")).toBeNull();
		testing.unhang();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Try again" })),
		);

		await waitFor(() => expect(view.queryByText(NO_ANSWER)).toBeNull());
		expect(view.queryByText("Reading budgets…")).toBeNull();
	});
});
