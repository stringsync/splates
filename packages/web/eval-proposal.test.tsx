import { describe, expect, it } from "bun:test";
import { evalProposalOf } from "./eval-proposal";
import { Markdown } from "./markdown";
import { render } from "./testing-library";

const SOURCE = [
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

describe("evalProposalOf", () => {
	it("reads each line, keeping replies in order and a tool call's name apart from its input", () => {
		const proposal = evalProposalOf(SOURCE);

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
		expect(proposal?.checks).toHaveLength(2);
		expect(proposal?.judgedBy).toBeNull();
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
				text={`\`\`\`eval\n${SOURCE}\nfail: Plan: fix README typo\n\`\`\``}
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

	it("draws as a proposal card with its setup above it and checks below, open", () => {
		const page = render(<Markdown text={`\`\`\`eval\n${SOURCE}\n\`\`\``} />);

		expect(
			page.getByText(
				"The splates skill skips the plan and says so for a trivial fix",
			),
		).toBeTruthy();
		expect(page.getByLabelText("Example conversation")).toBeTruthy();
		expect(page.getByText("You")).toBeTruthy();
		expect(page.getByText("Agent")).toBeTruthy();
		expect(page.getByText(/Small and easy to revert/)).toBeTruthy();
		expect(page.queryByText(/Plan: fix README typo/)).toBeNull();
		expect(page.getByText("Bash")).toBeTruthy();

		const setup = page.getByLabelText("Environment");
		const example = page.getByLabelText("Example conversation");
		const checks = page.getByLabelText("Checks");
		expect(
			setup.compareDocumentPosition(example) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(
			example.compareDocumentPosition(checks) &
				Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy();
		expect(page.getAllByText("Code")).toHaveLength(2);
		expect(page.getByText("Judge")).toBeTruthy();
		expect(checks.textContent).toContain(
			"Sonnet· default effort· reads the transcript after the run",
		);
		expect(checks.querySelector('path[fill="#D97757"]')).not.toBeNull();
	});

	it("stays code when it is not a proposal", () => {
		const page = render(<Markdown text={"```eval\nnot one\n```"} />);

		expect(page.queryByLabelText("Example conversation")).toBeNull();
		expect(page.container.querySelector("pre")).not.toBeNull();
	});
});
