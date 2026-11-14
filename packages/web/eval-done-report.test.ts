import { expect, test } from "bun:test";
import { evalDoneOf } from "./eval-done-report";

test("reads the outcome line and the final batch, skipping headings and tables", () => {
	const read = evalDoneOf(`## rec/x passes

\`rec/x\` passes on every agent.

| Agent | Rate |
| - | - |
| a | 3/3 |

Stopped by: all passing
Final batch: \`b-42\``);

	expect(read).toEqual({
		outcome: "`rec/x` passes on every agent.",
		batch: "b-42",
	});
});

test("reads nothing from a report that names no final batch", () => {
	expect(evalDoneOf("Both merged tasks kept their tests.")).toBeNull();
});
