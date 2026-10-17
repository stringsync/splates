"use client";

import { ComposerPrimitive, useAuiState } from "@assistant-ui/react";
import { useReactive } from "@webappwiz/react";
import { PlusIcon, XIcon } from "lucide-react";
import { type FC, useContext } from "react";
import { TooltipIconButton } from "#dev/components/assistant-ui/elements/tooltip-icon-button.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import type { Dictation } from "#dev/dictation.ts";
import { DictationContext } from "#dev/dictation-context.ts";
import { useHeld } from "#dev/hooks/use-held.ts";
import {
	useHeldKey,
	useShortcut,
	useShortcutLabel,
} from "#dev/hooks/use-shortcut.ts";
import { cn } from "#dev/lib/utils.ts";

/** Marks each composer's attach button, for ⌥⌘; to find. */
export const ATTACH = "aui-composer-add-attachment";
/**
 * Picks files to attach, as its shortcut does, showing its key while ⌥⌘ is
 * held.
 */
export const ComposerAddAttachment: FC = () => {
	const dictation = useContext(DictationContext);
	const taking = useAuiState((state) => state.composer.dictation != null);
	return taking && dictation !== null ? (
		<DictationAttachment dictation={dictation} />
	) : (
		<AttachFiles />
	);
};

/**
 * Its shortcut, ⌥⌘; unless set otherwise, picks files to attach in the
 * composer being written in, or else the first one showing. Once per page,
 * so one press opens one picker.
 */
export function useAttachKey(): void {
	useShortcut("shortcuts.attach", () => {
		const shown = [
			...document.querySelectorAll<HTMLButtonElement>(`.${ATTACH}`),
		].filter((each) => each.getClientRects().length > 0);
		const focused = document.activeElement?.closest("form");
		const button = shown.find((each) => focused?.contains(each)) ?? shown[0];
		button?.click();
		return button !== undefined;
	});
}

/** The attachment slot discards a take until transcription has been requested. */
function DictationAttachment({ dictation }: { dictation: Dictation }) {
	const phase = useReactive(dictation, (each) => each.state.phase, ["changed"]);
	return phase === "finishing" ? (
		<AttachFiles />
	) : (
		<TooltipIconButton
			tooltip="Discard dictation"
			side="bottom"
			type="button"
			variant="ghost"
			size="icon"
			className="size-7 rounded-full pointer-coarse:size-11"
			aria-label="Discard dictation"
			onClick={() => dictation.cancel()}
		>
			<XIcon aria-hidden="true" />
		</TooltipIconButton>
	);
}

function AttachFiles() {
	const held = useHeld();
	const shortcut = useShortcutLabel("shortcuts.attach");
	const key = useHeldKey("shortcuts.attach");
	return (
		<ComposerPrimitive.AddAttachment
			render={
				<TooltipIconButton
					tooltip={
						shortcut === null ? "Attach files" : `Attach files (${shortcut})`
					}
					side="bottom"
					variant="ghost"
					size="icon"
					className={cn(
						ATTACH,
						"text-muted-foreground hover:text-foreground size-7 rounded-full pointer-coarse:size-11",
					)}
					aria-label="Attach files"
				/>
			}
		>
			{held && key !== null ? (
				<Kbd aria-hidden>{key}</Kbd>
			) : (
				<PlusIcon className="aui-attachment-add-icon size-4 pointer-coarse:size-5" />
			)}
		</ComposerPrimitive.AddAttachment>
	);
}
