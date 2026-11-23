import "./testing-dom";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Steps } from "@splates/server/plans/browser";
import type { JSX } from "react";
import { ReplyContext } from "./card-reply";
import { StepsCard } from "./steps-card";
import { act, cleanup, fireEvent, render, within } from "./testing-library";

const STEPS: Steps = {
	title: "Rotate the secret",
	intro: "Only you can reach it.",
	steps: ["Open the dashboard.", "Copy the secret.", "Store it."],
	outro: "",
};

function current(container: HTMLElement): string | null {
	return container.querySelector('[aria-current="step"]')?.textContent ?? null;
}

describe("StepsCard", () => {
	beforeEach(() => localStorage.clear());
	afterEach(cleanup);

	it("starts on the first step and moves its place on with the step's circle", async () => {
		const view = render(<StepsCard steps={STEPS} />);
		const card = within(view.container);
		expect(current(view.container)).toContain("Open the dashboard.");
		expect(view.container.textContent).toContain("0 of 3");

		await act(async () =>
			fireEvent.click(card.getByRole("button", { name: "Mark step 1 done" })),
		);

		expect(current(view.container)).toContain("Copy the secret.");
		expect(view.container.textContent).toContain("1 of 3");
	});

	it("copies a step's shell command from its code block", async () => {
		const written: string[] = [];
		Object.defineProperty(window.navigator, "clipboard", {
			configurable: true,
			value: { writeText: async (text: string) => void written.push(text) },
		});
		const steps: Steps = {
			...STEPS,
			steps: ["Store it:\n```\nsplates creds set SECRET\n```"],
		};
		const view = render(<StepsCard steps={steps} />);
		await act(async () =>
			fireEvent.click(
				within(view.container).getByRole("button", { name: "Copy command" }),
			),
		);
		expect(written).toEqual(["splates creds set SECRET"]);
	});

	it("previews a future or completed step without moving checklist progress", async () => {
		const view = render(<StepsCard steps={STEPS} />);
		const card = within(view.container);
		await act(async () =>
			fireEvent.click(card.getByRole("button", { name: "Mark step 1 done" })),
		);
		const future = card.getByRole("button", { name: "Preview step 3" });
		const past = card.getByRole("button", { name: "Preview step 1, done" });

		await act(async () => fireEvent.click(future));
		expect(future.getAttribute("aria-expanded")).toBe("true");
		expect(future.closest("li")?.textContent).toContain("Preview");

		await act(async () => fireEvent.click(past));
		expect(future.getAttribute("aria-expanded")).toBe("false");
		expect(past.getAttribute("aria-expanded")).toBe("true");
		expect(current(view.container)).toContain("Copy the secret.");
		expect(view.container.textContent).toContain("1 of 3");

		await act(async () => fireEvent.click(past));
		expect(past.getAttribute("aria-expanded")).toBe("false");
	});

	it("expands a step from its title and closes the preview when progress moves", async () => {
		const view = render(<StepsCard steps={STEPS} />);
		const card = within(view.container);
		const future = card.getByRole("button", { name: "Preview step 3" });
		await act(async () => fireEvent.click(card.getByText("Store it.")));
		expect(future.getAttribute("aria-expanded")).toBe("true");
		expect(view.container.textContent).toContain("0 of 3");

		await act(async () =>
			fireEvent.click(card.getByRole("button", { name: "Mark step 1 done" })),
		);
		expect(future.getAttribute("aria-expanded")).toBe("false");
		expect(view.container.textContent).toContain("1 of 3");
	});

	it("keeps its place in this browser, for the card drawn again", async () => {
		const first = render(<StepsCard steps={STEPS} />);
		await act(async () =>
			fireEvent.click(
				within(first.container).getByRole("button", {
					name: "Mark step 1 done",
				}),
			),
		);
		cleanup();

		const again = render(<StepsCard steps={STEPS} />);

		expect(current(again.container)).toContain("Copy the secret.");
	});

	it("moves its place with Space and Backspace", async () => {
		const view = render(<StepsCard steps={STEPS} />);
		const list = view.container.querySelector("[tabindex]") as HTMLElement;
		await act(async () => fireEvent.keyDown(list, { key: " " }));
		expect(current(view.container)).toContain("Copy the secret.");
		await act(async () => fireEvent.keyDown(list, { key: "Backspace" }));
		expect(current(view.container)).toContain("Open the dashboard.");
	});

	it("ends on All done with Start over, and nothing to send", async () => {
		const view = render(<StepsCard steps={STEPS} />);
		const card = within(view.container);
		const mark = (step: number) =>
			act(async () =>
				fireEvent.click(
					card.getByRole("button", { name: `Mark step ${step} done` }),
				),
			);
		await mark(1);
		await mark(2);
		await mark(3);

		expect(view.container.textContent).toContain("All done");
		expect(card.queryByRole("button", { name: "Tell the agent" })).toBeNull();
		await act(async () =>
			fireEvent.click(card.getByRole("button", { name: "Start over" })),
		);
		expect(current(view.container)).toContain("Open the dashboard.");
	});

	it("marks the steps a newer version changed, with their old words, keeping the place", async () => {
		localStorage.clear();
		const first = render(<StepsCard steps={STEPS} />);
		await act(async () =>
			fireEvent.click(
				within(first.container).getByRole("button", {
					name: "Mark step 1 done",
				}),
			),
		);
		cleanup();
		const fixed = {
			...STEPS,
			steps: ["Open the dashboard.", "Copy it from the ⋯ menu.", "Store it."],
		};

		const view = render(<StepsCard steps={fixed} versions={[STEPS, fixed]} />);

		const here = view.container.querySelector('[aria-current="step"]');
		expect(here?.textContent).toContain("Updated");
		expect(here?.textContent).toContain("Copy it from the ⋯ menu.");
		expect(here?.querySelector(".line-through")?.textContent).toBe(
			"Copy the secret.",
		);
	});

	it("folds a version a newer one replaced", () => {
		const view = render(<StepsCard steps={STEPS} replaced />);

		expect(view.container.textContent).toContain("Replaced by a newer version");
		expect(view.container.querySelector('[aria-current="step"]')).toBeNull();
	});

	it("offers no pop-out where the browser has no picture-in-picture", () => {
		const view = render(<StepsCard steps={STEPS} />);

		expect(
			within(view.container).queryByRole("button", { name: "Pop out" }),
		).toBeNull();
	});
	it("opens step links without changing progress, including code-formatted URLs", async () => {
		const view = render(
			<StepsCard
				steps={{
					...STEPS,
					steps: [
						"Start here.",
						"Open `https://example.com/setup` or [docs](https://example.com/docs).",
					],
				}}
			/>,
		);
		const links = within(view.container).getAllByRole("link");
		const address = within(view.container).getByRole("link", {
			name: "https://example.com/setup",
		});
		expect(links.map((link) => link.getAttribute("href"))).toEqual([
			"https://example.com/setup",
			"https://example.com/docs",
		]);
		address.addEventListener("click", (event) => event.preventDefault(), {
			once: true,
		});
		await act(async () => {
			fireEvent.click(address);
			fireEvent.keyDown(
				within(view.container).getByRole("link", { name: "docs" }),
				{ key: "Enter" },
			);
		});
		expect(current(view.container)).toContain("Start here.");
		expect(
			within(view.container)
				.getByRole("button", { name: "Preview step 2" })
				.getAttribute("aria-expanded"),
		).toBe("false");
		expect(links.map((link) => link.getAttribute("target"))).toEqual([
			"_blank",
			"_blank",
		]);
	});

	function sending(card: JSX.Element): { sent: string[]; card: JSX.Element } {
		const sent: string[] = [];
		return {
			sent,
			card: (
				<ReplyContext
					value={{
						send: async (text) => {
							sent.push(text);
						},
						drafts: { read: () => "", write: () => {} },
					}}
				>
					{card}
				</ReplyContext>
			),
		};
	}

	it("asks first with steps unchecked, and Keep going sends nothing", async () => {
		const { sent, card } = sending(<StepsCard steps={STEPS} />);
		const view = within(render(card).container);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Done" })),
		);
		expect(
			view.getByText("None of the 3 steps are checked off."),
		).toBeDefined();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Keep going" })),
		);

		expect(sent).toEqual([]);
		expect(view.getByRole("button", { name: "Done" })).toBeDefined();
	});

	it("tells the agent once, then stays finished", async () => {
		const { sent, card } = sending(<StepsCard steps={STEPS} />);
		const view = within(render(card).container);
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Mark step 1 done" })),
		);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Done" })),
		);
		expect(view.getByText("Steps 2 to 3 aren't checked off.")).toBeDefined();
		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "I'm done" })),
		);

		expect(sent).toEqual([
			'(Done with the steps "Rotate the secret": 1 of 3 checked off)',
		]);
		expect(view.queryByRole("button", { name: "Done" })).toBeNull();
		expect(view.getByRole("status").textContent).toBe("Done");
	});

	it("sends at once with every step checked off", async () => {
		const { sent, card } = sending(<StepsCard steps={STEPS} />);
		const view = within(render(card).container);
		const mark = (step: number) =>
			act(async () =>
				fireEvent.click(
					view.getByRole("button", { name: `Mark step ${step} done` }),
				),
			);
		await mark(1);
		await mark(2);
		await mark(3);

		await act(async () =>
			fireEvent.click(view.getByRole("button", { name: "Done" })),
		);

		expect(sent).toEqual([
			'(Done with the steps "Rotate the secret": 3 of 3 checked off)',
		]);
	});

	it("shows a Done the thread already holds as finished, with no button", () => {
		const { card } = sending(
			<StepsCard
				steps={STEPS}
				finished={{ title: STEPS.title, checked: 2, count: 3 }}
			/>,
		);
		const view = within(render(card).container);

		expect(view.queryByRole("button", { name: "Done" })).toBeNull();
		expect(
			view.getByText(/The agent was told you finished, with 2 of 3/),
		).toBeDefined();
	});
});
