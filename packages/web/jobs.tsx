import type {
	JobListing,
	RunningJob,
	WaitingJob,
} from "@stringsync/splates-server/jobs";
import { PauseIcon, PlayIcon } from "lucide-react";
import type { JSX } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { pauseJobs } from "./api";
import { QueueEmpty, QueueSection } from "./queue-rows";
import { Refusal, useRefusal } from "./refusal";

/**
 * The machine's jobs atop the Queue page's card: Pause, or Resume while
 * paused, then what runs (with what it was given and when it should end) and
 * what waits in priority order, the head's reservation among them.
 */
export function Jobs({
	jobs,
}: {
	jobs: JobListing | null;
}): JSX.Element | null {
	const { refusal, refuse } = useRefusal();
	if (jobs === null) {
		return null;
	}
	const { paused } = jobs;
	const toggle = () =>
		void pauseJobs(!paused).catch((error: unknown) =>
			refuse(paused ? "Not resumed" : "Not paused", error),
		);
	return (
		<section
			aria-label="jobs"
			className="flex flex-col overflow-hidden rounded-xl border bg-card shadow-xs"
		>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
				<Button
					size="sm"
					variant={paused ? "default" : "outline"}
					onClick={toggle}
				>
					{paused ? <PlayIcon /> : <PauseIcon />}
					{paused ? "Resume jobs" : "Pause jobs"}
				</Button>
				<span
					role="status"
					className="text-muted-foreground text-sm max-md:basis-full"
				>
					{paused
						? `Paused · ${jobs.running.length} running finish · none start`
						: `${jobs.running.length} running · ${jobs.waiting.length} waiting`}
				</span>
			</div>
			<Refusal refusal={refusal} />
			<QueueSection title="Jobs running" count={jobs.running.length}>
				{jobs.running.length === 0 ? (
					<QueueEmpty>No job runs</QueueEmpty>
				) : (
					jobs.running.map((job) => <RunningRow key={job.id} job={job} />)
				)}
			</QueueSection>
			<QueueSection title="Jobs waiting" count={jobs.waiting.length}>
				{jobs.waiting.length === 0 ? (
					<QueueEmpty>No job waits</QueueEmpty>
				) : (
					jobs.waiting.map((job) => <WaitingRow key={job.id} job={job} />)
				)}
			</QueueSection>
		</section>
	);
}

function RunningRow({ job }: { job: RunningJob }): JSX.Element {
	const left = Math.max(0, job.expectedMs - job.ranMs);
	return (
		<Row
			job={job}
			given={given(job.allocation)}
			when={`since ${span(job.ranMs)} · ends in ~${span(left)}`}
		/>
	);
}

function WaitingRow({ job }: { job: WaitingJob }): JSX.Element {
	return (
		<Row
			job={job}
			place={job.place}
			given={asked(job.request.resources)}
			when={
				job.reservedInMs === undefined
					? `waited ${span(job.waitedMs)}`
					: `waited ${span(job.waitedMs)} · room in ~${span(job.reservedInMs)}`
			}
		/>
	);
}

function Row({
	job,
	place,
	given,
	when,
}: {
	job: RunningJob | WaitingJob;
	place?: number;
	given: string;
	when: string;
}): JSX.Element {
	const owner = job.task ?? (job.conversation === undefined ? "" : "agent");
	return (
		<div className="flex flex-col gap-0.5 px-4 py-2 text-sm md:flex-row md:items-center md:gap-4">
			<span className="flex min-w-0 flex-1 items-baseline gap-2">
				{place !== undefined && (
					<span className="text-muted-foreground tabular-nums">{place}.</span>
				)}
				<span className="truncate font-medium">{job.what}</span>
				{owner !== "" && (
					<span className="truncate text-muted-foreground">{owner}</span>
				)}
			</span>
			<span className="text-muted-foreground text-xs tabular-nums">
				{given} · priority {job.priority} · {when}
			</span>
		</div>
	);
}

const NAMES: Record<string, string> = { cpus: "cpus", mem: "MB" };

function given(allocation: Record<string, number>): string {
	return (
		Object.entries(allocation)
			.map(([pool, amount]) => `${amount} ${NAMES[pool] ?? pool}`)
			.join(", ") || "nothing allocated"
	);
}

function asked(resources: RunningJob["request"]["resources"]): string {
	return (
		Object.entries(resources)
			.map(([pool, amount]) => {
				const each =
					typeof amount === "number"
						? `${amount}`
						: `${amount.min} to ${amount.max}`;
				return `${each} ${NAMES[pool] ?? pool}`;
			})
			.join(", ") || "no resources"
	);
}

/** A length of time as `45s`, `3m`, `1h 5m`. */
function span(ms: number): string {
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.round(seconds / 60);
	return minutes < 60
		? `${minutes}m`
		: `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
