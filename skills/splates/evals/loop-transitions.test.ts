import { expect, it } from "bun:test";
import { resolve } from "node:path";
import type { Sandbox } from "@evals/evals/sandbox";
import type { Check } from "@evals/evals/scenario";
import { savedLoop } from "./loop-fixture";
import {
	baselineText,
	candidateText,
	subject,
	task,
	transitions,
} from "./loop-transition-fixture";
import { sandbox, scenarios } from "./loop-transitions";

async function open(id: string): Promise<Sandbox & AsyncDisposable> {
	const scenario = scenarios.find((each) => each.id === `eval-loop/${id}`);
	if (!scenario) {
		throw new Error(`Missing scenario ${id}`);
	}
	const box = await sandbox(resolve(import.meta.dir, ".."), scenario);
	return { ...box, [Symbol.asyncDispose]: () => box.remove() };
}

it.each(transitions)(
	"recovers persisted transition %s",
	async (transition, version, stage) => {
		await using box = await open(`resume-after-${transition}`);
		const saved = await savedLoop(box.repo);
		const recovered = JSON.parse(
			await box.repo.run(["splates", "evals", "resume", "recovery"]),
		);
		expect({
			version: saved.version,
			stage: saved.loop.stage.kind,
			task: saved.task,
			history: recovered.history,
		}).toEqual({ version, stage, task, history: saved.history });
	},
	10000,
);

it.each([
	["propose", candidateText],
	["keep", candidateText],
	["revert", baselineText],
])(
	"leaves code consistent after %s",
	async (transition, expected) => {
		await using box = await open(`resume-after-${transition}`);
		const path = (await box.repo.run(["splates", "path", task])).trim();
		expect(
			await box.repo.run(["git", "-C", path, "show", `HEAD:${subject}`]),
		).toBe(expected);
	},
	10000,
);

it("recovers refusal without evidence", async () => {
	await using box = await open("rejected-run");
	const recovered = JSON.parse(
		await box.repo.run(["splates", "evals", "resume", "recovery"]),
	);
	expect({
		version: recovered.version,
		batches: recovered.loop.batches,
		next: recovered.next,
	}).toEqual({
		version: 0,
		batches: [],
		next: expect.stringContaining("The run was refused"),
	});
});

it.each([
	["duplicate", 4, "awaiting-comparison"],
	["late", 7, "complete"],
] as const)(
	"seeds %s delivery after its original completion",
	async (delivery, version, stage) => {
		await using box = await open(`stale-completion-${delivery}`);
		const saved = await savedLoop(box.repo);
		expect({
			version: saved.version,
			stage: saved.loop.stage.kind,
			firstBatch: saved.loop.batches[0]?.batch.id,
		}).toEqual({ version, stage, firstBatch: "original-batch" });
	},
	10000,
);

it("grades a current comparison card and rejects contract drift", async () => {
	await using box = await open("stale-completion-duplicate");
	const saved = await savedLoop(box.repo);
	const check = gradingCheck(
		"eval-loop/stale-completion-duplicate",
		"current-action",
	);
	const reply = `## 🧪 Eval loop recovery at 4\n\n## 🔐 Permission: run evals splates: compare\n\n- \`landing/merge-message\`\n\nLoop: \`recovery\` at 4\nBaseline: \`${saved.loop.revision}\`\nRepetitions: 3\n`;
	const outcome = { repo: box.repo, reply, commands: [], transcript: [] };
	expect({
		correct: await check.test(outcome),
		drift: await check.test({
			...outcome,
			reply: reply.replace("Repetitions: 3", "Repetitions: 30"),
		}),
		extra: await check.test({
			...outcome,
			reply: `${reply}\n- \`unrelated/case\`\n`,
		}),
	}).toEqual({ correct: true, drift: false, extra: false });
}, 10000);

it("grades diagnosis as progress and rejects merely repeating its card", async () => {
	await using box = await open("resume-after-baseline");
	const check = gradingCheck("eval-loop/resume-after-baseline", "next-action");
	const outcome = {
		repo: box.repo,
		reply: "## 🧪 Eval loop recovery at 2",
		commands: [],
		transcript: [],
	};
	const before = await check.test(outcome);
	await box.repo.write(
		"diagnosis.json",
		JSON.stringify({
			diagnosis: "skill",
			hypothesis: "Require splates merge after committing.",
		}),
	);
	await box.repo.run([
		"splates",
		"evals",
		"diagnose",
		"recovery",
		"diagnosis.json",
		"--version",
		"2",
		"--event",
		"diagnosis",
	]);
	expect({ before, after: await check.test(outcome) }).toEqual({
		before: false,
		after: true,
	});
}, 10000);

function gradingCheck(id: string, name: string): Check {
	const check = scenarios
		.find((each) => each.id === id)
		?.checks?.find((each) => each.id === name);
	if (!check) {
		throw new Error("Missing check");
	}
	return check;
}
