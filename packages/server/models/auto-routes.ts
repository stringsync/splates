import type { Conversations } from "../conversations";
import { treeOf } from "../dev-conversation-tree";
import { body } from "../dev-http";
import type { Project } from "../dev-project";
import { fail } from "../exit";
import { startAuto } from "./auto-start";

/**
 * How a project's page starts a conversation on what Auto picks. Each
 * handler is a property, so `serveProject` spreads them into the project's
 * routes, as it does `ConversationRoutes`'.
 */
export class AutoRoutes {
	readonly #project: Project;
	readonly #conversations: Conversations | null;

	constructor(project: Project, conversations: Conversations | null) {
		this.#project = project;
		this.#conversations = conversations;
	}

	/**
	 * Starts a conversation on what Auto picks for `prompt`, the first prompt,
	 * which the page sends once it is up, as for any start: it answers before
	 * Auto has picked, and that prompt waits on the pick.
	 */
	readonly startAutoConversation = async (
		request: Request,
	): Promise<Response> => {
		const conversations = this.#conversations;
		if (conversations === null) {
			fail("not_found", "conversations are off", {});
		}
		const { task, prompt } = await body(request);
		const [named, cwd, base, caller] = await treeOf(
			this.#project.service,
			task,
		);
		const conversation = await startAuto({
			project: this.#project,
			conversations,
			prompt: String(prompt ?? ""),
			task: named,
			// No pick of the person's, so the next start does not take its
			// settings, though the next can start on Auto again.
			start: (agent, { model, settings, picking }) =>
				conversations.start(agent, {
					task: named,
					base,
					caller,
					cwd,
					model,
					settings,
					assigned: true,
					auto: true,
					picking,
				}),
		});
		return Response.json(conversation.state);
	};
}
