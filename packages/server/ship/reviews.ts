import { type IdProvider, UuidProvider } from "webappwiz/id";
import type { Logger } from "webappwiz/log";
import { fail } from "../exit";
import type { Document, Storage } from "../storage";
import {
	nextVersion,
	type ShipBump,
	type ShipPlan,
	type ShipReview,
	type ShipStep,
} from "./plan";

/** A dependent's review, before the person approves any publishing. */
export type ReviewShip = (
	step: ShipStep,
	plan: ShipPlan,
) => Promise<ShipReview>;

interface Draft {
	used?: boolean;
	bump?: ShipBump;
	/** The dependents the person left out of the plan. */
	skip?: string[];
	key: string;
	snapshot: string;
	plan: ShipPlan;
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
			snapshot: (plan: ShipPlan) => Promise<string>;
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
			for (const step of plan.steps) {
				if (step.takes.length > 0 || plan.recovery !== undefined) {
					step.review = {
						status: "pending",
						proposed: null,
						reasons: "Waiting for dependent review",
					};
				}
			}
			this.running.add(plan.id);
			launch = true;
			return { key, snapshot, plan, bump, skip };
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
				);
				if (
					!review.reasons.trim() ||
					(review.status === "done" &&
						step.action === "ship" &&
						review.proposed === null)
				) {
					throw new Error("The agent did not complete its release review");
				}
				step.review = review;
				if (review.status === "done" && step.action === "ship") {
					step.bump = review.proposed;
					step.to =
						step.from === null || step.bump === null
							? null
							: nextVersion(step.from, step.bump);
				}
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
