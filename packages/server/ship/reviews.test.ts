import { describe, expect, it } from "bun:test";
import { CounterIdProvider } from "webappwiz/id";
import { MemoryLogger } from "webappwiz/log";
import { MemoryStorage } from "../storage/testing";
import { readGraph } from "./graph";
import { planShip, type ShipReview } from "./plan";
import { ShipReviews } from "./reviews";
import { servedProjects, until } from "./testing";

describe("ShipReviews", () => {
	it("reviews every dependent, including private leaves, and saves their proposals", async () => {
		const setup = await fixture();
		const pending = await setup.reviews.draw("webappwiz", "patch");
		expect(pending.steps[1]?.review?.status).toBe("pending");
		const plan = await setup.complete();
		expect(setup.seen).toEqual(["splates", "mdom", "vexml", "sound2score"]);
		expect(plan.steps[2]).toMatchObject({
			bump: "minor",
			to: "1.5.0",
			review: { status: "done" },
		});
		const restarted = new ShipReviews(setup.opts);
		expect(await restarted.draw("webappwiz", "patch")).toEqual(plan);
		expect(setup.seen).toHaveLength(4);
	});

	it("refuses approval without a complete matching review", async () => {
		const setup = await fixture();
		await expect(
			setup.reviews.approve("webappwiz", "missing"),
		).rejects.toMatchObject({ reason: "conflict" });
		const pending = await setup.reviews.draw("webappwiz", "patch");
		await expect(
			setup.reviews.approve("webappwiz", pending.id as string),
		).rejects.toMatchObject({ reason: "conflict" });
		await setup.complete();
	});

	it("keeps the person's overrides without mutating the saved proposals", async () => {
		const setup = await fixture();
		const plan = await setup.complete();
		const approved = await setup.reviews.approve(
			"webappwiz",
			plan.id as string,
			{
				mdom: "major",
			},
		);
		expect(approved.steps[2]).toMatchObject({
			bump: "major",
			to: "2.0.0",
			review: { proposed: "minor" },
		});
		expect(
			(await setup.reviews.draw("webappwiz", "patch")).steps[2]?.bump,
		).toBe("minor");
		await expect(
			setup.reviews.approve("webappwiz", plan.id as string, {
				sound2score: "major",
			}),
		).rejects.toMatchObject({ reason: "usage" });
	});

	it("reviews and approves only the dependents the person kept", async () => {
		const setup = await fixture();
		const plan = await setup.complete(["splates"]);
		expect(plan.skipped).toEqual(["splates"]);
		expect(setup.seen).toEqual(["mdom", "vexml", "sound2score"]);
		const approved = await setup.reviews.approve(
			"webappwiz",
			plan.id as string,
		);
		expect(approved.steps.map((step) => step.slug)).toEqual([
			"webappwiz",
			"mdom",
			"vexml",
			"sound2score",
		]);
		expect(approved.skipped).toEqual(["splates"]);
		const kept = await setup.complete();
		expect(kept.id).not.toBe(plan.id);
		expect(kept.skipped).toBeUndefined();
	});

	it("rejects changed sources and superseded drafts", async () => {
		const setup = await fixture();
		const plan = await setup.complete();
		setup.change();
		await expect(
			setup.reviews.approve("webappwiz", plan.id as string),
		).rejects.toMatchObject({ reason: "conflict" });
		const changed = await setup.reviews.draw("webappwiz", "patch");
		expect(changed.id).not.toBe(plan.id);
		await expect(
			setup.reviews.approve("webappwiz", plan.id as string),
		).rejects.toMatchObject({ reason: "conflict" });
		await setup.complete();
	});

	it("requires an explicit retry after an interrupted review, without launching duplicate agents", async () => {
		const setup = await fixture();
		const raw = await setup.opts.plan("webappwiz", "patch");
		const key = JSON.stringify([raw, "one"]);
		const saved = structuredClone(raw);
		saved.id = "interrupted";
		saved.steps = saved.steps.map((step) => ({
			...step,
			review: { status: "pending", proposed: null, reasons: "Reviewing" },
		}));
		await setup.opts.storage
			.document("ship-plans/webappwiz.json")
			.write({ key, snapshot: "one", plan: saved });
		const interrupted = await setup.reviews.draw("webappwiz", "patch");
		expect(interrupted.steps[1]?.review?.status).toBe("failed");
		expect(setup.seen).toHaveLength(0);
		await expect(
			setup.reviews.approve("webappwiz", "interrupted"),
		).rejects.toMatchObject({ reason: "conflict" });
		await setup.reviews.draw("webappwiz", "patch", true);
		expect((await setup.complete()).steps[1]?.review?.status).toBe("done");
	});

	it("failed agent reviews block approval instead of becoming patch releases", async () => {
		const setup = await fixture();
		setup.proposals.push(new Error("Pinned release tag missing"));
		const plan = await setup.complete();
		expect(plan.steps[1]?.review).toMatchObject({
			status: "failed",
			reasons: "Pinned release tag missing",
		});
		await expect(
			setup.reviews.approve("webappwiz", plan.id as string),
		).rejects.toMatchObject({ reason: "conflict" });
	});
});

async function fixture() {
	const served = await servedProjects();
	let revision = "one";
	const seen: string[] = [];
	const proposals: (ShipReview | Error)[] = [];
	const opts = {
		storage: new MemoryStorage(),
		ids: new CounterIdProvider(),
		log: new MemoryLogger(),
		plan: async (
			slug: string,
			bump: "patch" | "minor" | "major",
			skip: string[] = [],
		) => planShip(await readGraph(served.fs, served.sources), slug, bump, skip),
		snapshot: async () => revision,
		review: async (step: { slug: string }) => {
			seen.push(step.slug);
			const next = proposals.shift();
			if (next instanceof Error) {
				throw next;
			}
			return (
				next ?? {
					status: "done" as const,
					proposed: "minor" as const,
					reasons: "New upstream API requires a new public adapter",
				}
			);
		},
	};
	const reviews = new ShipReviews(opts);
	const complete = async (skip: string[] = []) => {
		const draw = () =>
			reviews.draw("webappwiz", "patch", false, undefined, skip);
		await until(
			async () =>
				!(await draw()).steps.some((step) => step.review?.status === "pending"),
		);
		return draw();
	};
	return {
		reviews,
		complete,
		opts,
		seen,
		proposals,
		change: () => {
			revision = "two";
		},
	};
}
