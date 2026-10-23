import type { Event } from "@stringsync/splates-server/records";

/** What a count of quiet events counts, in the order they show. */
export type CountKind =
	| "added"
	| "updated"
	| "moved"
	| "taken"
	| "removed"
	| "queued"
	| "lanes"
	| "files"
	| "artifacts";

export interface Count {
	kind: CountKind;
	/** `3 tasks added`, `Uploads lane`, `2 moved`. */
	label: string;
}

/** The counts a row's quiet events add up to, and how many were refused. */
export interface Counts {
	counts: Count[];
	refused: number;
}

/** Which count a successful quiet event goes in; null for the kinds with none. */
export function kindOf(event: Event): CountKind | null {
	switch (event.action) {
		case "task add":
			return "added";
		case "task update":
			return event.reason === null &&
				(event.changed.lane !== undefined ||
					event.changed.position !== undefined)
				? "moved"
				: "updated";
		case "task take":
		case "task release":
			return "taken";
		case "task remove":
			return "removed";
		case "queue add":
		case "queue remove":
			return "queued";
		case "lane add":
		case "lane update":
		case "lane remove":
			return "lanes";
		case "attach":
			return "files";
		case "artifact add":
		case "artifact remove":
			return "artifacts";
		default:
			// Notes read, Auto pick, and an add handed to another agent only
			// show in the dialog.
			return null;
	}
}

/** How many things one event counts: the todos a command named, else itself. */
function weigh(event: Event): number {
	if (event.reason !== null) {
		return 0;
	}
	switch (event.action) {
		case "task take":
		case "task release":
		case "task remove":
		case "queue add":
		case "queue remove":
			return event.tasks.length;
		case "attach":
			return event.stored.length + event.removed.length;
		default:
			return 1;
	}
}

/** The counts for `events`, quiet ones of a row, in the order they show. */
export function countsOf(events: readonly Event[]): Counts {
	const totals = new Map<CountKind, number>();
	const lanes = new Set<string>();
	let refused = 0;
	for (const event of events) {
		if (event.reason !== null) {
			refused++;
			continue;
		}
		const kind = kindOf(event);
		if (kind === null) {
			continue;
		}
		totals.set(kind, (totals.get(kind) ?? 0) + weigh(event));
		if (
			event.action === "lane add" ||
			event.action === "lane update" ||
			event.action === "lane remove"
		) {
			lanes.add(event.name);
		}
	}
	const counts = ORDER.flatMap((kind): Count[] => {
		const total = totals.get(kind) ?? 0;
		if (total === 0) {
			return [];
		}
		const [only] = lanes;
		const label =
			kind === "lanes" && lanes.size === 1 && only !== undefined
				? `${only} lane`
				: LABELS[kind](total);
		return [{ kind, label }];
	});
	return { counts, refused };
}

const ORDER: CountKind[] = [
	"added",
	"updated",
	"moved",
	"taken",
	"removed",
	"queued",
	"lanes",
	"files",
	"artifacts",
];

const LABELS: Record<CountKind, (many: number) => string> = {
	added: (many) => `${many} ${many === 1 ? "task" : "tasks"} added`,
	updated: (many) => `${many} updated`,
	moved: (many) => `${many} moved`,
	taken: (many) => `${many} taken`,
	removed: (many) => `${many} removed`,
	queued: (many) => `${many} queued`,
	lanes: (many) => `${many} ${many === 1 ? "lane" : "lanes"}`,
	files: (many) => `${many} ${many === 1 ? "file" : "files"}`,
	artifacts: (many) => `${many} ${many === 1 ? "artifact" : "artifacts"}`,
};
