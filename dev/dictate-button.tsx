import { ComposerPrimitive, useAuiState } from "@assistant-ui/react";
import { useReactive } from "@webappwiz/react";
import { MicIcon, MicOffIcon, SquareIcon } from "lucide-react";
import { useContext } from "react";
import { TooltipIconButton } from "#dev/components/assistant-ui/elements/tooltip-icon-button.tsx";
import { Kbd } from "#dev/components/ui/kbd.tsx";
import { useHeld } from "#dev/hooks/use-held.ts";
import {
	useHeldKey,
	useShortcut,
	useShortcutLabel,
} from "#dev/hooks/use-shortcut.ts";
import { cn } from "#dev/lib/utils.ts";
import type { BoxDictation } from "./box-dictation";
import type { Dictation, DictationPhase } from "./dictation";
import { DictationContext } from "./dictation-context";

/** What the mic button does in each phase, as a tooltip and a screen reader say it. */
const ACTIONS: Record<DictationPhase, string> = {
	idle: "Dictate",
	asking: "Cancel dictation",
	denied: "Dictate",
	opening: "Cancel dictation",
	recording: "Stop dictation",
	finishing: "Transcribing",
	failed: "Dictate",
};

const SIZE = "size-7 rounded-md pointer-coarse:size-11";

/** Marks each composer's mic, whichever way it toggles, for ⌥⌘V to find. */
const MIC = "aui-composer-mic";

/** Start a take, or stop and transcribe it without sending the draft. */
export function DictateButton() {
	const dictation = useContext(DictationContext);
	return dictation === null ? null : <Mic dictation={dictation} />;
}

function Mic({ dictation }: { dictation: Dictation }) {
	const phase = useReactive(dictation, (each) => each.state.phase, ["changed"]);
	const dictating = useAuiState((state) => state.composer.dictation != null);
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
					variant="default"
					size="icon"
					data-phase={phase}
					aria-pressed={true}
					disabled={phase === "finishing"}
					className={cn(
						MIC,
						"aui-composer-stop-dictation dictate relative transition-colors duration-200",
						SIZE,
					)}
					aria-label={ACTIONS[phase]}
				/>
			}
		>
			<SquareIcon className="fill-current" />
		</ComposerPrimitive.StopDictation>
	);
}

/**
 * The composer's mic for a box of its own, such as a card's answer: it looks
 * and toggles as the composer's does, showing the phase of the last take
 * only when that take was this box's.
 */
export function BoxMic({ box }: { box: BoxDictation }) {
	const taking = useReactive(box, (each) => each.taking, ["changed"]);
	const phase = useReactive(
		box.dictation,
		(each) => (each.owner === box.by ? each.state.phase : "idle"),
		["changed"],
	);
	const held = useHeld();
	const key = useHeldKey("shortcuts.dictate");
	const shortcut = useShortcutLabel("shortcuts.dictate");
	const action = ACTIONS[phase];
	const live = taking && phase !== "denied" && phase !== "failed";
	return (
		<TooltipIconButton
			tooltip={shortcut === null ? action : `${action} (${shortcut})`}
			side="bottom"
			type="button"
			variant={live ? "default" : "ghost"}
			size="icon"
			data-phase={live ? phase : undefined}
			aria-pressed={live}
			disabled={phase === "finishing"}
			aria-label={action}
			onClick={() => (live ? box.stop() : box.start())}
			className={cn(
				MIC,
				live
					? "dictate relative transition-colors duration-200"
					: "text-muted-foreground hover:text-foreground",
				SIZE,
			)}
		>
			{held && key !== null && !live ? (
				<Kbd aria-hidden>{key}</Kbd>
			) : live ? (
				<SquareIcon className="fill-current" />
			) : phase === "denied" ? (
				<MicOffIcon className="size-4 pointer-coarse:size-5" />
			) : (
				<MicIcon className="size-4 pointer-coarse:size-5" />
			)}
		</TooltipIconButton>
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
