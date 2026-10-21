import type { Setting } from "@stringsync/splates-server/conversations";
import { chooseSetting } from "./conversation-api";
import { useExpect } from "./expecting";
import type { Refuse } from "./refusal";

/**
 * Switches `setting` of conversation `id` to `value`, shown at once as the one
 * entry of its settings the server will change, and said refused by `refuse`.
 */
export function useChooseSetting(
	id: string,
	refuse: Refuse,
): (setting: Setting, value: string) => Promise<void> {
	const expect = useExpect();
	return (setting, value) =>
		expect(
			id,
			(state) => ({
				...state,
				settings: state.settings.map((each) =>
					each.id === setting.id ? { ...each, current: value } : each,
				),
				// The person's own model or effort switches Auto pick off.
				autoPick:
					state.autoPick !== null && picksFor(setting)
						? { ...state.autoPick, overridden: true }
						: state.autoPick,
			}),
			chooseSetting(id, setting.id, value),
		).catch((error: unknown) => refuse(`${setting.name} not switched`, error));
}

/** Whether `setting` is one Auto pick chooses: the model or the effort. */
export function picksFor(setting: Setting): boolean {
	return (
		setting.category === "model" ||
		setting.id === "model" ||
		setting.category === "thought_level" ||
		setting.id === "effort"
	);
}
