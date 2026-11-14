import "./testing-dom";
import { afterEach, describe, expect, it } from "bun:test";
import { RowIcon } from "./agent-icons";
import { colorOf, nameOf } from "./billing-sums";
import { cleanup, conversation, render } from "./testing";

afterEach(cleanup);

describe("recorded OpenCode history in the page", () => {
	it("still draws a conversation's icon", () => {
		const view = render(
			<RowIcon
				conversation={conversation({ agent: "opencode" })}
				name="OpenCode"
			/>,
		);

		expect(view.getByRole("img", { name: "OpenCode" })).toBeTruthy();
	});

	it("still names and colors an opencode provider in billing", () => {
		expect(nameOf("opencode")).toBe("OpenCode");
		expect(colorOf("opencode")).toBe("var(--series-4)");
	});
});
