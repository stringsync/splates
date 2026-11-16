import type { AsyncResource, Resource } from "core/disposable";
import type { CascadeStep } from "./cascade";
import type { ReleaseStep } from "./release-steps";
import type { StepContext, StepRecord } from "./step-context";
import type { StepProject } from "./steps";

export async function publishStep(
	ctx: StepContext,
	record: StepRecord,
	step: CascadeStep,
	project: StepProject,
): Promise<boolean> {
	const { shipping } = project;
	ctx.publishing(shipping);
	const adoptions = new Adoptions(ctx, record, step, project);
	const following = followSteps(ctx, record, step, project, adoptions);
	try {
		const left = await shipping.current();
		if (!(await ctx.active(record))) {
			return false;
		}
		if (
			left?.status === "running" &&
			left.log === ctx.logOf(record.cascade.id, step.slug)
		) {
			await shipping.resume();
		} else if (left?.status === "running") {
			throw new Error("another ship is already running for this project");
		} else {
			const ship = await shipping.start(step.bump ?? "patch", {
				log: ctx.logOf(record.cascade.id, step.slug),
				planned: true,
				...(step.inputs === undefined ? {} : { inputs: step.inputs }),
			});
			step.ship = ship.started;
			if (!(await ctx.active(record))) {
				await shipping.stop();
			}
		}
		await shipping.settled();
		const ship = await shipping.current();
		if (ship?.status !== "done") {
			throw new Error(ship?.error ?? "ship command did not finish");
		}
	} finally {
		following?.dispose();
		await adoptions.disposeAsync();
		await keepSteps(ctx, record, step, project);
		ctx.publishing(null);
	}
	step.published = step.publishes.map((name) => ({
		name,
		version: step.to ?? "",
	}));
	return false;
}

/** Shows the release steps of the ship under way on the step's Publish stage as they change. */
function followSteps(
	ctx: StepContext,
	record: StepRecord,
	step: CascadeStep,
	project: StepProject,
	adoptions: Adoptions,
): Resource | undefined {
	return project.shipping.followSteps?.(async (steps) => {
		await showSteps(ctx, record, step, steps);
		adoptions.see(steps);
	});
}

/**
 * Answers the adopt steps of the ship under way: each asks for a task that
 * adopts upstream versions, which starts once and is answered `true` when it
 * merges and `false` when it was removed or failed to start.
 */
class Adoptions implements AsyncResource {
	private readonly asked = new Map<string, Promise<void>>();
	private readonly controller = new AbortController();
	constructor(
		private readonly ctx: StepContext,
		private readonly record: StepRecord,
		private readonly step: CascadeStep,
		private readonly project: StepProject,
	) {}

	see(steps: ReleaseStep[]): void {
		for (const each of steps) {
			const questionId = each.question?.questionId;
			if (
				each.state === "asking" &&
				each.adopt != null &&
				questionId !== undefined &&
				!this.asked.has(questionId)
			) {
				this.asked.set(questionId, this.answer(questionId, each.adopt));
			}
		}
	}

	/** Stops any task still being waited on and settles what was started. */
	async disposeAsync(): Promise<void> {
		this.controller.abort();
		await Promise.allSettled(this.asked.values());
	}

	private async answer(
		questionId: string,
		request: NonNullable<ReleaseStep["adopt"]>,
	): Promise<void> {
		const ctx = this.ctx;
		const record = this.record;
		const step = this.step;
		const project = this.project;
		const started = (await project.shipping.current())?.started;
		let merged = false;
		try {
			const versions = Object.entries(request.versions).map(
				([name, version]) => `${name}@${version}`,
			);
			merged = await project.adopt(
				record.cascade,
				step,
				{
					goal: `Adopt ${versions.join(", ")} for this ship.`,
					lines: [
						`The ship command could not simply move these pins to ${versions.join(", ")}:`,
						...request.unmovable.map(
							(pin) => `${pin.name} in ${pin.file}: ${pin.pin}`,
						),
						"Change the project so every pin of those packages is at the version given, and land it with `splates merge`: the ship checks the pins once it merges.",
					],
				},
				(text) => ctx.log(record.cascade.id, step.slug, text),
				AbortSignal.any([ctx.signal, this.controller.signal]),
				() => ctx.save(record),
			);
		} catch (error) {
			if (this.controller.signal.aborted || ctx.signal.aborted) {
				return;
			}
			await ctx.log(
				record.cascade.id,
				step.slug,
				`${error instanceof Error ? error.message : String(error)}\n`,
			);
		}
		if (started !== undefined && !this.controller.signal.aborted) {
			await project.shipping.answer?.(started, questionId, merged);
		}
	}
}

/** Copies the release steps the ship ended with onto the step's Publish stage, so its history keeps them. */
async function keepSteps(
	ctx: StepContext,
	record: StepRecord,
	step: CascadeStep,
	project: StepProject,
): Promise<void> {
	const ship = await project.shipping.current().catch(() => null);
	const steps = ship?.stages?.find(
		(stage) => stage.key === "command",
	)?.releaseSteps;
	if (
		steps !== undefined &&
		ship?.log === ctx.logOf(record.cascade.id, step.slug)
	) {
		await showSteps(ctx, record, step, steps);
	}
}

async function showSteps(
	ctx: StepContext,
	record: StepRecord,
	step: CascadeStep,
	steps: ReleaseStep[],
): Promise<void> {
	const stage = step.stages.find((each) => each.key === "publish");
	if (stage === undefined || !(await ctx.active(record))) {
		return;
	}
	stage.state = steps.some((each) => each.state === "asking")
		? "asking"
		: stage.state === "asking"
			? "running"
			: stage.state;
	stage.releaseSteps = step.planned
		? [
				...(stage.releaseSteps ?? []).map(
					(declared) =>
						steps.find((each) => each.id === declared.id) ?? declared,
				),
				...steps.filter(
					(each) =>
						!(stage.releaseSteps ?? []).some(
							(declared) => declared.id === each.id,
						),
				),
			]
		: steps;
	await ctx.save(record);
}
