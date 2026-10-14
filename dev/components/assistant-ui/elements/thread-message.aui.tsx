"use client";

import {
	ActionBarPrimitive,
	AuiIf,
	ComposerPrimitive,
	MessagePrimitive,
	type TextMessagePartComponent,
	useAuiState,
} from "@assistant-ui/react";
import {
	AudioLinesIcon,
	CheckIcon,
	CopyIcon,
	MicIcon,
	PhoneIcon,
} from "lucide-react";
import { type FC, useContext } from "react";
import { AssistantMessage } from "#dev/components/assistant-ui/elements/thread-assistant-message.aui.tsx";
import { ThreadComponentsContext } from "#dev/components/assistant-ui/elements/thread-context.aui.ts";
import { UserMessage } from "#dev/components/assistant-ui/elements/thread-user-message.aui.tsx";
import { TooltipIconButton } from "#dev/components/assistant-ui/elements/tooltip-icon-button.tsx";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";

export const ThreadMessage: FC = () => {
	const { AssistantMessage: AssistantMessageComponent = AssistantMessage } =
		useContext(ThreadComponentsContext);
	const role = useAuiState((s) => s.message.role);
	const isEditing = useAuiState((s) => s.message.composer.isEditing);
	const isSpoken = useAuiState((s) => s.message.metadata.modality === "voice");

	if (isEditing) {
		return <EditComposer />;
	}
	if (isSpoken) {
		return <SpokenMessage />;
	}
	if (role === "user") {
		return <UserMessage />;
	}
	return <AssistantMessageComponent />;
};
type VoiceRunPosition = "single" | "start" | "middle" | "end";
const useVoiceRunPosition = (): VoiceRunPosition =>
	useAuiState((s) => {
		const before =
			s.thread.messages[s.message.index - 1]?.metadata.modality === "voice";
		const after =
			s.thread.messages[s.message.index + 1]?.metadata.modality === "voice";
		if (before) {
			return after ? "middle" : "end";
		}
		return after ? "start" : "single";
	});
const SpokenText: TextMessagePartComponent = ({ text }) => (
	<p className="aui-spoken-message-text m-0">{text}</p>
);
const SpokenMessage: FC = () => {
	const role = useAuiState((s) => s.message.role);
	const position = useVoiceRunPosition();
	const isSpeaking = useAuiState(
		(s) =>
			s.message.role === "assistant" && s.message.status?.type === "running",
	);
	const opensExchange = position === "start" || position === "single";

	return (
		<MessagePrimitive.Root
			data-slot="aui_spoken-message-root"
			data-role={role}
			data-voice-run={position}
			className={cn(
				"aui-spoken-message bg-muted/40 mx-2 px-3 py-1.5 [contain-intrinsic-size:auto_48px] [content-visibility:auto]",
				position === "single" && "rounded-xl py-2",
				position === "start" && "rounded-t-xl pt-2",
				position === "middle" && "-mt-6",
				position === "end" && "-mt-6 rounded-b-xl pb-2",
			)}
		>
			{opensExchange && (
				<div
					data-slot="aui_spoken-exchange-header"
					className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-xs"
				>
					<PhoneIcon className="size-3" aria-hidden />
					<span>Voice conversation</span>
				</div>
			)}
			<div
				data-slot="aui_spoken-message-content"
				className="text-foreground flex items-start gap-2 text-sm leading-relaxed"
			>
				<span className="text-muted-foreground mt-1 shrink-0" aria-hidden>
					{role === "user" ? (
						<MicIcon className="size-3.5" />
					) : (
						<AudioLinesIcon className="size-3.5" />
					)}
				</span>
				<span className="sr-only">
					{role === "user" ? "You said" : "Assistant said"}
				</span>
				<div className="min-w-0 flex-1 wrap-break-word">
					<MessagePrimitive.Parts components={{ Text: SpokenText }} />
					{isSpeaking && (
						<span
							data-slot="aui_spoken-message-indicator"
							role="status"
							className="text-muted-foreground shimmer ms-1 font-sans motion-reduce:animate-none"
						>
							Speaking
						</span>
					)}
				</div>
				<SpokenActionBar />
			</div>
		</MessagePrimitive.Root>
	);
};
const SpokenActionBar: FC = () => {
	return (
		<ActionBarPrimitive.Root
			hideWhenRunning
			autohide="always"
			className="aui-spoken-action-bar text-muted-foreground flex shrink-0 gap-1"
		>
			<ActionBarPrimitive.Copy
				render={<TooltipIconButton tooltip="Copy" className="size-6" />}
			>
				<AuiIf condition={(s) => s.message.isCopied}>
					<CheckIcon className="animate-in zoom-in-50 fade-in duration-200 ease-out" />
				</AuiIf>
				<AuiIf condition={(s) => !s.message.isCopied}>
					<CopyIcon className="animate-in zoom-in-75 fade-in duration-150" />
				</AuiIf>
			</ActionBarPrimitive.Copy>
		</ActionBarPrimitive.Root>
	);
};
const EditComposer: FC = () => {
	return (
		<MessagePrimitive.Root
			data-slot="aui_edit-composer-wrapper"
			className="flex flex-col px-2 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
		>
			<ComposerPrimitive.Root className="aui-edit-composer-root border-foreground/10 focus-within:border-foreground/25 ms-auto flex w-full max-w-[85%] cursor-text flex-col rounded-(--composer-radius) border bg-(--composer-bg) transition-[border-color]">
				<ComposerPrimitive.Input
					className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none"
					autoFocus
				/>
				<div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
					<ComposerPrimitive.Cancel
						render={<Button variant="ghost" size="sm" className="h-8 px-3" />}
					>
						Cancel
					</ComposerPrimitive.Cancel>
					<ComposerPrimitive.Send
						render={<Button size="sm" className="h-8 px-3" />}
					>
						Update
					</ComposerPrimitive.Send>
				</div>
			</ComposerPrimitive.Root>
		</MessagePrimitive.Root>
	);
};
