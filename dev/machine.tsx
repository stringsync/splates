import { type JSX, useEffect, useState } from "react";
import { WindowBackgroundObserver } from "webappwiz/browser";
import { Duration, SystemTimer } from "webappwiz/time";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "#dev/components/ui/popover.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { MachineReading } from "../machine";
import { machine } from "./api";

/** How often the page asks how the machine is doing, while in front. */
const EVERY = Duration.secs(5);

/** CPU and memory shares, and degrees, past which each is yellow, then red. */
const SHARE = { warning: 0.8, destructive: 0.9 };
const DEGREES = { warning: 80, destructive: 95 };

/**
 * The machine's reading, asked every few seconds while the page is in front,
 * or null before the first and while the server does not answer.
 */
export function useMachine(): MachineReading | null {
	const [reading, setReading] = useState<MachineReading | null>(null);
	useEffect(() => {
		const observer = new WindowBackgroundObserver();
		const ask = () => {
			if (!observer.isBackgrounded()) {
				machine().then(setReading, () => setReading(null));
			}
		};
		ask();
		// Back in front, at once, rather than up to a tick late.
		observer.events.on("change", ask);
		const tick = new SystemTimer().setInterval(ask, EVERY);
		return () => {
			tick.dispose();
			observer.dispose();
		};
	}, []);
	return reading;
}

/**
 * Whether the machine is working hard enough that agents may slow down: CPU
 * or memory red, or the hottest sensor red.
 */
export function strained(reading: MachineReading): boolean {
	return (
		toneOf(reading.cpu, SHARE) === "destructive" ||
		toneOf(reading.memory, SHARE) === "destructive" ||
		(reading.temperature !== null &&
			toneOf(reading.temperature, DEGREES) === "destructive")
	);
}

/**
 * The machine's CPU, memory and, where it can be read, temperature, as bars
 * the way Plan limits draws them: yellow from 80%, red from 90%.
 */
export function MachineStats({
	reading,
	className,
}: {
	reading: MachineReading;
	className?: string;
}): JSX.Element {
	const { cpu, memory, temperature } = reading;
	return (
		<section
			aria-label={`This ${reading.kind}`}
			className={cn("flex flex-col gap-1.5 text-sm tabular-nums", className)}
		>
			<h3 className="font-medium text-muted-foreground text-xs">
				This {reading.kind}
			</h3>
			<ul className="grid grid-cols-[4rem_1fr_2.5rem] gap-x-2 gap-y-1.5">
				<Meter
					name="CPU"
					share={cpu}
					tone={toneOf(cpu, SHARE)}
					shown={`${Math.round(cpu * 100)}%`}
				/>
				<Meter
					name="Memory"
					share={memory}
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
			</ul>
		</section>
	);
}

function Meter({
	name,
	share,
	tone,
	shown,
}: {
	name: string;
	share: number;
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
	reading: MachineReading | null;
}): JSX.Element | null {
	if (reading === null || !strained(reading)) {
		return null;
	}
	return (
		<Popover>
			<PopoverTrigger
				role="status"
				className="flex shrink-0 items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-medium text-[11px] text-amber-600 leading-none dark:text-amber-400"
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
