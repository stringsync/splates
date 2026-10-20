import type { AutomationRow } from "@stringsync/splates-server/hooks";
import { GROOMER_AUTOMATION } from "@stringsync/splates-server/hooks/browser";
import type { AgentPick } from "@stringsync/splates-server/models";
import { Dispatcher } from "webappwiz/events";
import {
	automations,
	groomAutomation,
	pauseAutomation,
} from "./automations-api";
import { refusalOf } from "./refusal";

/** The board's grooming action, including choosing an agent on its first use. */
export class BoardGroomer {
	private readonly dispatcher = new Dispatcher<{ changed: undefined }>();
	readonly events = this.dispatcher.events;
	picking = false;
	pending = false;
	refusal: string | null = null;

	constructor(
		private readonly api = {
			read: automations,
			resume: (): Promise<AutomationRow[]> =>
				pauseAutomation(GROOMER_AUTOMATION, false),
			groom: groomAutomation,
		},
	) {}

	async start(): Promise<void> {
		if (this.pending) {
			return;
		}
		await this.run(async () => {
			const configured = (await this.api.read()).some(
				(row) => row.id === GROOMER_AUTOMATION,
			);
			if (configured) {
				await this.api.resume();
			} else {
				this.picking = true;
			}
		});
	}

	async choose(pick: AgentPick): Promise<void> {
		this.picking = false;
		await this.run(() => this.api.groom(pick));
	}

	setPicking(picking: boolean): void {
		this.picking = picking;
		this.dispatcher.dispatch("changed");
	}

	private async run(action: () => Promise<unknown>): Promise<void> {
		this.pending = true;
		this.refusal = null;
		this.dispatcher.dispatch("changed");
		try {
			await action();
		} catch (error) {
			this.refusal = refusalOf("Grooming not started", error);
		} finally {
			this.pending = false;
			this.dispatcher.dispatch("changed");
		}
	}
}
