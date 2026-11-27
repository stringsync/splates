import type { ConversationState } from "@splates/server/conversations";
import { switched } from "@splates/server/conversations/browser";
import { switchAutopick } from "./conversation-api";
import { useExpect } from "./expecting";
import type { Refuse } from "./refusal";

/**
 * Whether Autopick chooses a conversation's model and effort, and the
 * switch for it, which the composer's settings show: a switch atop the
 * settings sheet, and atop the model's dropdown where they sit inline.
 */
export interface AutopickControl {
	on: boolean;
	switch: (on: boolean) => void;
	/** What it chooses, as the sheet's switch says; the model and effort when not given. */
	chooses?: string;
}

/**
 * Autopick's switch for `conversation`, shown on at once and said refused
 * by `refuse` should the server not take it.
 */
export function useAutopick(
	conversation: Pick<ConversationState, "id" | "autoPick">,
	refuse: Refuse,
): AutopickControl {
	const expect = useExpect();
	const { id, autoPick } = conversation;
	const on = autoPick !== null && !autoPick.overridden;
	return {
		on,
		switch: (next) => {
			void expect(
				id,
				(state) => ({ ...state, autoPick: switched(state, next) }),
				switchAutopick(id, next),
			).catch((error: unknown) =>
				refuse(next ? "Autopick not on" : "Autopick not off", error),
			);
		},
	};
}
