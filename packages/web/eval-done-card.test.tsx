import { afterEach, expect, test } from "bun:test";
import { EvalDoneBody } from "./eval-done-card";
import { evalRoundsOf } from "./eval-rounds";
import { cleanup, fireEvent, render, waitFor, within } from "./testing-library";

afterEach(cleanup);

const EMPTY = {
	rounds: [],
	rest: "",
	stoppedBy: null,
	finalBatch: null,
	commit: null,
};

const READ = evalRoundsOf(`| Round | Label | Change | Current | Baseline | Why |
| - | - | - | - | - | - |
| 1 | skill | Claim first | 1/3 | 0/3 | Too faint |
| 2 | judge | Rubric fix | 3/3 | 1/3 | |

Stopped by: all passing
Final batch: b-42
Commit: abc1234`);

test("folds each round's why until it is opened, and counts the layers changed", () => {
	const { container } = render(
		<EvalDoneBody
			read={
				READ ?? {
					rounds: [],
					rest: "",
					stoppedBy: null,
					finalBatch: null,
					commit: null,
				}
			}
			lead={false}
		/>,
	);

	const view = within(container);
	expect(view.queryByText("Too faint")).toBeNull();
	fireEvent.click(view.getByText("Claim first"));
	expect(view.getByText("Too faint")).toBeTruthy();
	expect(view.getByText("1 skill · 1 judge")).toBeTruthy();
	expect(view.getByText("Every repetition passes")).toBeTruthy();
	expect(view.getByText("0/3 → 3/3 passing")).toBeTruthy();
	expect(view.getByText("Keep the change")).toBeTruthy();
	expect(view.getByText("all passing")).toBeTruthy();
});

test("links Final evidence to the batch the report names", () => {
	const { container } = render(
		<EvalDoneBody
			read={
				READ ?? {
					rounds: [],
					rest: "",
					stoppedBy: null,
					finalBatch: null,
					commit: null,
				}
			}
			lead={false}
		/>,
	);

	expect(
		within(container).getByText("Final evidence").getAttribute("href"),
	).toBe("#evals/b-42");
});

test("opens the landed commit's diff under View diff", async () => {
	const real = globalThis.fetch;
	const asked: string[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL) => {
		asked.push(String(input));
		return Response.json([
			{
				path: "skills/a.md",
				from: null,
				status: "modified",
				added: 1,
				removed: 0,
				binary: false,
				uncommitted: false,
				hunks: [],
			},
		]);
	}) as typeof fetch;
	try {
		const { container } = render(
			<EvalDoneBody read={READ ?? EMPTY} lead={false} />,
		);
		fireEvent.click(within(container).getByText("View diff"));
		await waitFor(() =>
			expect(within(container).getByText(/skills\/a\.md|a\.md/u)).toBeTruthy(),
		);
		expect(asked.some((url) => url.includes("/api/commits/abc1234/diff"))).toBe(
			true,
		);
	} finally {
		globalThis.fetch = real;
	}
});
