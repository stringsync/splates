import { expect, it } from "bun:test";
import { resolve } from "node:path";
import type { Sandbox } from "@evals/evals/sandbox";
import { NodeFs } from "core/system";
import { sandbox, scenarios } from "./eval-loop";
import { savedLoop } from "./loop-fixture";

const skill = resolve(import.meta.dir, "..");

async function open(name: string): Promise<Sandbox & AsyncDisposable> {
	const scenario = scenarios.find((each) => each.id === `eval-loop/${name}`);
	if (!scenario) {
		throw new Error(`Missing scenario ${name}`);
	}
	const box = await sandbox(skill, scenario);
	return { ...box, [Symbol.asyncDispose]: () => box.remove() };
}

it.each(scenarios)(
	"seeds isolated state and hides eval files: $id",
	async (scenario) => {
		await using box = await open(scenario.id.slice("eval-loop/".length));
		const state = JSON.parse(
			await box.repo.run(["splates", "evals", "resume", "recovery"]),
		);
		const installs = await Promise.all(
			[".agents", ".claude"].map((install) =>
				new NodeFs().exists(`${box.repo.dir}/${install}/skills/splates/evals`),
			),
		);
		expect({
			version: state.version,
			repetitions: state.loop.contract.repetitions,
			installs,
		}).toEqual({ version: 0, repetitions: 3, installs: [false, false] });
	},
);

it("recovers the original live request without a new batch", async () => {
	await using box = await open("interrupted-running");
	const state = JSON.parse(
		await box.repo.run(["splates", "evals", "resume", "recovery"]),
	);
	expect(state.next).toContain("Reattach to run request original-request");
});

it("leaves a fresh baseline without a launch", async () => {
	await using box = await open("fresh-baseline");
	const state = JSON.parse(
		await box.repo.run(["splates", "evals", "resume", "recovery"]),
	);
	expect(state.launches).toEqual([]);
});

it("reconciles a lost completion only once", async () => {
	await using box = await open("lost-completion");
	await box.repo.run(["splates", "evals", "reconcile", "recovery"]);
	await box.repo.run(["splates", "evals", "reconcile", "recovery"]);
	const saved = await savedLoop(box.repo);
	expect({
		version: saved.version,
		stage: saved.loop.stage.kind,
		events: saved.history.map((event) => event.id),
	}).toEqual({
		version: 2,
		stage: "baseline-diagnosing",
		events: ["run-original-batch", "done-original-batch"],
	});
});

it("refuses incomplete evidence without advancing the loop", async () => {
	await using box = await open("interrupted-process");
	const failure = await box.repo
		.run(["splates", "evals", "reconcile", "recovery"])
		.catch((error: Error) => error.message);
	expect({ failure, version: (await savedLoop(box.repo)).version }).toEqual({
		failure: expect.stringContaining("missing unique repetition evidence"),
		version: 0,
	});
});
