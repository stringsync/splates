import type { ConversationState } from "@stringsync/splates-server/conversations";
import { switched } from "@stringsync/splates-server/conversations/browser";
import { switchAutoPick } from "./conversation-api";
import { useExpect } from "./expecting";
import type { Refuse } from "./refusal";

/**
 * Whether Auto pick chooses a conversation's model and effort, and the
 * switch for it, which the composer's settings show: a switch atop the
 * settings sheet, and atop the model's dropdown where they sit inline.
 */
export interface AutoPickControl {
	on: boolean;
	switch: (on: boolean) => void;
	/** What it chooses, as the sheet's switch says; the model and effort when not given. */
	chooses?: string;
}

/**
 * Auto pick's switch for `conversation`, shown on at once and said refused
 * by `refuse` should the server not take it.
 */
export function useAutoPick(
	conversation: Pick<ConversationState, "id" | "autoPick">,
	refuse: Refuse,
): AutoPickControl {
	const expect = useExpect();
	const { id, autoPick } = conversation;
	const on = autoPick !== null && !autoPick.overridden;
	return {
		on,
		switch: (next) => {
			void expect(
				id,
				(state) => ({ ...state, autoPick: switched(state, next) }),
				switchAutoPick(id, next),
			).catch((error: unknown) =>
				refuse(next ? "Auto pick not on" : "Auto pick not off", error),
			);
		},
	};
}
