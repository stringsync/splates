import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createElement } from "react";
import { Duration } from "webappwiz/time";
import { Leaving } from "./leaving";
import { act, cleanup, fireEvent, render, Testing, waitFor } from "./testing";

describe("Leaving", () => {
	let testing: Testing;
	let stayed: number;

	beforeEach(() => {
		testing = new Testing();
		testing.answerWithin(Duration.ms(300));
		stayed = 0;
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("counts down a server that never opens, then offers a way back", async () => {
		const view = render(
			createElement(Leaving, { name: "studio", onStay: () => stayed++ }),
		);

		await waitFor(() =>
			expect(view.getByText(/Still opening, gives up in \ds/)).toBeTruthy(),
		);
		await waitFor(() =>
			expect(view.getByRole("alert").textContent).toContain(
				"studio has not opened: is it running?",
			),
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Stay here" })),
		);

		expect(stayed).toBe(1);
	});
});
