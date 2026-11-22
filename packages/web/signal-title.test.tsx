import { afterEach, describe, expect, it } from "bun:test";
import { SignalTitle } from "./signal-title";
import { cleanup, fireEvent, render, waitFor } from "./testing-library";

describe("signal title", () => {
	afterEach(cleanup);

	it("shows the last part whole and opens the full name on a tap", async () => {
		const name = "sound2score.infra.staging.prod-at-edge";
		const view = render(<SignalTitle name={name} />);
		const heading = view.getByRole("heading");
		expect(heading.textContent).toBe(name);
		fireEvent.click(view.getByRole("button", { name: /show full name/ }));
		await waitFor(() =>
			expect(view.getByRole("button", { name: /Copy/ })).toBeTruthy(),
		);
		expect(document.body.querySelector("code")?.textContent).toBe(name);
	});
});
