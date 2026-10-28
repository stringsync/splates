import "./testing-dom";
import { afterEach, describe, expect, it } from "bun:test";
import { RowIcon } from "./agent-icons";
import { cleanup, conversation, render } from "./testing";

afterEach(cleanup);

describe("inbox agent marks", () => {
	it("uses the same branded colors as the composer", () => {
		const view = render(
			<RowIcon
				conversation={conversation({ agent: "claude" })}
				name="Claude"
			/>,
		);

		expect(view.getByRole("img", { name: "Claude" })).toBeTruthy();
		expect(view.container.querySelector('path[fill="#D97757"]')).toBeTruthy();
	});
});
