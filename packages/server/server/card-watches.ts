import type { Resource } from "core/disposable";
import type { Conversations } from "../conversations";
import type { ShipComposer } from "../ship";
import { EvalCardWatch } from "./eval-card-watch";
import type { Project } from "./project";
import type { DevContext } from "./project-types";
import { ShipCardWatch } from "./ship-card-watch";

/** The watches that send an agent back a card its person could not act on: ship and run-evals. */
export function cardWatches(
	project: Project,
	conversations: Conversations,
	composer: ShipComposer,
	context: Pick<DevContext, "evalCards">,
): Resource {
	const watches: Resource[] = [
		new ShipCardWatch(project, conversations, composer),
	];
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
