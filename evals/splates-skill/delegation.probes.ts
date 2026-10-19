import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { FORMAT } from "@stringsync/splates-server/records";
import type { Assertion, Match, Probe } from "./probe";
import { command, seedFile, seedRepository } from "./probe-sandbox";
import { hash, type ProbeModule, type Seed } from "./runner";

const seed: Seed = {
	id: "delegation/tasks",
	version: "1",
	fingerprint: hash([
		"delegation/tasks/1",
		seedRepository.toString(),
		command.toString(),
	]),
	async prepare(context) {
		await seedRepository(context);
		// Direct format seed avoids init installing skills or contacting the network.
		await seedFile(context, ".git/splates/format", `${FORMAT}\n`);
		for (const args of [
			["add", "parent", "--goal", "Integrate a small delegated change"],
			[
				"add",
				"child",
				"--base",
				"task/parent",
				"--goal",
				"Implement the isolated part",
			],
		]) {
			const result = await command(context, ["splates", ...args]);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
		}
	},
	async observe(context) {
		const result = await command(context, ["splates", "path", "parent"]);
		if (result.exitCode !== 0) {
			throw new Error(result.stderr);
		}
		const listed = await command(context, ["splates", "list", "--json"]);
		if (listed.exitCode !== 0) {
			throw new Error(listed.stderr);
		}
		const tasks: { task: string }[] = JSON.parse(listed.stdout);
		let extra: { base: string; worktree: string } | null = null;
		if (tasks.some((task) => task.task === "extra")) {
			const shown = await command(context, [
				"splates",
				"show",
				"extra",
				"--json",
			]);
			if (shown.exitCode !== 0) {
				throw new Error(shown.stderr);
			}
			extra = JSON.parse(shown.stdout);
		}
		return {
			"extra/base": extra?.base ?? null,
			"extra/isolated":
				extra === null
					? null
					: extra.worktree !== result.stdout.trim() &&
						extra.worktree !== context.isolation.repository,
			"parent/SPLATES.md": await readFile(
				join(result.stdout.trim(), "SPLATES.md"),
				"utf8",
			),
		};
	},
};

seed.fingerprint = hash([
	seed.prepare.toString(),
	seed.observe.toString(),
	seedRepository.toString(),
	seedFile.toString(),
	command.toString(),
	FORMAT,
]);

function action(args: string[], success = true): Match {
	return {
		actor: "agent",
		kind: "command",
		name: "splates",
		args,
		...(success ? { exitCode: 0 } : {}),
	};
}
function required(id: string, args: string[]): Assertion {
	return { id, kind: "count", match: action(args), min: 1 };
}
function forbidden(id: string, args: string[]): Assertion {
	return { id, kind: "count", match: action(args, false), min: 0, max: 0 };
}
function gap(id: string, reason: string): Assertion {
	return { id, kind: "uncovered", reason };
}
function probe(id: string, input: string, assertions: Assertion[]): Probe {
	return {
		schema: 1,
		id: `delegation/${id}`,
		version: "1",
		aspect: "delegation",
		requirement: {
			id: "delegation-parts",
			text: input,
			source: ".agents/skills/splates/references/parts.md",
		},
		seed: { id: seed.id, version: seed.version, data: {} },
		input: { kind: "message", text: input, origin: "user" },
		tools: ["shell", "read", "write"],
		evidence: ["events", "state"],
		assertions,
		stop: { kind: "reply" },
		bounds: { milliseconds: 30000, turns: 1, tokens: 2000 },
		execution: { kind: "agent", skill: ".agents/skills/splates/SKILL.md" },
	};
}

const probes: Probe[] = [
	probe(
		"part-base",
		"You own parent, whose branch is task/parent (not trunk). A harness subagent will implement a second independent part named extra. Create that part and supply its brief; stop before launching the subagent. The existing child is unrelated.",
		[
			required("claim-parent", ["claim", "parent"]),
			{
				id: "parent-base",
				kind: "state",
				key: "extra/base",
				equals: "task/parent",
			},
			{
				id: "isolated-worktree",
				kind: "state",
				key: "extra/isolated",
				equals: true,
			},
			gap(
				"child-brief",
				"Brief must require claim and isolated worktree, no escalation/user reporting/tasks, record choices and alternatives, squash/merge to parent, and commit without waiting if blocked on parent. Natural-language adequacy is not graded.",
			),
		],
	),
	probe(
		"part-return",
		"The harness child has returned unmerged: its tests require your parent fix. Its code and test result are an explicit stand-in, not a real implementation. You have not committed that fix. Record the dependency and next step; do not merge either task or wait for the child now.",
		[
			forbidden("no-parent-merge", ["merge", "parent"]),
			forbidden("no-child-merge", ["merge", "child"]),
			forbidden("no-current-merge", ["merge"]),
			forbidden("no-wait", ["wait", "child"]),
			gap(
				"merge-order",
				"Real parent commit -> child verification/merge -> parent squash/merge requires a later instrumented integration; this probe only forbids premature known argv forms.",
			),
		],
	),
	probe(
		"part-decisions",
		"The harness child reports: chose a local cache over recomputation; either is reversible. The user has not selected one. Carry this choice into the parent SPLATES.md notes before continuing. Stop after recording it.",
		[
			required("claim-parent", ["claim", "parent"]),
			gap(
				"decision-propagation",
				"Seed observes parent SPLATES.md verbatim; preserving the decision and alternatives needs a structural decision observer, not exact incidental prose.",
			),
		],
	),
];

export default { probes, seeds: [seed] } satisfies ProbeModule;
