import type { AgentConnection } from "./agent-connection";
import type { ConversationHost } from "./conversation-host";
import { fail } from "./exit";

/** Applies a validated user choice to the session and its log. */
export async function choose(
	host: ConversationHost,
	connection: AgentConnection,
	id: string,
	value: string,
): Promise<void> {
	const setting = host.state.settings.find((each) => each.id === id);
	if (setting === undefined) {
		fail("usage", `conversation ${host.state.id} has no setting '${id}'`, {
			conversation: host.state.id,
		});
	}
	if (!setting.options.some((option) => option.value === value)) {
		fail(
			"usage",
			`'${value}' is not a ${setting.name.toLowerCase()} this agent offers`,
			{ conversation: host.state.id },
		);
	}
	const settings = await connection.choose(setting, value);
	host.log.write({ kind: "settings", settings });
	host.set({ settings });
}
