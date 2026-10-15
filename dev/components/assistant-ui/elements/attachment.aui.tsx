"use client";

import { ComposerPrimitive } from "@assistant-ui/react";
import { PlusIcon } from "lucide-react";
import type { FC } from "react";
import { TooltipIconButton } from "#dev/components/assistant-ui/elements/tooltip-icon-button.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { useHeld } from "#dev/hooks/use-held.ts";
import {
	useHeldKey,
	useShortcut,
	useShortcutLabel,
} from "#dev/hooks/use-shortcut.ts";
import { cn } from "#dev/lib/utils.ts";

/** Marks each composer's attach button, for ⌥⌘; to find. */
const ATTACH = "aui-composer-add-attachment";
/**
 * Picks files to attach, as its shortcut does, showing its key while ⌥⌘ is
 * held.
 */
export const ComposerAddAttachment: FC = () => {
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
						"text-muted-foreground hover:text-foreground size-7 rounded-full pointer-coarse:size-10",
					)}
					aria-label="Attach files"
				/>
			}
		>
			{held && key !== null ? (
				<Kbd aria-hidden>{key}</Kbd>
			) : (
				<PlusIcon className="aui-attachment-add-icon size-4" />
			)}
		</ComposerPrimitive.AddAttachment>
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
