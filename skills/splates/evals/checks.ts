import type { Check, Repo, Step } from "@evals/evals/scenario";
import { stretches } from "@splates/server/plans";

/** The index of the first tool step whose target `test` accepts, or -1. */
export function firstStep(
	transcript: Step[],
	test: (target: string) => boolean,
): number {
	return transcript.findIndex(
		(step) => step.kind === "tool" && test(target(step)),
	);
}

/** What a tool step reads or runs, as text: the shell command or the file path. */
function target(step: Step): string {
	if (step.kind !== "tool") {
		return "";
	}
	try {
		const input = JSON.parse(step.input) as Record<string, unknown>;
		const text = input.command ?? input.file_path ?? input.path;
		return typeof text === "string" ? text : step.input;
	} catch {
		return step.input;
	}
}

/** Whether a step opens `path`: a read tool on it, or a shell command that cats it. */
export function opens(path: string): (target: string) => boolean {
	return (text) => text.includes(path);
}

/**
 * Whether the transcript opens a file matching `first` before the first step
 * matching `second`; true when `first` comes up and `second` never does.
 */
export function readBefore(
	transcript: Step[],
	first: (target: string) => boolean,
	second: (target: string) => boolean,
): boolean {
	const read = firstStep(transcript, first);
	if (read === -1) {
		return false;
	}
	const acted = firstStep(transcript, second);
	return acted === -1 || read < acted;
}

/** Whether the agent's reply holds a report of `ending` for `task` (any task when null). */
export function reported(
	reply: string,
	ending: "merged" | "removed" | "done",
	task: string | null = null,
): boolean {
	return stretches(reply).some(
		(part) =>
			part.type === "report" &&
			part.report.ending === ending &&
			(task === null || part.report.task === task),
	);
}

export function planProse(body: string): string {
	return body
		.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "")
		.replace(/<pre[\s\S]*?<\/pre>/g, "")
		.replace(/!\[[^\]]*\]\([^)]*\)/g, "");
}

/** Whether a plan body has the prescribed shape: Goal, After and Approach lines, no step list, at most 200 words of prose. */
export function shortPlan(body: string): boolean {
	const prose = planProse(body);
	const has = (label: string) =>
		new RegExp(`^\\*\\*${label}:\\*\\*\\s*\\S`, "m").test(prose);
	const listed = /^\s*(?:[-*+]|\d+[.)])\s+\S/m.test(prose);
	const words = prose.split(/\s+/).filter((word) => /\w/.test(word)).length;
	return (
		has("Goal") && has("After") && has("Approach") && !listed && words <= 200
	);
}

/** Checks that the seeded files at `paths` are unchanged in main and every task worktree. */
export function untouched(...paths: string[]): Check {
	return {
		id: "source-untouched",
		about: `Seeded source (${paths.join(", ")}) is unchanged in main and every task worktree.`,
		live: true,
		test: async ({ repo }) => {
			const listing = await repo.run([
				"git",
				"worktree",
				"list",
				"--porcelain",
			]);
			const trees = listing
				.split("\n")
				.filter((line) => line.startsWith("worktree "))
				.map((line) => line.slice("worktree ".length));
			for (const path of paths) {
				const history = await repo.run([
					"git",
					"log",
					"--format=%H",
					"--",
					path,
				]);
				const seed = history.trim().split("\n").at(-1);
				if (!seed) {
					return false;
				}
				for (const tree of trees) {
					const diff = await repo.run([
						"git",
						"-C",
						tree,
						"diff",
						seed,
						"--",
						path,
					]);
					if (diff !== "") {
						return false;
					}
				}
			}
			return true;
		},
	};
}

const REFERENCE_FILE = /references\/([a-z0-9-]+\.md)/g;

/** Checks that the agent did not open any reference file outside `allowed`. */
export function noUnrelatedReferences(allowed: readonly string[]): Check {
	const ok = new Set(allowed);
	return {
		id: "no-unrelated-references",
		about:
			allowed.length === 0
				? "Did not read any reference files."
				: `Only read reference files in: ${allowed.join(", ")}.`,
		test: ({ transcript }) => {
			for (let index = 0; index < transcript.length; index += 1) {
				const step = transcript[index];
				if (step?.kind !== "tool") {
					continue;
				}
				const text = target(step);
				for (const match of text.matchAll(REFERENCE_FILE)) {
					const name = match[1];
					if (name && !ok.has(name)) {
						return {
							pass: false,
							step: { index, observed: `opened unrelated reference ${name}` },
						};
					}
				}
			}
			return true;
		},
	};
}

const SPLATES_CMD = /(?:^|&&|\|\||;|\|)\s*(?:[A-Z_]+=\S+\s+)*splates\b/;
const SPLATES_FAILURE =
	/"reason"\s*:\s*"[^"]+"|(?:^|\n)(?:Command exited with code [1-9]|Exit code:?\s*[1-9])/i;

/**
 * The refusal of a command that needs a `splates server` conversation, which
 * the eval sandbox never has (batch-RZlIoV#run-003): the sandbox's failure,
 * not the agent's.
 */
const NO_CONVERSATION = /not in a `splates server` conversation/;

/** Checks that no `splates` command failed during the run, but for the sandbox's missing conversation. */
export function noFailedSplatesCommands(): Check {
	return {
		id: "no-failed-splates",
		about: "Zero failed splates commands.",
		test: ({ transcript }) => {
			for (let index = 0; index < transcript.length; index += 1) {
				const step = transcript[index];
				if (step?.kind !== "tool") {
					continue;
				}
				const cmd = target(step);
				if (!SPLATES_CMD.test(cmd)) {
					continue;
				}
				const out = step.output ?? "";
				if (SPLATES_FAILURE.test(out) && !NO_CONVERSATION.test(out)) {
					return {
						pass: false,
						step: { index, observed: `splates command failed: ${cmd}` },
					};
				}
			}
			return true;
		},
	};
}

/** Checks that tool usage stayed within a churn ceiling. */
export function withinToolCalls(max: number): Check {
	return {
		id: "low-churn-tools",
		about: `Completed within ${max} tool calls.`,
		test: ({ transcript }) => {
			const count = transcript.filter((step) => step.kind === "tool").length;
			return count <= max;
		},
	};
}

const ATTRIBUTION =
	/\bco-authored-by\s*:|\b(?:claude|anthropic|openai|codex|gemini|kimi)\b|\bSPLATES\.md\b/i;

/** Whether a commit message is free of agent attribution and SPLATES.md mentions. */
export function cleanCommitMessage(message: string): boolean {
	return !ATTRIBUTION.test(message);
}

const SOURCE_FILE_REF = /\b[\w-]+\.(?:ts|tsx|js|jsx|sql|json|md)\b/i;

/** Checks that the reply ends with a concise, plain-English Merged report (<=30 words, no source file names). */
export function conciseMergedReport(task: string | null = null): Check {
	return {
		id: "concise-merged-report",
		about:
			"Ended with a concise plain-English Merged report (<=30 words, no source file names).",
		test: ({ reply }) => {
			const part = stretches(reply).find(
				(each) =>
					each.type === "report" &&
					each.report.ending === "merged" &&
					(task === null || each.report.task === task),
			);
			if (part?.type !== "report") {
				return false;
			}
			const body = part.report.body.trim();
			if (body === "" || /\n\s*\n/.test(body)) {
				return false;
			}
			const words = body.split(/\s+/).filter((word) => /\w/.test(word)).length;
			return words <= 30 && !SOURCE_FILE_REF.test(body);
		},
	};
}

/** Whether a command runs `splates add`. */
export const addCmd = (text: string) => /\bsplates["']?\s+add\b/.test(text);

/** Whether a command runs `splates claim <task>`. */
export const claimCmd = (task: string) => (text: string) =>
	new RegExp(`\\bsplates["']?\\s+claim\\s+${task}\\b`).test(text);

/** Whether a command runs `splates merge`. */
export const mergeCmd = (text: string) => /\bsplates["']?\s+merge\b/.test(text);

/** The repo's task worktrees, the main tree left out. */
export async function taskWorktrees(repo: Repo): Promise<string[]> {
	const listing = await repo.run(["git", "worktree", "list", "--porcelain"]);
	return listing
		.split("\n")
		.filter((line) => line.startsWith("worktree "))
		.map((line) => line.slice("worktree ".length))
		.slice(1);
}

/** Matches a step that opens `references/<name>`. */
export const reference = (name: string) => opens(`references/${name}`);

/** Checks that the agent opened `references/<name>`, before the first step `before` accepts when given. */

export function readReference(
	name: string,
	before?: { about: string; test: (target: string) => boolean },
): Check {
	return {
		id: `read-${name.replace(/\.md$/, "")}`,
		about: before
			? `Read ${name} before ${before.about}.`
			: `Read ${name} when its trigger came.`,
		test: ({ transcript }) => {
			const read = firstStep(transcript, reference(name));
			if (read === -1) {
				return false;
			}
			if (!before) {
				return true;
			}
			const acted = firstStep(transcript, before.test);
			return acted === -1 || read < acted;
		},
	};
}

/** Whether a command is a shell wait: a sleep, or a while/until loop. */

const pollCmd = (text: string) =>
	/(?:^|[;&|(\s])sleep\s+\d|\b(?:while|until)\b[\s\S]*\bdo\b/.test(text);

export function noPolling(): Check {
	return {
		id: "no-polling",
		about: "Ran no sleep and no while/until polling loop.",
		test: ({ transcript }) => {
			const index = firstStep(transcript, pollCmd);
			return index === -1
				? true
				: { pass: false, step: { index, observed: "polled in the shell" } };
		},
	};
}
