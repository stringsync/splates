import { afterEach, describe, expect, it } from "bun:test";
import { RadioIcon } from "lucide-react";
import { cleanup, fireEvent, render } from "./testing-library";
import { ThreadBar } from "./thread-bar";

afterEach(cleanup);

describe("ThreadBar", () => {
	it("renders a clickable button bar with uniform card surface, tinted icon, truncated label, and ghost CTA", () => {
		let presses = 0;
		const { getByRole, getByText } = render(
			<ThreadBar
				Icon={RadioIcon}
				iconTone="info"
				label="Waiting for mono.deploy.staging · 14m left"
				cta="View"
				onPress={() => {
					presses += 1;
				}}
			/>,
		);
		const button = getByRole("button");
		expect(button.hasAttribute("data-thread-bar")).toBe(true);
		expect(button.className).toContain("min-h-11");
		expect(button.className).toContain("rounded-xl");
		expect(button.className).toContain("border");
		expect(button.className).toContain("bg-card");
		expect(button.className).toContain("px-4");

		const icon = button.querySelector("svg");
		expect(icon?.getAttribute("class")).toContain("text-info");

		const label = getByText("Waiting for mono.deploy.staging · 14m left");
		expect(label.className).toContain("truncate");

		const cta = getByText("View");
		expect(cta.className).not.toContain("border");
		expect(cta.className).toContain("text-muted-foreground");

		fireEvent.click(button);
		expect(presses).toBe(1);
	});

	it("renders as a link when href is provided", () => {
		const { getByRole } = render(
			<ThreadBar
				Icon={RadioIcon}
				label="Queued #4626, #4627 and 2 more"
				cta="View"
				href="/tasks"
			/>,
		);
		const link = getByRole("link");
		expect(link.getAttribute("href")).toBe("/tasks");
		expect(link.hasAttribute("data-thread-bar")).toBe(true);
	});

	it("renders an action bar as a static container with a secondary button and no chevron", () => {
		let presses = 0;
		const { container, getByRole, getByText } = render(
			<ThreadBar
				Icon={RadioIcon}
				iconTone="success"
				label="Done threadbar-action-button"
				cta="Archive"
				ctaKind="action"
				onPress={() => {
					presses += 1;
				}}
			/>,
		);
		const bar = container.querySelector("[data-thread-bar]");
		expect(bar?.tagName).toBe("DIV");
		expect(bar?.className).not.toContain("hover:bg-muted/40");
		expect(bar?.querySelectorAll("svg").length).toBe(1);

		// Clicking the static label does not trigger the action.
		fireEvent.click(getByText("Done threadbar-action-button"));
		expect(presses).toBe(0);

		const button = getByRole("button", { name: "Archive" });
		expect(button.className).toContain("bg-secondary");
		expect(button.className).toContain("h-7");
		fireEvent.click(button);
		expect(presses).toBe(1);
	});

	it("renders a static non-interactive bar when neither href nor onPress is provided", () => {
		const { container, queryByRole } = render(
			<ThreadBar
				Icon={RadioIcon}
				iconTone="info"
				label="Waiting for the machine to stay idle 2m"
				title="Idle wait"
			/>,
		);
		expect(queryByRole("button")).toBeNull();
		expect(queryByRole("link")).toBeNull();
		const bar = container.querySelector("[data-thread-bar]");
		expect(bar).not.toBeNull();
		expect(bar?.getAttribute("title")).toBe("Idle wait");
	});
});
