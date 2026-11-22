import "./testing-dom";
import { afterEach, describe, expect, it } from "bun:test";
import { BlockView } from "./readouts";
import { act, cleanup, fireEvent, render, within } from "./testing-library";

describe("BlockView's details", () => {
	afterEach(cleanup);

	it("folds its text behind a button that toggles it", async () => {
		const view = render(
			<BlockView
				block={{ kind: "details", title: "Details", text: "hidden words" }}
				lead={false}
			/>,
		);
		const button = within(view.container).getByRole("button", {
			name: "Details",
		});
		expect(button.getAttribute("aria-expanded")).toBe("false");
		expect(view.container.textContent).not.toContain("hidden words");
		await act(async () => fireEvent.click(button));
		expect(button.getAttribute("aria-expanded")).toBe("true");
		expect(view.container.textContent).toContain("hidden words");
	});
});
