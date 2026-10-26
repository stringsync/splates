import type { ConversationState } from "@stringsync/splates-server/conversations";
import { PanelRightIcon } from "lucide-react";
import type { JSX } from "react";
import { useAutoPick } from "./auto-pick-switch";
import { useChooseSetting } from "./choose-setting";
import type { Refuse } from "./refusal";
import { SettingControls } from "./setting-controls";
import { ContextMeter, compactionsIn } from "./usage";

/**
 * The row of controls in a conversation's composer: on a phone its widgets
 * first, then, unless it is archived, how full its context is and its
 * agent's settings.
 */
export function ThreadControls({
	conversation,
	refused,
	widgets,
}: {
	conversation: ConversationState;
	refused: Refuse;
	/** The widgets, on a phone, whose bar has no room for them; null beside a sidebar. */
	widgets: { open: boolean; toggle: () => void } | null;
}): JSX.Element {
	const choose = useChooseSetting(conversation.id, refused);
	const autoPick = useAutoPick(conversation, refused);
	return (
		<>
			{widgets !== null && (
				<WidgetsButton conversation={conversation} widgets={widgets} />
			)}
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

/**
 * A phone's way to a conversation's widgets, first in the composer's row,
 * before its settings, marked while a command it started runs.
 */
function WidgetsButton({
	conversation,
	widgets,
}: {
	conversation: ConversationState;
	widgets: { open: boolean; toggle: () => void };
}): JSX.Element {
	return (
		<button
			type="button"
			aria-label="Widgets"
			title="Widgets"
			aria-expanded={widgets.open}
			onClick={widgets.toggle}
			className="relative inline-flex size-6 pointer-coarse:size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 pointer-coarse:[&_svg]:size-5"
		>
			<PanelRightIcon />
			{running(conversation) && !widgets.open && (
				<span
					aria-hidden
					className="absolute top-0.5 right-0.5 size-1.5 pointer-coarse:top-2 pointer-coarse:right-2 rounded-full bg-success"
				/>
			)}
		</button>
	);
}

function running(conversation: ConversationState): boolean {
	return conversation.background.some((each) => each.state === "running");
}
