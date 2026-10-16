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
			]),
		).toEqual([true, true, true, true]);
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
			]),
		).toEqual([false, false]);
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

	it("setup-read-first: passes a step read before acting, and fails one acted on first", () => {
		expect(
			verdicts("setup-read-first", [
				user("[ARBOR SETUP tunnel]"),
				run("cat skills/arbor/references/setup.md"),
				run("arbor setup tunnel --json"),
				run("arbor tunnel setup dev.example.com --email me@example.com"),
				user("[ARBOR SETUP agents]"),
				run("arbor agents"),
				run("arbor setup agents"),
			]),
		).toEqual([true, false]);
	});

	it("setup-read-first: does not apply outside a setup conversation", () => {
		expect(verdicts("setup-read-first", [user(), add()])).toEqual([]);
	});

	it("setup-checked: passes each turn checked after its last change, and fails one left unchecked", () => {
		expect(
			verdicts("setup-checked", [
				user("[ARBOR SETUP agents]"),
				run("arbor setup agents --json"),
				run("arbor agents"),
				edit("/Users/me/.arbor/agents.json"),
				run("arbor setup agents"),
				say("The roster now has Claude and Codex."),
				user("make codex the default"),
				edit("/Users/me/.arbor/agents.json"),
				say("Done."),
			]),
		).toEqual([true, false]);
	});

	it("setup-checked: counts waiting on a cred as no change, and a turn that changed nothing does not apply", () => {
		expect(
			verdicts("setup-checked", [
				user("[ARBOR SETUP dictation]"),
				run("arbor setup dictation --json"),
				say("Dictation transcribes on your own OpenAI key."),
				user("go ahead"),
				run("arbor creds request OPENAI_API_KEY --device --purpose x"),
				run("arbor setup dictation"),
				run("arbor creds wait OPENAI_API_KEY"),
			]),
		).toEqual([true]);
	});

	it("setup-one-step: fails reading another step in the ask's turn, but not once the user asks", () => {
		expect(
			verdicts("setup-one-step", [
				user("[ARBOR SETUP agents]"),
				run("arbor setup agents --json"),
				run("arbor setup --json"),
				say("Next is the tunnel."),
				user("[ARBOR SETUP tunnel]"),
				run("arbor setup tunnel --json"),
				run("arbor setup notifications --json"),
			]),
		).toEqual([true, false]);
		expect(
			verdicts("setup-one-step", [
				user("[ARBOR SETUP agents]"),
				run("arbor setup agents"),
				user("now the tunnel"),
				run("arbor setup tunnel"),
			]),
		).toEqual([true]);
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
