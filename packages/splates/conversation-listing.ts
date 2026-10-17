import type { Conversations } from "./conversations";
import { modelsOf } from "./roster";

/** The conversations and saved agent defaults offered to the page. */
export async function listing(all: Conversations) {
	const offered = await all.settings();
	const limits = await all.limits();
	return {
		agents: all.agents.map((each) => ({
			id: each.id,
			name: each.name,
			models: modelsOf(each).map(({ id, name }) => ({ id, name })),
			settings: offered[each.id] ?? [],
			limits: limits[each.id] ?? [],
		})),
		conversations: (await all.list()).map((each) => each.state),
	};
}
