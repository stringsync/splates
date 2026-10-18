import { z } from "zod";
import { body, refuse } from "../dev-http";
import type { Scheduler } from "../scheduler";
import {
	type RaiseOffer,
	span,
	WORKER_LIMITS,
	type WorkerBudget,
	type WorkerRaise,
	type WorkerStanding,
} from "./budget";

/** Where the worker budget stands, as `/api/worker-budget` answers and `splates budget` prints. */
export interface WorkerBudgetReport {
	standing: WorkerStanding[];
	raises: WorkerRaise[];
	/** What made workers running now cost an hour together. */
	rate: number;
	/** Why made workers are stopped, the day's or month's limit reached; null while they may run. */
	stopped: string | null;
	/** Why no worker is made for the queue, as the queue says it; null when nothing holds it. */
	holding: string | null;
	/** What one click raises to start a worker for the held queue, and what it buys; null when nothing is held. */
	offer: RaiseOffer | null;
}

/** What `PUT /api/worker-budget/:limit` is sent: dollars, or null for the default. */
const SetLimit = z.object({ dollars: z.number().min(0).nullable() });

/** What `POST /api/worker-budget/raises` is sent. */
const AddRaise = z.object({
	limit: z.enum(WORKER_LIMITS),
	dollars: z.number().min(0),
	/** Like `1d`; a day when unset. */
	for: z.string().optional(),
});

/**
 * The routes the worker budget is read and changed through, by the page
 * and `splates budget`; each answers with a `WorkerBudgetReport`. Without a
 * `workerProvider` there is no budget, and each refuses saying so.
 */
export class WorkerBudgetRoutes {
	constructor(
		private readonly budget: WorkerBudget | null,
		private readonly scheduler: Scheduler,
		private readonly provisioning: {
			offer(): RaiseOffer | null;
			refill(): Promise<void>;
		} | null = null,
	) {}

	/** `GET /api/worker-budget`. */
	readonly show = async (): Promise<Response> =>
		this.answer(() => Promise.resolve());

	/** `PUT /api/worker-budget/:limit`: sets a limit, or with null gives it back to its default. */
	readonly set = async (request: Request): Promise<Response> => {
		const limit = z
			.enum(WORKER_LIMITS)
			.safeParse(new URL(request.url).pathname.split("/")[3]);
		const parsed = SetLimit.safeParse(await body(request));
		if (!limit.success || !parsed.success) {
			return refuse(
				400,
				"usage",
				"set hour, day or month to dollars, like { dollars: 5 }, or null for its default",
			);
		}
		return this.answer((budget) => budget.set(limit.data, parsed.data.dollars));
	};

	/** `POST /api/worker-budget/raises`: adds dollars to a limit for a while. */
	readonly raise = async (request: Request): Promise<Response> => {
		const parsed = AddRaise.safeParse(await body(request));
		if (!parsed.success) {
			return refuse(
				400,
				"usage",
				'raise hour, day or month by dollars, like { limit: "day", dollars: 2, for: "1d" }',
			);
		}
		const { limit, dollars, for: lasting } = parsed.data;
		let duration: ReturnType<typeof span> | undefined;
		try {
			duration = lasting === undefined ? undefined : span(lasting);
		} catch (error) {
			return refuse(400, "usage", (error as Error).message);
		}
		return this.answer(async (budget) => {
			await budget.raise(limit, dollars, duration);
		});
	};

	/** `DELETE /api/worker-budget/raises/:id`: ends a raise now. */
	readonly endRaise = async (request: Request): Promise<Response> => {
		const id = new URL(request.url).pathname.split("/")[4] ?? "";
		if (!/^\d+$/.test(id)) {
			return refuse(
				400,
				"usage",
				`no raise ${id}: a raise is named by its number`,
			);
		}
		const budget = this.budget;
		if (budget !== null && !(await budget.endRaise(Number(id)))) {
			return refuse(404, "not_found", `no raise ${id}`);
		}
		return this.answer(() => Promise.resolve());
	};

	/** The report, after `change`; refused without a budget. */
	private async answer(
		change: (budget: WorkerBudget) => Promise<void>,
	): Promise<Response> {
		const { budget } = this;
		if (budget === null) {
			return refuse(
				400,
				"usage",
				"no worker budget: splates makes no workers until `splates.config.ts` names a `workerProvider`",
			);
		}
		try {
			await change(budget);
			await this.provisioning?.refill();
		} catch (error) {
			return refuse(400, "usage", (error as Error).message);
		}
		return Response.json(
			workerBudgetReport(
				budget,
				this.scheduler,
				this.provisioning?.offer() ?? null,
			),
		);
	}
}

/** Where `budget` stands, with what holds `scheduler`'s queue. */
export function workerBudgetReport(
	budget: WorkerBudget,
	scheduler: Scheduler,
	offer: RaiseOffer | null = null,
): WorkerBudgetReport {
	return {
		standing: budget.standing(),
		raises: budget.raises,
		rate: budget.rate(),
		stopped: budget.stopped(),
		holding: scheduler.withheldReason(),
		offer: scheduler.withheldReason() === null ? null : offer,
	};
}
