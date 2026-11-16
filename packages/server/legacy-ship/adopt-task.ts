import { aborts } from "core/abort";
import type { Logger } from "core/log";
import type { Ps } from "core/system";
import { Duration, sleep } from "core/time";
import { PLAN_FILE } from "../plans";
import type { Repository } from "../records";
import { add, remove } from "../tasks";
import type { Cascade, CascadeStep } from "./cascade";

/**
 * Starts an agent task for a ship step that needs one to adopt upstream
 * versions, and waits for it to land or be removed. The task changes the
 * project's own files; the server edits none of them.
 */
export class AdoptTask {
	constructor(private readonly repo: Repository & { ps: Ps; log: Logger }) {}

	/** Whether the task merged: false once it was removed without merging. */
	async run(
		ship: Cascade,
		step: CascadeStep,
		request: AdoptRequest,
		log: (text: string) => Promise<void>,
		opts: AdoptTaskOptions,
	): Promise<boolean> {
		const repo = this.repo;
		const { service, config } = repo;
		const task = this.taskOf(ship, step);
		const ended = await this.ended(task);
		if (ended !== undefined) {
			return ended === "merged";
		}
		let numbered = (await repo.tasks.all()).find(
			(each) =>
				each.state.ship?.run === ship.id && each.state.ship.step === step.slug,
		);
		if (numbered === undefined) {
			numbered = await repo.tasks.add(`Check ${step.slug} for its ship`, null, {
				slug: task,
				ship: { run: ship.id, step: step.slug },
				text: this.detail(ship, step, request),
			});
		}
		step.task = numbered.id;
		await opts.assigned?.();
		let tree = await service.find(task);
		if (tree.gone) {
			// A repo whose config requires a tag refuses an untagged fresh task, so
			// tag it with its project's folder, the step slug less its npm scope.
			const folder = step.slug.slice(step.slug.lastIndexOf("/") + 1);
			const allowed = config.tags?.allowed;
			await add(repo, task, {
				tasks: [numbered.id],
				tag: allowed === undefined || allowed.includes(folder) ? [folder] : [],
				goal: request.goal,
			});
			tree = await service.find(task);
			await numbered.take(task);
			await repo.fs.write(
				`${tree.path}/${PLAN_FILE}`,
				`# ${task}\n\nThis task belongs to a ship.\n\n## Goal\n\n${this.detail(ship, step, request)}\n`,
			);
		}
		await log(`Adopting in ${tree.path}\n`);
		if (opts.agent === undefined) {
			throw new Error("Ship agent starts are not configured");
		}
		// The agent claims the task itself; a lease left on the server's pid
		// would make its merge and claim refuse with lease_held.
		await tree.save({ lease: null });
		await opts.agent(task);
		for (;;) {
			opts.signal?.throwIfAborted();
			const outcome = await this.ended(task);
			if (outcome !== undefined) {
				return outcome === "merged";
			}
			await (opts.signal === undefined
				? sleep(Duration.secs(1))
				: aborts.race(opts.signal, sleep(Duration.secs(1))));
		}
	}

	/** Discard an unfinished task once the person ends its ship. */
	async discard(ship: Cascade, step: CascadeStep): Promise<void> {
		const task = this.taskOf(ship, step);
		const tree = await this.repo.service.find(task);
		if (!tree.gone) {
			await remove(this.repo, task, { reason: "moot" });
		}
	}

	/** How the task ended, or undefined while it is open. */
	private async ended(task: string): Promise<string | undefined> {
		const { git } = this.repo;
		return (await this.repo.outcomes.list()).find(
			(each) => each.project === git.root && each.task === task,
		)?.ended;
	}

	private detail(
		ship: Cascade,
		step: CascadeStep,
		request: AdoptRequest,
	): string {
		return [
			`Ship ${ship.id}, step ${step.slug}.`,
			...request.lines,
			"Fix what breaks, then land with `splates merge`: your merge is how you tell the server it is OK to ship, and it publishes only after that, so run no ship command yourself. Never change the release type or bump further. If you cannot, `splates remove <task> --reason blocked` saying why.",
			"## Person's instructions",
			step.instructions ?? "",
		].join("\n\n");
	}

	private taskOf(ship: Cascade, step: CascadeStep): string {
		const slug = step.slug
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "");
		return `ship-${ship.started.replace(/[^0-9]/g, "")}-${slug}`;
	}
}

/** What the task is asked to do: a goal line and the details the agent reads. */
export interface AdoptRequest {
	goal: string;
	lines: string[];
}

export interface AdoptTaskOptions {
	agent?: (task: string) => Promise<void>;
	assigned?: () => Promise<void>;
	signal?: AbortSignal;
}
