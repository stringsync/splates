import { startAuto } from "./auto-start";
import type { Conversations } from "./conversations";
import { treeOf } from "./dev-conversation-tree";
import { body } from "./dev-http";
import type { Project } from "./dev-project";
import { fail } from "./exit";

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
	 * which the page sends once it is up, as for any start.
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
			// No pick of the person's, so the next start does not follow it.
			start: (agent, { model, settings }) =>
				conversations.start(agent, {
					task: named,
					base,
					caller,
					cwd,
					model,
					settings,
					assigned: true,
				}),
		});
		return Response.json(conversation.state);
	};
}
