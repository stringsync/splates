import { expect, it } from "bun:test";
import { EvalLoopStore } from "@splates/server/evals";
import { splatesHome } from "@splates/server/models";
import { Testing } from "@splates/server/testing";
import { splates } from "./splates";

it("drives a loop through CLI payloads and reports resumable JSON without launching runs", async () => {
	await using env = await Testing.open();
	env.ps.cd(env.root);
	const deps = {
		log: env.log,
		fs: env.fs,
		ps: env.ps,
		assets: env.assets,
		secrets: env.secrets,
	};
	const contract = {
		scenario: "focused",
		suiteRevision: "suite",
		target: { model: "test" },
		repetitions: 1,
	};
	const file = `${env.root}/payload.json`;
	await env.fs.write(
		file,
		JSON.stringify({ contract, revision: "base", conversation: "chat" }),
	);
	await splates.run(deps, ["evals", "improve", "example", file]);
	const store = new EvalLoopStore(env.storage);
	expect((await store.show("example")).version).toBe(0);
	const batch = { id: "baseline", contract, revision: "base" };
	await env.fs.write(file, JSON.stringify({ batch }));
	await splates.run(deps, [
		"evals",
		"request",
		"example",
		file,
		"--version",
		"0",
		"--event",
		"event-0",
		"--task",
		"edit-task",
	]);
	await env.fs.write(
		file,
		JSON.stringify({ completion: { batch, results: ["fail"] } }),
	);
	await splates.run(deps, [
		"evals",
		"record",
		"example",
		file,
		"--version",
		"1",
		"--event",
		"event-1",
		"--task",
		"edit-task",
	]);
	await env.fs.write(
		file,
		JSON.stringify({ diagnosis: "missed", hypothesis: "clarify" }),
	);
	await splates.run(deps, [
		"evals",
		"diagnose",
		"example",
		file,
		"--version",
		"2",
		"--event",
		"event-2",
		"--task",
		"edit-task",
	]);
	await env.fs.write(file, JSON.stringify({ contract, revision: "candidate" }));
	await splates.run(deps, [
		"evals",
		"propose",
		"example",
		file,
		"--version",
		"3",
		"--event",
		"event-3",
		"--task",
		"edit-task",
	]);
	await env.fs.write(file, JSON.stringify({ reason: "paused deliberately" }));
	await splates.run(deps, [
		"evals",
		"stop",
		"example",
		file,
		"--version",
		"4",
		"--event",
		"event-4",
		"--task",
		"edit-task",
	]);
	await splates.run(deps, ["evals", "show", "example"]);
	const shown = JSON.parse(String(env.log.entries.at(-1)?.message));
	expect(shown.next).toContain("Loop stopped");
	expect(shown.conversation).toBe("chat");
	expect(shown.history).toHaveLength(5);
	expect(shown.loop.stage.interrupted.kind).toBe("awaiting-comparison");
	await splates.run(deps, [
		"evals",
		"stop",
		"example",
		file,
		"--version",
		"0",
		"--event",
		"stale",
	]);
	expect(env.out()).toContain("Stale loop version");
	expect((await store.show("example")).version).toBe(5);
});

it("attaches remarks to a batch for the Evals page", async () => {
	await using env = await Testing.open();
	env.ps.cd(env.root);
	const deps = {
		log: env.log,
		fs: env.fs,
		ps: env.ps,
		assets: env.assets,
		secrets: env.secrets,
	};
	await env.fs.mkdir(`${env.root}/nightly`);
	await env.fs.write(`${env.root}/nightly/batch.json`, "{}");
	await env.fs.write(`${env.root}/remarks.md`, "Skill: too faint");

	await splates.run(deps, ["evals", "remarks", "nightly", "remarks.md"]);

	expect(await env.fs.read(`${env.root}/nightly/remarks.md`)).toBe(
		"Skill: too faint",
	);
});

it("prints each saved eval agent as its target, and says when none are saved", async () => {
	await using env = await Testing.open();
	env.ps.cd(env.root);
	const deps = {
		log: env.log,
		fs: env.fs,
		ps: env.ps,
		assets: env.assets,
		secrets: env.secrets,
	};
	const home = splatesHome(env.ps);

	await splates.run(deps, ["evals", "agents"]);
	expect(env.out()).toContain("no eval agents are saved");

	await env.fs.mkdir(home, { recursive: true });
	await env.fs.write(
		`${home}/eval-agents.json`,
		JSON.stringify({
			format: 1,
			agents: [
				{ agent: "claude", model: "m1", effort: "high" },
				{ agent: "codex" },
			],
		}),
	);
	await splates.run(deps, ["evals", "agents"]);
	expect(env.out()).toContain("claude:m1@high");
	expect(env.out()).toContain("codex");
});
