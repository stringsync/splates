import { body, refuse } from "./dev-http";
import { fail } from "./exit";
import type { Setup, StepAnswers } from "./setup";
import { StepProblem } from "./setup-step-problem";

/**
 * How the page reads this machine's setup and does its steps. Not any
 * project's: every page on the server shares one machine. Each handler is a
 * property, so `dev` hands them straight to its routes.
 */
export class SetupRoutes {
	readonly #setup: Setup;

	constructor(setup: Setup) {
		this.#setup = setup;
	}

	/** Every step checked, by area, and the one to do next. */
	readonly read = async (): Promise<Response> =>
		Response.json(await this.#setup.read());

	/** Marks setup seen, so the page stops nudging towards it. */
	readonly see = async (): Promise<Response> => {
		await this.#setup.see();
		return Response.json(await this.#setup.read());
	};

	/**
	 * Does what the step `/api/setup/:step/next` names needs with the
	 * answers its page sends, answering the fresh progress, or a 422 whose
	 * message is the one line the page shows under its fields.
	 */
	readonly next = async (request: Request): Promise<Response> => {
		const step = decodeURIComponent(
			new URL(request.url).pathname.split("/")[3] ?? "",
		);
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
		try {
			return Response.json(await this.#setup.submit(step, answers));
		} catch (error) {
			if (error instanceof StepProblem) {
				return refuse(422, "step", error.message);
			}
			throw error;
		}
	};
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
