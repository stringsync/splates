import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	cleanup,
	conversation,
	details,
	fireEvent,
	message,
	Testing,
	waitFor,
	within,
} from "./testing";

describe("App's review panel, with what the task's assumptions show", () => {
	let testing: Testing;
	let panel: HTMLElement;

	beforeEach(async () => {
		testing = new Testing();
		const shown = "  ![header at 390px](/abs/header.png)";
		const view = await testing.openConversations(
			[
				conversation({
					title: "Header",
					messages: [
						message(
							"agent",
							[
								"## 🔍 Ready to merge header onto main",
								"",
								"The header wraps on phones.",
								"",
								'Reply "merge", or say what to change.',
							].join("\n"),
						),
					],
				}),
			],
			"c1",
			{
				tasks: [
					details({
						task: "header",
						plan: [
							"## Assumptions",
							"",
							"- [ ] 1. Where should the header wrap?",
							shown,
							"  - (a) Below 400px (chosen)",
							"  - (b) Below 600px",
							"- [ ] 2. Where does the search box go?",
							shown,
							"  - (a) Into the menu (chosen)",
							"  - (b) Beside the menu",
							"- [ ] 3. What should the menu be called?",
							"  - (a) Menu (chosen)",
							"  - (b) More",
						].join("\n"),
					}),
				],
			},
		);
		panel = await waitFor(() =>
			view.getByRole("region", { name: "review header" }),
		);
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("shows every assumption open, by number, one exhibit over those beside each other that show it", async () => {
		const exhibit = within(panel).getByRole("figure", {
			name: "exhibit for assumption 1 and assumption 2",
		});
		expect(exhibit.querySelector("figcaption")?.textContent).toBe(
			"header at 390px",
		);
		expect(within(exhibit).getByText("Below 400px")).toBeTruthy();
		expect(within(exhibit).getByText("Into the menu")).toBeTruthy();
		expect(
			within(panel).queryByRole("button", { name: /^Assumptions/ }),
		).toBeNull();
		expect(
			within(panel)
				.getAllByRole("button", { name: /^Challenge assumption/ })
				.map((each) => each.getAttribute("aria-label")),
		).toEqual([
			"Challenge assumption 1",
			"Challenge assumption 2",
			"Challenge assumption 3",
		]);

		await act(async () =>
			fireEvent.click(
				within(exhibit).getByRole("button", {
					name: "Challenge assumption 1",
				}),
			),
		);
		// Open as a question, it leaves the screenshot to the exhibit above:
		// its caption, and the screenshot itself, as its alt text here.
		expect(exhibit.textContent?.match(/header at 390px/g)?.length).toBe(2);
	});
});
