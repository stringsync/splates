import type { Conversation, Conversations } from "./conversations";
import type { Served } from "./dev-project";
import type { Projects } from "./projects";

/**
 * The conversations of every project `arbor dev` serves, so a conversation
 * that handed out a task in another project than its own hears of, and
 * answers for, the agent it handed it to, as it would one in its own.
 */
export class Everywhere {
	/** Only the conversations of the project at `root`, as a server of one has them. */
	static onlyHere(root: string, conversations: Conversations): Everywhere {
		return new Everywhere({
			list: async () =>
				(await conversations.list()).map((conversation) => ({
					conversation,
					root,
				})),
			slug: async (at) => at.split("/").filter(Boolean).at(-1) ?? at,
		});
	}

	/**
	 * The conversations of each project in `served`, by its root, those that
	 * failed to open left out, each named as `projects` names it.
	 */
	static served(
		served: Map<string, Promise<Served>>,
		projects: Projects,
	): Everywhere {
		return new Everywhere({
			list: async () => {
				const all: Placed[] = [];
				for (const settled of await Promise.allSettled(served.values())) {
					if (
						settled.status === "rejected" ||
						settled.value.conversations === null
					) {
						continue;
					}
					const { conversations, root } = settled.value;
					for (const conversation of await conversations.list()) {
						all.push({ conversation, root });
					}
				}
				return all;
			},
			slug: async (root) =>
				(await projects.list()).find((each) => each.root === root)?.slug ??
				root,
		});
	}

	constructor(private readonly placing: Placing) {}

	/** Every conversation of every project served so far, with its project's main tree. */
	list(): Promise<Placed[]> {
		return this.placing.list();
	}

	/** The conversation `id`, of whichever project holds it, or undefined for none. */
	async find(id: string): Promise<Placed | undefined> {
		return (await this.placing.list()).find(
			(each) => each.conversation.id === id,
		);
	}

	/**
	 * How a directive names `task`, of the project at `root`, to a
	 * conversation of the project at `to`: bare in its own, else
	 * `<slug>/<task>`, which `arbor --project <slug>` reaches.
	 */
	async taskNamed(task: string, root: string, to: string): Promise<string> {
		return root === to ? task : `${await this.placing.slug(root)}/${task}`;
	}
}

/** A conversation, and the main tree of the project it is in. */
export interface Placed {
	conversation: Conversation;
	root: string;
}

/** Where `Everywhere` finds the conversations, and the projects' names. */
export interface Placing {
	/** Every conversation of every project served so far. */
	list(): Promise<Placed[]>;
	/** What the registry names the project at `root` by. */
	slug(root: string): Promise<string>;
}
