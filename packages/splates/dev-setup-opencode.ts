import { refuse } from "./dev-http";
import type { OpenCodeSetup } from "./setup-opencode";
import { OpenCodeModelError } from "./setup-opencode-model-error";
import type { OpenCodeSelection } from "./setup-opencode-models";

/**
 * What the OpenCode journey's done page does beyond the Setup steps:
 * start a conversation on the saved models, or take the recipe off the
 * roster.
 */
export class OpenCodeSetupRoutes {
	constructor(readonly setup: OpenCodeSetup) {}

	/**
	 * Checks the saved recipe again in the project's `cwd`, then hands its
	 * main model to `start`, which opens the conversation.
	 */
	async conversation(
		cwd: string,
		start: (selection: OpenCodeSelection) => Promise<Response>,
	): Promise<Response> {
		let selection: OpenCodeSelection;
		try {
			selection = await this.setup.verify(cwd);
		} catch (error) {
			return refuse(400, "setup", problemOf(error));
		}
		return start(selection);
	}

	readonly disable = async (): Promise<Response> => {
		try {
			await this.setup.disable();
			return Response.json({});
		} catch {
			return refuse(
				400,
				"setup",
				"Could not turn OpenCode off: the roster's OpenCode entry was changed by hand, so Setup leaves it alone.",
			);
		}
	};
}

function problemOf(error: unknown): string {
	return error instanceof OpenCodeModelError || error instanceof Error
		? error.message
		: "OpenCode could not check the saved models.";
}
