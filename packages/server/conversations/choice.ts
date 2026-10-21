import type { AgentConnection } from "../agents";
import { fail } from "../exit";
import type { ConversationHost } from "./host";
import type { Setting } from "./state";

/**
 * Applies a validated choice to the session and its log: the person's, or,
 * `byAutoPick`, Auto pick's own, which overrides nothing.
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
	const { autoPick } = host.state;
	if (aspect !== null && !byAutoPick && !host.state.assigned) {
		// Auto pick switched on by the person: their own pick switches it off.
		if (autoPick !== null && !autoPick.overridden) {
			host.state.autoPick = { ...autoPick, overridden: true };
			host.log.write({
				kind: "auto-pick-switch",
				on: false,
				at: new Date().toISOString(),
			});
		}
	}
	if (host.state.assigned && aspect !== null && !byAutoPick) {
		if (autoPick !== null) {
			host.state.autoPick = { ...autoPick, overridden: true };
		}
		host.log.write({
			kind: "override",
			setting: id,
			aspect,
			value,
			at: new Date().toISOString(),
		});
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
