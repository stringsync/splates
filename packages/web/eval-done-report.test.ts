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
		checks: "",
	});
});

test("reads nothing from a report that names no final batch", () => {
	expect(evalDoneOf("Both merged tasks kept their tests.")).toBeNull();
});

test("reads the Checks section, stopping at the bookkeeping lines", () => {
	const read = evalDoneOf(`## Done: asking evals pass on 1 of 2

Mostly passes.

## Checks

- [x] \`a\` on claude opus
  Passed in round 1.
- [ ] \`b\` on codex
  Still fails after 3 rounds.

Open the report
Final batch: b-7`);

	expect(read?.checks).toBe(
		"- [x] `a` on claude opus\n  Passed in round 1.\n- [ ] `b` on codex\n  Still fails after 3 rounds.",
	);
});
