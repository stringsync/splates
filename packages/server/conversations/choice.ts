import type { AgentConnection } from "../agents";
import { fail } from "../exit";
import type { ConversationHost } from "./host";
import { type Setting, switched } from "./state";

/**
 * Applies a validated choice to the session and its log: the person's, or,
 * `byAutoPick`, Auto pick's own. Picking a model or effort yourself switches
 * Auto pick off for the conversation, so it never moves what you chose.
 */
export async function choose(
	host: ConversationHost,
	connection: AgentConnection,
	id: string,
	value: string,
	byAutoPick = false,
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
	const aspect = overridden(setting);
	if (aspect !== null && !byAutoPick) {
		host.personChose = true;
	}
	if (host.state.assigned && aspect !== null && !byAutoPick) {
		host.log.write({
			kind: "override",
			setting: id,
			aspect,
			value,
			at: new Date().toISOString(),
		});
	}
	if (aspect !== null && !byAutoPick) {
		const { autoPick } = host.state;
		if (autoPick !== null && !autoPick.overridden) {
			host.log.write({
				kind: "auto-pick-switch",
				on: false,
				at: new Date().toISOString(),
			});
			host.set({ autoPick: switched(host.state, false) });
		}
	}
	const settings = await connection.choose(setting, value);
	host.log.write({ kind: "settings", settings });
	host.set({ settings });
}

/** Whether `setting` is the model or the effort, the two Auto pick chooses. */
function overridden(setting: Setting): "model" | "effort" | null {
	if (setting.category === "model" || setting.id === "model") {
		return "model";
	}
	return setting.category === "thought_level" || setting.id === "effort"
		? "effort"
		: null;
}
