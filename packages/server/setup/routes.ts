import { fail } from "../exit";
import { body, refuse } from "../server/shared";
import { KeptReads } from "./kept-reads";
import type { Setup, StepAnswers } from "./setup";
import { StepProblem } from "./step-problem";

/**
 * Read this machine's setup and do its steps from the page. Give each handler
 * to `dev`'s routes; the project a request names picks the repository steps.
 */
export class SetupRoutes {
	readonly #setupFor: (request: Request) => Promise<Setup>;

	readonly #reads = new KeptReads<unknown>(READ_KEPT_MS);

	constructor(setupFor: (request: Request) => Promise<Setup>) {
		this.#setupFor = setupFor;
	}

	/** Every step checked, by area, and the one to do next. */
	readonly read = async (request: Request): Promise<Response> => {
		const key = new URL(request.url).searchParams.get("project") ?? "";
		return Response.json(
			await this.#reads.get(key, async () =>
				(await this.#setupFor(request)).read(),
			),
		);
	};

	/** Marks setup seen, so the page stops nudging towards it. */
	readonly see = async (request: Request): Promise<Response> => {
		const setup = await this.#setupFor(request);
		await setup.see();
		this.#reads.clear();
		return Response.json(await setup.read());
	};

	/**
	 * Does what the step `/api/setup/:step/next` names needs with the
	 * answers its page sends, answering the fresh progress, or a 422 whose
	 * message is the one line the page shows under its fields.
	 */
	readonly next = async (request: Request): Promise<Response> => {
		const step = idOf(request);
		const { answers = {} } = await body(request);
		if (!isAnswers(answers)) {
			fail(
				"usage",
				"send the page's answers: { answers: { [field]: string | boolean } }",
				{
					step,
				},
			);
		}
		this.#reads.clear();
		try {
			return Response.json(
				await (await this.#setupFor(request)).submit(step, answers),
			);
		} catch (error) {
			if (error instanceof StepProblem) {
				return refuse(422, "step", error.message);
			}
			throw error;
		}
	};

	/**
	 * What undoing the area `/api/setup/:area/undo` names would do, for its
	 * page to ask before it goes.
	 */
	readonly undoPlan = async (request: Request): Promise<Response> =>
		Response.json(
			await (await this.#setupFor(request)).undoPlan(idOf(request)),
		);

	/**
	 * Undoes that area, `{ confirm }` the name its plan asks to be typed,
	 * answering the fresh progress, or a 422 whose message the page shows.
	 */
	readonly undo = async (request: Request): Promise<Response> => {
		const area = idOf(request);
		const { confirm = null } = await body(request);
		if (confirm !== null && typeof confirm !== "string") {
			fail("usage", "send { confirm: string } or nothing", { area });
		}
		this.#reads.clear();
		try {
			return Response.json(
				await (await this.#setupFor(request)).undo(area, confirm),
			);
		} catch (error) {
			if (error instanceof StepProblem) {
				return refuse(422, "undo", error.message);
			}
			throw error;
		}
	};
}

/** How long a read of the setup progress answers the next ones. */
const READ_KEPT_MS = 10_000;

/** The area or step `/api/setup/:id/...` names, by its id. */
function idOf(request: Request): string {
	return decodeURIComponent(new URL(request.url).pathname.split("/")[3] ?? "");
}

function isAnswers(value: unknown): value is StepAnswers {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.values(value).every(
			(each) => typeof each === "string" || typeof each === "boolean",
		)
	);
}
