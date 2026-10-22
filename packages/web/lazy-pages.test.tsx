import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Duration } from "webappwiz/time";
import { onDemand } from "./lazy-pages";
import { act, cleanup, fireEvent, render, Testing, waitFor } from "./testing";

describe("onDemand's page chunk", () => {
	let testing: Testing;

	beforeEach(() => {
		testing = new Testing();
		testing.answerWithin(Duration.ms(300));
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("says a chunk that never came gave up, and loads again on Try again", async () => {
		const loads = [
			() => new Promise<never>(() => {}),
			async () => ({ default: () => <p>the page</p> }),
		];
		const Page = onDemand(() => (loads.shift() as () => Promise<never>)());
		const view = render(<Page />);

		await waitFor(() =>
			expect(view.getByRole("alert").textContent).toContain(
				"Couldn't load this part of the page: no answer in 0.3s",
			),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Try again" })),
		);

		await waitFor(() => expect(view.getByText("the page")).toBeTruthy());
		expect(view.queryByRole("alert")).toBeNull();
	});

	it("says why a chunk that failed did", async () => {
		const Page = onDemand(async () => {
			throw new Error("Failed to fetch dynamically imported module");
		});
		const view = render(<Page />);

		await waitFor(() =>
			expect(view.getByRole("alert").textContent).toContain(
				"Failed to fetch dynamically imported module",
			),
		);
		expect(view.getByRole("button", { name: "Try again" })).toBeTruthy();
	});
});
