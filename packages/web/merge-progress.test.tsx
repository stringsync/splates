import { afterEach, describe, expect, it } from "bun:test";
import { details } from "./fixtures";
import { MergeProgress } from "./merge-progress";
import { cleanup, fireEvent, render, within } from "./testing-library";

afterEach(cleanup);

const ago = (secs: number) => new Date(Date.now() - secs * 1000).toISOString();

describe("MergeProgress", () => {
	it("shows nothing while no merge is under way", () => {
		const view = render(<MergeProgress task={details()} phone={false} />);

		expect(view.container.textContent).toBe("");
	});

	it("checks off the merge's steps as it goes, the premerge's phases under it, and folds away", () => {
		const view = render(
			<MergeProgress
				task={details({
					base: "main",
					gate: "running",
					mergeSince: ago(125),
					mergeSteps: {
						steps: [
							{ step: "rebase", at: ago(125) },
							{ step: "wait", at: ago(120) },
							{ step: "test", at: ago(60) },
						],
						phases: [
							{ phase: "biome", at: ago(58), ms: 4000 },
							{ phase: "tests", at: ago(50) },
						],
					},
				})}
				phone={false}
			/>,
		);
		const card = view.getByRole("region", { name: "Merge progress" });

		expect(card.textContent).toContain("Merging onto main · Premerge");
		expect(card.textContent).toContain("2m 5s");
		const steps = within(card).getByRole("list", { name: "Merge steps" });
		expect(
			within(steps)
				.getAllByRole("listitem")
				.map((item) => item.getAttribute("aria-label")),
		).toEqual([
			"Rebase onto main, done",
			"Wait for its turn, done",
			"Premerge, under way",
			"biome, done",
			"tests, under way",
			"Land on main, to come",
			"Clean up, to come",
		]);

		fireEvent.click(within(card).getByRole("button"));
		expect(within(card).queryByRole("list")).toBeNull();
	});
});
