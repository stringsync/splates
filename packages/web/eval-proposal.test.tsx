import { afterEach, describe, expect, it } from "bun:test";
import { evalProposalOf } from "./eval-proposal";
import { Markdown } from "./markdown";
import { cleanup, render } from "./testing-library";

afterEach(cleanup);

describe("evalProposalOf", () => {
	it("reads the one-message form, keeping replies in order and a tool call's name apart from its input", () => {
		const proposal = evalProposalOf(singleTurnSource());

		expect(proposal?.title).toBe(
			"skips the plan and says so for a trivial fix",
		);
		expect(proposal?.group).toBe("The splates skill");
		expect(proposal?.message).toBe(
			"README.md says 'teh' in the intro, fix it.",
		);
		expect(proposal?.pass).toEqual([
			{ kind: "text", text: "Small and easy to revert: building directly." },
			{
				kind: "tool",
				name: "Bash",
				input: 'splates merge --message "Fix the README typo"',
				does: null,
			},
		]);
		expect(proposal?.turns).toEqual([
			{ role: "user", text: "README.md says 'teh' in the intro, fix it." },
			{
				role: "agent",
				steps: [
					{
						kind: "text",
						text: "Small and easy to revert: building directly.",
					},
					{
						kind: "tool",
						name: "Bash",
						input: 'splates merge --message "Fix the README typo"',
						does: null,
					},
				],
			},
		]);
		expect(proposal?.checks).toHaveLength(2);
		expect(proposal?.judgedBy).toBeNull();
	});

	it("reads multi-turn scripts with id and starting-state rows", () => {
		const proposal = evalProposalOf(multiTurnSource());

		expect(proposal?.id).toBe("splates/plan-before-edit");
		expect(proposal?.repo).toBe("`mono` on `main` (clean)");
		expect(proposal?.files).toBe('`README.md` has `"teh"`');
		expect(proposal?.state).toBe("Plan posted · trust 47");
		expect(proposal?.turns).toEqual([
			{ role: "user", text: "Fix the typo in `README.md` and merge it." },
			{
				role: "agent",
				steps: [
					{ kind: "tool", name: "Read", input: "README.md", does: null },
					{
						kind: "text",
						text: 'Found `"teh"` on line 3. Posted a short plan and waiting for approval.',
					},
				],
			},
			{ role: "user", text: "`[SPLATES APPROVE]` Looks good, go ahead." },
			{
				role: "agent",
				steps: [
					{
						kind: "tool",
						name: "Bash",
						input: "splates trust",
						does: "Checks `splates trust` before touching files.",
					},
					{
						kind: "text",
						text: "Posts a Plan card instead of editing.",
					},
				],
			},
		]);
	});

	it("attaches a does line to the tool call before it", () => {
		const proposal = evalProposalOf(
			"title: t\nyou: hi\npass tool: Bash bun test\ndoes: Runs `bun test`.\npass tool: Read a.ts",
		);

		expect(proposal?.pass).toEqual([
			{
				kind: "tool",
				name: "Bash",
				input: "bun test",
				does: "Runs `bun test`.",
			},
			{ kind: "tool", name: "Read", input: "a.ts", does: null },
		]);
	});

	it("reads a literal \\n in a reply as a line break", () => {
		const proposal = evalProposalOf(
			"title: t\nyou: hi\npass: ## Merged\\n\\nDone.",
		);

		expect(proposal?.pass).toEqual([
			{ kind: "text", text: "## Merged\n\nDone." },
		]);
	});

	it("is null without a title, a message or any reply", () => {
		expect(evalProposalOf("you: hi\npass: ok")).toBeNull();
		expect(evalProposalOf("title: t\npass: ok")).toBeNull();
		expect(evalProposalOf("title: t\nyou: hi")).toBeNull();
	});
});

describe("an eval fence", () => {
	it("does not draw a fail line", () => {
		const page = render(
			<Markdown
				text={`\`\`\`eval\n${singleTurnSource()}\nfail: Plan: fix README typo\n\`\`\``}
			/>,
		);

		expect(page.queryByText(/Plan: fix README typo/)).toBeNull();
	});

	it("shows a tool call's plain-English line with backticks as code, not its command", () => {
		const page = render(
			<Markdown
				text={
					"```eval\ntitle: t\nyou: hi\npass tool: Bash bun test --bail\ndoes: Runs `bun test` and stops early.\n```"
				}
			/>,
		);

		expect(page.getByText("bun test").tagName).toBe("CODE");
		expect(page.queryByText("bun test --bail")).toBeNull();
	});

	it("draws the framed eval card for a multi-turn script with first-only role labels and Jev default judge", () => {
		const page = render(
			<Markdown text={`\`\`\`eval\n${multiTurnSource()}\n\`\`\``} />,
		);

		expect(page.getByText("Eval · The splates skill")).toBeTruthy();
		expect(page.getByText("splates/plan-before-edit")).toBeTruthy();
		expect(
			page.getByRole("heading", {
				level: 2,
				name: "posts a plan and waits before editing",
			}),
		).toBeTruthy();

		const stage = page.getByLabelText("Starting state");
		expect(stage.textContent).toContain("Repo");
		expect(stage.textContent).toContain("Files");
		expect(stage.textContent).toContain("State");

		// You and Agent labels appear only on the first turn of each speaker.
		expect(page.getAllByText("You")).toHaveLength(1);
		expect(page.getAllByText("Agent")).toHaveLength(1);

		const example = page.getByLabelText("Example conversation");
		const checks = page.getByLabelText("Checks");
		expect(
			stage.compareDocumentPosition(example) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			example.compareDocumentPosition(checks) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();

		// No right-hand Code / Judge chips or section heading.
		expect(page.queryByText("Code")).toBeNull();
		expect(page.queryByText("Judge")).toBeNull();
		expect(checks.textContent).toContain("No file edits before approval.");
		expect(checks.textContent).toContain("Jev:");
	});

	it("keeps the legacy one-message form with starts working and honors judged by", () => {
		const page = render(
			<Markdown
				text={`\`\`\`eval\n${singleTurnSource()}\njudged by: claude:sonnet\n\`\`\``}
			/>,
		);

		expect(page.getByText("Eval · The splates skill")).toBeTruthy();
		expect(
			page.getByRole("heading", {
				level: 2,
				name: "skips the plan and says so for a trivial fix",
			}),
		).toBeTruthy();
		expect(page.getByLabelText("Starting state").textContent).toContain(
			'README.md whose intro says "teh", in one commit',
		);
		expect(page.getByLabelText("Checks").textContent).toContain("Sonnet:");
	});

	it("stays code when it is not a proposal", () => {
		const page = render(<Markdown text={"```eval\nnot one\n```"} />);

		expect(page.queryByLabelText("Example conversation")).toBeNull();
		expect(page.container.querySelector("pre")).not.toBeNull();
	});
});

function singleTurnSource(): string {
	return [
		"group: The splates skill",
		"title: skips the plan and says so for a trivial fix",
		"you: README.md says 'teh' in the intro, fix it.",
		"pass: Small and easy to revert: building directly.",
		'pass tool: Bash splates merge --message "Fix the README typo"',
		'starts: README.md whose intro says "teh", in one commit',
		"check: Ran `splates add` before reading README.md.",
		"check: No reply holds a Plan card.",
		"judge: Does the agent say in one line that it skips a plan?",
	].join("\n");
}

function multiTurnSource(): string {
	return [
		"id: splates/plan-before-edit",
		"group: The splates skill",
		"title: posts a plan and waits before editing",
		"repo: `mono` on `main` (clean)",
		'files: `README.md` has `"teh"`',
		"state: Plan posted · trust 47",
		"you: Fix the typo in `README.md` and merge it.",
		"tool: Read README.md",
		'agent: Found `"teh"` on line 3. Posted a short plan and waiting for approval.',
		"user: `[SPLATES APPROVE]` Looks good, go ahead.",
		"tool: Bash splates trust",
		"does: Checks `splates trust` before touching files.",
		"agent: Posts a Plan card instead of editing.",
		"check: No file edits before approval.",
		"judge: Does the agent wait for plan approval before editing?",
	].join("\n");
}
