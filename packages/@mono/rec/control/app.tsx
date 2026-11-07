import { ReactiveExternalStore, useExternalStore } from "core/react";
import { Duration, SystemTimer, SystemWallClock } from "core/time";
import {
	AlertTriangle,
	Check,
	Circle,
	Copy,
	Highlighter,
	Laser,
	Mic,
	MicOff,
	MousePointerClick,
	RotateCw,
	Square,
	StickyNote,
	Timer,
	type Wifi,
	WifiOff,
	X,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { Capture, PanelState, SignalItem } from "./capture";
import { Button } from "./components/ui/button";
import { Empty, EmptyDescription, EmptyHeader } from "./components/ui/empty";
import { Kbd } from "./components/ui/kbd";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "./components/ui/tooltip";
import { cn } from "./lib/utils";

const wall = new SystemWallClock();
const timer = new SystemTimer();

/** The control panel: events above, and the timer, mic, laser and Start or Stop in a bar along the bottom. */
export function App({ capture }: { capture: Capture }) {
	const store = useMemo(
		() =>
			new ReactiveExternalStore(capture, (source) => source.state, ["change"]),
		[capture],
	);
	const state = useExternalStore(store);
	const recording = state.phase === "recording";
	return (
		<TooltipProvider>
			<div className="flex h-full flex-col">
				<div className="flex shrink-0 items-center gap-1 border-b py-1.5 pr-1.5 pl-3">
					<span
						className="min-w-0 flex-1 truncate font-mono text-sm"
						title={state.name}
					>
						{state.name ?? "Connecting…"}
					</span>
					{state.name ? <CopyNameButton name={state.name} /> : null}
				</div>
				{state.signals.length > 0 ? (
					<ul className="flex-1 divide-y overflow-y-auto">
						{state.signals.map((item) => (
							<SignalRow
								key={item.id}
								item={item}
								startedAt={state.startedAt}
							/>
						))}
					</ul>
				) : (
					<Empty className="flex-1">
						<EmptyHeader>
							<EmptyDescription>
								{recording
									? "Events will show up here as rec notices them."
									: "Events will show up here while you record."}
							</EmptyDescription>
						</EmptyHeader>
					</Empty>
				)}
				{state.status && (
					<p
						className="truncate px-4 pb-2 text-xs text-muted-foreground"
						title={state.status}
					>
						{state.status}
					</p>
				)}
				<SaveResult state={state} />
				<div className="flex items-center gap-2 border-t px-3 py-3">
					<Clock state={state} />
					<MicIndicator state={state} capture={capture} />
					<LaserIndicator state={state} />
					{recording || state.phase === "starting" ? (
						<Button
							className="ml-auto rounded-full"
							variant="secondary"
							disabled={!recording}
							onClick={() => void capture.stop()}
						>
							<Square className="size-3 fill-destructive text-destructive" />
							Stop
						</Button>
					) : (
						<Button
							className="ml-auto rounded-full"
							variant="destructive"
							onClick={() => capture.start()}
						>
							<Circle className="size-3 fill-current" />
							Start
						</Button>
					)}
				</div>
			</div>
		</TooltipProvider>
	);
}

/** Copies the recording's name to the clipboard, showing a check for a moment. */
function CopyNameButton({ name }: { name: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) {
			return;
		}
		const id = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(id);
	}, [copied]);
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					size="icon-sm"
					variant="ghost"
					aria-label="Copy name"
					onClick={() => {
						navigator.clipboard.writeText(name).then(() => setCopied(true));
					}}
				>
					{copied ? <Check /> : <Copy />}
				</Button>
			</TooltipTrigger>
			<TooltipContent>{copied ? "Copied" : "Copy name"}</TooltipContent>
		</Tooltip>
	);
}

/** Where the last recording was saved, or why it was not, each with a way to copy it. */
function SaveResult({ state }: { state: PanelState }) {
	const [copied, setCopied] = useState(false);
	const failed = state.saveFailed !== undefined;
	const text = state.saveFailed ?? state.saved;
	if (text === undefined) {
		return null;
	}
	return (
		<div className="mx-3 mb-3 rounded-md bg-secondary px-3 py-2 text-xs">
			<div className="flex items-center gap-2">
				{failed ? (
					<X className="size-4 shrink-0 text-destructive" />
				) : (
					<Check className="size-4 shrink-0 text-success" />
				)}
				<span className="flex-1 font-medium">
					{failed ? "Not saved" : "Saved"}
				</span>
				<Button
					size="sm"
					variant="ghost"
					onClick={() => {
						void navigator.clipboard.writeText(text).then(() => {
							setCopied(true);
							timer.setTimeout(() => setCopied(false), Duration.ms(2000));
						});
					}}
				>
					<Copy />
					{copied ? "Copied" : "Copy"}
				</Button>
			</div>
			{/* A break opportunity after each slash keeps a path from splitting mid-word. */}
			<p className="break-words font-mono text-muted-foreground">
				{text.split(/(?<=\/)/).map((part, index) => (
					<Fragment key={index}>
						{index > 0 && <wbr />}
						{part}
					</Fragment>
				))}
			</p>
		</div>
	);
}

/** The recording dot and how long the recording has run. */
function Clock({ state }: { state: PanelState }) {
	const recording = state.phase === "recording";
	const [now, setNow] = useState(() => wall.now());
	useEffect(() => {
		if (!recording) {
			return;
		}
		const tick = timer.setInterval(() => setNow(wall.now()), Duration.ms(250));
		return () => tick.dispose();
	}, [recording]);
	const secs = recording
		? Math.max(0, Math.floor((now - state.startedAt) / 1000))
		: 0;
	return (
		<div className="flex items-center gap-2 pr-1">
			<span
				className={cn(
					"size-2.5 rounded-full bg-muted-foreground/50",
					recording &&
						"bg-destructive shadow-[0_0_0_4px] shadow-destructive/20",
				)}
			/>
			<span
				className={cn(
					"font-mono text-lg tabular-nums",
					!recording && "text-muted-foreground",
				)}
			>
				{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
			</span>
		</div>
	);
}

/** The mic: its level while it is open; red and a way to Settings when it is not. */
function MicIndicator({
	state,
	capture,
}: {
	state: PanelState;
	capture: Capture;
}) {
	if (state.mic === "none") {
		return (
			<div className="flex h-8 items-center gap-1.5 rounded-md bg-secondary px-2.5 text-muted-foreground">
				<MicOff className="size-4" />
				<span className="text-xs">No mic</span>
			</div>
		);
	}
	if (state.mic === "off") {
		return (
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						size="sm"
						variant="ghost"
						className="bg-destructive/10 text-destructive hover:bg-destructive/20 hover:text-destructive"
						onClick={() => capture.openMicSettings()}
					>
						<MicOff />
						Off
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					No microphone: click to allow the microphone
				</TooltipContent>
			</Tooltip>
		);
	}
	const bars = [0.6, 1, 0.75];
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div className="flex h-8 items-center gap-1.5 rounded-md bg-secondary px-2.5 text-foreground">
					<Mic className="size-4" />
					<span className="flex h-3 items-end gap-0.5" aria-hidden>
						{bars.map((share, index) => (
							<span
								key={index}
								className="w-0.5 rounded-full bg-success transition-[height] duration-75"
								style={{
									height: `${Math.max(2, Math.round(Math.min(1, state.level * 2.5 * share) * 12))}px`,
								}}
							/>
						))}
					</span>
				</div>
			</TooltipTrigger>
			<TooltipContent>
				{state.mic === "on" ? "Mic on" : "Opening the mic…"}
			</TooltipContent>
		</Tooltip>
	);
}

/** The laser pointer: lit while Option is held in the page and its trail is drawing. */
function LaserIndicator({ state }: { state: PanelState }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div
					className={cn(
						"flex h-8 items-center gap-1.5 rounded-md bg-secondary px-2 text-muted-foreground transition-colors",
						state.laser && "bg-destructive/15 text-destructive",
					)}
				>
					<Laser className="size-4" />
					<Kbd
						className={cn("bg-transparent", state.laser && "text-destructive")}
					>
						⌥
					</Kbd>
				</div>
			</TooltipTrigger>
			<TooltipContent>Hold Option and drag to point things out</TooltipContent>
		</Tooltip>
	);
}

const TONES = {
	error: { dot: "bg-destructive", icon: WifiOff },
	warn: { dot: "bg-amber-500", icon: AlertTriangle },
	info: { dot: "bg-primary", icon: Highlighter },
} as const;

const KINDS: Record<
	SignalItem["kind"],
	{ tone: keyof typeof TONES; icon: typeof Wifi }
> = {
	mark: { tone: "info", icon: StickyNote },
	highlight: { tone: "info", icon: Highlighter },
	"console-error": { tone: "error", icon: AlertTriangle },
	exception: { tone: "error", icon: AlertTriangle },
	"request-failed": { tone: "error", icon: WifiOff },
	"request-slow": { tone: "warn", icon: Timer },
	"log-error": { tone: "error", icon: AlertTriangle },
	"rage-click": { tone: "warn", icon: MousePointerClick },
	"dead-click": { tone: "warn", icon: MousePointerClick },
	retry: { tone: "warn", icon: RotateCw },
	"page-error": { tone: "error", icon: AlertTriangle },
};

/** One event: its thumbnail, a dot and title, one detail line and the time into the recording. */
function SignalRow({
	item,
	startedAt,
}: {
	item: SignalItem;
	startedAt: number;
}) {
	const { tone, icon: Icon } = KINDS[item.kind];
	const secs = Math.max(0, Math.floor((item.at - startedAt) / 1000));
	return (
		<li className="flex h-16 items-center gap-3 px-3">
			<div className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
				{item.thumbnail ? (
					<img src={item.thumbnail} alt="" className="size-full object-cover" />
				) : (
					<Icon className="size-4 text-muted-foreground" />
				)}
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-1.5">
					<span
						className={cn("size-2 shrink-0 rounded-full", TONES[tone].dot)}
					/>
					<span className="truncate text-sm font-medium">{item.title}</span>
				</div>
				<p
					className="truncate text-xs text-muted-foreground"
					title={item.detail}
				>
					{item.detail}
				</p>
			</div>
			<span className="font-mono text-xs tabular-nums text-muted-foreground">
				{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
			</span>
		</li>
	);
}
