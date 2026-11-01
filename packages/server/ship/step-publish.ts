import { aborts } from "core/abort";
import { ensure } from "core/assert";
import { sleep } from "core/time";
import type { CascadeStep } from "./cascade";
import {
	allPublished,
	pinsOf,
	pollSince,
	untilPublished,
} from "./published-notice";
import type { StepContext, StepRecord } from "./step-context";
import type { StepProject } from "./steps";

/** Publishes a step's project and waits for the registry to show it; true when it was already out. */
export async function publishStep(
	ctx: StepContext,
	record: StepRecord,
	step: CascadeStep,
	project: StepProject,
): Promise<boolean> {
	const version = step.to ?? "";

	if (
		(await allPublished(ctx.registry, step, version)) &&
		(await (project.released?.(version) ?? true))
	) {
		step.published = pinsOf(step);
		return true;
	}
	const { shipping } = project;
	ctx.publishing(shipping);
	try {
		const left = await shipping.current();
		if (!(await ctx.active(record))) {
			return false;
		}
		if (left?.status === "running") {
			if (
				left.log !== ctx.logOf(record.cascade.id, step.slug) ||
				left.bump !== step.bump
			) {
				throw new Error("another publish is already running for this project");
			}
			await shipping.resume();
		} else {
			const ship = await shipping.start(ensure.present(step.bump), {
				log: ctx.logOf(record.cascade.id, step.slug),
			});
			step.ship = ship.started;
			if (!(await ctx.active(record))) {
				await shipping.stop();
			}
		}
		let settled = false;
		const settling = new AbortController();
		const nextPoll = pollSince(
			ctx.clock,
			() => step.stages.find((each) => each.key === "publish")?.expected ?? 0,
		);
		const announced = untilPublished(
			ctx.registry,
			step,
			ensure.present(step.to),
			{
				settled: () => settled || ctx.signal.aborted,
				pause: () =>
					aborts.race(
						AbortSignal.any([ctx.signal, settling.signal]),
						ctx.pause?.() ?? sleep(nextPoll()),
					),
				show: async (notice) => {
					const stage = step.stages.find((each) => each.key === "publish");
					if (stage !== undefined && (await ctx.active(record))) {
						stage.check = {
							at: ctx.stamp(),
							result: notice,
							next: ctx.stamp(nextPoll()),
						};
						await ctx.log(record.cascade.id, step.slug, `${notice}\n`);
						await ctx.save(record);
					}
				},
			},
		);
		try {
			await shipping.settled();
		} finally {
			settled = true;
			settling.abort();
		}
		await announced;
		const ship = await shipping.current();
		if (ship?.status !== "done") {
			throw new Error(ship?.error ?? "publish did not finish");
		}
		if (ship.to !== step.to) {
			throw new Error(`published ${ship.to}, expected ${step.to}`);
		}
	} finally {
		ctx.publishing(null);
	}
	step.published = pinsOf(step);
	return false;
}
