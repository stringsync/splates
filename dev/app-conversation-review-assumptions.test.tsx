import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	act,
	type ConversationsView,
	cleanup,
	conversation,
	details,
	fireEvent,
	message,
	Testing,
	typeIn,
	waitFor,
	within,
} from "./testing";

describe("App's review panel, with what the task assumed", () => {
	let testing: Testing;
	let view: ConversationsView;
	let panel: HTMLElement;

	const reviewing = conversation({
		title: "Header",
		messages: [
			message(
				"agent",
				[
					"## 🔍 Ready to merge header onto main",
					"",
					"The header wraps on phones.",
					"",
					"Open the page at 390px wide.",
					"",
					'Reply "merge", or say what to change.',
				].join("\n"),
			),
		],
	});

	const assumed = {
		tasks: [
			details({
				task: "header",
				plan: [
					"# header",
					"",
					"## Assumptions",
					"",
					"- [ ] 1. Where should the header wrap?",
					"  - (a) Below 400px (chosen)",
					"    Why: the menu fits down to 400px.",
					"  - (b) Below 600px",
					"- [ ] 2. What should the menu be called?",
					"  - (a) Menu (chosen)",
					"  - (b) More",
				].join("\n"),
			}),
		],
	};

	/** The review's assumptions, opened from the fold they wait behind. */
	async function unfold(panel: HTMLElement): Promise<HTMLElement> {
		const list = within(panel).getByRole("region", { name: "Assumptions" });
		await act(async () =>
			fireEvent.click(
				within(list).getByRole("button", { name: "Assumptions 2" }),
			),
		);
		return list;
	}

	beforeEach(async () => {
		testing = new Testing();
		view = await testing.openConversations([reviewing], "c1", assumed);
		panel = await waitFor(() =>
			view.getByRole("region", { name: "review header" }),
		);
	});

	afterEach(() => {
		cleanup();
		testing.dispose();
	});

	it("shows the reason for the choice an assumption took once asked", async () => {
		const list = await unfold(panel);
		const row = within(list).getByRole("listitem", { name: "assumption 1" });
		expect(within(row).queryByText("the menu fits down to 400px.")).toBeNull();

		await act(async () =>
			fireEvent.click(within(row).getByRole("button", { name: "Show reason" })),
		);

		expect(within(row).getByText("the menu fits down to 400px.")).toBeTruthy();
	});

	it("folds what the task assumed under a title that counts them", async () => {
		const list = within(panel).getByRole("region", { name: "Assumptions" });
		expect(within(list).queryByText("Below 400px")).toBeNull();

		await unfold(panel);

		expect(within(list).getByText("Below 400px")).toBeTruthy();
		expect(within(list).getByText("Menu")).toBeTruthy();
	});

	it("holds the assumptions open while one is challenged", async () => {
		const list = await unfold(panel);
		await act(async () =>
			fireEvent.click(
				within(list).getByRole("button", { name: "Challenge assumption 2" }),
			),
		);
		await act(async () =>
			fireEvent.click(within(list).getByRole("button", { name: /More/ })),
		);
		const toggle = within(list).getByRole("button", {
			name: "Assumptions 2",
		});

		await act(async () => fireEvent.click(toggle));

		expect(toggle.getAttribute("aria-disabled")).toBe("true");
		expect(
			within(list).getByRole("listitem", { name: "question 2" }),
		).toBeTruthy();
	});

	it("lists what the task assumed, from its plan, and sends a challenge with the changes", async () => {
		const list = await unfold(panel);
		expect(within(list).getByText("Below 400px")).toBeTruthy();
		// What it passed over waits for a challenge.
		expect(within(list).queryByText("Below 600px")).toBeNull();
		expect(button(panel)).toBe("Merge");

		await act(async () =>
			fireEvent.click(
				within(list).getByRole("button", {
					name: "Challenge assumption 1",
				}),
			),
		);
		const challenge = within(list).getByRole("listitem", {
			name: "question 1",
		});
		// Every choice is offered, the one it took tagged and picked.
		const took = within(challenge).getByRole("button", {
			name: /Below 400px/,
		});
		expect(took.textContent).toContain("Assumed");
		expect(took.getAttribute("aria-pressed")).toBe("true");
		await act(async () =>
			fireEvent.click(
				within(challenge).getByRole("button", { name: /Below 600px/ }),
			),
		);
		// Merging would leave the challenge unsaid, so Send stands in for it.
		expect(button(panel)).toBe("Send");
		await typeIn(
			within(panel).getByRole("textbox", { name: "Changes to header" }),
			"and bolder",
		);
		await act(async () =>
			fireEvent.click(within(panel).getByRole("button", { name: "Send" })),
		);

		expect(testing.posted("/api/conversations/c1/prompt")).toEqual([
			{
				method: "POST",
				body: {
					text: [
						"and bolder",
						"",
						"> **Where should the header wrap?**",
						"",
						"- (b) Below 600px",
					].join("\n"),
				},
			},
		]);
	});

	it("withdraws a challenge when the assumed choice is picked again", async () => {
		const list = await unfold(panel);
		await act(async () =>
			fireEvent.click(
				within(list).getByRole("button", { name: "Challenge assumption 2" }),
			),
		);
		await act(async () =>
			fireEvent.click(within(list).getByRole("button", { name: /More/ })),
		);
		expect(button(panel)).toBe("Send");

		await act(async () =>
			fireEvent.click(within(list).getByRole("button", { name: /Menu/ })),
		);

		expect(button(panel)).toBe("Merge");
		expect(
			within(list)
				.getByRole("button", { name: /Menu/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
	});

	it("holds the assumptions still while one is challenged, offering to reload once its agent changes them", async () => {
		const list = await unfold(panel);
		await act(async () =>
			fireEvent.click(
				within(list).getByRole("button", {
					name: "Challenge assumption 1",
				}),
			),
		);
		await act(async () =>
			fireEvent.click(
				within(
					within(list).getByRole("listitem", { name: "question 1" }),
				).getByRole("button", { name: /Below 600px/ }),
			),
		);
		await act(async () =>
			fireEvent.click(
				within(list).getByRole("button", {
					name: "Challenge assumption 2",
				}),
			),
		);
		await act(async () =>
			fireEvent.click(
				within(
					within(list).getByRole("listitem", { name: "question 2" }),
				).getByRole("button", { name: /More/ }),
			),
		);

		// Its agent drops the first, and moves the second's choices around.
		testing.served = {
			...testing.served,
			tasks: [
				details({
					task: "header",
					plan: [
						"# header",
						"",
						"## Assumptions",
						"",
						"- [ ] 2. What should the menu be called?",
						"  - (a) More",
						"  - (b) Menu (chosen)",
					].join("\n"),
				}),
			],
		};
		await act(async () => testing.stream?.onmessage?.());

		// Nothing moved under the person.
		// Said beside Send, which stays put too.
		const banner = await waitFor(() => within(panel).getByRole("status"));
		expect(
			within(list).getByRole("listitem", { name: "question 1" }),
		).toBeTruthy();
		expect(banner.textContent).toBe(
			"Assumptions changed. Reloading keeps your challenges to those still there, and drops the one now gone.Reload",
		);

		await act(async () =>
			fireEvent.click(within(banner).getByRole("button", { name: "Reload" })),
		);

		expect(within(panel).queryByRole("status")).toBeNull();
		expect(
			within(list).queryByRole("listitem", { name: "question 1" }),
		).toBeNull();
		// Carried by its text, now under another letter.
		expect(
			within(within(list).getByRole("listitem", { name: "question 2" }))
				.getByRole("button", { name: /More/ })
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(localStorage.getItem("arbor.draft.c1:review:0")).toBe(
			"> **What should the menu be called?**\n\n- (a) More",
		);
	});

	it("puts a challenge away with Keep, leaving the assumption as it was", async () => {
		const list = await unfold(panel);
		await act(async () =>
			fireEvent.click(
				within(list).getByRole("button", { name: "Challenge assumption 2" }),
			),
		);
		await act(async () =>
			fireEvent.click(within(list).getByRole("button", { name: /More/ })),
		);
		expect(button(panel)).toBe("Send");

		await act(async () =>
			fireEvent.click(
				within(list).getByRole("button", { name: "Keep assumption 2" }),
			),
		);

		expect(
			within(list).queryByRole("listitem", { name: "question 2" }),
		).toBeNull();
		expect(
			within(list).getByRole("listitem", { name: "assumption 2" }),
		).toBeTruthy();
		expect(button(panel)).toBe("Merge");
		expect(localStorage.getItem("arbor.draft.c1:review:0")).toBeNull();
	});
});

/** The one button the review's footer shows: Merge, or Send. */
function button(panel: HTMLElement): string {
	const shown = ["Merge", "Send"].filter(
		(name) => within(panel).queryByRole("button", { name }) !== null,
	);
	expect(shown).toHaveLength(1);
	return shown[0] ?? "";
}
