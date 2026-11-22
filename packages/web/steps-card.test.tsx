import "./testing-dom";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Steps } from "@splates/server/plans/browser";
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

	it("marks a step ahead done with every step before it, from its number", async () => {
		const view = render(<StepsCard steps={STEPS} />);
		const card = within(view.container);

		await act(async () =>
			fireEvent.click(
				card.getByRole("button", { name: "Mark steps through 2 done" }),
			),
		);

		expect(current(view.container)).toContain("Store it.");
		expect(view.container.textContent).toContain("2 of 3");
		expect(
			card.getByRole("button", { name: "Step 1, done: back to it" }),
		).toBeDefined();
	});

	it.each(STEPS.steps)(
		"leaves progress unchanged when clicking %s",
		async (text) => {
			const view = render(<StepsCard steps={STEPS} />);
			const card = within(view.container);
			await act(async () => fireEvent.click(card.getByText(text)));
			expect(view.container.textContent).toContain("0 of 3");
			await act(async () =>
				fireEvent.click(card.getByRole("button", { name: "Mark step 1 done" })),
			);
			await act(async () => fireEvent.click(card.getByText(text)));
			expect(view.container.textContent).toContain("1 of 3");
		},
	);

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

	it("moves its place back to a step done when its check is pressed, and with Backspace", async () => {
		const view = render(<StepsCard steps={STEPS} />);
		const card = within(view.container);
		await act(async () =>
			fireEvent.click(card.getByRole("button", { name: "Mark step 1 done" })),
		);
		await act(async () =>
			fireEvent.click(card.getByRole("button", { name: "Mark step 2 done" })),
		);

		await act(async () =>
			fireEvent.click(
				card.getByRole("button", { name: "Step 1, done: back to it" }),
			),
		);
		expect(current(view.container)).toContain("Open the dashboard.");

		const list = view.container.querySelector("[tabindex]") as HTMLElement;
		await act(async () => fireEvent.keyDown(list, { key: " " }));
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
	expect(links.map((link) => link.getAttribute("href"))).toEqual([
		"https://example.com/setup",
		"https://example.com/docs",
	]);
	await act(async () => {
		fireEvent.click(
			within(view.container).getByRole("link", {
				name: "https://example.com/setup",
			}),
		);
		fireEvent.keyDown(
			within(view.container).getByRole("link", { name: "docs" }),
			{ key: "Enter" },
		);
	});
	expect(current(view.container)).toContain("Start here.");
	expect(links.map((link) => link.getAttribute("target"))).toEqual([
		"_blank",
		"_blank",
	]);
});
