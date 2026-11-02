import { expect, it } from "bun:test";
import { resolve } from "node:path";
import type { Sandbox } from "@evals/evals/sandbox";
import type { Check } from "@evals/evals/scenario";
import { savedLoop } from "./loop-fixture";
import { sandbox, scenarios } from "./loop-guards";
import { subject, TransitionFixture, task } from "./loop-transition-fixture";

async function open(id: string): Promise<Sandbox & AsyncDisposable> {
	const scenario = scenarios.find((each) => each.id === `eval-loop/${id}`);
	if (!scenario) {
		throw new Error(`Missing scenario ${id}`);
	}
	const box = await sandbox(resolve(import.meta.dir, ".."), scenario);
	return { ...box, [Symbol.asyncDispose]: () => box.remove() };
}

function check(id: string, name: string): Check {
	const found = scenarios
		.find((each) => each.id === `eval-loop/${id}`)
		?.checks?.find((each) => each.id === name);
	if (!found) {
		throw new Error(`Missing check ${id}/${name}`);
	}
	return found;
}

it("requires rebaseline of the actual changed suite commit", async () => {
	await using box = await open("changed-suite");
	const saved = await savedLoop(box.repo);
	const path = (await box.repo.run(["splates", "path", task])).trim();
	const suite = (
		await box.repo.run(["git", "-C", path, "rev-parse", "HEAD"])
	).trim();
	const changed = await box.repo.run([
		"git",
		"-C",
		path,
		"diff",
		saved.loop.contract.suiteRevision,
		suite,
		"--",
		"skills/splates/evals/landing.ts",
	]);
	const outcome = { repo: box.repo, reply: "", commands: [], transcript: [] };
	const before = await check("changed-suite", "rebaselined").test(outcome);
	await new TransitionFixture(box.repo).advance("rebaseline", {
		contract: { ...saved.loop.contract, suiteRevision: suite },
	});
	const reply =
		"## 🔐 Permission: run evals splates: baseline\n\n- `landing/merge-message`\n\nLoop: `recovery` at 3\nRepetitions: 3\n";
	expect({
		before,
		after: await check("changed-suite", "rebaselined").test({
			...outcome,
			reply,
		}),
		changed,
	}).toEqual({
		before: false,
		after: true,
		changed: expect.stringContaining("reported-task-name"),
	});
}, 10000);

it("leaves partial comparison unrecorded", async () => {
	await using box = await open("decision-before-evidence");
	const saved = await savedLoop(box.repo);
	expect({
		version: saved.version,
		stage: saved.loop.stage.kind,
		completed: saved.loop.batches.map((batch) => batch.batch.id),
	}).toEqual({ version: 5, stage: "comparing", completed: ["original-batch"] });
});

it("grades the third no-gain revert and task cleanup", async () => {
	await using box = await open("three-no-gain");
	const before = await savedLoop(box.repo);
	const path = (await box.repo.run(["splates", "path", task])).trim();
	const outcome = { repo: box.repo, reply: "", commands: [], transcript: [] };
	const candidate = (
		await box.repo.run(["git", "-C", path, "rev-parse", "HEAD"])
	).trim();
	const starting = await check("three-no-gain", "third-revert-stopped").test(
		outcome,
	);
	await box.repo.run(["git", "-C", path, "revert", "--no-edit", candidate]);
	await new TransitionFixture(box.repo).advance("revert", {
		reason: "Third paired comparison showed no gain.",
	});
	const reverted = await box.repo.run([
		"git",
		"-C",
		path,
		"show",
		`HEAD:${subject}`,
	]);
	await box.repo.run(["splates", "remove", task, "--reason", "nothing"]);
	expect({
		initialCount: before.loop.noGainCount,
		initialRounds: before.loop.rounds.length,
		starting,
		stopped: await check("three-no-gain", "third-revert-stopped").test(outcome),
		closed: await check("three-no-gain", "discarded-code").test(outcome),
		reverted,
	}).toEqual({
		initialCount: 2,
		initialRounds: 2,
		starting: false,
		stopped: true,
		closed: true,
		reverted:
			"# Landing\n\nCommit the completed change and report the outcome.\n",
	});
}, 15000);

it.each([
	["fail", "baseline-diagnosing"],
	["error", "baseline-diagnosing"],
	["pass", "complete"],
] as const)(
	"grades repeated-pass with final %s",
	async (last, expectedStage) => {
		await using box = await open(`repeated-pass-${last}`);
		const outcome = { repo: box.repo, reply: "", commands: [], transcript: [] };
		const before = await check(`repeated-pass-${last}`, "correct-stop").test(
			outcome,
		);
		await new TransitionFixture(box.repo).advance("keep", {
			reason: "The candidate gained against the paired baseline.",
		});
		const saved = await savedLoop(box.repo);
		expect({
			before,
			after: await check(`repeated-pass-${last}`, "correct-stop").test(outcome),
			stage: saved.loop.stage.kind,
			results: saved.loop.batches[1]?.results,
		}).toEqual({
			before: false,
			after: true,
			stage: expectedStage,
			results: ["pass", "pass", last],
		});
	},
	10000,
);
