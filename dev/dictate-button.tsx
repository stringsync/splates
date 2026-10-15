import { ComposerPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { useReactive } from "@webappwiz/react";
import { MicIcon, MicOffIcon } from "lucide-react";
import { useContext, useEffect } from "react";
import { TooltipIconButton } from "#dev/components/assistant-ui/elements/tooltip-icon-button.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { useHeld } from "#dev/hooks/use-held.ts";
import {
	useHeldKey,
	useShortcut,
	useShortcutLabel,
} from "#dev/hooks/use-shortcut.ts";
import { cn } from "#dev/lib/utils.ts";
import type { Dictation, DictationPhase } from "./dictation";
import { DictationContext } from "./dictation-context";

/** What the mic button does in each phase, as a tooltip and a screen reader say it. */
const ACTIONS: Record<DictationPhase, string> = {
	idle: "Dictate",
	asking: "Cancel dictation",
	denied: "Dictate",
	opening: "Cancel dictation",
	recording: "Stop dictation",
	finishing: "Finishing dictation",
	failed: "Dictate",
};

const SIZE = "size-7 rounded-md pointer-coarse:size-11";

/** Marks each composer's mic, whichever way it toggles, for ⌥⌘V to find. */
const MIC = "aui-composer-mic";

/** How the button looks in each phase of a take under way. */
const LOOKS: Partial<Record<DictationPhase, string>> = {
	// Waiting, on the browser's prompt or on the mic: the mic breathes.
	asking: "text-foreground",
	opening: "text-foreground",
	// Hearing, then waiting on the final text: a still red mic on a red tint,
	// never a square, which is stop-generating's alone; the blinking dot in
	// DictationStatus says it is live.
	recording:
		"bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive",
	finishing: "bg-destructive/10 text-destructive",
};

/**
 * The composer's mic, always beside Send: an icon-only mic to start, showing
 * its key while ⌥⌘ is held, and pressed on a red tint while it hears you and
 * while the final text comes. Waiting on the browser's prompt or the mic, the
 * glyph itself breathes, so nothing crowds it off center.
 * Every state also has its words, beside it in {@link DictationStatus}.
 */
export function DictateButton() {
	const dictation = useContext(DictationContext);
	return dictation === null ? null : <Mic dictation={dictation} />;
}

function Mic({ dictation }: { dictation: Dictation }) {
	const phase = useReactive(dictation, (each) => each.state.phase, ["changed"]);
	const dictating = useAuiState((state) => state.composer.dictation != null);
	useEdits(dictation);
	const held = useHeld();
	const key = useHeldKey("shortcuts.dictate");
	const shortcut = useShortcutLabel("shortcuts.dictate");
	const tooltip = (action: string) =>
		shortcut === null ? action : `${action} (${shortcut})`;
	if (!dictating || phase === "denied" || phase === "failed") {
		return (
			<ComposerPrimitive.Dictate
				render={
					<TooltipIconButton
						tooltip={tooltip(ACTIONS[phase])}
						side="bottom"
						type="button"
						variant="ghost"
						size="icon"
						aria-pressed={false}
						className={cn(
							MIC,
							"aui-composer-dictate text-muted-foreground hover:text-foreground",
							SIZE,
						)}
						aria-label={ACTIONS[phase]}
					/>
				}
			>
				{held && key !== null ? (
					<Kbd aria-hidden>{key}</Kbd>
				) : phase === "denied" ? (
					<MicOffIcon className="size-4 pointer-coarse:size-5" />
				) : (
					<MicIcon className="size-4 pointer-coarse:size-5" />
				)}
			</ComposerPrimitive.Dictate>
		);
	}
	return (
		<ComposerPrimitive.StopDictation
			render={
				<TooltipIconButton
					tooltip={tooltip(ACTIONS[phase])}
					side="bottom"
					type="button"
					variant="ghost"
					size="icon"
					data-phase={phase}
					aria-pressed={true}
					aria-disabled={phase === "finishing"}
					className={cn(
						MIC,
						"aui-composer-stop-dictation dictate relative transition-colors duration-200",
						SIZE,
						LOOKS[phase],
					)}
					aria-label={ACTIONS[phase]}
				/>
			}
		>
			<MicIcon className="size-4 pointer-coarse:size-5" />
		</ComposerPrimitive.StopDictation>
	);
}

/**
 * Tells the take under way when the person edits its draft. The composer
 * takes the edited draft as the base the take writes after, dropping the
 * rough text it showed, so a take whose rough text is gone was edited.
 */
function useEdits(dictation: Dictation): void {
	const aui = useAui();
	useEffect(
		() =>
			aui.subscribe(() => {
				const take = aui.composer.getState().dictation;
				if (take != null && take.transcript === undefined) {
					dictation.edited();
				}
			}),
		[aui, dictation],
	);
}

/**
 * Its shortcut, ⌥⌘V unless set otherwise, starts or stops a take in the
 * composer being written in, or else the first one showing. Once per page,
 * so one press toggles one mic.
 */
export function useDictateKey(): void {
	useShortcut("shortcuts.dictate", () => {
		const shown = [
			...document.querySelectorAll<HTMLButtonElement>(`.${MIC}`),
		].filter((each) => each.getClientRects().length > 0);
		const focused = document.activeElement?.closest("form");
		const button = shown.find((each) => focused?.contains(each)) ?? shown[0];
		button?.click();
		return button !== undefined;
	});
}
