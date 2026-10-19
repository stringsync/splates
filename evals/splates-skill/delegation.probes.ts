import { readFile, writeFile } from "node:fs/promises";
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
			source: `.agents/skills/splates/references/${requirement === "delegation-parts" ? "parts" : "handoff"}.md`,
		},
		seed: { id: seed.id, version: seed.version, data: {} },
		input: {
			kind: input.startsWith("[SPLATES") ? "directive" : "message",
			text: input,
			origin: "user",
		},
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
		"handoff-checkpoint",
		"delegation-handoff",
		"[SPLATES HANDOFF TO fake]\n\nYou own parent. Checkpoint the task, record a Handoff section, inspect the roster and hand parent to fake. There is no dev server: explain that it will not start automatically. Stop after the handoff.",
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
				"Observed SPLATES.md is retained, but meaningful Handoff context and commit-before-dispatch need structured state and write instrumentation.",
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
		"The harness child reports: chose a local cache over recomputation; either is reversible. The user has not selected one. Carry this choice into the parent SPLATES.md notes before continuing. Stop after recording it.",
		[
			required("claim-parent", ["claim", "parent"]),
			gap(
				"decision-propagation",
				"Seed observes parent SPLATES.md verbatim; preserving the decision and alternatives needs a structural decision observer, not exact incidental prose.",
			),
		],
	),
	probe(
		"takeover",
		"delegation-handoff",
		"[SPLATES HANDOFF child]\n\nTake over the existing child task. Stop after claiming it and inspecting its saved state, before implementation.",
		[
			required("claim-child", ["claim", "child"]),
			gap(
				"saved-context",
				"Reference and SPLATES.md read ordering belongs to #367; native read capture is incomplete.",
			),
		],
	),
];

// An Auto start: a router picked the model from the request's words alone.
// The seed's code shows how big each request really is: one value, one name
// across many files, or three retry loops that disagree.
const clients = Array.from({ length: 24 }, (_, i) => `client${i + 1}`);
const auto: Seed = {
	id: "delegation/auto",
	version: "3",
	fingerprint: "",
	async prepare(context) {
		await seedRepository(context);
		await seedFile(context, ".git/splates/format", `${FORMAT}\n`);
		// Two disabled models, so a probe can hand up or down without starting one.
		await writeFile(
			join(context.isolation.splatesHome, "agents.json"),
			JSON.stringify({
				format: 1,
				agents: [
					{
						id: "fake",
						name: "Fake",
						argv: ["false"],
						models: [
							{
								id: "small",
								name: "Fake Small",
								strengths: "quick answers and mechanical edits",
								cost: "low",
							},
							{
								id: "large",
								name: "Fake Large",
								strengths: "design calls and changes across systems",
								cost: "high",
							},
						],
					},
				],
			}),
		);
		// The thinking levels `splates agents` lists, as a run of fake would leave them.
		await writeFile(
			join(context.isolation.splatesHome, "offered.json"),
			JSON.stringify({
				format: 1,
				agents: {
					fake: [
						{
							id: "effort",
							name: "Effort",
							type: "select",
							category: "thought_level",
							current: "medium",
							options: ["low", "medium", "high"].map((value) => ({
								value,
								name: value,
								description: null,
							})),
						},
					],
				},
			}),
		);
		await seedFile(
			context,
			"src/limits.ts",
			"/** How many times a client tries a request before it gives up. */\nexport const MAX_RETRIES = 3;\n",
		);
		for (const client of clients) {
			await seedFile(
				context,
				`src/clients/${client}.ts`,
				`import { MAX_RETRIES } from "../limits";\n\nexport const ${client} = { name: "${client}", tries: MAX_RETRIES };\n`,
			);
		}
		// Three retry loops, each with its own policy and no way to reach the user.
		await seedFile(
			context,
			"src/upload.ts",
			'import { MAX_RETRIES } from "./limits";\n\n// Retries any 4xx or 5xx, forever when the server sends Retry-After.\nexport async function upload(send: () => Promise<Response>): Promise<Response> {\n\tfor (let tries = 0; ; tries++) {\n\t\tconst response = await send();\n\t\tif (response.ok) return response;\n\t\tif (!response.headers.has("retry-after") && tries >= MAX_RETRIES) throw new Error(String(response.status));\n\t}\n}\n',
		);
		await seedFile(
			context,
			"src/sync.ts",
			"// Requeues a failed batch behind the others, sharing the queue with every tab.\nexport const queue: (() => Promise<Response>)[] = [];\nexport async function drain(): Promise<void> {\n\twhile (queue.length > 0) {\n\t\tconst job = queue.shift()!;\n\t\tif (!(await job()).ok) queue.push(job);\n\t}\n}\n",
		);
		await seedFile(
			context,
			"src/fetch.ts",
			'// Retries 5xx only, and swallows every 4xx as an empty body.\nexport async function get(send: () => Promise<Response>): Promise<string> {\n\tconst response = await send();\n\tif (response.status >= 500) return get(send);\n\treturn response.ok ? response.text() : "";\n}\n',
		);
		for (const argv of [
			["git", "add", "."],
			["git", "commit", "-qm", "Seed retrying clients"],
		]) {
			const result = await command(context, argv);
			if (result.exitCode !== 0) {
				throw new Error(result.stderr);
			}
		}
	},
	async observe(context) {
		const listed = await command(context, ["splates", "list", "--json"]);
		if (listed.exitCode !== 0) {
			throw new Error(listed.stderr);
		}
		const tasks: { task: string }[] = JSON.parse(listed.stdout);
		const handoffs = [];
		for (const { task } of tasks) {
			const state: {
				dispatch?: {
					agent: string;
					model?: string;
					effort?: string;
				};
			} = JSON.parse(
				await readFile(
					join(
						context.isolation.repository,
						".git/splates/tasks",
						`${task}.json`,
					),
					"utf8",
				),
			);
			if (state.dispatch !== undefined) {
				handoffs.push({
					agent: state.dispatch.agent,
					model: state.dispatch.model ?? null,
					effort: state.dispatch.effort ?? null,
				});
			}
		}
		return { "auto/tasks": tasks.length, "auto/handoffs": handoffs };
	},
};

auto.fingerprint = hash([
	auto.prepare.toString(),
	auto.observe.toString(),
	seedRepository.toString(),
	seedFile.toString(),
	command.toString(),
	FORMAT,
]);

/** The Auto line the page shows, which a probe's conversation would hold. */
function autoProbe(
	id: string,
	picked: string,
	request: string,
	assertions: Assertion[],
): Probe {
	const made = probe(
		id,
		"delegation-auto",
		`[SPLATES AUTO] ${request}\n\nThe conversation shows splates's line "Auto picked ${picked}"; you run as that pick, on agent fake. This is a bounded probe: stop as soon as you have answered, started the work in a task, or handed it on.`,
		assertions,
	);
	made.seed = { id: auto.id, version: auto.version, data: {} };
	made.bounds = { milliseconds: 120000, turns: 1, tokens: 8000 };
	return made;
}
function handedTo(model: string, effort: string): Assertion {
	return {
		id: "handoff",
		kind: "state",
		key: "auto/handoffs",
		equals: [{ agent: "fake", model, effort }],
	};
}
const kept: Assertion = {
	id: "kept",
	kind: "state",
	key: "auto/handoffs",
	equals: [],
};

probes.push(
	autoProbe(
		"auto-question",
		"Fake Small, low effort: a quick question",
		"How many times does a client retry a request?",
		[
			{ id: "no-task", kind: "state", key: "auto/tasks", equals: 0 },
			gap("answer", "Whether the reply says three is prose, not graded."),
		],
	),
	autoProbe(
		"auto-fits",
		"Fake Small, low effort: a one-value change",
		"Let clients retry five times instead of three.",
		[{ id: "one-task", kind: "state", key: "auto/tasks", equals: 1 }, kept],
	),
	autoProbe(
		"auto-hand-up",
		"Fake Small, low effort: a small fix",
		"Stop retrying a 413 anywhere, and tell the user the file is too big.",
		[
			{ id: "one-task", kind: "state", key: "auto/tasks", equals: 1 },
			handedTo("large", "high"),
			gap(
				"handoff-context",
				"Whether the Handoff section names the three retry policies and the missing path to the user needs a structural observer.",
			),
			gap(
				"reason-line",
				"The one line naming who it went to and why is prose the reply parser does not recognize.",
			),
		],
	),
	autoProbe(
		"auto-hand-down",
		"Fake Large, high effort: a change across the codebase",
		"Rename MAX_RETRIES to RETRY_LIMIT everywhere.",
		[
			{ id: "one-task", kind: "state", key: "auto/tasks", equals: 1 },
			handedTo("small", "low"),
			gap(
				"spelled-out",
				"Whether Next lists the files to rename needs a structural SPLATES.md observer.",
			),
		],
	),
);

export default { probes, seeds: [seed, auto] } satisfies ProbeModule;

// Actual CLI refusal, with no coordinator, transport, or model started.
const noDev = probe(
	"cli-no-dev-tell",
	"delegation-no-dev",
	"Tell an agent without splates server",
	[],
);
noDev.execution = {
	kind: "cli",
	command: ["splates", "tell", "parent", "carry on"],
};
noDev.tools = [];
noDev.stop = {
	kind: "event",
	match: {
		actor: "cli",
		kind: "command",
		name: "splates",
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
