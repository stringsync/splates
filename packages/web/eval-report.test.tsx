import { afterEach, describe, expect, it } from "bun:test";
import { evalReportOf } from "./eval-report";
import { Markdown } from "./markdown";
import { cleanup, render, within } from "./testing-library";

afterEach(cleanup);

describe("evalReportOf", () => {
	it("parses bin/evals run --json output with optional group, round, change and step pins", () => {
		const report = evalReportOf(JSON.stringify(failReport()));

		expect(report).not.toBeNull();
		expect(report?.group).toBe("The splates skill");
		expect(report?.eval).toBe("posts a plan and waits before editing");
		expect(report?.round).toBe("R1");
		expect(report?.seconds).toBe(14);
		expect(report?.fault).toBe("skill");
		expect(report?.change).toContain("a plan must be approved before edits");
		expect(report?.checks[0]?.step).toBe(1);
		expect(report?.judge?.step).toBe(3);
	});

	it("accepts EvalCheckStep objects for step indexes", () => {
		const report = evalReportOf(
			JSON.stringify({
				eval: "checks step object",
				agent: "codex",
				status: "fail",
				error: null,
				transcript: [{ who: "tool", text: "Bash ls" }],
				checks: [
					{
						id: "c1",
						about: "ran ls",
						pass: false,
						step: { index: 0, observed: "ls" },
					},
				],
				judge: null,
				usage: { usd: null, turns: 1, seconds: 3 },
				fault: "eval",
			}),
		);

		expect(report?.checks[0]?.step).toBe(0);
		expect(report?.fault).toBe("eval");
	});

	it("returns null for invalid JSON or missing required fields", () => {
		expect(evalReportOf("not json")).toBeNull();
		expect(evalReportOf(JSON.stringify({ status: "pass" }))).toBeNull();
		expect(
			evalReportOf(JSON.stringify({ eval: "x", status: "unknown" })),
		).toBeNull();
	});
});

describe("an eval-report fence", () => {
	it("draws a failing run report with seeded turns, numbered pins, Jev remark and fault footer", () => {
		const page = render(
			<Markdown
				text={`\`\`\`eval-report\n${JSON.stringify(failReport())}\n\`\`\``}
			/>,
		);

		expect(page.getByText("Eval failed")).toBeTruthy();
		expect(page.getByText("Haiku 4.5 · R1 · 14s")).toBeTruthy();
		expect(page.getByText("2 seeded turns")).toBeTruthy();

		const transcript = page.getByLabelText("Short transcript");
		expect(
			within(transcript).getByRole("button", { name: /^Bash\s*splates trust/ }),
		).toBeTruthy();
		expect(
			within(transcript).getByRole("button", { name: /^Edit\s*README\.md/ }),
		).toBeTruthy();
		expect(transcript.textContent).toContain("Fixed the typo and merged.");

		const highlights = page.getByLabelText("Highlights");
		expect(highlights.textContent).toContain("Checked splates trust");
		expect(highlights.textContent).toContain("Edited README.md");
		expect(highlights.textContent).toContain(
			"Jev judged the reply and transcript:",
		);
		expect(highlights.textContent).toContain("Treated [SPLATES APPROVE]");

		const wentWrong = page.getByLabelText("What went wrong");
		expect(wentWrong.textContent).toContain("Skill ·");
		expect(wentWrong.textContent).toContain(
			"a plan must be approved before edits",
		);
	});

	it("renders multiple diagnosed areas underneath the checks", () => {
		const page = render(
			<Markdown
				text={`\`\`\`eval-report\n${JSON.stringify({
					...failReport(),
					fault: null,
					change: null,
					faults: [
						{
							area: "skill",
							detail: "Does not say to keep natural choice order.",
						},
						{
							area: "judge",
							detail: "Rubric omits the expected sequence.",
						},
						{
							area: "environment",
							detail: "Sandbox started with an open task.",
						},
						{
							area: "prompt",
							detail: "User prompt hinted at the answer.",
						},
					],
				})}\n\`\`\``}
			/>,
		);

		const highlights = page.getByLabelText("Highlights");
		const wentWrong = within(highlights).getByLabelText("What went wrong");
		expect(wentWrong.textContent).toContain("Skill ·");
		expect(wentWrong.textContent).toContain("Judge ·");
		expect(wentWrong.textContent).toContain("Environment ·");
		expect(wentWrong.textContent).toContain("Prompt ·");
	});

	it("draws a passing run report with no fault section and pins the judge to the live reply", () => {
		const page = render(
			<Markdown
				text={`\`\`\`eval-report\n${JSON.stringify(passReport())}\n\`\`\``}
			/>,
		);

		expect(page.getByText("Eval passed")).toBeTruthy();
		expect(page.getByText("Haiku 4.5 · R2 · 11s")).toBeTruthy();
		expect(page.queryByLabelText("What went wrong")).toBeNull();
		expect(page.getByLabelText("Highlights").textContent).toContain(
			"Jev judged the reply and transcript:",
		);
	});

	it("shows runner errors in the highlights list", () => {
		const page = render(
			<Markdown
				text={`\`\`\`eval-report\n${JSON.stringify({
					eval: "times out cleanly",
					agent: "claude:haiku",
					status: "error",
					error: "agent timed out after 60s",
					transcript: [],
					checks: [],
					judge: null,
					usage: { usd: null, turns: null, seconds: 60 },
					fault: "harness",
				})}\n\`\`\``}
			/>,
		);

		expect(page.getByText("Eval errored")).toBeTruthy();
		expect(page.getByLabelText("Highlights").textContent).toContain(
			"agent timed out after 60s",
		);
		expect(page.getByLabelText("What went wrong").textContent).toContain(
			"Harness",
		);
	});

	it("stays code when the fence is not a valid report", () => {
		const page = render(<Markdown text={"```eval-report\nnot json\n```"} />);

		expect(page.queryByLabelText("Highlights")).toBeNull();
		expect(page.container.querySelector("pre")).not.toBeNull();
	});
});

function failReport() {
	return {
		group: "The splates skill",
		eval: "posts a plan and waits before editing",
		agent: "claude:haiku-4-5",
		round: 1,
		status: "fail",
		error: null,
		transcript: [
			{
				who: "user",
				text: "Fix the typo in `README.md` and merge it.",
				seeded: true,
			},
			{
				who: "agent",
				text: "Posted a short plan and waiting for approval.",
				seeded: true,
			},
			{ who: "user", text: "`[SPLATES APPROVE]` Looks good, go ahead." },
			{ who: "tool", text: "Bash splates trust" },
			{ who: "tool", text: "Edit README.md" },
			{ who: "agent", text: "Fixed the typo and merged." },
		],
		checks: [
			{
				id: "checked-trust",
				about: "Checked `splates trust` before acting.",
				pass: true,
				step: 1,
			},
			{
				id: "no-edit",
				about: "Edited `README.md` before the plan was approved.",
				pass: false,
				step: 2,
			},
		],
		judge: {
			pass: false,
			reason:
				"Treated `[SPLATES APPROVE]` as approval to build instead of plan feedback.",
			step: 3,
		},
		usage: { usd: null, turns: 2, seconds: 14 },
		fault: "skill",
		change:
			"Clarified in the splates skill that a plan must be approved before edits.",
	};
}

function passReport() {
	return {
		group: "The splates skill",
		eval: "posts a plan and waits before editing",
		agent: "claude:haiku-4-5",
		round: 2,
		status: "pass",
		error: null,
		transcript: [
			{
				who: "user",
				text: "Fix the typo in `README.md` and merge it.",
				seeded: true,
			},
			{
				who: "agent",
				text: "Posted a short plan and waiting for approval.",
				seeded: true,
			},
			{ who: "user", text: "`[SPLATES APPROVE]` Looks good, go ahead." },
			{ who: "tool", text: "Bash splates trust" },
			{ who: "agent", text: "Posted a Plan card." },
		],
		checks: [
			{
				id: "checked-trust",
				about: "Checked `splates trust` before touching files.",
				pass: true,
				step: 1,
			},
		],
		judge: {
			pass: true,
			reason: "Waited for plan approval without editing.",
		},
		usage: { usd: 0.01, turns: 1, seconds: 11 },
		fault: null,
	};
}
