import type { Fs } from "webappwiz/system";
import { enqueued, type Tasks } from "../board";
import { asking, type WorktreeService } from "../tasks";
import type { Pin } from "./graph";
import type { ShipBump } from "./plan";

/** Where a bump task stands, as a cascade reads it: `gating` while its merge gate runs. */
export type BumpState = "open" | "asking" | "gating" | "merged" | "removed";

/** What a bump task moves: another project's packages, to the versions it shipped. */
export interface BumpTake {
	/** The project that shipped them. */
	project: string;
	pins: Pin[];
	/** What that project's config says to run after taking them, if anything. */
	afterBump: string | null;
}

/**
 * A project's side of a ship's cascade: the task that moves its pins to the
 * versions shipped before it, added groomed in its untriaged lane, as a
 * task from another project goes, and queued for an agent to start, since
 * the person approved the plan that named it.
 */
export class Bumps {
	constructor(
		private readonly deps: {
			tasks: Tasks;
			service: Pick<WorktreeService, "find" | "finished">;
			fs: Fs;
			/** Removes the task an agent took, as the page's remove does. */
			removeTaken: (task: string) => Promise<void>;
		},
	) {}

	/** Adds and queues the bump of `takes`, for the ship of `from`, whose main tree is `origin`. */
	async add(
		{
			from,
			origin,
			release,
		}: {
			from: string;
			origin: string;
			release?: { bump: ShipBump | null; reasons: string };
		},
		takes: BumpTake[],
	): Promise<number> {
		const pins = takes.flatMap((take) => take.pins);
		const named = pins.map((pin) => `${pin.name} ${pin.version}`).join(", ");
		const task = await this.deps.tasks.add(
			`Take ${named}, from the ship of ${from}`,
			null,
			{
				text: bumpText(from, takes, release),
				origin: { project: origin, task: null },
				ready: true,
			},
		);
		const queued = await this.deps.tasks.revise(task.id, (state) =>
			enqueued(state, { by: "ship", project: from }),
		);
		return queued.id;
	}

	/**
	 * Where bump task `id` stands: on the board, open or asking the person;
	 * off it, merged or removed, as its finished record says.
	 */
	async state(id: number): Promise<BumpState> {
		const listed = (await this.deps.tasks.all()).find((each) => each.id === id);
		if (listed !== undefined) {
			if (listed.takenBy === null) {
				return "open";
			}
			const worktree = await this.deps.service.find(listed.takenBy);
			if (worktree.status === "merging") {
				return "gating";
			}
			return (await asking(worktree, this.deps.fs, Date.now())) === null
				? "open"
				: "asking";
		}
		const ended = (await this.deps.service.finished.list()).find(
			(each) => each.id === id || each.took.some((took) => took.id === id),
		);
		return ended?.ended === "merged" ? "merged" : "removed";
	}

	/**
	 * Removes bump task `id`, as abandoning its cascade does: off the board
	 * when no agent took it, else its task, the agent stopped.
	 */
	async remove(id: number): Promise<void> {
		const listed = (await this.deps.tasks.all()).find((each) => each.id === id);
		if (listed === undefined) {
			return;
		}
		if (listed.takenBy === null) {
			await (await this.deps.tasks.find(id)).discard();
			return;
		}
		await this.deps.removeTaken(listed.takenBy);
	}
}

/** What a bump task asks of the agent that takes it. */
function bumpText(
	from: string,
	takes: BumpTake[],
	release?: { bump: ShipBump | null; reasons: string },
): string {
	return [
		`The ship of ${from} published new versions this project pins:`,
		"",
		...takes.flatMap((take) =>
			take.pins.map(
				(pin) => `- \`${pin.name}\` ${pin.version}, from ${take.project}`,
			),
		),
		"",
		"Move every pin of them in each `package.json` (the root's and each workspace member's) to these versions, run `bun install`, fix what breaks, and land it through the merge gate.",
		...afterBumpSteps(takes),
		"",
		...(release === undefined
			? []
			: [
					`Approved release: ${release.bump ?? "dependency bump only"}. Plan review: ${release.reasons}`,
					"",
				]),
		"Publish nothing: when this project ships too, the cascade ships it once this task merges, at the release type settled in the approved plan. Do not ask for a different release type during the run.",
		"If the repairs reveal a public API change outside the approved plan, or a break you cannot fix, do not merge. Remove your bump task with `--reason blocked` and `--waiting-on` a revised ship plan, explaining what it must resolve. Removing the task stops the whole run and removes its other open bump tasks; what shipped stays published. A new plan must recover unfinished bumps without republishing successful releases, and needs the person's approval before another run.",
	].join("\n");
}

/** The commands the shipped projects ask to be run once their versions are in. */
function afterBumpSteps(takes: BumpTake[]): string[] {
	const runs = takes.flatMap((take) =>
		take.afterBump === null
			? []
			: [`- \`${take.afterBump}\`, as ${take.project} asks`],
	);
	return runs.length === 0
		? []
		: [
				"",
				"After `bun install`, run each of these from the worktree's root and commit what it changes:",
				"",
				...runs,
			];
}
