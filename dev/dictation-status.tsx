import { useReactive } from "@webappwiz/react";
import { XIcon } from "lucide-react";
import { useContext, useMemo } from "react";
import { Device } from "webappwiz/browser";
import { Button } from "#dev/components/ui/button.tsx";
import { COMPOSER, type Dictation, type DictationPhase } from "./dictation";
import { DictationContext } from "./dictation-context";

/**
 * What the mic is doing, in words, so no state rests on color or motion
 * alone, each a word or two so it fits beside the controls on a phone.
 */
const WORDS: Partial<Record<DictationPhase, string>> = {
	asking: "Allow mic",
	opening: "Starting…",
	recording: "Recording",
	finishing: "Finishing…",
};

/** What the status says while the open mic hears nothing. */
const SILENT = "Can't hear you";

/**
 * Says what the mic is doing, in the composer's action row while a take is
 * under way: waiting on the mic, recording, or that it hears nothing. Null otherwise, leaving the row to its own controls.
 */
export function DictationStatus() {
	const dictation = useContext(DictationContext);
	return dictation === null ? null : <Status dictation={dictation} />;
}

function Status({ dictation }: { dictation: Dictation }) {
	const phase = useReactive(dictation, (each) => each.state.phase, ["changed"]);
	const silent = useReactive(dictation, (each) => each.state.silent, [
		"changed",
	]);
	const words = WORDS[phase];
	if (words === undefined) {
		return null;
	}
	return (
		<div
			className="dictation-status text-muted-foreground flex min-w-0 items-center gap-2 px-1.5 text-sm"
			data-phase={phase}
		>
			{phase === "recording" && (
				<span
					aria-hidden="true"
					className="dictation-dot bg-destructive size-2 shrink-0 rounded-full"
				/>
			)}
			<span aria-live="polite" className="truncate">
				{phase === "recording" && silent ? (
					<span className="text-amber-600 dark:text-amber-400">{SILENT}</span>
				) : (
					words
				)}
			</span>
		</div>
	);
}

/**
 * What went wrong with the last take, above the composer's action row until
 * the next one or a dismiss, in the box `by` names that took it: a blocked
 * mic with how to allow it on this device, a missing key with where to add
 * it, a take stopped on its own.
 */
export function DictationNotice({ by = COMPOSER }: { by?: string }) {
	const dictation = useContext(DictationContext);
	return dictation === null ? null : <Notice dictation={dictation} by={by} />;
}

function Notice({ dictation, by }: { dictation: Dictation; by: string }) {
	const phase = useReactive(dictation, (each) => each.state.phase, ["changed"]);
	const error = useReactive(dictation, (each) => each.state.error, ["changed"]);
	const cred = useReactive(dictation, (each) => each.state.cred, ["changed"]);
	const owner = useReactive(dictation, (each) => each.owner, ["changed"]);
	// Only the box that took it says what went wrong.
	if (error === undefined || owner !== by) {
		return null;
	}
	return (
		<div
			role="alert"
			className="dictation-notice flex items-start gap-2 px-2.5 text-sm text-amber-700 dark:text-amber-400"
		>
			<div className="min-w-0 flex-1">
				<p>
					{error}{" "}
					{cred !== undefined && (
						<a href="#creds" className="underline underline-offset-2">
							Add it on Creds
						</a>
					)}
				</p>
				{phase === "denied" && <AllowMic />}
			</div>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="text-muted-foreground size-6 shrink-0 rounded-full"
				aria-label="Dismiss"
				onClick={() => dictation.dismiss()}
			>
				<XIcon className="size-3.5" />
			</Button>
		</div>
	);
}

/** How to unblock the mic on the device the page is open on. */
function AllowMic() {
	const os = useMemo(
		() =>
			Device.parse(navigator.userAgent, {
				touchPoints: navigator.maxTouchPoints,
			}).os,
		[],
	);
	return (
		<p className="text-muted-foreground mt-1">
			{os === "ios"
				? "In Safari, tap aA in the address bar, then Website Settings, and set Microphone to Allow. Then reload."
				: os === "android"
					? "In Chrome, tap the icon left of the address, then Permissions, and turn on Microphone. Then reload."
					: "Click the icon left of the address, allow the microphone, then reload."}
		</p>
	);
}
