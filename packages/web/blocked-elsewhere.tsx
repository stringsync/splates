import type {
	ElsewhereBlockerNow,
	TaskRecord,
} from "@stringsync/splates-server/board/browser";
import { HourglassIcon, LinkIcon } from "lucide-react";
import { type JSX, useContext } from "react";
import { Board } from "./board";
import { ElsewhereMention } from "./markdown";

/**
 * What `todo` waits on in other projects and has yet to merge, each a link
 * to its card there with where it stands, and the tasks there that wait on
 * it: so work held up by another project says so on its card.
 */
export function Elsewhere({ todo }: { todo: TaskRecord }): JSX.Element | null {
	const { elsewhere } = useContext(Board);
	const waits = blockersNow(todo, elsewhere?.blockers[todo.id]).filter(
		(blocker) => blocker.status !== "merged",
	);
	const following = elsewhere?.following[todo.id] ?? [];
	if (waits.length === 0 && following.length === 0) {
		return null;
	}
	return (
		<>
			{waits.length > 0 && (
				<span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
					<HourglassIcon aria-hidden className="size-3 text-warning" />
					waits on
					{waits.map((blocker) => (
						<span
							key={`${blocker.project}#${blocker.id}`}
							className="inline-flex items-baseline gap-1"
							title={blocker.subject}
						>
							<ElsewhereMention project={blocker.slug} id={blocker.id} />
							<span
								className={
									blocker.status === "removed" ? "text-warning" : undefined
								}
							>
								{STATUS[blocker.status]}
							</span>
						</span>
					))}
				</span>
			)}
			{following.length > 0 && (
				<span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
					<LinkIcon aria-hidden className="size-3" />
					blocks
					{following.map((other) => (
						<span key={`${other.project}#${other.id}`} title={other.subject}>
							<ElsewhereMention project={other.slug} id={other.id} />
						</span>
					))}
				</span>
			)}
		</>
	);
}

/** Whether `todo` waits on a task of another project that has yet to merge. */
export function heldElsewhere(todo: TaskRecord): boolean {
	return (todo.blockedElsewhere ?? []).some(
		(blocker) => blocker.landed === undefined,
	);
}

/**
 * `todo`'s blockers in other projects as the server read them, `read`, or
 * from its record alone while it has not.
 */
function blockersNow(
	todo: TaskRecord,
	read: ElsewhereBlockerNow[] | undefined,
): ElsewhereBlockerNow[] {
	return (
		read ??
		(todo.blockedElsewhere ?? []).map((blocker) => ({
			...blocker,
			slug: blocker.project.split("/").filter(Boolean).at(-1) ?? "",
			status: blocker.landed ? "merged" : blocker.lost ? "removed" : "unknown",
		}))
	);
}

/** How a blocker's standing reads on a card. */
const STATUS: Record<ElsewhereBlockerNow["status"], string> = {
	backlog: "in its backlog",
	ready: "ready",
	queued: "queued",
	working: "under way",
	merged: "merged",
	removed: "removed: needs you",
	unknown: "",
};
