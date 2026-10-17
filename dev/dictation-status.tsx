import { useReactive } from "@webappwiz/react";
import { XIcon } from "lucide-react";
import {
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Device } from "webappwiz/browser";
import { TICK } from "webappwiz/dictate";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import { COMPOSER, type Dictation, type DictationPhase } from "./dictation";
import { DictationContext } from "./dictation-context";

/**
 * What the mic is doing, in words, so no state rests on color or motion
 * alone, each a word or two so it fits beside the controls on a phone.
 */
const WORDS: Partial<Record<DictationPhase, string>> = {
	asking: "Starting",
	opening: "Starting",
	recording: "Recording",
	finishing: "Transcribing",
};

/** What the status says while the open mic hears nothing. */
const SILENT = "Can't hear you";

/**
 * Says what the mic is doing, in the composer's action row while a take is
 * under way: waiting on the mic, recording, or that it hears nothing. Null otherwise, leaving the row to its own controls.
 */
export function DictationStatus({ expanded = false }: { expanded?: boolean }) {
	const dictation = useContext(DictationContext);
	return dictation === null ? null : (
		<Status dictation={dictation} expanded={expanded} />
	);
}

function Status({
	dictation,
	expanded,
}: {
	dictation: Dictation;
	expanded: boolean;
}) {
	const phase = useReactive(dictation, (each) => each.state.phase, ["changed"]);
	const silent = useReactive(dictation, (each) => each.state.silent, [
		"changed",
	]);
	const levels = useReactive(dictation, (each) => each.state.levels, [
		"changed",
	]);
	const level = useReactive(dictation, (each) => each.state.level, ["changed"]);
	const words = WORDS[phase];
	if (words === undefined) {
		return null;
	}
	return (
		<div
			className={cn(
				"dictation-status text-muted-foreground relative flex min-w-0 items-center justify-center gap-2 px-1.5 text-sm",
				expanded && "static h-7 flex-1 pointer-coarse:h-11",
			)}
			data-phase={phase}
		>
			{phase === "recording" && (
				<>
					<span
						aria-hidden="true"
						className="dictation-level bg-foreground size-2 shrink-0 rounded-full transition-opacity duration-75 motion-reduce:transition-none"
						style={{ opacity: 0.2 + Math.sqrt(level) * 0.8 }}
					/>
					<Waveform levels={levels} expanded={expanded} />
				</>
			)}
			<span
				aria-live="polite"
				className={cn(
					"truncate",
					expanded &&
						phase !== "recording" &&
						"pointer-events-none absolute inset-x-0 text-center",
					phase === "recording" && silent && "absolute inset-x-0 text-center",
					phase === "recording" && !silent
						? "sr-only"
						: phase !== "recording" && "shimmer motion-reduce:animate-none",
				)}
			>
				{phase === "recording" && silent ? (
					<span className="bg-background/90 rounded px-2 text-amber-600 dark:text-amber-400">
						{SILENT}
					</span>
				) : (
					words
				)}
			</span>
		</div>
	);
}

/** A dotted strip with fixed-size bars: new audio enters at the right. */
function Waveform({
	levels,
	expanded,
}: {
	levels: readonly number[];
	expanded: boolean;
}) {
	const strip = useRef<SVGSVGElement>(null);
	const bars = useRef<SVGPathElement>(null);
	const [width, setWidth] = useState(160);
	useEffect(() => {
		const element = strip.current;
		if (element === null) {
			return;
		}
		const measure = () =>
			setWidth(Math.max(1, element.getBoundingClientRect().width));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	// Keep the same bars moving between the mic's 100 ms ticks instead of
	// jumping six pixels each time. The newest bar enters from offscreen.
	useLayoutEffect(() => {
		const element = bars.current;
		if (element === null || levels.length === 0) {
			return;
		}
		const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
		if (reduced.matches) {
			element.removeAttribute("transform");
			return;
		}
		const start = performance.now();
		let frame = 0;
		const move = () => {
			const progress = Math.min(1, (performance.now() - start) / TICK.ms);
			element.setAttribute("transform", `translate(${6 * (1 - progress)} 0)`);
			if (progress < 1) {
				frame = requestAnimationFrame(move);
			}
		};
		move();
		return () => cancelAnimationFrame(frame);
	}, [levels]);
	const count = Math.ceil(width / 6) + 1;
	const heard = levels.slice(-count);
	const path = Array.from({ length: count }, (_, index) => {
		const level = heard[index - (count - heard.length)] ?? 0;
		const position = width - (count - index) * 6 + 3;
		const height = Math.max(0.01, Math.sqrt(level) * 12);
		return `M${position},${14 - height}V${14 + height}`;
	}).join(" ");
	return (
		<svg
			ref={strip}
			aria-hidden="true"
			className={cn(
				"dictation-waveform h-7 min-w-0 overflow-hidden opacity-70",
				expanded ? "w-full" : "w-32",
			)}
			viewBox={`0 0 ${width} 28`}
		>
			<path
				ref={bars}
				d={path}
				stroke="currentColor"
				strokeWidth="2.5"
				strokeLinecap="round"
			/>
		</svg>
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
				className="text-muted-foreground size-6 pointer-coarse:size-10 shrink-0 rounded-full"
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
