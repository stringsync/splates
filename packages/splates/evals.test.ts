import { expect, it } from "bun:test";
import { splatesHome } from "@splates/server/models";
import { Testing } from "@splates/server/testing";
import { splates } from "./splates";

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

it("refuses remarks whose Faults list names no layer, leaving the batch's", async () => {
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
	await env.fs.write(`${env.root}/remarks.md`, "Faults:\n- run-000: weather");

	await splates.run(deps, ["evals", "remarks", "nightly", "remarks.md"]);

	expect(env.out()).toContain('"reason":"usage"');
	expect(await env.fs.exists(`${env.root}/nightly/remarks.md`)).toBe(false);
});

it("refuses a diagnosis naming a run or check the batch does not have", async () => {
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
	await env.fs.write(
		`${env.root}/nightly/batch.json`,
		JSON.stringify({
			format: "splates-evals/1",
			startedAt: "2026-11-24T12:00:00.000Z",
			cells: [{ id: "run-000", case: "creds", target: { model: "m" } }],
		}),
	);
	await env.fs.write(
		`${env.root}/nightly/results.jsonl`,
		`${JSON.stringify({ cell: "run-000", status: "fail", detail: "run-000.json" })}\n`,
	);
	await env.fs.write(
		`${env.root}/nightly/run-000.json`,
		JSON.stringify({ checks: [{ id: "asks", about: "asks", pass: false }] }),
	);
	const entry = (head: string) =>
		`Diagnosis:\n- ${head}: skill\n  - Why: The skill misses webhooks.\n`;

	await env.fs.write(`${env.root}/remarks.md`, entry("run-009 asks"));
	await splates.run(deps, ["evals", "remarks", "nightly", "remarks.md"]);
	expect(env.out()).toContain("run-009 is no finished run of this batch");

	await env.fs.write(`${env.root}/remarks.md`, entry("run-000 leaves-env"));
	await splates.run(deps, ["evals", "remarks", "nightly", "remarks.md"]);
	expect(env.out()).toContain("run-000 has no check leaves-env");
	expect(await env.fs.exists(`${env.root}/nightly/remarks.md`)).toBe(false);

	await env.fs.write(`${env.root}/remarks.md`, entry("run-000 asks"));
	await splates.run(deps, ["evals", "remarks", "nightly", "remarks.md"]);
	expect(await env.fs.read(`${env.root}/nightly/remarks.md`)).toBe(
		entry("run-000 asks"),
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

it("lists each saved eval agent's quota left with --quota", async () => {
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
	await env.fs.mkdir(home, { recursive: true });
	await env.fs.write(
		`${home}/eval-agents.json`,
		JSON.stringify({
			format: 1,
			agents: [{ agent: "claude", model: "sonnet" }, { agent: "kimi" }],
		}),
	);
	const later = new Date(Date.now() + 86_400_000).toISOString();
	await env.fs.write(
		`${home}/limits.json`,
		JSON.stringify({
			format: 1,
			agents: {
				claude: [
					{ window: "five_hour", used: 0.75, resets: later, at: null },
					{ window: "seven_day", used: 0.6, resets: later, at: null },
					{ window: "seven_day_opus", used: 0.9, resets: later, at: null },
					{
						window: "seven_day_overage_included",
						used: 0,
						resets: later,
						at: null,
					},
				],
			},
		}),
	);
	await splates.run(deps, ["evals", "agents", "--quota", "--json"]);
	const quotas = JSON.parse(env.out().trim().split("\n").at(-1) ?? "[]");
	expect(quotas[0].target).toBe("claude:sonnet");
	expect(quotas[0].headroom).toBeCloseTo(0.4);
	expect(
		quotas[0].windows.map((each: { window: string }) => each.window),
	).toEqual(["five_hour", "seven_day"]);
	expect(quotas[1]).toEqual({ target: "kimi", windows: [], headroom: null });
});

it("lists single eval scenarios in run order from priority and saved history", async () => {
	await using env = await Testing.open();
	env.ps.cd(env.root);
	const deps = {
		log: env.log,
		fs: env.fs,
		ps: env.ps,
		assets: env.assets,
		secrets: env.secrets,
	};
	const listed = [
		{ case: "low-never", priority: "low" },
		{ case: "normal-recent" },
		{ case: "high-old", priority: "high" },
		{ case: "high-never", priority: "high" },
		{ case: "normal-codex" },
	];
	await env.fs.write(
		`${env.root}/list-evals.json`,
		`${listed.map((each) => JSON.stringify(each)).join("\n")}\n`,
	);
	await env.fs.write(
		`${env.root}/splates.config.ts`,
		`export default { evals: { results: ".evals", list: "cat list-evals.json" } };\n`,
	);
	await env.fs.mkdir(`${env.root}/.evals/b1`, { recursive: true });
	await env.fs.write(
		`${env.root}/.evals/b1/batch.json`,
		JSON.stringify({
			format: "splates-evals/1",
			startedAt: "2026-11-01T00:00:00.000Z",
			cells: [{ id: "c1", case: "high-old", target: { agent: "claude" } }],
		}),
	);
	await env.fs.write(
		`${env.root}/.evals/b1/results.jsonl`,
		`${JSON.stringify({ cell: "c1", status: "pass" })}\n`,
	);
	await env.fs.mkdir(`${env.root}/.evals/b2`, { recursive: true });
	await env.fs.write(
		`${env.root}/.evals/b2/batch.json`,
		JSON.stringify({
			format: "splates-evals/1",
			startedAt: "2026-11-10T00:00:00.000Z",
			cells: [
				{ id: "c2", case: "normal-recent", target: { agent: "claude" } },
				{ id: "c3", case: "normal-codex", target: { agent: "codex" } },
			],
		}),
	);
	await env.fs.write(
		`${env.root}/.evals/b2/results.jsonl`,
		`${[
			JSON.stringify({ cell: "c2", status: "pass" }),
			JSON.stringify({ cell: "c3", status: "pass" }),
		].join("\n")}\n`,
	);

	await splates.run(deps, ["evals", "order"]);
	expect(env.out().trim().split("\n")).toEqual([
		"high-never",
		"high-old",
		"normal-recent",
		"normal-codex",
		"low-never",
	]);

	await splates.run(deps, ["evals", "order", "--agent", "claude", "--json"]);
	const parsed = JSON.parse(env.out().trim().split("\n").at(-1) ?? "[]") as {
		id: string;
		priority: string;
		lastRunAt: string | null;
	}[];
	expect(
		parsed.map((each) => [each.id, each.priority, each.lastRunAt]),
	).toEqual([
		["high-never", "high", null],
		["high-old", "high", "2026-11-01T00:00:00.000Z"],
		["normal-codex", "normal", null],
		["normal-recent", "normal", "2026-11-10T00:00:00.000Z"],
		["low-never", "low", null],
	]);
});
