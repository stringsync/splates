import { describe, expect, it } from "bun:test";
import discovery, { completeRead, deliveredCoverage } from "./discovery.probes";
import type { Event, Evidence, Probe } from "./probe";
import { assess } from "./probe";
import { validate } from "./runner";

it("registers unique valid discovery probes with gaps retained", () => {
	expect(() => validate(discovery.probes)).not.toThrow();
	expect(discovery.probes).toHaveLength(16);
	expect(
		discovery.probes.every(
			(probe) =>
				probe.aspect === "discovery" &&
				probe.assertions.some((assertion) => assertion.kind === "uncovered"),
		),
	).toBe(true);
	expect(discovery.probes[0]?.input.text).not.toContain("arbor");
	expect(discovery.probes[1]?.input.text).toContain("$arbor");
	expect(
		discovery.probes.map((probe) => probe.input.text).join("\n"),
	).not.toContain("references/");
});

it("separates positive assertion fixtures from measured adherence", () => {
	const result = assess(implicit, evidence([rootRead, add, investigate]));
	expect(result.status).toBe("uncovered");
	expect(
		result.verdicts.filter((verdict) => verdict.status === "fail"),
	).toEqual([]);
	const read = result.verdicts.find(
		(verdict) => verdict.id === "discovery/root",
	);
	expect(read).toMatchObject({
		actual: 1,
		expected: { min: 1, max: null },
		evidence: ["root"],
	});
});

it("distinguishes omitted discovery, incomplete disclosure and loaded-but-ignored behavior", () => {
	expect(statuses([add, investigate])["discovery/root"]).toBe("fail");
	expect(
		statuses([
			{ ...rootRead, payload: { delivered: "partial" } },
			add,
			investigate,
		])["discovery/root"],
	).toBe("fail");
	expect(statuses([rootRead, investigate, add])["discovery/root"]).toBe("pass");
	expect(
		statuses([rootRead, investigate, add])[
			"adherence/add-before-investigation"
		],
	).toBe("fail");
	expect(
		statuses([add, investigate, rootRead])["disclosure/read-before-action"],
	).toBe("fail");
	expect(
		statuses([rootRead, { ...add, exitCode: 1 }, investigate])[
			"adherence/add-before-investigation"
		],
	).toBe("fail");
});

it("rejects fixture reads, plain opens, mentions and correction after early investigation", () => {
	expect(
		[
			{ ...rootRead, actor: "fixture" as const },
			{ ...rootRead, payload: undefined },
		].map((read) => statuses([read, add, investigate])["discovery/root"]),
	).toEqual(["fail", "fail"]);
	expect(
		statuses([investigate, rootRead, add, { ...investigate, id: "retry" }])[
			"disclosure/read-before-action"
		],
	).toBe("fail");
	expect(assess(implicit, evidence([])).status).toBe("fail");
});

it("catches failed and unfinished writes to the main worktree", () => {
	expect(
		[undefined, 1, 0].map(
			(exitCode) =>
				statuses([
					rootRead,
					add,
					investigate,
					{
						id: "write",
						actor: "agent",
						kind: "write",
						name: "main:src/message.ts",
						args: [],
						exitCode,
					},
				])["adherence/no-main-write"],
		),
	).toEqual(["fail", "fail", "fail"]);
});

it("keeps missing capture and termination failures separate from noncompliance", () => {
	const partial = { ...evidence([]), complete: [] };
	expect(assess(implicit, partial).status).toBe("uncovered");
	expect(
		(["unsupported", "infrastructure-error", "bound"] as const).map(
			(termination) => assess(implicit, { ...partial, termination }).status,
		),
	).toEqual(["unsupported", "infrastructure-error", "bound"]);
});

it("requires exact reference reads before actions across all five reference contracts", () => {
	expect(discovery.probes.slice(2, 7).map(referenceVerdicts)).toEqual(
		Array.from({ length: 5 }, () => [
			"uncovered",
			"fail",
			"fail",
			"fail",
			"fail",
		]),
	);
});

describe("delivered-byte coverage (synthetic boundary fixtures only)", () => {
	const bytes = new TextEncoder().encode(
		`head\n${"long output\n".repeat(3000)}尾: read reference before acting\n`,
	);
	it("rejects truncated root/reference and accepts complete chunk recovery", () => {
		const head = { offset: 0, bytes: bytes.slice(0, 1000) };
		expect(deliveredCoverage(bytes, [head])).toBe(false);
		expect(
			deliveredCoverage(bytes, [
				head,
				{ offset: 1000, bytes: bytes.slice(1000) },
			]),
		).toBe(true);
		expect(
			deliveredCoverage(bytes, [
				head,
				{ offset: 500, bytes: bytes.slice(500) },
			]),
		).toBe(true);
	});
	it("rejects holes, absent reads, wrong snapshots and invalid ranges", () => {
		expect(deliveredCoverage(bytes, [])).toBe(false);
		expect(
			deliveredCoverage(bytes, [{ offset: 1, bytes: bytes.slice(1) }]),
		).toBe(false);
		expect(
			deliveredCoverage(bytes, [
				{ offset: 0, bytes: new Uint8Array(bytes.length) },
			]),
		).toBe(false);
		expect(
			[-1, 0.5, NaN, Infinity, bytes.length + 1].map((offset) =>
				deliveredCoverage(bytes, [{ offset, bytes: new Uint8Array() }]),
			),
		).toEqual([false, false, false, false, false]);
	});
});

// scry-ignore simple-test-setup: this single integration case owns its temporary runner directory and no-launch adapter.
it("seeds real instructions and preserves ACP's no-launch unsupported boundary", async () => {
	const { mkdtemp, readFile, readlink, rm } = await import("node:fs/promises");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { acpAdapter } = await import("./probe-adapters");
	const { runProbes } = await import("./runner");
	const directory = await mkdtemp(join(tmpdir(), "discovery-probe-"));
	try {
		const adapter = acpAdapter(
			{ id: "fake", name: "Disabled", argv: ["false"] },
			join(import.meta.dir, "../../.agents/skills/arbor"),
			() => {
				throw new Error("must not launch");
			},
		);
		const runs = await runProbes(
			{ probes: [implicit], seeds: discovery.seeds },
			[{ adapter, model: null }],
			{
				directory,
				parallel: 1,
				reps: 1,
				skillHash: "test-only-snapshot",
				cliHash: "test-only-cli",
				reproduction: [],
				allowUnmetered: true,
			},
		);
		expect(runs).toHaveLength(1);
		const run = runs[0] as import("./runner").StoredRun;
		expect(run.result.status).toBe("unsupported");
		expect(run.result.detail).toContain("tool-free reply probes only");
		const repo = run.run.isolation.repository;
		expect(await readlink(join(repo, "CLAUDE.md"))).toBe("AGENTS.md");
		expect(await readFile(join(repo, root), "utf8")).toBe(
			await readFile(join(import.meta.dir, "../../", root), "utf8"),
		);
		expect(
			await readFile(
				join(repo, ".agents/skills/arbor/references/todos.md"),
				"utf8",
			),
		).toContain("todo");
		expect(
			run.run.evidence.events.every((event) => event.actor === "fixture"),
		).toBe(true);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

const root = ".agents/skills/arbor/SKILL.md";
const implicit = discovery.probes[0] as Probe;
const rootRead: Event = { ...completeRead(root), id: "root", args: [] };
const add: Event = {
	id: "add",
	actor: "agent",
	kind: "command",
	name: "arbor",
	args: ["add", "message", "--goal", "Fix the greeting"],
	exitCode: 0,
};
const investigate: Event = {
	id: "code",
	actor: "agent",
	kind: "read",
	name: "src/message.ts",
	args: [],
};
function evidence(events: Event[]): Evidence {
	return {
		events,
		state: {},
		reply: "Arbor was used.",
		complete: ["events", "state", "reply"],
		termination: "stop",
	};
}
function statuses(events: Event[]) {
	return Object.fromEntries(
		assess(implicit, evidence(events)).verdicts.map((verdict) => [
			verdict.id,
			verdict.status,
		]),
	);
}

function referenceVerdicts(probe: Probe) {
	const order = probe.assertions.find(
		(assertion) => assertion.kind === "before",
	) as Extract<import("./probe").Assertion, { kind: "before" }>;
	const ref: Event = {
		...order.first,
		id: "reference",
		args: order.first.args ?? [],
	};
	const action: Event = {
		...order.second,
		id: "action",
		args: order.second.args ?? [],
	};
	return [
		[rootRead, ref, action],
		[rootRead, action],
		[rootRead, action, ref],
		[rootRead, { ...ref, name: "references/wrong.md" }, action],
		[rootRead, { ...ref, payload: { delivered: "partial" } }, action],
	].map((events) => assess(probe, evidence(events)).status);
}
