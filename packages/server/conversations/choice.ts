import type { AgentConnection } from "../agents";
import { fail } from "../exit";
import type { ConversationHost } from "./host";
import { type Setting, switched } from "./state";

/**
 * Sets the conversation's setting `id` to `value`, one its agent offers, as
 * the person chose it or, `byAutoPick`, as Auto pick did.
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
	// A model the person picks leaves Auto pick on, moving only the effort
	// from then on. An effort they pick leaves it on too, standing for that
	// turn alone (`personChose`), then judged again from the next message.
	if (aspect === "model" && !byAutoPick) {
		const { autoPick } = host.state;
		if (autoPick !== null && !autoPick.overridden && !autoPick.keepModel) {
			host.log.write({
				kind: "auto-pick-switch",
				on: true,
				keepModel: true as const,
				at: new Date().toISOString(),
			});
			host.set({ autoPick: switched(host.state, true, true) });
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
