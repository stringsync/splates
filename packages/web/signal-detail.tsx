import type { SignalOverview, SignalSubscriber } from "@splates/server/signals";
import {
	ChevronLeftIcon,
	HourglassIcon,
	PencilIcon,
	PlusIcon,
	RadioIcon,
} from "lucide-react";
import { type JSX, useState } from "react";
import { Button, buttonVariants } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { pauseSubscription, stopProbe, stopWait } from "./api/signals";
import { ago, everyOf, timeLeft } from "./signal-of";
import { Raises } from "./signal-raises";
import {
	busiestDay,
	familyOf,
	type RaiseDay,
	raisesPerDay,
	usualRaiser,
} from "./signal-summary";

/**
 * One signal in full: how it stands, its probe and subscribers, its raises
 * per day over the last week, and the raises themselves, each opening to its
 * raw payload.
 */
export function SignalDetail({
	signal,
	checkHref,
	onOpen,
	onChanged,
	className,
}: {
	signal: SignalOverview;
	/** The address of its check's form. */
	checkHref: string;
	/** Opens conversation `id`. */
	onOpen: (id: string) => void;
	onChanged: () => Promise<void>;
	className?: string;
}): JSX.Element {
	const now = Date.now();
	const [error, setError] = useState<string | null>(null);
	const act = (what: () => Promise<void>) => {
		setError(null);
		what()
			.then(onChanged)
			.catch((caught: unknown) => setError(String(caught)));
	};
	const days = raisesPerDay(signal.raises, now);
	const busiest = busiestDay(days);
	const { family, leaf } = familyOf(signal.name);
	const waiting = signal.subscribers.filter((each) => each.armed).length;
	return (
		<section
			aria-label={`signal ${signal.name}`}
			className={cn(
				"flex min-w-0 flex-col gap-5 rounded-xl border bg-card p-5 shadow-xs",
				className,
			)}
		>
			<a
				href="#signals"
				className="flex items-center gap-1 text-muted-foreground text-sm md:hidden"
			>
				<ChevronLeftIcon className="size-4" /> Signals
			</a>
			<header className="flex flex-wrap items-center gap-2">
				<RadioIcon
					className={cn(
						"size-4",
						signal.armed ? "text-warning" : "text-muted-foreground",
					)}
				/>
				<h2 className="font-mono font-semibold text-base">
					{family !== leaf && (
						<span className="text-muted-foreground">{family}.</span>
					)}
					{leaf}
				</h2>
				<State signal={signal} />
				<span className="text-muted-foreground text-sm">
					{waiting === 0 ? "nothing waiting" : `${waiting} waiting`}
				</span>
				<a
					href={checkHref}
					className={cn(
						buttonVariants({ size: "sm", variant: "outline" }),
						"ml-auto",
					)}
				>
					{signal.probe === null ? <PlusIcon /> : <PencilIcon />}
					{signal.probe === null ? "Add check" : "Edit check"}
				</a>
			</header>
			<dl className="flex flex-wrap gap-x-7 gap-y-3 text-muted-foreground text-xs">
				<Figure label="Raises · 7d" value={String(signal.raises.length)} />
				<Figure
					label="Last raised"
					value={
						signal.raises[0] === undefined
							? "not this week"
							: ago(signal.raises[0].at, now)
					}
				/>
				<Figure
					label="Raised by"
					value={usualRaiser(signal.raises) ?? "nobody"}
				/>
				<Figure label="Busiest day" value={busiest?.label ?? "none"} />
			</dl>
			{signal.probe !== null && <Probe signal={signal} now={now} act={act} />}
			{signal.subscribers.length > 0 && (
				<ul className="flex flex-col divide-y rounded-md border text-sm">
					{signal.subscribers.map((each) => (
						<Subscriber
							key={`${each.kind}:${each.id}`}
							sub={each}
							now={now}
							onOpen={onOpen}
							act={act}
						/>
					))}
				</ul>
			)}
			<DayChart days={days} />
			<Raises raises={signal.raises} now={now} />
			{error !== null && (
				<p role="alert" className="text-destructive text-xs">
					{error}
				</p>
			)}
		</section>
	);
}

function State({ signal }: { signal: SignalOverview }): JSX.Element {
	const [label, tone] = signal.armed
		? ["armed", "bg-warning/20 text-warning"]
		: signal.raises.length > 0
			? ["raised", "bg-success/15 text-success"]
			: ["ended", "bg-muted text-muted-foreground"];
	return <span className={cn("rounded-full px-2 text-xs", tone)}>{label}</span>;
}

function Figure({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<dt>{label}</dt>
			<dd className="mt-0.5 font-semibold text-foreground text-lg tabular-nums">
				{value}
			</dd>
		</div>
	);
}

/** Raises per day, today picked out; each bar says its day and count on hover. */
function DayChart({ days }: { days: RaiseDay[] }): JSX.Element {
	const most = Math.max(1, ...days.map((day) => day.count));
	return (
		<figure className="flex flex-col gap-2">
			<figcaption className="flex items-baseline gap-2 font-semibold text-sm">
				Raises per day
				<span className="font-normal text-muted-foreground text-xs">
					last 7 days
				</span>
			</figcaption>
			<div className="relative ml-7 h-28">
				<span className="absolute top-0 -left-7 w-5 -translate-y-1/2 text-right text-[11px] text-muted-foreground tabular-nums">
					{most}
				</span>
				<span className="absolute bottom-0 -left-7 w-5 translate-y-1/2 text-right text-[11px] text-muted-foreground">
					0
				</span>
				<div className="absolute inset-x-0 top-0 border-t" />
				<div className="absolute inset-x-0 top-1/2 border-t" />
				<div className="absolute inset-0 flex items-end gap-0.5 border-input border-b">
					{days.map((day) => {
						const today = day.label === "Today";
						const says = `${day.label}: ${day.count} ${day.count === 1 ? "raise" : "raises"}`;
						return (
							<div
								key={day.label}
								role="img"
								aria-label={says}
								className={cn(
									"group relative flex h-full flex-1 items-end justify-center rounded-md hover:bg-muted/50",
									today && "bg-muted/40",
								)}
							>
								<div
									className={cn(
										"w-[44%] rounded-t",
										today ? "bg-foreground" : "bg-muted-foreground",
									)}
									style={{ height: `${(day.count / most) * 100}%` }}
								/>
								<span className="pointer-events-none absolute -top-8 z-10 hidden whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs shadow-md group-hover:block">
									<span className="font-semibold">{day.label}</span>
									<span className="text-muted-foreground">
										{" "}
										· {day.count} {day.count === 1 ? "raise" : "raises"}
									</span>
								</span>
							</div>
						);
					})}
				</div>
			</div>
			<div className="ml-7 flex gap-0.5">
				{days.map((day) => (
					<span
						key={day.label}
						className="flex-1 text-center text-muted-foreground text-xs"
					>
						{day.label}
					</span>
				))}
			</div>
		</figure>
	);
}

function Probe({
	signal,
	now,
	act,
}: {
	signal: SignalOverview;
	now: number;
	act: (what: () => Promise<void>) => void;
}): JSX.Element | null {
	const { probe } = signal;
	if (probe === null) {
		return null;
	}
	const running = ["idle", "running"].includes(probe.state);
	const last = probe.runs.at(-1);
	return (
		<div className="flex flex-col gap-1 rounded-md border px-3 py-2 text-muted-foreground text-xs">
			<div className="flex flex-wrap items-center gap-2">
				<span>
					Probe {probe.state} · every {everyOf(probe.everyMs)}
					{last !== undefined &&
						` · last run ${ago(last.at, now)}, exit ${last.exit}`}
					{running &&
						probe.next !== undefined &&
						` · next in ${timeLeft(probe.next, now)}`}
				</span>
				{running && (
					<Button
						size="sm"
						variant="outline"
						className="ml-auto"
						onClick={() => act(() => stopProbe(signal.name))}
					>
						Stop probe
					</Button>
				)}
			</div>
			<p className="truncate">
				{probe.description} ·{" "}
				<code className="font-mono">{probe.script.split("\n")[0]}</code>
			</p>
		</div>
	);
}

function Subscriber({
	sub,
	now,
	onOpen,
	act,
}: {
	sub: SignalSubscriber;
	now: number;
	onOpen: (id: string) => void;
	act: (what: () => Promise<void>) => void;
}): JSX.Element {
	const drop =
		sub.kind === "wait"
			? () => stopWait(sub.conversation ?? "", sub.id)
			: () => pauseSubscription(sub.project ?? "", sub.id);
	return (
		<li className="flex flex-wrap items-center gap-2 px-3 py-1.5">
			{sub.kind === "wait" ? (
				<HourglassIcon className="size-3.5 text-muted-foreground" />
			) : null}
			<span className="text-muted-foreground text-xs">
				{sub.kind === "wait" ? "conversation" : "automation"}
			</span>
			{sub.kind === "wait" && sub.conversation !== undefined ? (
				<button
					type="button"
					className="truncate text-left underline-offset-2 hover:underline"
					onClick={() => onOpen(sub.conversation ?? "")}
				>
					{sub.title ?? sub.label}
				</button>
			) : (
				<span className="truncate">{sub.label}</span>
			)}
			<span className="text-muted-foreground text-xs">
				{sub.state}
				{sub.armed &&
					sub.deadline !== undefined &&
					` · ${timeLeft(sub.deadline, now)} left`}
			</span>
			{sub.armed && (
				<Button
					size="sm"
					variant="ghost"
					className="ml-auto"
					onClick={() => act(drop)}
				>
					{sub.kind === "wait" ? "Drop" : "Pause"}
				</Button>
			)}
		</li>
	);
}
