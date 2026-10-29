import { type IdProvider, UuidProvider } from "webappwiz/id";
import type { Logger } from "webappwiz/log";
import { fail } from "../exit";
import type { Document, Storage } from "../storage";
import {
	nextVersion,
	type ShipBump,
	type ShipPlan,
	type ShipReview,
	type ShipReviewProgress,
	type ShipStep,
} from "./plan";

/** A dependent's review, before the person approves any publishing. */
export type ReviewShip = (
	step: ShipStep,
	plan: ShipPlan,
	report: (progress: ShipReviewProgress) => Promise<void>,
) => Promise<ShipReview>;

interface Draft {
	used?: boolean;
	bump?: ShipBump;
	/** The dependents the person left out of the plan. */
	skip?: string[];
	key: string;
	/** Each reviewed project's checked-out source, by slug; a string in drafts saved before it was kept per project. */
	snapshot: Record<string, string> | string;
	plan: ShipPlan;
	/** Finished reviews of earlier drafts at this release type, for a redraw that leaves out or adds back a dependent. */
	earlier?: Reviewed[];
}

/** A finished review of a step, with the source of its project it read. */
interface Reviewed {
	step: ShipStep;
	source: string;
}

/** Saved, reviewed plans. A redraw supersedes the old approval; a restart marks interrupted reviews for an explicit retry. */
export class ShipReviews {
	private readonly running = new Set<string>();
	private readonly ids: IdProvider;
	constructor(
		private readonly opts: {
			storage: Storage;
			log: Logger;
			plan: (slug: string, bump: ShipBump, skip: string[]) => Promise<ShipPlan>;
			recover?: (id: string) => Promise<ShipPlan>;
			/** Each project the plan reviews, by slug, to a value that changes with its source. */
			snapshot: (plan: ShipPlan) => Promise<Record<string, string>>;
			review: ReviewShip;
			ids?: IdProvider;
		},
	) {
		this.ids = opts.ids ?? new UuidProvider();
	}

	/**
	 * Draws immediately, with reviews pending while their agents work, leaving
	 * out the dependents `skip` names.
	 */
	async draw(
		slug: string,
		bump: ShipBump,
		retry = false,
		recovery?: string,
		skip: string[] = [],
	): Promise<ShipPlan> {
		const plan = await this.drawPlan(slug, bump, recovery, skip);
		const snapshot = await this.opts.snapshot(plan);
		const key = JSON.stringify([plan, snapshot]);
		const record = this.record(slug, recovery);
		let launch = false;
		const draft = await record.update((old) => {
			if (old?.key === key && !retry && !old.used) {
				if (!this.running.has(old.plan.id as string)) {
					for (const step of old.plan.steps) {
						if (step.review?.status === "pending") {
							step.review = {
								status: "failed",
								proposed: null,
								reasons:
									"Review interrupted by a server restart; retry the reviews",
							};
						}
					}
				}
				return old;
			}
			plan.id = this.ids.next();
			const earlier =
				retry || old === null || old.used || old.bump !== bump
					? []
					: reviewed(old);
			for (const step of plan.steps) {
				const kept = keptReview(earlier, step, snapshot);
				if (kept !== undefined) {
					adopt(step, kept);
				} else if (step.takes.length > 0 || plan.recovery !== undefined) {
					step.review = {
						status: "pending",
						proposed: null,
						reasons: "Waiting for dependent review",
					};
				}
			}
			this.running.add(plan.id);
			launch = true;
			return {
				key,
				snapshot,
				plan,
				bump,
				skip,
				...(earlier.length > 0 ? { earlier } : {}),
			};
		});
		const id = draft.plan.id as string;
		if (
			launch &&
			draft.plan.steps.some((step) => step.review?.status === "pending")
		) {
			void this.review(record, draft)
				.catch((error: unknown) =>
					this.opts.log.error(`ship review: ${String(error)}`),
				)
				.finally(() => this.running.delete(id));
		}
		if (!draft.plan.steps.some((step) => step.review?.status === "pending")) {
			this.running.delete(id);
		}
		return structuredClone(draft.plan);
	}

	/** Uses only a complete saved review of the current source trees. */
	async approve(
		slug: string,
		id: string,
		choices: Record<string, ShipBump> = {},
		recovery?: string,
	): Promise<ShipPlan> {
		const draft = await this.record(slug, recovery).read();
		if (draft === null || draft.plan.id !== id || draft.used) {
			fail("conflict", "the ship plan changed; reopen it and review it again");
		}
		if (
			draft.plan.steps.some(
				(step) => step.review !== undefined && step.review.status !== "done",
			)
		) {
			fail(
				"conflict",
				"every dependent review must finish successfully before approval",
			);
		}
		const fresh = await this.drawPlan(
			slug,
			draft.bump ?? draft.plan.steps[0]?.bump ?? "patch",
			recovery,
			draft.skip ?? [],
		);
		if (
			JSON.stringify([fresh, await this.opts.snapshot(fresh)]) !== draft.key
		) {
			fail("conflict", "the reviewed projects changed; redraw the ship plan");
		}
		if (draft.plan.recovery !== undefined && draft.plan.steps.length === 0) {
			fail("conflict", "nothing remains to recover");
		}
		const plan = structuredClone(draft.plan);
		for (const [slug, bump] of Object.entries(choices)) {
			const step = plan.steps.find(
				(step) => step.slug === slug && step.action === "ship",
			);
			if (step === undefined) {
				fail("usage", `${slug} has no release in this plan`);
			}
			step.bump = bump;
			step.to = step.from === null ? null : nextVersion(step.from, bump);
		}
		if (plan.steps.some((step) => step.action === "ship" && step.to === null)) {
			fail("usage", "every publish needs a valid planned version");
		}
		if ((await this.record(slug, recovery).read())?.plan.id !== id) {
			fail(
				"conflict",
				"the ship plan changed during approval; review it again",
			);
		}
		if (recovery !== undefined) {
			await this.record(slug, recovery).update((current) => {
				if (current?.plan.id !== id || current.used) {
					fail(
						"conflict",
						"the recovery approval was already used or replaced; redraw the plan",
					);
				}
				return { ...current, used: true };
			});
		}
		return plan;
	}

	private async drawPlan(
		slug: string,
		bump: ShipBump,
		recovery?: string,
		skip: string[] = [],
	): Promise<ShipPlan> {
		if (recovery === undefined) {
			return this.opts.plan(slug, bump, skip);
		}
		if (this.opts.recover === undefined) {
			fail("usage", "ship recovery is unavailable");
		}
		const plan = await this.opts.recover(recovery);
		if (plan.from !== slug) {
			fail("conflict", "the stopped ship belongs to another project");
		}
		return plan;
	}

	private record(slug: string, recovery?: string): Document<Draft> {
		return this.opts.storage.document<Draft>(
			recovery === undefined
				? `ship-plans/${encodeURIComponent(slug)}.json`
				: `ship-recovery-plans/${encodeURIComponent(recovery)}.json`,
		);
	}

	private async review(record: Document<Draft>, draft: Draft): Promise<void> {
		for (const step of draft.plan.steps) {
			if (step.review?.status !== "pending") {
				continue;
			}
			if ((await record.read())?.plan.id !== draft.plan.id) {
				return;
			}
			try {
				const review = await this.opts.review(
					step,
					structuredClone(draft.plan),
					async (progress) => {
						if (step.review?.status !== "pending") {
							return;
						}
						step.review = { ...step.review, progress };
						await record.update((current) =>
							current?.plan.id === draft.plan.id
								? structuredClone(draft)
								: (current ?? draft),
						);
					},
				);
				if (
					!review.reasons.trim() ||
					(review.status === "done" &&
						step.action === "ship" &&
						review.proposed === null)
				) {
					throw new Error("The agent did not complete its release review");
				}
				adopt(step, review);
			} catch (error) {
				step.review = {
					status: "failed",
					proposed: null,
					reasons: error instanceof Error ? error.message : String(error),
				};
			}
			await record.update((current) =>
				current?.plan.id === draft.plan.id
					? structuredClone(draft)
					: (current ?? draft),
			);
		}
	}
}

/** The finished reviews `old` holds, of its steps and of its earlier drafts', each once. */
function reviewed(old: Draft): Reviewed[] {
	const snapshot = old.snapshot;
	if (typeof snapshot !== "object") {
		return [];
	}
	const all = [
		...old.plan.steps.flatMap((step) => {
			const source = snapshot[step.slug];
			return step.review?.status === "done" && source !== undefined
				? [{ step, source }]
				: [];
		}),
		...(old.earlier ?? []),
	];
	return all.filter(
		(prior, index) =>
			all.findIndex((other) => inputs(other) === inputs(prior)) === index,
	);
}

/** What a review of a step read: the step's place in the plan and its project's source. */
function inputs(reviewed: { step: ShipStep; source: string | undefined }) {
	const { slug, action, from, takes } = reviewed.step;
	return JSON.stringify([slug, action, from, takes, reviewed.source]);
}

/**
 * The finished review among `earlier` of a step like `step`, when its
 * project's source is unchanged too, so a redraw that only leaves out or adds
 * back other dependents need not review it again.
 */
function keptReview(
	earlier: Reviewed[],
	step: ShipStep,
	snapshot: Record<string, string>,
): ShipReview | undefined {
	const wanted = inputs({ step, source: snapshot[step.slug] });
	const before = earlier.find((prior) => inputs(prior) === wanted);
	return before === undefined ? undefined : structuredClone(before.step.review);
}

/** Records `review` on `step`, a finished ship taking the release type it proposes. */
function adopt(step: ShipStep, review: ShipReview): void {
	step.review = review;
	if (review.status === "done" && step.action === "ship") {
		step.bump = review.proposed;
		step.to =
			step.from === null || step.bump === null
				? null
				: nextVersion(step.from, step.bump);
	}
}
