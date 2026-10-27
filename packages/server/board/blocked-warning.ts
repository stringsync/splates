import { color } from "webappwiz/log";
import { elsewhereName } from "./elsewhere";
import type { Task } from "./task";

/**
 * The lines warning that `taken` was taken while `blockers` have yet to merge,
 * or none when nothing blocks it: it may be started, but what it builds on
 * is not there yet.
 */
export function blockedWarning(taken: Task, blockers: Task[]): string[] {
	const elsewhere = taken.blockedElsewhere
		.filter((blocker) => blocker.landed === undefined)
		.map(
			(blocker) =>
				`  ${color.yellow("blocked")}: task ${taken.id} is blocked by ${elsewhereName(blocker)} ${blocker.subject}, in another project, which ${blocker.lost ? "was removed there without merging: ask the person whether this still makes sense" : `has yet to merge there; \`splates --project ${elsewhereName(blocker).split(" ")[0]} task show ${blocker.id}\` says where it stands`}`,
		);
	const [first] = blockers;
	if (first === undefined) {
		return elsewhere;
	}
	const where = (other: Task) =>
		[
			other.lane === null ? null : `lane ${other.lane}`,
			other.takenBy === null ? "open" : `taken by ${other.takenBy}`,
		]
			.filter(Boolean)
			.join(", ");
	return [
		`  ${color.yellow("blocked")}: task ${taken.id} is blocked by ${blockers.map((other) => `task ${other.id} (${where(other)})`).join(" and ")}, which ${blockers.length === 1 ? "has" : "have"} yet to merge`,
		`  work only on what does not need ${blockers.length === 1 ? "it" : "them"}, or \`splates task wait ${first.id}\` until it lands`,
		...elsewhere,
	];
}
