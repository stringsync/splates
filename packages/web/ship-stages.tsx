import type {
	Cascade,
	CascadeStep,
	Ship,
	Stage,
	StageState,
} from "@stringsync/splates-server/ship";
import { LoaderCircleIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Duration } from "webappwiz/time";
import { shipStageLog } from "./api";
import { useNow } from "./hooks/use-now";
import { cn } from "./lib/utils";
import { ShipOutput } from "./ship-badge";

const AMBER = "text-amber-600 dark:text-amber-400";
const SECOND = Duration.secs(1);

/** One step of a project's part: its state, its time against what is expected, its last check, and its log on tap. */
export function StageRow({
	cascade,
	step,
	stage,
	ship,
	live,
}: {
	cascade: Cascade;
	step: CascadeStep;
	stage: Stage;
	ship: Ship | null;
	live: boolean;
}): JSX.Element {
	const [open, setOpen] = useState(false);
	const going = live && ONGOING.includes(stage.state);
	const now = useNow(going, SECOND);
	const spent =
		stage.started === null
			? null
			: (stage.ended === null ? now : Date.parse(stage.ended)) -
				Date.parse(stage.started);
	return (
		<li aria-label={stage.name} className="flex flex-col gap-0.5 py-1">
			<button
				type="button"
				aria-expanded={open}
				disabled={stage.log === null}
				onClick={() => setOpen(!open)}
				className={cn(
					"flex flex-wrap items-center gap-x-2 text-left text-xs",
					stage.state === "asking" && AMBER,
					stage.state === "hung" && "text-destructive",
				)}
			>
				<span aria-hidden>{ICONS[stage.state]}</span>
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
				<p className="pl-5 text-muted-foreground text-xs">
					{stage.check.result}, checked {ago(now, stage.check.at)}
				</p>
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
		shipStageLog(cascade.id, step.slug, stage.key).then(
			setText,
			() => undefined,
		);
	}, [followed, cascade.id, step.slug, stage.key]);
	if (followed) {
		return <ShipOutput key={ship.started} project={ship.project} />;
	}
	return (
		<pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 font-mono text-xs whitespace-pre-wrap">
			{text ?? "Reading the log…"}
		</pre>
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
	skipped: "skipped",
};

const ICONS: Record<StageState, JSX.Element | string> = {
	pending: "○",
	running: <LoaderCircleIcon className="size-3 animate-spin" />,
	checking: <LoaderCircleIcon className="size-3 animate-spin" />,
	asking: "●",
	hung: "⚠",
	done: "✓",
	failed: "✕",
	skipped: "·",
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
