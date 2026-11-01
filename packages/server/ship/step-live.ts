import { aborts } from "core/abort";
import { ensure } from "core/assert";
import { sleep } from "core/time";
import type { CascadeStep } from "./cascade";
import type { ShipProject } from "./graph";
import { REGISTRY_DEADLINE } from "./live";
import { pollSince } from "./published-notice";
import type { StageKey } from "./stages";
import type { StepContext, StepRecord } from "./step-context";

/** Polls the live check until a project's version is deployed, or the registry deadline passes. */
export async function waitLive(
	ctx: StepContext,
	record: StepRecord,
	step: CascadeStep,
	project: ShipProject,
	version: string,
	key: StageKey,
): Promise<void> {
	const stage = ensure.defined(step.stages.find((each) => each.key === key));
	const began = ctx.clock.now();
	const until = began + REGISTRY_DEADLINE.ms;
	const nextPoll = pollSince(ctx.clock, () => stage.expected);
	stage.deadline = new Date(until).toISOString();
	stage.state = "checking";
	while (await ctx.active(record)) {
		const check = await ctx.live.check(project, version);
		const lagging = check.lagging
			.map((each) => `${each.name}: ${each.deployed ?? "not live"}`)
			.join(", ");
		stage.check = {
			at: ctx.stamp(),
			result: check.live
				? `${project.slug}@${version} is live`
				: `${scanning(ctx.clock.now() - began, stage.expected)}: ${lagging}`,
			...(check.live || check.lagging[0] === undefined
				? {}
				: { link: npmPage(check.lagging[0].name, version) }),
		};
		if (!check.live) {
			stage.check.next = ctx.stamp(nextPoll());
		}
		await ctx.log(record.cascade.id, step.slug, `${stage.check.result}\n`);
		await ctx.save(record);
		if (check.live) {
			return;
		}
		if (ctx.clock.now() >= until) {
			throw new Error(
				`timed out waiting for ${project.slug}@${version} to go live`,
			);
		}
		await aborts.race(ctx.signal, ctx.pause?.() ?? sleep(nextPoll()));
	}
}

/** The package's page for a version on npmjs.com, where npm shows whether it is held. */
export function npmPage(name: string, version: string): string {
	return `https://www.npmjs.com/package/${name}/v/${version}`;
}

/** Why a version npm accepted is not installable yet, given how long the wait has run against the usual scan. */
export function scanning(waited: number, usual: number): string {
	return waited < usual ? "Scanning on npm" : "Possibly held for review";
}
