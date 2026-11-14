import type { ThreadMessageLike } from "@assistant-ui/react";
import { messageOf, type Unsent } from "./sending";
import { like } from "./thread-messages";

/**
 * The thread's rows for messages the server refused, from `first` on, each
 * carrying its id and why for the line under its bubble.
 */
export function unsentLikes(
	unsent: readonly Unsent[],
	first: number,
	conversation: string,
): ThreadMessageLike[] {
	return unsent.map((each, at) => {
		const liked = like(
			{ ...messageOf(each.message), sending: undefined },
			first + at,
			conversation,
		);
		return {
			...liked,
			metadata: {
				...liked.metadata,
				custom: {
					...liked.metadata?.custom,
					unsent: { id: each.message.id, why: each.why },
				},
			},
		};
	});
}
