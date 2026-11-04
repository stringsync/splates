import { afterEach, expect, test } from "bun:test";
import { EvalDoneBody } from "./eval-done-card";
import { evalRoundsOf } from "./eval-rounds";
import { cleanup, fireEvent, render, within } from "./testing-library";

afterEach(cleanup);

const READ = evalRoundsOf(`| Round | Label | Change | Current | Baseline | Why |
| - | - | - | - | - | - |
| 1 | skill | Claim first | 1/3 | 0/3 | Too faint |
| 2 | judge | Rubric fix | 3/3 | 1/3 | |

Stopped by: all passing`);

test("folds each round's why until it is opened, and counts the layers changed", () => {
	const { container } = render(
		<EvalDoneBody
			read={READ ?? { rounds: [], rest: "", stoppedBy: null }}
			lead={false}
		/>,
	);

	const view = within(container);
	expect(view.queryByText("Too faint")).toBeNull();
	fireEvent.click(view.getByText("Claim first"));
	expect(view.getByText("Too faint")).toBeTruthy();
	expect(view.getByText("1 skill · 1 judge")).toBeTruthy();
	expect(view.getByText("Every repetition passes")).toBeTruthy();
});
