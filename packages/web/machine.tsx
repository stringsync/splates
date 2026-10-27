import { type JSX, useEffect, useRef, useState } from "react";
import { WindowBackgroundObserver } from "webappwiz/browser";
import { Duration, SystemTimer } from "webappwiz/time";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { cn } from "#web/lib/utils.ts";
import { type MachineStatus, machine } from "./api";
import { STATUS_PILL } from "./status-pill";

/** How often the page asks how the machine is doing, while in front. */
const EVERY = Duration.secs(5);

/** How often a run card waiting on its answer asks, to be decided on live. */
const LIVE = Duration.secs(1);

/** How old a live reading may be and still be shown as live. */
const FRESH = Duration.secs(3);

/** CPU and memory shares, and degrees, past which each is yellow, then red. */
const SHARE = { warning: 0.8, destructive: 0.9 };
const DEGREES = { warning: 80, destructive: 95 };

/**
 * The machine's reading, asked every few seconds while the page is in front,
 * or null before the first and while the server does not answer.
 */
export function useMachine(): MachineStatus | null {
	const [reading, setReading] = useState<MachineStatus | null>(null);
	useAsking(EVERY, setReading);
	return reading;
}

/** A reading, and when it came, as epoch ms. */
export type TimedReading = { reading: MachineStatus; at: number };

/**
 * The machine's reading, asked every second while `live` and the page is
 * in front, and not at all otherwise. A failed ask keeps the last, whose `at`
 * then shows its age; null before the first.
 */
export function useLiveMachine(live: boolean): TimedReading | null {
	const [last, setLast] = useState<TimedReading | null>(null);
	useAsking(live ? LIVE : null, (reading) => {
		if (reading !== null) {
			setLast({ reading, at: Date.now() });
		}
	});
	return last;
}

/**
 * Asks for the machine's reading `every` while in front, answering null on
 * failure; never while `every` is null.
 */
function useAsking(
	every: Duration | null,
	answer: (reading: MachineStatus | null) => void,
): void {
	const answered = useRef(answer);
	answered.current = answer;
	useEffect(() => {
		if (every === null) {
			return;
		}
		const observer = new WindowBackgroundObserver();
		const ask = () => {
			if (!observer.isBackgrounded()) {
				machine().then(
					(reading) => answered.current(reading),
					() => answered.current(null),
				);
			}
		};
		ask();
		// Back in front, at once, rather than up to a tick late.
		observer.events.on("change", ask);
		addEventListener(ASK_NOW, ask);
		const tick = new SystemTimer().setInterval(ask, every);
		return () => {
			tick.dispose();
			observer.dispose();
			removeEventListener(ASK_NOW, ask);
		};
	}, [every?.ms, every]);
}

/** The window event that has every reading of the machine asked again at once. */
const ASK_NOW = "splates:machine";

/**
 * Asks for the machine's reading again at once, as after an action that
 * changes what it says, rather than up to a tick later.
 */
export function askMachineNow(): void {
	dispatchEvent(new Event(ASK_NOW));
}

/**
 * Whether the machine is working hard enough that agents may slow down: CPU
 * or memory red, or the hottest sensor red.
 */
export function strained(reading: MachineStatus): boolean {
	return (
		toneOf(reading.cpu, SHARE) === "destructive" ||
		toneOf(reading.memory, SHARE) === "destructive" ||
		(reading.temperature !== null &&
			toneOf(reading.temperature, DEGREES) === "destructive")
	);
}

/**
 * The machine's CPU, memory and, where it can be read, temperature, as bars
 * yellow from 80% and red from 90%, splates' own part of CPU and memory in
 * blue, with dashes for no reading. Give `at` and `now` to have a reading
 * older than a few seconds say how old.
 */
export function MachineStats({
	reading,
	at,
	now,
	className,
}: {
	reading: MachineStatus | null;
	at?: number;
	now?: number;
	className?: string;
}): JSX.Element {
	const kind = reading?.kind ?? "machine";
	const age =
		at === undefined || now === undefined ? null : Math.max(0, now - at);
	return (
		<section
			aria-label={`This ${kind}`}
			className={cn("flex flex-col gap-1.5 text-sm tabular-nums", className)}
		>
			<h3 className="flex justify-between font-medium text-muted-foreground text-xs">
				This {kind}
				{age !== null && age >= FRESH.ms && (
					<span className="font-normal">{secondsAgo(age)}</span>
				)}
			</h3>
			<ul className="grid grid-cols-[4rem_1fr_2.5rem] gap-x-2 gap-y-1.5">
				{reading === null ? (
					<>
						<Meter name="CPU" share={0} tone={null} shown="-" />
						<Meter name="Memory" share={0} tone={null} shown="-" />
					</>
				) : (
					<Readings reading={reading} />
				)}
			</ul>
		</section>
	);
}

function Readings({ reading }: { reading: MachineStatus }): JSX.Element {
	const { cpu, memory, temperature, splates } = reading;
	return (
		<>
			<Meter
				name="CPU"
				share={cpu}
				ours={splates?.cpu}
				tone={toneOf(cpu, SHARE)}
				shown={`${Math.round(cpu * 100)}%`}
			/>
			<Meter
				name="Memory"
				share={memory}
				ours={splates?.memory}
				tone={toneOf(memory, SHARE)}
				shown={`${Math.round(memory * 100)}%`}
			/>
			{temperature !== null && (
				<Meter
					name="Temp"
					// Of the hottest a CPU runs before throttling hard.
					share={temperature / 105}
					tone={toneOf(temperature, DEGREES)}
					shown={`${Math.round(temperature)}°`}
				/>
			)}
			{splates !== null && (
				<li
					aria-label="splates"
					className="col-span-full flex items-center gap-1.5 text-muted-foreground text-xs"
				>
					<span aria-hidden className="size-1.5 rounded-full bg-info" />
					splates {Math.round(splates.cpu * 100)}% CPU,{" "}
					{gigabytes(splates.bytes)}
				</li>
			)}
		</>
	);
}

/** Bytes as gigabytes, to a tenth: `4.8 GB`. */
function gigabytes(bytes: number): string {
	return `${(bytes / 2 ** 30).toFixed(1)} GB`;
}

/** How old a reading is: `4s ago`, `3m ago`. */
function secondsAgo(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ago`;
}

/** A bar of `share`, its first `ours` of it splates' own, when given. */
function Meter({
	name,
	share,
	ours,
	tone,
	shown,
}: {
	name: string;
	share: number;
	ours?: number;
	tone: Tone;
	shown: string;
}): JSX.Element {
	return (
		<li
			aria-label={name}
			className="col-span-full grid grid-cols-subgrid items-center"
		>
			<span>{name}</span>
			<span
				aria-hidden
				className="relative h-1 overflow-hidden rounded-full bg-foreground/15"
			>
				<span
					className={cn(
						"absolute inset-y-0 left-0 rounded-full bg-foreground",
						tone === "warning" && "bg-warning",
						tone === "destructive" && "bg-destructive",
					)}
					style={{ width: `${Math.min(share, 1) * 100}%` }}
				/>
				{ours !== undefined && (
					<span
						className="absolute inset-y-0 left-0 rounded-full bg-info"
						style={{ width: `${Math.min(ours, share, 1) * 100}%` }}
					/>
				)}
			</span>
			<span
				className={cn(
					"text-right",
					tone === "warning" && "text-warning",
					tone === "destructive" && "text-destructive",
				)}
			>
				{shown}
			</span>
		</li>
	);
}

/**
 * "Mac busy" in the header while the machine is strained, and nothing
 * otherwise, as Offline is silent while connected; tapped, the numbers.
 */
export function MachineBadge({
	reading,
}: {
	reading: MachineStatus | null;
}): JSX.Element | null {
	if (reading === null || !strained(reading)) {
		return null;
	}
	return (
		<Popover>
			<PopoverTrigger
				role="status"
				className={`${STATUS_PILL} border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400`}
			>
				<span className="size-1.5 rounded-full bg-amber-500" />
				{reading.kind} busy
			</PopoverTrigger>
			<PopoverContent align="start" className="w-64">
				<MachineStats reading={reading} />
				<p className="text-muted-foreground text-xs">
					Load {reading.load.toFixed(1)} on {reading.cores} cores. Agents may
					run slowly.
				</p>
			</PopoverContent>
		</Popover>
	);
}

type Tone = "warning" | "destructive" | null;

function toneOf(value: number, at: typeof SHARE): Tone {
	return value >= at.destructive
		? "destructive"
		: value >= at.warning
			? "warning"
			: null;
}
