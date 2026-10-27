import type { ShipPlan } from "@stringsync/splates-server/ship";
import { Dispatcher, type Eventful } from "webappwiz/events";
import { shipPlan, startShip } from "./api";
import { refusalOf } from "./refusal";

export type ShipApprovalEvents = { changed: undefined };

/** Where an approval asks for the plan and starts the ship. */
export interface ShipServer {
	shipPlan(project: string): Promise<ShipPlan>;
	startShip(project: string): Promise<void>;
}

/**
 * The plan to ship one project, drawn by the server, and the person's
 * Approve of it: the plan once drawn, why there is none or why the ship did
 * not start, and whether it is starting.
 */
export class ShipApproval implements Eventful<ShipApprovalEvents> {
	private readonly dispatcher = new Dispatcher<ShipApprovalEvents>();
	readonly events = this.dispatcher.events;

	/** The plan, or null until it is drawn or when there is none. */
	plan: ShipPlan | null = null;
	/** Why there is no plan, or why the ship did not start; null otherwise. */
	refusal: string | null = null;
	/** Whether Approve waits on the server's answer. */
	starting = false;

	constructor(
		readonly project: string,
		private readonly server: ShipServer = { shipPlan, startShip },
	) {}

	/** Asks the server for the plan, as the dialog opens. */
	async draw(): Promise<void> {
		try {
			this.plan = await this.server.shipPlan(this.project);
		} catch (error) {
			this.refusal = refusalOf(`No plan to ship ${this.project}`, error);
		}
		this.changed();
	}

	/** Starts the ship the plan shows; whether it started. */
	async approve(): Promise<boolean> {
		this.starting = true;
		this.refusal = null;
		this.changed();
		try {
			await this.server.startShip(this.project);
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
