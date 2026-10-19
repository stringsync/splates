import { describe, expect, it } from "bun:test";
import { type Beat, judge, splatesCalls } from "./skill-checks";

describe("skill checks", () => {
	it("splatesCalls: finds splates where a shell would run it, not in a quoted message", () => {
		expect(
			splatesCalls(
				`cd /repo && FOO=1 bunx @stringsync/splates add retry --task 3; git commit -m "say what splates merge did"`,
			),
		).toEqual([{ verb: "add", args: ["retry", "--task", "3"] }]);
	});

	it("plan-first: passes SPLATES.md written before the first other edit", () => {
		expect(
			verdicts("plan-first", [
				user(),
				add(),
				run("cat > SPLATES.md <<'EOF'\n# upload-413\nEOF"),
				edit("/repo-splates/upload-413/src/upload.ts"),
			]),
		).toEqual([true]);
	});

	it("plan-first: fails an edit before SPLATES.md, and reading it is not writing it", () => {
		expect(
			verdicts("plan-first", [
				user(),
				add(),
				run("cat SPLATES.md 2>/dev/null"),
				edit("/repo-splates/upload-413/src/upload.ts"),
				edit("/repo-splates/upload-413/SPLATES.md"),
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
				run("splates remove old --reason moot", "removed old"),
				say("## 🛑 Removed old: moot after the rewrite"),
				user(),
				say(
					'## 🔍 Ready to merge next onto main\n\nChecks: `bun test`\n\nReply "merge", or say what to change.',
				),
			]),
		).toEqual([true, true, true]);
	});

	it("report-title: fails a review titled otherwise or missing its last line", () => {
		expect(
			verdicts("report-title", [
				user(),
				say(
					'Done.\n\n## 🔍 Ready to merge next onto main\n\nReply "merge", or say what to change.',
				),
				user(),
				say("## 🔍 Ready to merge next onto main\n\nShall I merge?"),
			]),
		).toEqual([false, false]);
	});

	it("report-title: asks no title of a turn that ends on questions", () => {
		expect(
			verdicts("report-title", [
				user(),
				say("The board can mark a stale task.\n\n1. How should it look?"),
			]),
		).toEqual([]);
	});

	it("report-title: fails a report that is not titled, or ends on a full stop", () => {
		expect(
			verdicts("report-title", [
				user(),
				merge(),
				say("Done! It landed."),
				user(),
				run("splates remove old", "removed old"),
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
				run("splates merge | tail", '{"reason":"tests_failed"}'),
				say("A test failed."),
			]),
		).toEqual([]);
	});

	it("numbered-questions: passes two questions numbered, and ignores code and quotes", () => {
		expect(
			verdicts("numbered-questions", [
				user(),
				say(
					"Two calls left.\n\n> **Which one?**\n\n```\nwhy?\n```\n\n1. What cap?\n2. What then?\n   - (a) Stop (chosen)",
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

	it("setup-read-first: passes a step read before acting, and fails one acted on first", () => {
		expect(
			verdicts("setup-read-first", [
				user("[SPLATES SETUP tunnel]"),
				run("cat skills/splates/references/setup.md"),
				run("splates setup tunnel --json"),
				run("splates tunnel setup dev.example.com --email me@example.com"),
				user("[SPLATES SETUP agents]"),
				run("splates agents"),
				run("splates setup agents"),
			]),
		).toEqual([true, false]);
	});

	it("setup-read-first: does not apply outside a setup conversation", () => {
		expect(verdicts("setup-read-first", [user(), add()])).toEqual([]);
	});

	it("setup-checked: passes each turn checked after its last change, and fails one left unchecked", () => {
		expect(
			verdicts("setup-checked", [
				user("[SPLATES SETUP agents]"),
				run("splates setup agents --json"),
				run("splates agents"),
				edit("/Users/me/.splates/agents.json"),
				run("splates setup agents"),
				say("The roster now has Claude and Codex."),
				user("make codex the default"),
				edit("/Users/me/.splates/agents.json"),
				say("Done."),
			]),
		).toEqual([true, false]);
	});

	it("setup-checked: counts waiting on a cred as no change, and a turn that changed nothing does not apply", () => {
		expect(
			verdicts("setup-checked", [
				user("[SPLATES SETUP dictation]"),
				run("splates setup dictation --json"),
				say("Dictation transcribes on your own OpenAI key."),
				user("go ahead"),
				run("splates creds request OPENAI_API_KEY --device --purpose x"),
				run("splates setup dictation"),
				run("splates creds wait OPENAI_API_KEY"),
			]),
		).toEqual([true]);
	});

	it("setup-one-step: fails reading another step in the ask's turn, but not once the user asks", () => {
		expect(
			verdicts("setup-one-step", [
				user("[SPLATES SETUP agents]"),
				run("splates setup agents --json"),
				run("splates setup --json"),
				say("Next is the tunnel."),
				user("[SPLATES SETUP tunnel]"),
				run("splates setup tunnel --json"),
				run("splates setup notifications --json"),
			]),
		).toEqual([true, false]);
		expect(
			verdicts("setup-one-step", [
				user("[SPLATES SETUP agents]"),
				run("splates setup agents"),
				user("now the tunnel"),
				run("splates setup tunnel"),
			]),
		).toEqual([true]);
	});

	it("squashed: passes one plain commit, and fails several or an attributed one", () => {
		const found = judge(
			{ beats: [] },
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

/** A task added, as `splates add` prints it, color and all. */
function add(task = "upload-413", flags = ""): Beat {
	return run(
		`bunx @stringsync/splates add ${task}${flags} 2>&1 | tail -5`,
		`\u001b[32madded\u001b[39m ${task}\n  worktree: /repo-splates/${task}`,
	);
}

/** A task merged, as `splates merge` prints it. */
function merge(task = "upload-413"): Beat {
	return run(
		"SPLATES_ROOT=/repo splates merge",
		`merged ${task} onto main (abc123)\n  worktree removed, cd /repo`,
	);
}

/** What `check` found of `beats`, as pass or fail per place it applied. */
function verdicts(check: string, beats: Beat[]): boolean[] | undefined {
	return judge({ beats }, { landed: [] })[check]?.map((each) => each.ok);
}
