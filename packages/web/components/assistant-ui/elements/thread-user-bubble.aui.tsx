import {
	MessagePrimitive,
	type TextMessagePartComponent,
} from "@assistant-ui/react";
import type { FC } from "react";
import { cn } from "#web/lib/utils.ts";
import { Markdown } from "#web/markdown.tsx";

/**
 * What the person said, across the thread's full width like the reply: the
 * theme's muted fill, set apart from the page, with room at its end for the
 * copy button. On a phone, a chat bubble instead: as wide as its words up
 * to most of the thread, at its end, rounded and unbordered, the copy
 * button below it.
 */
export const USER_BUBBLE =
	"text-foreground bg-muted rounded-lg border border-foreground/15 ps-4 pe-9 py-2.5 max-sm:rounded-3xl max-sm:border-0 max-sm:px-5 max-sm:py-3 max-sm:leading-relaxed min-w-0 max-w-full wrap-anywhere";

export const RecordedUserMessage: FC = () => (
	<MessagePrimitive.Root
		data-slot="aui_user-message-root"
		data-role="user"
		className="flex justify-end"
	>
		<div
			className={cn(
				USER_BUBBLE,
				"max-w-[85%] rounded-2xl border-0 px-3.5 py-2 max-sm:px-3.5 max-sm:py-2 leading-relaxed",
			)}
		>
			<MessagePrimitive.Parts components={{ Text: RecordedUserText }} />
		</div>
	</MessagePrimitive.Root>
);

const RecordedUserText: TextMessagePartComponent = ({ text }) => (
	<Markdown text={text} className="whitespace-pre-wrap" />
);
