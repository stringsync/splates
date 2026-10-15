import { describe, expect, it } from "bun:test";
import { arborCalls, type Beat, judge } from "./skill-checks";

describe("skill checks", () => {
	it("arborCalls: finds arbor where a shell would run it, not in a quoted message", () => {
		expect(
			arborCalls(
				`cd /repo && FOO=1 bunx @webappwiz/arbor add retry --todo 3; git commit -m "say what arbor merge did"`,
			),
		).toEqual([{ verb: "add", args: ["retry", "--todo", "3"] }]);
	});

	it("plan-first: passes ARBOR.md written before the first other edit", () => {
		expect(
			verdicts("plan-first", [
				user(),
				add(),
				run("cat > ARBOR.md <<'EOF'\n# upload-413\nEOF"),
				edit("/repo-arbor/upload-413/src/upload.ts"),
			]),
		).toEqual([true]);
	});

	it("plan-first: fails an edit before ARBOR.md, and reading it is not writing it", () => {
		expect(
			verdicts("plan-first", [
				user(),
				add(),
				run("cat ARBOR.md 2>/dev/null"),
				edit("/repo-arbor/upload-413/src/upload.ts"),
				edit("/repo-arbor/upload-413/ARBOR.md"),
			]),
		).toEqual([false]);
	});

	it("plan-first: does not apply to a task that edited nothing", () => {
		expect(
			verdicts("plan-first", [user(), add(), say("Nothing to do.")]),
		).toEqual([]);
	});

	it("report-title: passes each ending titled its own way", () => {
		expect(
			verdicts("report-title", [
				user(),
				merge(),
				say("## ✅ Merged upload-413 onto main\n\nUploads stop retrying."),
				user(),
				run("arbor remove old --reason moot", "removed old"),
				say("## 🛑 Removed old: moot after the rewrite"),
				user(),
				run("arbor escalate --review 'look'", "escalated next"),
				say("## 🔍 Ready to merge next onto main"),
				user(),
				run("arbor escalate 'two calls'", "escalated last"),
				say("## ⚠️ Escalated last: needs two calls"),
				user(),
				run("arbor handoff styles --agent codex", "handed off styles"),
				say("## 🤝 Handed off styles to Codex: you asked for GPT-5.5"),
			]),
		).toEqual([true, true, true, true, true]);
	});

	it("report-title: fails a report that is not titled, or ends on a full stop", () => {
		expect(
			verdicts("report-title", [
				user(),
				merge(),
				say("Done! It landed."),
				user(),
				run("arbor remove old", "removed old"),
				say("## 🛑 Removed old: it was moot."),
				user(),
				run("arbor handoff styles --agent codex", "handed off styles"),
				say("Codex has it now."),
			]),
		).toEqual([false, false, false]);
	});

	it("report-title: judges the report before the next task is added, not the card after", () => {
		expect(
			verdicts("report-title", [
				user(),
				merge("one"),
				say("## ✅ Merged one onto main"),
				add("two"),
				say("## 🌱 Added two"),
			]),
		).toEqual([true]);
	});

	it("report-title: leaves out a merge that failed", () => {
		expect(
			verdicts("report-title", [
				user(),
				run("arbor merge | tail", '{"reason":"tests_failed"}'),
				say("A test failed."),
			]),
		).toEqual([]);
	});

	it("numbered-questions: passes two questions numbered, and ignores code and quotes", () => {
		expect(
			verdicts("numbered-questions", [
				user(),
				say(
					"## ⚠️ Escalated x: needs calls\n\n> **Which one?**\n\n```\nwhy?\n```\n\n1. What cap?\n2. What then?\n   - (a) Stop (chosen)",
				),
			]),
		).toEqual([true]);
	});

	it("numbered-questions: fails questions in bullets", () => {
		expect(
			verdicts("numbered-questions", [
				user(),
				say("- What cap?\n- What then?"),
			]),
		).toEqual([false]);
	});

	it("numbered-questions: does not apply to a single question", () => {
		expect(
			verdicts("numbered-questions", [user(), say("Shall I go on?")]),
		).toEqual([]);
	});

	const proposal = "### 📝 Retry on 413 [#12]\n\nIt shares the retry loop.";

	it("next-todo: passes a proposal after a merge, and fails a remove without one", () => {
		expect(
			verdicts("next-todo", [
				user(),
				merge(),
				say(`## ✅ Merged upload-413 onto main\n\nDone.\n\n${proposal}`),
				user(),
				run("arbor remove old", "removed old"),
				say("## 🛑 Removed old: moot"),
			]),
		).toEqual([true, false]);
	});

	it("next-todo: does not apply when merge had no todo to propose, or the task was handed", () => {
		const merged = [
			user(),
			merge("upload-413", false),
			say("## ✅ Merged x onto main"),
		];
		expect(verdicts("next-todo", merged)).toEqual([]);
		expect(
			verdicts(
				"next-todo",
				[user(), merge(), say("## ✅ Merged x onto main")],
				true,
			),
		).toEqual([]);
	});

	it("squashed: passes one plain commit, and fails several or an attributed one", () => {
		const found = judge(
			{ beats: [], handed: false },
			{
				landed: [
					{ task: "a", commits: ["Stop retrying a 413"] },
					{ task: "b", commits: ["Step one", "Step two"] },
					{
						task: "c",
						commits: [
							"Fix it\n\nCo-authored-by: Claude <noreply@anthropic.com>",
						],
					},
				],
			},
		).squashed;
		expect(found?.map((each) => each.ok)).toEqual([true, false, false]);
	});
});

function user(text = "fix the upload"): Beat {
	return { kind: "user", text };
}

function say(text: string): Beat {
	return { kind: "say", text };
}

function run(command: string, output = ""): Beat {
	return { kind: "run", command, output, ok: true };
}

function edit(...paths: string[]): Beat {
	return { kind: "edit", paths };
}

/** A task added, as `arbor add` prints it, color and all. */
function add(task = "upload-413", flags = ""): Beat {
	return run(
		`bunx @webappwiz/arbor add ${task}${flags} 2>&1 | tail -5`,
		`\u001b[32madded\u001b[39m ${task}\n  worktree: /repo-arbor/${task}`,
	);
}

/** A task merged, as `arbor merge` prints it, with a todo to propose or not. */
function merge(task = "upload-413", proposed = true): Beat {
	return run(
		"WEBAPPWIZ_ROOT=/repo arbor merge",
		`merged ${task} onto main (abc123)\n  worktree removed, cd /repo${
			proposed
				? "\n\nnext todo 12: Retry\n  start it: arbor add <task> --todo 12"
				: ""
		}`,
	);
}

/** What `check` found of `beats`, as pass or fail per place it applied. */
function verdicts(
	check: string,
	beats: Beat[],
	handed = false,
): boolean[] | undefined {
	return judge({ beats, handed }, { landed: [] })[check]?.map(
		(each) => each.ok,
	);
}
