import type {
	Cascade,
	CascadeStep,
	ReleaseStep,
	Ship,
	Stage,
	StageState,
} from "@splates/server/legacy-ship";
import { OUTSIDE_STEPS } from "@splates/server/legacy-ship/browser";
import { Duration, SystemTimer } from "core/time";
import {
	ChevronRightIcon,
	CircleCheckIcon,
	CircleDotIcon,
	CircleIcon,
	CircleSlashIcon,
	CircleXIcon,
	LoaderCircleIcon,
	TriangleAlertIcon,
} from "lucide-react";
import { type JSX, useEffect, useRef, useState } from "react";
import { shipStageLog } from "./api";
import { useNow } from "./hooks/use-now";
import { ShipOutput } from "./legacy-ship-badge";
import { CopyFrame } from "./legacy-ship-copy";
import { ShipQuestion } from "./legacy-ship-question";
import { cn } from "./lib/utils";
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
	const releaseSteps = stage.releaseSteps ?? [];
	// Until tapped, a step shows its log while it is the one under way.
	const [tapped, setTapped] = useState<boolean | null>(null);
	const open = tapped ?? (opened || going);
	const openable = stage.log !== null || releaseSteps.length > 0;
	const now = useNow(going, SECOND);
	const spent =
		stage.started === null
			? null
			: (stage.ended === null ? now : Date.parse(stage.ended)) -
				Date.parse(stage.started);
	if (step.planned && stage.key === "publish" && releaseSteps.length > 0) {
		return (
			<li>
				<ReleaseSteps
					cascade={cascade}
					step={step}
					stage={stage}
					steps={releaseSteps}
					now={now}
					live={live}
				/>
			</li>
		);
	}
	return (
		<li aria-label={stage.name} className="flex flex-col gap-1.5 py-1.5">
			<button
				type="button"
				aria-expanded={open}
				disabled={!openable}
				onClick={() => setTapped(!open)}
				className={cn(
					"flex flex-wrap items-center gap-x-2 text-left text-sm",
					stage.state === "asking" && AMBER,
					(stage.state === "hung" || stage.state === "failed") &&
						"text-destructive",
					stage.state === "skipped" && "text-muted-foreground/60 line-through",
				)}
			>
				<Chevron open={open} openable={openable} />
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
			{open && releaseSteps.length > 0 && (
				<ReleaseSteps
					cascade={cascade}
					step={step}
					stage={stage}
					steps={releaseSteps}
					now={now}
					live={live}
				/>
			)}
			{open && releaseSteps.length === 0 && stage.log !== null && (
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
 * running, timed against its deadline, and each opening to what it printed.
 * Release steps are the project's; the rows around them are splates's own.
 */
function ReleaseSteps({
	cascade,
	step,
	stage,
	steps,
	now,
	live,
}: {
	cascade: Cascade;
	step: CascadeStep;
	stage: Stage;
	steps: ReleaseStep[];
	now: number;
	live: boolean;
}): JSX.Element {
	const sliced = steps.some((each) => each.log !== undefined);
	const [unfolded, setUnfolded] = useState(false);
	// Leading steps that finished cleanly fold into one row while later ones run.
	const lead = steps.findIndex((each) => each.state !== "done");
	const folded = lead === -1 ? [] : steps.slice(0, lead);
	const foldedMs = folded.reduce(
		(sum, each) =>
			each.started === null || each.ended === null
				? sum
				: sum + Date.parse(each.ended) - Date.parse(each.started),
		0,
	);
	return (
		<ol aria-label="Release steps" className="flex flex-col gap-0.5">
			{folded.length > 1 && !unfolded && (
				<li aria-label="Finished steps">
					<button
						type="button"
						aria-expanded={false}
						onClick={() => setUnfolded(true)}
						className="flex w-full items-center gap-x-2 text-left text-sm"
					>
						<Chevron open={false} openable />
						<span aria-hidden className="shrink-0">
							{ICONS.done}
						</span>
						<span>{folded.length} steps done</span>
						<span className="ml-auto text-muted-foreground tabular-nums">
							{span(foldedMs)}
						</span>
					</button>
				</li>
			)}
			{(folded.length > 1 && !unfolded
				? steps.slice(folded.length)
				: steps
			).map((release) => (
				<ReleaseStepRow
					key={release.id}
					cascade={cascade}
					step={step}
					stage={stage}
					release={release}
					now={now}
					live={live}
				/>
			))}
			{sliced && (
				<OutsideSteps
					cascade={cascade}
					step={step}
					stage={stage}
					ongoing={live && stage.ended === null}
				/>
			)}
		</ol>
	);
}

/** One release step: open while it runs or once it failed, until tapped. */
function ReleaseStepRow({
	cascade,
	step,
	stage,
	release,
	now,
	live,
}: {
	cascade: Cascade;
	step: CascadeStep;
	stage: Stage;
	release: ReleaseStep;
	now: number;
	live: boolean;
}): JSX.Element {
	const running =
		live && (release.state === "running" || release.state === "asking");
	const [tapped, setTapped] = useState<boolean | null>(null);
	const open = tapped ?? (release.state === "failed" || running);
	const openable = release.log !== undefined;
	const spent =
		release.started === null
			? null
			: (release.ended === null ? now : Date.parse(release.ended)) -
				Date.parse(release.started);
	return (
		<li aria-label={release.name} className="flex flex-col gap-1 py-0.5">
			<div
				className={cn(
					"flex flex-wrap items-center gap-x-2 text-sm",
					release.state === "failed" && "text-destructive",
					release.state === "asking" && AMBER,
					release.state === "skipped" && "text-muted-foreground/60",
				)}
			>
				<button
					type="button"
					aria-expanded={open}
					disabled={!openable}
					onClick={() => setTapped(!open)}
					className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-left"
				>
					<Chevron open={open} openable={openable} />
					<span aria-hidden className="shrink-0">
						{ICONS[release.state]}
					</span>
					<span>{release.name}</span>
					{release.state === "running" && release.status !== null && (
						<span className="text-muted-foreground">{release.status}</span>
					)}
					{release.state === "asking" && <span>waits on you</span>}
					{release.state === "skipped" && (
						<span className="text-muted-foreground">already done</span>
					)}
					{spent !== null && (
						<span className="ml-auto text-muted-foreground tabular-nums">
							{release.state === "running"
								? `${span(spent)} of up to ${span(release.deadlineMs)}`
								: span(spent)}
						</span>
					)}
				</button>
				{release.url !== null && (
					<a
						href={release.url}
						target="_blank"
						rel="noreferrer"
						className="underline"
					>
						run on GitHub
					</a>
				)}
				{release.state === "failed" && release.error !== null && (
					<span className="basis-full pl-10">{release.error}</span>
				)}
			</div>
			{live &&
				cascade.status === "running" &&
				step.status === "shipping" &&
				step.ship &&
				release.state === "asking" &&
				release.question && (
					<ShipQuestion
						key={release.question.questionId}
						id={cascade.id}
						project={step.slug}
						started={step.ship}
						question={release.question}
					/>
				)}
			{open && openable && (
				<SliceLog
					key={`${cascade.id}/${step.slug}/${stage.key}/${release.id}`}
					title={`${step.slug} ${release.name}`}
					read={() =>
						shipStageLog(cascade.id, step.slug, stage.key, release.id)
					}
					ongoing={live && release.ended === null}
				/>
			)}
		</li>
	);
}

/** What the stage printed before its first release step and after its last, folded. */
function OutsideSteps({
	cascade,
	step,
	stage,
	ongoing,
}: {
	cascade: Cascade;
	step: CascadeStep;
	stage: Stage;
	ongoing: boolean;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	return (
		<li aria-label="Other output" className="flex flex-col gap-1 py-0.5">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="flex items-center gap-x-2 text-left text-muted-foreground text-sm"
			>
				<Chevron open={open} openable />
				<span>Other output</span>
			</button>
			{open && (
				<SliceLog
					key={`${cascade.id}/${step.slug}/${stage.key}`}
					title={`${step.slug} other output`}
					read={() =>
						shipStageLog(cascade.id, step.slug, stage.key, OUTSIDE_STEPS)
					}
					ongoing={ongoing}
				/>
			)}
		</li>
	);
}

/** A row's open or closed mark, holding its place on a row that does not open. */
function Chevron({
	open,
	openable,
}: {
	open: boolean;
	openable: boolean;
}): JSX.Element {
	return (
		<ChevronRightIcon
			aria-hidden
			className={cn(
				"size-3.5 shrink-0 text-muted-foreground transition-transform",
				open && "rotate-90",
				!openable && "invisible",
			)}
		/>
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
	if (ship !== null && stage.ended === null) {
		return <ShipOutput key={ship.started} project={ship.project} />;
	}
	return (
		<SliceLog
			key={`${cascade.id}/${step.slug}/${stage.key}`}
			title={step.slug}
			read={() => shipStageLog(cascade.id, step.slug, stage.key)}
			ongoing={stage.ended === null}
		/>
	);
}

/** A slice of a ship's log, read again each second while it may still grow. */
function SliceLog({
	title,
	read,
	ongoing,
}: {
	title: string;
	read: () => Promise<string | null>;
	ongoing: boolean;
}): JSX.Element {
	const [text, setText] = useState<string | null>(null);
	// The latest reader, so a render's new closure does not restart the reading.
	const reader = useRef(read);
	reader.current = read;
	useEffect(() => {
		let disposed = false;
		const again = () =>
			reader.current().then(
				(value) => {
					if (!disposed) {
						setText(value ?? "");
					}
				},
				() => undefined,
			);
		void again();
		const tick = ongoing
			? new SystemTimer().setInterval(() => {
					void again();
				}, SECOND)
			: null;
		return () => {
			disposed = true;
			tick?.dispose();
		};
	}, [ongoing]);
	return (
		<CopyFrame title={title} read={() => (text === null ? "" : plain(text))}>
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
