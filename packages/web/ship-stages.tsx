import type {
	Cascade,
	CascadeStep,
	ReleaseStep,
	Ship,
	Stage,
	StageState,
} from "@splates/server/ship";
import { Duration, SystemTimer } from "core/time";
import {
	CircleCheckIcon,
	CircleDotIcon,
	CircleIcon,
	CircleSlashIcon,
	CircleXIcon,
	LoaderCircleIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { shipStageLog } from "./api";
import { useNow } from "./hooks/use-now";
import { cn } from "./lib/utils";
import { ShipOutput } from "./ship-badge";
import { CopyFrame } from "./ship-copy";
import { plain } from "./work-timeline";

const AMBER = "text-amber-600 dark:text-amber-400";
const SECOND = Duration.secs(1);

/** One step of a project's part: its state, its time against what is expected, its last check, and its log on tap. */
export function StageRow({
	cascade,
	step,
	stage,
	ship,
	live,
	opened = false,
}: {
	cascade: Cascade;
	step: CascadeStep;
	stage: Stage;
	ship: Ship | null;
	live: boolean;
	/** Whether its log shows from the start, as a failed step's does; a step under way shows it too. */
	opened?: boolean;
}): JSX.Element {
	const going = live && ONGOING.includes(stage.state);
	// Until tapped, a step shows its log while it is the one under way.
	const [tapped, setTapped] = useState<boolean | null>(null);
	const open = tapped ?? (opened || going);
	const now = useNow(going, SECOND);
	const spent =
		stage.started === null
			? null
			: (stage.ended === null ? now : Date.parse(stage.ended)) -
				Date.parse(stage.started);
	return (
		<li aria-label={stage.name} className="flex flex-col gap-1.5 py-1.5">
			<button
				type="button"
				aria-expanded={open}
				disabled={stage.log === null}
				onClick={() => setTapped(!open)}
				className={cn(
					"flex flex-wrap items-center gap-x-2 text-left text-sm",
					stage.state === "asking" && AMBER,
					(stage.state === "hung" || stage.state === "failed") &&
						"text-destructive",
					stage.state === "skipped" && "text-muted-foreground/60 line-through",
				)}
			>
				<span aria-hidden className="shrink-0">
					{ICONS[stage.state]}
				</span>
				<span className="font-medium">{stage.name}</span>
				<span className="text-muted-foreground">
					{STAGE_STATES[stage.state]}
				</span>
				{spent !== null && (
					<span className="ml-auto text-muted-foreground tabular-nums">
						{stage.state === "done" || stage.ended !== null
							? span(spent)
							: `${span(spent)} of about ${span(stage.expected)}`}
					</span>
				)}
			</button>
			{stage.check !== null && going && (
				<p className="pl-5 text-muted-foreground text-sm">
					{stage.check.result}
					{stage.check.link !== undefined && (
						<>
							{" "}
							(
							<a
								href={stage.check.link}
								target="_blank"
								rel="noreferrer"
								className="underline"
							>
								on npmjs.com
							</a>
							)
						</>
					)}
					,{" "}
					{stage.check.next !== undefined && Date.parse(stage.check.next) > now
						? `next check in ${Math.ceil((Date.parse(stage.check.next) - now) / 1000)}s`
						: `checked ${ago(now, stage.check.at)}`}
				</p>
			)}
			{stage.releaseSteps !== undefined && (
				<ReleaseSteps steps={stage.releaseSteps} now={now} />
			)}
			{open && stage.log !== null && (
				<StageLog
					cascade={cascade}
					step={step}
					stage={stage}
					ship={live ? ship : null}
				/>
			)}
		</li>
	);
}

/**
 * The steps a project's own Release reports under its ship command, each
 * labelled by the Release's stage (preflight, build, publish...) and, while
 * running, timed against its deadline. Release steps are the project's; the
 * rows around them are splates's own.
 */
function ReleaseSteps({
	steps,
	now,
}: {
	steps: ReleaseStep[];
	now: number;
}): JSX.Element {
	return (
		<ol aria-label="Release steps" className="flex flex-col gap-0.5 pl-5">
			{steps.map((step) => {
				const spent =
					step.started === null
						? null
						: (step.ended === null ? now : Date.parse(step.ended)) -
							Date.parse(step.started);
				return (
					<li
						key={step.id}
						aria-label={step.name}
						className={cn(
							"flex flex-wrap items-center gap-x-2 text-sm",
							step.state === "failed" && "text-destructive",
							step.state === "skipped" && "text-muted-foreground/60",
						)}
					>
						<span aria-hidden className="shrink-0">
							{ICONS[step.state]}
						</span>
						<span className="text-muted-foreground">{step.stage}</span>
						<span>{step.name}</span>
						{step.state === "running" && step.status !== null && (
							<span className="text-muted-foreground">{step.status}</span>
						)}
						{step.url !== null && (
							<a
								href={step.url}
								target="_blank"
								rel="noreferrer"
								className="underline"
							>
								run on GitHub
							</a>
						)}
						{step.state === "skipped" && (
							<span className="text-muted-foreground">already done</span>
						)}
						{spent !== null && (
							<span className="ml-auto text-muted-foreground tabular-nums">
								{step.state === "running"
									? `${span(spent)} of up to ${span(step.deadlineMs)}`
									: span(spent)}
							</span>
						)}
						{step.state === "failed" && step.error !== null && (
							<span className="basis-full pl-5">{step.error}</span>
						)}
					</li>
				);
			})}
		</ol>
	);
}

/** What a step printed: followed live while its ship publishes, the kept slice otherwise. */
function StageLog({
	cascade,
	step,
	stage,
	ship,
}: {
	cascade: Cascade;
	step: CascadeStep;
	stage: Stage;
	ship: Ship | null;
}): JSX.Element {
	const [text, setText] = useState<string | null>(null);
	const followed = ship !== null && stage.ended === null;
	useEffect(() => {
		if (followed) {
			return;
		}
		let disposed = false;
		const read = () =>
			shipStageLog(cascade.id, step.slug, stage.key).then(
				(value) => {
					if (!disposed) {
						setText(value);
					}
				},
				() => undefined,
			);
		void read();
		const tick =
			stage.ended === null
				? new SystemTimer().setInterval(() => {
						void read();
					}, SECOND)
				: null;
		return () => {
			disposed = true;
			tick?.dispose();
		};
	}, [followed, cascade.id, step.slug, stage.key, stage.ended]);
	if (followed) {
		return <ShipOutput key={ship.started} project={ship.project} />;
	}
	return (
		<CopyFrame
			title={step.slug}
			read={() => (text === null ? "" : plain(text))}
		>
			<pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-sm whitespace-pre-wrap">
				{text === null ? "Reading the log…" : plain(text)}
			</pre>
		</CopyFrame>
	);
}

/** The states a step is under way in, whose time still runs. */
const ONGOING: StageState[] = ["running", "checking", "asking", "hung"];

const STAGE_STATES: Record<StageState, string> = {
	pending: "",
	running: "running",
	checking: "checking",
	asking: "waits on you",
	hung: "past its deadline",
	done: "done",
	failed: "failed",
	skipped: "",
};

const ICON = "size-4 shrink-0";

export const ICONS: Record<StageState, JSX.Element> = {
	pending: <CircleIcon className={cn(ICON, "text-muted-foreground/50")} />,
	running: (
		<LoaderCircleIcon
			className={cn(ICON, "animate-spin text-muted-foreground")}
		/>
	),
	checking: (
		<LoaderCircleIcon
			className={cn(ICON, "animate-spin text-muted-foreground")}
		/>
	),
	asking: <CircleDotIcon className={cn(ICON, AMBER)} />,
	hung: <TriangleAlertIcon className={cn(ICON, AMBER)} />,
	done: <CircleCheckIcon className={cn(ICON, "text-emerald-500")} />,
	failed: <CircleXIcon className={cn(ICON, "text-destructive")} />,
	skipped: <CircleSlashIcon className={cn(ICON, "text-muted-foreground/60")} />,
};

/** `ms` as "45s", "3m" or "1h 5m". */
export function span(ms: number): string {
	const secs = Math.max(0, Math.round(ms / 1000));
	if (secs < 60) {
		return `${secs}s`;
	}
	const mins = Math.round(secs / 60);
	return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/** How long before `now` the ISO time `at` was, as "20s ago". */
function ago(now: number, at: string): string {
	return `${span(now - Date.parse(at))} ago`;
}
