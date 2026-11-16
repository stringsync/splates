import { Dispatcher } from "core/events";
import { answerShip } from "./api/legacy-ship";

/** Sends a question's answer once, allowing retry after a transport error. */
export class ShipQuestionAnswer {
	private readonly dispatcher = new Dispatcher<{ changed: undefined }>();
	readonly events = this.dispatcher.events;
	pending = false;
	error: string | null = null;
	constructor(
		private readonly question: {
			id: string;
			project: string;
			started: string;
			questionId: string;
		},
	) {}
	async send(answer: boolean): Promise<void> {
		if (this.pending) {
			return;
		}
		this.pending = true;
		this.error = null;
		this.dispatcher.dispatch("changed");
		try {
			const { id, project, started, questionId } = this.question;
			await answerShip(id, project, started, questionId, answer);
		} catch (error) {
			this.error = String(error);
			this.pending = false;
			this.dispatcher.dispatch("changed");
		}
	}
}
