import { afterEach, describe, expect, it } from "bun:test";
import type { Details } from "@stringsync/splates-server/tasks";
import { details, snapshot } from "./fixtures";
import { MergeBadge } from "./merge-badge";
import { NavigationContext } from "./navigation";
import { cleanup, fireEvent, render } from "./testing-library";

afterEach(cleanup);

const ago = (mins: number) =>
	new Date(Date.now() - mins * 60_000 - 1000).toISOString();

/** The badge over `tasks` in project `repo`, and every address it shows. */
function badge(tasks: Details[]) {
	const shown: string[] = [];
	const view = render(
		<NavigationContext value={{ go: () => {}, show: (url) => shown.push(url) }}>
			<MergeBadge snapshot={snapshot({ project: "repo", tasks })} />
		</NavigationContext>,
	);
	return { view, shown };
}

describe("MergeBadge", () => {
	it("shows nothing while no merge waits, one merging alone included", () => {
		const { view } = badge([
			details({ task: "alpha" }),
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
});
