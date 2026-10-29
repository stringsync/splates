import type { ShipBump, ShipPlan } from "@stringsync/splates-server/ship";
import { nextVersion } from "@stringsync/splates-server/ship/browser";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { shipPlan, startShip } from "./api";
import { refusalOf } from "./refusal";

export type ShipApprovalEvents = { changed: undefined };

/** Where an approval asks for the plan and starts the ship. */
export interface ShipServer {
	shipPlan(
		project: string,
		bump: ShipBump,
		retry?: boolean,
		recovery?: string,
		skip?: string[],
	): Promise<ShipPlan>;
	startShip(
		project: string,
		bump: ShipBump,
		approval?: { id: string; choices: Record<string, ShipBump> },
		recovery?: string,
	): Promise<void>;
}

/**
 * The plan to ship one project at the person's chosen bump, drawn by the server,
 * and their Approve of it: the plan once drawn, why there is none or why the
 * ship did not start, and whether it is starting.
 */
export class ShipApproval implements Eventful<ShipApprovalEvents> {
	private readonly dispatcher = new Dispatcher<ShipApprovalEvents>();
	readonly events = this.dispatcher.events;
	private drawing = 0;

	/** The plan, or null until it is drawn or when there is none. */
	plan: ShipPlan | null = null;
	/** The starting project's release type, patch until the person changes it. */
	bump: ShipBump = "patch";
	/** The dependents the person left out of the ship, none until they leave one out. */
	skip: string[] = [];
	/** Why there is no plan, or why the ship did not start; null otherwise. */
	refusal: string | null = null;
	/** Whether Approve waits on the server's answer. */
	starting = false;

	constructor(
		readonly project: string,
		private readonly server: ShipServer = { shipPlan, startShip },
		readonly recovery?: string,
	) {}

	/** Asks the server for the plan at the chosen bump, as the dialog opens. */
	async draw(retry = false): Promise<void> {
		const drawing = ++this.drawing;
		try {
			const plan = await this.server.shipPlan(
				this.project,
				this.bump,
				retry,
				this.recovery,
				this.skip,
			);
			if (drawing !== this.drawing) {
				return;
			}
			this.plan = plan;
			this.refusal = null;
		} catch (error) {
			if (drawing !== this.drawing) {
				return;
			}
			this.plan = null;
			this.refusal = refusalOf(`No plan to ship ${this.project}`, error);
		}
		this.changed();
	}

	/** Picks the release type to ship at, as the dialog's selector does, and redraws the plan at it. */
	async choose(bump: ShipBump): Promise<void> {
		// draw() drops an older draw that answers late.
		if (this.starting || bump === this.bump) {
			return;
		}
		this.bump = bump;
		this.plan = null;
		this.refusal = null;
		this.changed();
		await this.draw();
	}

	/**
	 * Leaves the dependent `slug` out of the ship, with what only it would
	 * carry the release to, or puts it back when `out` is false, and redraws.
	 */
	async leaveOut(slug: string, out = true): Promise<void> {
		if (this.starting || this.skip.includes(slug) === out) {
			return;
		}
		this.skip = out
			? [...this.skip, slug]
			: this.skip.filter((each) => each !== slug);
		this.plan = null;
		this.refusal = null;
		this.changed();
		await this.draw();
	}

	/** Whether every dependent has successfully reviewed this plan. */
	get ready(): boolean {
		return (
			this.refusal === null &&
			(this.recovery === undefined || (this.plan?.steps.length ?? 0) > 0) &&
			(this.plan?.steps.every(
				(step) => step.review === undefined || step.review.status === "done",
			) ??
				false)
		);
	}

	/** Changes a release choice in the plan the person will approve. */
	chooseDependent(slug: string, bump: ShipBump): void {
		if (this.starting) {
			return;
		}
		if (this.plan !== null) {
			this.plan = structuredClone(this.plan);
		}
		const step = this.plan?.steps.find(
			(step) => step.slug === slug && step.action === "ship",
		);
		if (step === undefined) {
			return;
		}
		step.bump = bump;
		step.to = step.from === null ? null : nextVersion(step.from, bump);
		this.changed();
	}

	/** Starts the ship the plan shows; whether it started. */
	async approve(): Promise<boolean> {
		if (!this.ready || this.starting) {
			return false;
		}
		this.starting = true;
		this.refusal = null;
		this.changed();
		try {
			await this.server.startShip(
				this.project,
				this.bump,
				this.plan?.id === undefined
					? undefined
					: {
							id: this.plan.id,
							choices: Object.fromEntries(
								this.plan.steps
									.filter(
										(step) => step.action === "ship" && step.bump !== null,
									)
									.map((step) => [step.slug, step.bump as ShipBump]),
							),
						},
				this.recovery,
			);
			return true;
		} catch (error) {
			this.refusal = refusalOf(
				`The ship of ${this.project} did not start`,
				error,
			);
			return false;
		} finally {
			this.starting = false;
			this.changed();
		}
	}

	private changed(): void {
		this.dispatcher.dispatch("changed");
	}
}
