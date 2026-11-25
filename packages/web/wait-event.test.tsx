import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render } from "./testing-library";
import { WaitEvent } from "./wait-event";

describe("wait event", () => {
	afterEach(cleanup);

	it("is one line saying what it waits on, with no card to open", () => {
		const view = render(
			<WaitEvent
				directive="[SPLATES WAIT machine idle 2m]"
				wait={{ type: "idle", duration: "2m" }}
				at={null}
				outcome={null}
			/>,
		);
		expect(view.getByText(/Waiting on/)).toBeTruthy();
		expect(view.queryByRole("button", { name: "Show" })).toBeNull();
	});

	it("says it finished, with the server's outcome on hover, once the wait ended", () => {
		const view = render(
			<WaitEvent
				directive="[SPLATES WAIT machine idle 2m]"
				wait={{ type: "idle", duration: "2m" }}
				at={null}
				outcome="The machine has stayed idle."
			/>,
		);
		expect(view.getByText(/Finished waiting on/)).toBeTruthy();
		expect(
			view.container.querySelector("[title*='The machine has stayed idle.']"),
		).toBeTruthy();
	});
});
