import type { Resource } from "core/disposable";
import type { Conversations } from "../conversations";
import { EvalCardWatch } from "./eval-card-watch";
import type { Project } from "./project";
import type { DevContext } from "./project-types";

/** The watches that send an agent back a card its person could not act on: run-evals. */
export function cardWatches(
	project: Project,
	conversations: Conversations,
	context: Pick<DevContext, "evalCards">,
): Resource {
	const watches: Resource[] = [];
	if (context.evalCards !== undefined) {
		watches.push(new EvalCardWatch(project, conversations, context.evalCards));
	}
	return {
		dispose: () => {
			for (const each of watches) {
				each.dispose();
			}
		},
	};
}
