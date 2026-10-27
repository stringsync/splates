import type { ConversationState } from "@stringsync/splates-server/conversations";
import type { JSX } from "react";
import { useAutoPick } from "./auto-pick-switch";
import { useChooseSetting } from "./choose-setting";
import type { Refuse } from "./refusal";
import { SettingControls } from "./setting-controls";
import { ContextMeter, compactionsIn } from "./usage";

/**
 * The row of controls in a conversation's composer: unless it is
 * archived, how full its context is and its
 * agent's settings.
 */
export function ThreadControls({
	conversation,
	refused,
}: {
	conversation: ConversationState;
	refused: Refuse;
}): JSX.Element {
	const choose = useChooseSetting(conversation.id, refused);
	const autoPick = useAutoPick(conversation, refused);
	return (
		<>
			{!conversation.archived && (
				<>
					<ContextMeter
						usage={conversation.usage}
						compactions={compactionsIn(conversation.messages)}
					/>
					<SettingControls
						agent={conversation.agent}
						autoPick={autoPick}
						settings={conversation.settings}
						current={(setting) => setting.current}
						onChange={choose}
					/>
				</>
			)}
		</>
	);
}
