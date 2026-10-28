import type { Mark, SplatesEventView, Words } from "./splates-event";

/**
 * What splates server's early warning to a task's agent says, read back from
 * its words (`earlyWarning` in the server's `early-warning.ts`): that the
 * task's commits conflict with its base, or each open task that changes the
 * files it does.
 */
export type EarlyWarning =
	| { kind: "conflict"; base: string; files: string[] }
	| { kind: "overlap"; overlaps: { task: string; files: string[] }[] };

const HEAD = /^Splates early warning for \S+:\n\n/u;
const CONFLICT =
	/^The committed changes will conflict with (\S+) in: (.+)\. Align the changes before merging\. This check did not rebase or change your worktree\.$/u;
const OVERLAP =
	/^overlap with (\S+): (.+); coordinate the work or queue it with --blocked-by$/u;

/** The early warning `text` is, or null for any other message, a warning reworded included. */
export function earlyWarningOf(text: string): EarlyWarning | null {
	const head = HEAD.exec(text);
	if (head === null) {
		return null;
	}
	const words = text.slice(head[0].length);
	const conflict = CONFLICT.exec(words);
	if (conflict !== null) {
		return {
			kind: "conflict",
			base: conflict[1] ?? "",
			files: (conflict[2] ?? "").split(", "),
		};
	}
	const overlaps = words.split("\n").map((line) => OVERLAP.exec(line));
	return overlaps.every((each) => each !== null)
		? {
				kind: "overlap",
				overlaps: overlaps.map(([, task = "", files = ""]) => ({
					task,
					files: files.split(", "),
				})),
			}
		: null;
}

/** The lines an early warning draws, one per task it overlaps, each with the whole warning on hover. */
export function warningLines(
	warning: EarlyWarning,
	at: string | null,
	title: string,
): SplatesEventView[] {
	const line = (mark: Mark, words: Words, mobile: Words) => ({
		mark,
		words,
		mobile: { words: mobile },
		at,
		title,
	});
	return warning.kind === "conflict"
		? [
				line(
					"conflict",
					["Conflict with", { kind: "branch", branch: warning.base }],
					[
						"Conflict with",
						{ kind: "branch", branch: warning.base },
						...filesIn(warning.files),
					],
				),
			]
		: warning.overlaps.map(({ task, files }) =>
				line(
					"overlap",
					["Overlaps", { kind: "task", task }],
					["Overlaps", { kind: "task", task }, ...filesIn(files)],
				),
			);
}

/** "in" and a chip for each file, or past three, their count. */
function filesIn(files: readonly string[]): Words {
	return files.length > 3
		? [`in ${files.length} files`]
		: ["in", ...files.map((path) => ({ kind: "file" as const, path }))];
}
