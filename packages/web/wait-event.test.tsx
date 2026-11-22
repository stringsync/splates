import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, fireEvent, render } from "./testing-library";
import { WaitEvent } from "./wait-event";

describe("wait event", () => {
	afterEach(cleanup);

	it("folds the request into a line that shows and hides its card", () => {
		const view = render(
			<WaitEvent
				directive="[SPLATES WAIT machine idle 2m]"
				wait={{ type: "idle", duration: "2m" }}
				at={null}
				outcome={null}
			/>,
		);
		expect(view.getByText(/Waiting on/)).toBeTruthy();
		expect(view.queryByText("Still waiting")).toBeNull();
		fireEvent.click(view.getByRole("button", { name: "Show" }));
		expect(view.getByText("Still waiting")).toBeTruthy();
		fireEvent.click(view.getByRole("button", { name: "Hide" }));
		expect(view.queryByText("Still waiting")).toBeNull();
	});

	it("says it finished, with the server's outcome, once the wait ended", () => {
		const view = render(
			<WaitEvent
				directive="[SPLATES WAIT machine idle 2m]"
				wait={{ type: "idle", duration: "2m" }}
				at={null}
				outcome="The machine has stayed idle."
			/>,
		);
		expect(view.getByText(/Finished waiting on/)).toBeTruthy();
		fireEvent.click(view.getByRole("button", { name: "Show" }));
		expect(view.getByText("The machine has stayed idle.")).toBeTruthy();
	});
});
