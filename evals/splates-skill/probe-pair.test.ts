import { expect, it } from "bun:test";
import decisions from "./decisions.probes";
import type { Probe } from "./probe";
import {
	pairedBatchReport,
	pairedDifferences,
	pairedReport,
} from "./probe-pair";
import { assessRun, hash, type StoredRun } from "./probe-record";

it("pairs distinct snapshots without treating matched requested controls as applied configuration", () => {
	expect(pairedDifferences(run("before"), run("after"))).toEqual([]);
	expect(pairedReport(run("before"), run("after"))).toContain(
		"runtime compatibility and execution admission remain unverified",
	);
	expect(pairedReport(run("before"), run("after"))).toContain(
		"assertions observed 0/8; passing 0/0",
	);
	expect(pairedReport(run("before"), run("after"))).toContain(
		"fixture refusal",
	);
});
it("refuses identical snapshots", () => {
	expect(pairedDifferences(run("same"), run("same"))).toContain(
		"identical skill snapshots",
	);
});
it.each([
	"model",
	"repetition",
	"cliHash",
	"fixtureHash",
	"adapterVersion",
	"assertionHash",
] as const)("retains the %s control", (key) => {
	const candidate = run("after");
	Object.assign(candidate.run.identity, {
		[key]: key === "repetition" ? 1 : "different",
	});
	expect(pairedDifferences(run("before"), candidate)).toContain("identity");
});
it("refuses a changed invocation mode, even when other identity labels match", () => {
	const candidate = run("after");
	candidate.adapter.config = {
		skill: { source: "/snapshot/after", mode: "discovery" },
		driver: { version: "fixture" },
	};
	expect(pairedDifferences(run("before"), candidate)).toContain(
		"adapterConfig",
	);
});
it("retains failed candidate evidence and its revision", () => {
	const candidate = run("after");
	candidate.run.evidence.complete = ["state"];
	candidate.run.evidence.state = { "plan/blocked": "bad" };
	candidate.run.evidence.termination = "stop";
	candidate.result = assessRun(candidate.probe, candidate.run.evidence);
	expect(pairedReport(run("before"), candidate)).toContain(
		"plan/blocked: fail",
	);
	expect(pairedReport(run("before"), candidate)).toContain(
		"skill after; rep 1",
	);
});

it("rejects mismatched effective native versions", () => {
	const baseline = run("before");
	const candidate = run("after");
	baseline.adapter.runtime.claudeVersion = "2.1.0";
	candidate.adapter.runtime.claudeVersion = "2.2.0";
	expect(pairedDifferences(baseline, candidate)).toContain(
		"nativeConfiguration",
	);
});
it("keeps missing and duplicate cells visible", () => {
	const baseline = run("before");
	baseline.adapter.runtime.snapshot = { role: "baseline", hash: "before" };
	expect(pairedBatchReport([baseline])).toContain(
		"Incomplete or duplicate pair",
	);
	expect(pairedBatchReport([baseline, baseline])).toContain(
		"Incomplete or duplicate pair",
	);
});

function run(skillHash: string): StoredRun {
	const probe = decisions.probes[0] as Probe;
	const evidence = {
		events: [],
		state: {},
		complete: [],
		termination: "unsupported" as const,
		detail: "fixture refusal",
	};
	return {
		schema: 1,
		probe,
		agent: "native-codex",
		result: assessRun(probe, evidence),
		overheadMs: 0,
		warnings: [],
		conditions: { allowUnmetered: false },
		adapter: {
			version: "1",
			config: {
				skill: { source: `/snapshot/${skillHash}`, mode: "explicit" },
				driver: { version: "fixture" },
			},
			runtime: {},
		},
		run: {
			schema: 1,
			identity: {
				probe: probe.id,
				probeVersion: probe.version,
				fixtureHash: "fixture",
				assertionHash: hash(probe.assertions),
				skillHash,
				cliHash: "cli",
				adapterVersion: "native-codex@1",
				model: "fixture",
				configHash: skillHash,
				repetition: 0,
			},
			isolation: {
				repository: "/fixture",
				splatesHome: "/home",
				logs: "/logs",
				outputs: "/outputs",
				ports: [],
			},
			evidence,
			usage: { milliseconds: 0, turns: 0, tokens: null, costUsd: null },
			reproduction: [],
		},
	};
}
