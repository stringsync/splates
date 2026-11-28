import { afterEach, describe, expect, it } from "bun:test";
import { OverturnedLine } from "./assumed-line";
import { cleanup, render } from "./testing-library";

afterEach(cleanup);

describe("OverturnedLine", () => {
	it("renders the overturned pick hairline with no trailing trust badge", () => {
		const view = render(<OverturnedLine words="Retry limit: 3 → 5" />);
		expect(view.getByText("Overturned")).toBeTruthy();
		expect(view.getByText("Retry limit: 3 → 5")).toBeTruthy();
		expect(view.queryByRole("img", { name: /Trust/ })).toBeNull();
	});
});
