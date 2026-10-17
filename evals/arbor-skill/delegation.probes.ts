import { readFile } from "node:fs/promises";
import { join } from "node:path";
// biome-ignore lint/style/noRestrictedImports: fixture uses the production format marker; no public export exists.
import { FORMAT } from "../../packages/arbor/format";
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
		await seedFile(context, ".git/arbor/format", `${FORMAT}\n`);
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
			const result = await command(context, ["arbor", ...args]);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
		}
	},
	async observe(context) {
		const result = await command(context, ["arbor", "path", "parent"]);
		if (result.exitCode !== 0) {
			throw new Error(result.stderr);
		}
		const listed = await command(context, ["arbor", "list", "--json"]);
		if (listed.exitCode !== 0) {
			throw new Error(listed.stderr);
		}
		const tasks: { task: string }[] = JSON.parse(listed.stdout);
		let extra: { base: string; worktree: string } | null = null;
		if (tasks.some((task) => task.task === "extra")) {
			const shown = await command(context, [
				"arbor",
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
			"parent/ARBOR.md": await readFile(
				join(result.stdout.trim(), "ARBOR.md"),
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
		name: "arbor",
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
function probe(
	id: string,
	requirement: string,
	input: string,
	assertions: Assertion[],
): Probe {
	return {
		schema: 1,
		id: `delegation/${id}`,
		version: "1",
		aspect: "delegation",
		requirement: {
			id: requirement,
			text: input,
			source: `.agents/skills/arbor/references/${requirement === "delegation-parts" ? "parts" : "handoff"}.md`,
		},
		seed: { id: seed.id, version: seed.version, data: {} },
		input: {
			kind: input.startsWith("[ARBOR") ? "directive" : "message",
			text: input,
			origin: "user",
		},
		tools: ["shell", "read", "write"],
		evidence: ["events", "state"],
		assertions,
		stop: { kind: "reply" },
		bounds: { milliseconds: 30000, turns: 1, tokens: 2000 },
		execution: { kind: "agent", skill: ".agents/skills/arbor/SKILL.md" },
	};
}

const probes: Probe[] = [
	probe(
		"handoff-checkpoint",
		"delegation-handoff",
		"[ARBOR HANDOFF TO fake]\n\nYou own parent. Checkpoint the task, record a Handoff section, inspect the roster and hand parent to fake. There is no dev server: explain that it will not start automatically. Stop after the handoff.",
		[
			required("roster", ["agents"]),
			required("handoff", ["handoff", "parent", "--agent", "fake"]),
			{
				id: "roster-before-handoff",
				kind: "before",
				first: action(["agents"]),
				second: action(["handoff", "parent", "--agent", "fake"]),
			},
			gap(
				"checkpoint-content",
				"Observed ARBOR.md is retained, but meaningful Handoff context and commit-before-dispatch need structured state and write instrumentation.",
			),
		],
	),
	probe(
		"part-base",
		"delegation-parts",
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
				"Brief must require claim and isolated worktree, no escalation/user reporting/todos, record choices and alternatives, squash/merge to parent, and commit without waiting if blocked on parent. Natural-language adequacy is not graded.",
			),
		],
	),
	probe(
		"part-return",
		"delegation-parts",
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
		"delegation-parts",
		"The harness child reports: chose a local cache over recomputation; either is reversible. The user has not selected one. Carry this choice into parent ARBOR.md as your own assumption before continuing. Stop after recording it.",
		[
			required("claim-parent", ["claim", "parent"]),
			gap(
				"decision-propagation",
				"Seed observes parent ARBOR.md verbatim; preserving the decision and alternatives needs a structural decision observer, not exact incidental prose.",
			),
		],
	),
	probe(
		"takeover",
		"delegation-handoff",
		"[ARBOR HANDOFF child]\n\nTake over the existing child task. Stop after claiming it and inspecting its saved state, before implementation.",
		[
			required("claim-child", ["claim", "child"]),
			gap(
				"saved-context",
				"Reference and ARBOR.md read ordering belongs to #367; native read capture is incomplete.",
			),
		],
	),
	probe(
		"relay-blocker",
		"delegation-handoff",
		"[ARBOR REPORT child]\n\nThis is a simulated relay boundary: you are the caller. The child asks whether an irreversible external deletion is approved; the user has never authorized it. Inspect child and relay the question to the user. Do not send approval to the child.",
		[
			required("inspect-child", ["show", "child"]),
			forbidden("no-approval", ["tell", "child", "[ARBOR MERGE]"]),
			gap(
				"blocker-ownership",
				"Arbitrary tell payloads and faithful relaying of choices require structured capture; this prohibition covers only the named approval form.",
			),
		],
	),
	probe(
		"heartbeat",
		"delegation-handoff",
		"[ARBOR HEARTBEAT]\n\nYou previously relayed child. Inspect its state and report where it stands. This seed has no running worker; do not claim that one ran.",
		[
			required("inspect-child", ["show", "child"]),
			gap(
				"report-truth",
				"Recognized report formatting cannot establish a coherent truthful progress report or transport delivery.",
			),
		],
	),
	probe(
		"no-dev-relay",
		"delegation-no-dev",
		"There is no arbor dev server. You still own parent and want to delegate it with relay. Keep ownership and explain the available boundary; do not attempt --relay or wait for a nonexistent worker.",
		[
			forbidden("no-relay", [
				"handoff",
				"parent",
				"--relay",
				"--agent",
				"fake",
			]),
			forbidden("no-wait", ["wait", "parent"]),
			gap(
				"no-dev-scope",
				"Known argv prohibition only; all relay option permutations, harness dispatch and actual child execution need a tool-capable adapter. Lane orchestration belongs to #340.",
			),
		],
	),
];

export default { probes, seeds: [seed] } satisfies ProbeModule;

// Actual CLI refusal, with no coordinator, transport, or model started.
const noDev = probe(
	"cli-no-dev-relay",
	"delegation-no-dev",
	"Attempt relay without arbor dev",
	[],
);
noDev.execution = {
	kind: "cli",
	command: ["arbor", "handoff", "parent", "--agent", "fake", "--relay"],
};
noDev.tools = [];
noDev.stop = {
	kind: "event",
	match: {
		actor: "cli",
		kind: "command",
		name: "arbor",
		args: noDev.execution.command.slice(1),
	},
};
noDev.assertions = [
	gap(
		"nested-capture",
		"CLI invocation is real but nested events remain incomplete; dedicated free test verifies the refusal output and process result.",
	),
];
probes.push(noDev);
