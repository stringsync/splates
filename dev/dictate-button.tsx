import { ComposerPrimitive, useAuiState } from "@assistant-ui/react";
import { useReactive } from "@webappwiz/react";
import { MicIcon, MicOffIcon, SquareIcon } from "lucide-react";
import { useContext } from "react";
import { TooltipIconButton } from "#dev/components/assistant-ui/elements/tooltip-icon-button.tsx";
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

const SIZE = "size-7 rounded-md pointer-coarse:size-9";

/** How the button looks in each phase of a take under way. */
const LOOKS: Partial<Record<DictationPhase, string>> = {
	// Waiting, on the browser's prompt or on the mic: the mic breathes.
	asking: "text-foreground",
	opening: "text-foreground",
	// Hearing, then waiting on the final text: a still red stop on a red tint;
	// the blinking dot in DictationStatus says it is live.
	recording:
		"bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive",
	finishing: "bg-destructive/10 text-destructive",
};

/**
 * The composer's mic, in Send's place while the message is empty: an
 * icon-only mic to start, and a still red stop while it hears you and while
 * the final text comes. Waiting on the browser's prompt or the mic, the glyph
 * itself breathes, so nothing crowds it off center.
 * Every state also has its words, beside it in {@link DictationStatus}.
 */
export function DictateButton() {
	const dictation = useContext(DictationContext);
	return dictation === null ? null : <Mic dictation={dictation} />;
}

function Mic({ dictation }: { dictation: Dictation }) {
	const phase = useReactive(dictation, (each) => each.state.phase, ["changed"]);
	const dictating = useAuiState((state) => state.composer.dictation != null);
	const waiting = phase === "asking" || phase === "opening";
	if (!dictating || phase === "denied" || phase === "failed") {
		return (
			<ComposerPrimitive.Dictate
				render={
					<TooltipIconButton
						tooltip={ACTIONS[phase]}
						side="bottom"
						type="button"
						variant="ghost"
						size="icon"
						className={cn(
							"aui-composer-dictate text-muted-foreground hover:text-foreground",
							SIZE,
						)}
						aria-label={ACTIONS[phase]}
					/>
				}
			>
				{phase === "denied" ? (
					<MicOffIcon className="size-4" />
				) : (
					<MicIcon className="size-4" />
				)}
			</ComposerPrimitive.Dictate>
		);
	}
	return (
		<ComposerPrimitive.StopDictation
			render={
				<TooltipIconButton
					tooltip={ACTIONS[phase]}
					side="bottom"
					type="button"
					variant="ghost"
					size="icon"
					data-phase={phase}
					aria-disabled={phase === "finishing"}
					className={cn(
						"aui-composer-stop-dictation dictate relative transition-colors duration-200",
						SIZE,
						LOOKS[phase],
					)}
					aria-label={ACTIONS[phase]}
				/>
			}
		>
			{waiting ? (
				<MicIcon className="size-4" />
			) : (
				<SquareIcon className="size-3 fill-current" />
			)}
		</ComposerPrimitive.StopDictation>
	);
}
