import {
	MessagePrimitive,
	type ToolCallMessagePartComponent,
	type TriggerAdapter,
} from "@assistant-ui/react";
import {
	type ComponentType,
	createContext,
	type PropsWithChildren,
	type ReactNode,
} from "react";
import { AssistantMessage } from "#dev/components/assistant-ui/elements/thread-assistant-message.aui.tsx";
import { ToolFallback } from "#dev/components/assistant-ui/elements/tool-fallback.aui.tsx";
import type { References } from "#dev/references.tsx";

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;
/**
 * Optional component overrides for the thread. `AssistantMessage` and
 * `Welcome` replace whole sections; the remaining slots override how the
 * assistant message renders tool calls and part groups. Tool UIs registered
 * by name (toolkit `render`, `useAssistantDataUI`) take precedence over
 * `ToolFallback`. When `TaskGroup` is set, tool calls that carry a nested
 * conversation and have no registered UI render through it instead of the
 * tool group; without it they render like any other tool call.
 */
export type ThreadComponents = {
	AssistantMessage?: ComponentType | undefined;
	Welcome?: ComponentType | undefined;
	ToolFallback?: ToolCallMessagePartComponent | undefined;
	ToolGroup?:
		| ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
		| undefined;
	ReasoningGroup?:
		| ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
		| undefined;
	TaskGroup?: ComponentType<{ group: ThreadGroupPart }> | undefined;
};
export type ThreadProps = {
	components?: ThreadComponents | undefined;
	autoFocus?: boolean | undefined;
	/** Shown just above the composer, such as what the agent is asking. */
	above?: ReactNode | undefined;
	/** Shown in place of the greeting while the thread is empty. */
	welcome?: ReactNode | undefined;
	/** Shown under the composer while the thread is empty, so it never moves the composer. */
	below?: ReactNode | undefined;
	/** In the composer's bottom row, before its buttons: the session's pickers. */
	controls?: ReactNode | undefined;
	/** What `@` offers in the composer; nothing when unset. */
	mentions?: TriggerAdapter | undefined;
	/** What `#` offers in the composer; nothing when unset. */
	references?: References | undefined;
	/** What `/` offers at the start of a message; nothing when unset. */
	commands?: TriggerAdapter | undefined;
	/** The empty composer's hint, such as why it takes nothing. */
	placeholder?: string | undefined;
	/** Shown in place of the composer, as where the page sends nothing. */
	composer?: ReactNode | undefined;
	/** The id of the message to open at, rather than the bottom. */
	openAt?: string | undefined;
	/**
	 * Whether the composer stays along the bottom while the thread is empty
	 * too, the greeting centered above it, as a phone's chat apps have it,
	 * rather than under the greeting.
	 */
	docked?: boolean | undefined;
};
export const ThreadExtrasContext = createContext<
	Pick<
		ThreadProps,
		| "above"
		| "welcome"
		| "below"
		| "controls"
		| "mentions"
		| "references"
		| "commands"
		| "placeholder"
		| "composer"
	>
>({});
export const EMPTY_COMPONENTS: ThreadComponents = {};
export const ThreadComponentsContext =
	createContext<ThreadComponents>(EMPTY_COMPONENTS);
