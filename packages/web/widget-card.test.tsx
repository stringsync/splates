import { afterEach, describe, expect, it } from "bun:test";
import { LinkIcon } from "lucide-react";
import { cleanup, render } from "./testing-library";
import { WidgetCard } from "./widget-card";

afterEach(cleanup);

describe("WidgetCard", () => {
	it("renders a data-widget landmark with an h-8 px-3 header and body", () => {
		const { getByRole, getByText } = render(
			<WidgetCard
				label="references"
				Icon={LinkIcon}
				title="References"
				aside="2 tasks"
			>
				<ul>
					<li>task-a</li>
				</ul>
			</WidgetCard>,
		);
		const section = getByRole("region", { name: "references" });
		expect(section.hasAttribute("data-widget")).toBe(true);
		expect(section.className).toContain("rounded-lg");
		expect(section.className).toContain("border");

		const heading = getByRole("heading", { level: 3 });
		expect(heading.className).toContain("h-8");
		expect(heading.className).toContain("px-3");
		expect(heading.querySelector("svg")).not.toBeNull();
		expect(getByText("References")).toBeTruthy();
		expect(getByText("2 tasks")).toBeTruthy();
		expect(getByText("task-a")).toBeTruthy();
	});

	it("supports a custom icon node when not using a Lucide icon", () => {
		const { getByTestId } = render(
			<WidgetCard
				label="quota limits"
				icon={<span data-testid="agent-mark" />}
				title="Claude quota"
			>
				<div>meter</div>
			</WidgetCard>,
		);
		expect(getByTestId("agent-mark")).toBeTruthy();
	});

	it('renders as a headerless nav landmark when as="nav" and title is omitted', () => {
		const { getByRole, queryByRole } = render(
			<WidgetCard as="nav" label="actions">
				<button type="button">Archive</button>
			</WidgetCard>,
		);
		const nav = getByRole("navigation", { name: "actions" });
		expect(nav.hasAttribute("data-widget")).toBe(true);
		expect(queryByRole("heading")).toBeNull();
	});
});
