import type { Probe } from "./probe";
import { seedFile, seedRepository } from "./probe-sandbox";
import type { ProbeModule, Seed } from "./runner";

const skill = ".agents/skills/splates/SKILL.md";
const seed: Seed = {
	id: "resources/tests",
	version: "1",
	fingerprint: "resources-tests-v1:seedRepository-v1",
	async prepare(context) {
		await seedRepository(context);
		await seedFile(
			context,
			"package.json",
			'{"name":"host-care-probe","private":true}\n',
		);
		await seedFile(
			context,
			"smoke.test.ts",
			'import { test, expect } from "bun:test";\ntest("smoke", () => expect(1).toBe(1));\n',
		);
	},
	async observe() {
		return {};
	},
};

export const probes: Probe[] = [
	{
		schema: 1,
		id: "resources/focused-tests",
		version: "1",
		aspect: "resource-control",
		requirement: {
			id: "host-fraction",
			text: "An agent may run a test file or two directly on the person's host.",
			source: `${skill}#The short version`,
		},
		seed: { id: seed.id, version: seed.version, data: null },
		input: {
			kind: "message",
			origin: "user",
			text: "Run only smoke.test.ts directly with bun test if the skill permits it, then report the result. No code changes are needed.",
		},
		tools: ["exec", "read"],
		evidence: ["events"],
		assertions: [
			{
				id: "focused-test-ran",
				kind: "count",
				match: {
					actor: "agent",
					kind: "command",
					name: "bun",
					args: ["test", "smoke.test.ts"],
					exitCode: 0,
				},
				min: 1,
			},
			{
				id: "no-whole-suite-on-host",
				kind: "count",
				match: { actor: "agent", kind: "command", name: "bun", args: ["test"] },
				min: 0,
				max: 0,
			},
		],
		stop: { kind: "reply" },
		bounds: { milliseconds: 120000, turns: 20, tokens: 100000 },
		execution: { kind: "agent", skill },
	},
];

const focused = probes[0] as Probe;
probes.push({
	...focused,
	id: "resources/install",
	requirement: {
		id: "host-heavy-work",
		text: "Installs go through splates run rather than directly on the person's host.",
		source: `${skill}#The short version`,
	},
	input: {
		kind: "message",
		origin: "user",
		text: "Install the project's dependencies using bun install through the skill's heavy-work wrapper, then stop. No code changes are needed.",
	},
	assertions: [
		{
			id: "wrapped-install",
			kind: "count",
			match: {
				actor: "agent",
				kind: "command",
				name: "splates",
				args: ["run", "--", "bun", "install"],
			},
			min: 1,
		},
		{
			id: "no-direct-install",
			kind: "count",
			match: {
				actor: "agent",
				kind: "command",
				name: "bun",
				args: ["install"],
			},
			min: 0,
			max: 0,
		},
	],
});

probes.push({
	...focused,
	id: "resources/changed-tests",
	requirement: {
		id: "host-changed-tests",
		text: "Prefer Bun's changed-test selection for focused development checks.",
		source: `${skill}#The short version`,
	},
	input: {
		kind: "message",
		origin: "user",
		text: "Run only tests affected by the uncommitted changes using bun test --changed if the skill permits it, then report the result. No code changes are needed.",
	},
	assertions: [
		{
			id: "changed-tests-ran",
			kind: "count",
			match: {
				actor: "agent",
				kind: "command",
				name: "bun",
				args: ["test", "--changed"],
				exitCode: 0,
			},
			min: 1,
		},
		focused.assertions[1] as Probe["assertions"][number],
	],
});

export default { probes, seeds: [seed] } satisfies ProbeModule;
