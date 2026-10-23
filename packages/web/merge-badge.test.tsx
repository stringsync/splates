import { afterEach, describe, expect, it } from "bun:test";
import type { Details } from "@stringsync/splates-server/tasks";
import { details, snapshot } from "./fixtures";
import { MergeBadge } from "./merge-badge";
import { NavigationContext } from "./navigation";
import { act, cleanup, fireEvent, render, within } from "./testing-library";

afterEach(cleanup);

const ago = (mins: number) =>
	new Date(Date.now() - mins * 60_000 - 1000).toISOString();

/** The badge over `tasks` in project `repo`, and every address it shows. */
function badge(tasks: Details[], mergeBatches: string[][] = []) {
	const shown: string[] = [];
	const view = render(
		<NavigationContext value={{ go: () => {}, show: (url) => shown.push(url) }}>
			<MergeBadge
				snapshot={snapshot({ project: "repo", tasks, mergeBatches })}
			/>
		</NavigationContext>,
	);
	return { view, shown };
}

describe("MergeBadge", () => {
	it("shows nothing while no merge waits, one merging alone included", () => {
		const { view } = badge([
			details({ task: "alpha", gate: "running", mergeSince: ago(3) }),
			details({ task: "beta", gate: "running", mergeSince: ago(4) }),
		]);
		expect(view.container.textContent).toBe("");
	});

	it("shows the longest wait and opens the merges in order, each timed from when it was asked, each to its conversation", () => {
		const { view, shown } = badge([
			details({ task: "newer", gate: "queued", mergeSince: ago(5) }),
			details({
				task: "merging",
				gate: "running",
				mergeSince: ago(9),
			}),
			details({
				task: "older",
				gate: "queued",
				mergeSince: ago(12),
				takenBy: "c-older",
			}),
		]);
		fireEvent.click(view.getByText("12m"));
		const rows = view.getAllByRole("listitem").map((row) => row.textContent);
		expect(rows).toEqual(["merging9m", "1older12m", "2newer5m"]);
		fireEvent.click(view.getByText("older"));
		expect(shown).toHaveLength(1);
		expect(shown[0]).toContain("project=repo");
		expect(shown[0]).toContain("#conversations/c-older");
	});
	it("groups confirmed companions with their own times and links, leaving waiting tasks below", () => {
		const { view, shown } = badge(
			[
				details({
					task: "alpha",
					gate: "running",
					mergeSince: ago(2),
					takenBy: "c-alpha",
				}),
				details({
					task: "beta",
					gate: "running",
					mergeSince: ago(3),
					takenBy: "c-beta",
				}),
				details({ task: "waiting", gate: "queued", mergeSince: ago(4) }),
			],
			[["alpha", "beta"]],
		);
		fireEvent.click(
			view.getByTitle(
				"How long the merge waiting longest for its turn has waited",
			),
		);
		const group = view.getByRole("region", { name: "Testing together" });
		expect(group.textContent).toContain("Testing together · 2 tasks");
		expect(
			within(group)
				.getAllByRole("listitem")
				.map((row) => row.textContent),
		).toEqual(["alpha2m", "beta3m"]);
		expect(within(group).queryByText("waiting")).toBeNull();
		expect(view.getByText("Waiting for a gate")).not.toBeNull();
		expect(view.getByRole("list", { name: "Merges" }).textContent).toBe(
			"1waiting4m",
		);
		fireEvent.click(within(group).getByText("beta"));
		expect(shown[0]).toContain("#conversations/c-beta");
	});

	it("keeps a batch accessible when all merges are running, and follows it dissolving", async () => {
		const tasks = [
			details({ task: "alpha", gate: "running", mergeSince: ago(2) }),
			details({ task: "beta", gate: "running", mergeSince: ago(3) }),
		];
		const view = render(
			<MergeBadge
				snapshot={snapshot({ tasks, mergeBatches: [["alpha", "beta"]] })}
			/>,
		);
		fireEvent.click(view.getByTitle("Tasks testing together"));
		expect(
			view.getByRole("region", { name: "Testing together" }),
		).not.toBeNull();
		await act(async () => {
			view.rerender(
				<MergeBadge
					snapshot={snapshot({
						tasks: [
							tasks[0] as Details,
							{ ...(tasks[1] as Details), gate: "queued" },
						],
						mergeBatches: [],
					})}
				/>,
			);
		});
		expect(view.queryByRole("region", { name: "Testing together" })).toBeNull();
		expect(view.getByRole("list", { name: "Merges" }).textContent).toBe(
			"alpha2m1beta3m",
		);
	});
});
