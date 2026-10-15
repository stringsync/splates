import { describe, expect, it } from "bun:test";
import type { Beat } from "@webappwiz/arbor/skill-checks";
import { COMMON, type EvalRun } from "./checks";
import type { EndRepo } from "./fixture";
import { openQuestions } from "./reading";

describe("eval checks", () => {
	it("report-body: passes one short sentence and few bullets under a task report's title", () => {
		expect(
			verdicts("report-body", [
				say(
					"## ✅ Merged retry-413 onto main\n\nUploads stop retrying a 413 and say the file is too big.\n\n- Restart to see it.\n\n### 📝 Next [#3]\n\nIt follows.",
				),
			]),
		).toEqual([true]);
	});

	it("report-body: fails two sentences, counting none inside code", () => {
		expect(
			verdicts("report-body", [
				say(
					"## ✅ Merged retry-413 onto main\n\nIn `src/upload.ts` a 413 stops. The user is told.",
				),
			]),
		).toEqual([false]);
	});

	it("report-body: leaves out a reply that reports no task, as a lane's", () => {
		expect(
			verdicts("report-body", [
				say("## 🏁 Finished lanes Upload errors\n\nDone. Both landed."),
			]),
		).toEqual([]);
	});

	it("questions-in-report: fails an open question the escalation leaves out", () => {
		const end = endWith({ status: "escalated", plan: PLAN });
		expect(
			verdicts(
				"questions-in-report",
				[
					say(
						"## ⚠️ Escalated cap: needs a number\n\nOne.\n\n1. How many tries?\n   - (a) Three (chosen)\n   - (b) Five",
					),
				],
				end,
			),
		).toEqual([true, false]);
	});

	it("openQuestions: reads open questions with their choices, not checked ones", () => {
		expect(openQuestions(PLAN)).toEqual([
			{ subject: "How many tries?", choices: ["Three (chosen)", "Five"] },
			{ subject: "What then?", choices: [] },
		]);
	});
});

const PLAN = `# cap

## Blocked

- [x] 1. Old one? → a
  - (a) Yes it
- [ ] 2. How many tries?
  - (a) Three (chosen)
  - (b) Five
- [ ] 3. What then?
`;

function verdicts(
	id: string,
	beats: Beat[],
	end: EndRepo = endWith(),
): boolean[] {
	const check = COMMON.find((each) => each.id === id);
	const run: EvalRun = {
		log: {
			transcript: {
				beats: [{ kind: "user", text: "go" }, ...beats],
				handed: false,
			},
			tools: [],
			text: "",
			usage: [],
		},
		end,
	};
	return (check?.judge(run) ?? []).map((each) => each.ok);
}

function say(text: string): Beat {
	return { kind: "say", text };
}

function endWith(task?: { status: string; plan: string }): EndRepo {
	return {
		landed: [],
		tasks: task === undefined ? [] : [{ task: "cap", base: "main", ...task }],
		todos: [],
		lanes: [],
		systems: false,
		main: [],
	};
}
