import { type IdProvider, UuidProvider } from "webappwiz/id";
import { fail } from "../exit";
import type { Document, Storage } from "../storage";
import { nextVersion, type ShipBump, type ShipPlan } from "./plan";

interface Draft {
	used?: boolean;
	bump?: ShipBump;
	/** The dependents the person left out of the plan. */
	skip?: string[];
	key: string;
	plan: ShipPlan;
}

/**
 * The ship plans the person approves: draw one to show it, then approve it by
 * the id it was drawn with, and only that plan starts.
 */
export class ShipPlans {
	private readonly ids: IdProvider;
	constructor(
		private readonly opts: {
			storage: Storage;
			plan: (slug: string, bump: ShipBump, skip: string[]) => Promise<ShipPlan>;
			recover?: (id: string) => Promise<ShipPlan>;
			ids?: IdProvider;
		},
	) {
		this.ids = opts.ids ?? new UuidProvider();
	}

	/** Draws and saves the plan, leaving out the dependents `skip` names. */
	async draw(
		slug: string,
		bump: ShipBump,
		recovery?: string,
		skip: string[] = [],
	): Promise<ShipPlan> {
		// A redraw that changes the plan supersedes the old id.
		const plan = await this.drawPlan(slug, bump, recovery, skip);
		const key = JSON.stringify(plan);
		const draft = await this.record(slug, recovery).update((old) => {
			if (old?.key === key && !old.used) {
				return old;
			}
			plan.id = this.ids.next();
			return { key, plan, bump, skip };
		});
		return structuredClone(draft.plan);
	}

	/** The saved plan `id` names, at the release types in `choices`, once the world still draws it. */
	async approve(
		slug: string,
		id: string,
		choices: Record<string, ShipBump> = {},
		recovery?: string,
	): Promise<ShipPlan> {
		const record = this.record(slug, recovery);
		const draft = await record.read();
		if (draft === null || draft.plan.id !== id || draft.used) {
			fail("conflict", "the ship plan changed; reopen it and plan again");
		}
		const fresh = await this.drawPlan(
			slug,
			draft.bump ?? draft.plan.steps[0]?.bump ?? "patch",
			recovery,
			draft.skip ?? [],
		);
		if (JSON.stringify(fresh) !== draft.key) {
			fail("conflict", "the projects changed; redraw the ship plan");
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
		if (recovery !== undefined) {
			await record.update((current) => {
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
}
