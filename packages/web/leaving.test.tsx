import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import { Duration } from "core/time";
import { createElement } from "react";
import { Leaving } from "./leaving";
import { act, cleanup, fireEvent, render, Testing } from "./testing";

describe("Leaving", () => {
	let testing: Testing;
	let stayed: number;

	beforeEach(() => {
		jest.useFakeTimers();
		testing = new Testing();
		testing.answerWithin(Duration.ms(300));
		stayed = 0;
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
		jest.useRealTimers();
	});

	it("counts down a server that never opens, then offers a way back", async () => {
		const view = render(
			createElement(Leaving, { name: "studio", onStay: () => stayed++ }),
		);

		await act(async () => {
			jest.advanceTimersByTime(250);
		});
		expect(view.getByText(/Still opening, gives up in \ds/)).toBeTruthy();
		await act(async () => {
			jest.advanceTimersByTime(500);
		});
		expect(view.getByRole("alert").textContent).toContain(
			"studio has not opened: is it running?",
		);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Stay here" })),
		);

		expect(stayed).toBe(1);
	});
});
