import type { ConversationHost, Lift } from "./host";
import type { Message } from "./state";

/**
 * Lets Auto pick look again at what the person says in `messages`, in a
 * conversation it started, before the agent reads them; one that fails
 * moves nothing.
 */
export async function lifted(
	lift: Lift | null | undefined,
	host: ConversationHost,
	messages: readonly Message[],
): Promise<void> {
	const said = messages.filter((each) => each.told === undefined);
	if (lift == null || said.length === 0 || host.state.autoPick === null) {
		return;
	}
	await lift(host, said).catch(() => {});
}
