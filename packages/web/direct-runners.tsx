import type {
	DirectJobReport,
	DirectRunnerReport,
	WorkerPool,
} from "@stringsync/splates-server/workers";
import type { JSX } from "react";
import { Badge } from "#web/components/ui/badge.tsx";
import { cn } from "#web/lib/utils.ts";
import { useMinute } from "./hooks/use-minute";
import { PHONE_HEADING } from "./phone-rows";
import { ago } from "./plan-limits";

/**
 * The runners `splates run` made for itself in the project's cloud, which
 * it needs no server for, and the jobs on them as it reported them: each
 * runner's size, price and whether it is busy, and each job's step. Nothing
 * while there are none.
 */
export function DirectRunners({
	pool,
}: {
	pool: WorkerPool;
}): JSX.Element | null {
	const now = useMinute();
	const { runners, unplaced } = pool.direct;
	if (runners.length === 0 && unplaced.length === 0) {
		return null;
	}
	return (
		<div className="flex flex-col gap-3">
			<header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
				<h2 className={cn("font-medium text-sm", PHONE_HEADING)}>
					Made by splates run
				</h2>
				<span className="text-muted-foreground text-xs">
					Runners <code className="font-mono">splates run</code> made in the
					project's cloud, with or without this server; each is deleted once
					idle 10 minutes.
				</span>
			</header>
			<ul aria-label="made by splates run" className="flex flex-col gap-4">
				{runners.map((runner) => (
					<li
						key={runner.id}
						aria-label={`runner ${runner.id}`}
						className="overflow-hidden rounded-xl border bg-card shadow-xs"
					>
						<header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
							<div className="flex min-w-0 flex-1 flex-col gap-0.5">
								<span className="flex flex-wrap items-center gap-2">
									<span className="font-medium font-mono text-sm">
										{runner.id}
									</span>
									<Badge
										variant={runner.state === "up" ? "secondary" : "outline"}
									>
										{runnerState(runner)}
									</Badge>
								</span>
								<span className="text-muted-foreground text-xs">
									{sizeLine(runner)} · made {ago(runner.createdAt, now)}
								</span>
							</div>
						</header>
						<Jobs jobs={runner.jobs} now={now} />
					</li>
				))}
				{unplaced.length > 0 && (
					<li
						aria-label="waiting for a runner"
						className="overflow-hidden rounded-xl border bg-card shadow-xs"
					>
						<header className="px-4 py-3 font-medium text-sm">
							Waiting for a runner
						</header>
						<Jobs jobs={unplaced} now={now} />
					</li>
				)}
			</ul>
		</div>
	);
}

function Jobs({
	jobs,
	now,
}: {
	jobs: DirectJobReport[];
	now: number;
}): JSX.Element {
	if (jobs.length === 0) {
		return (
			<p className="border-t px-4 py-2 text-muted-foreground text-xs">
				No job in the last 15 minutes.
			</p>
		);
	}
	return (
		<ul aria-label="jobs" className="flex flex-col border-t">
			{jobs.map((job) => (
				<li
					key={job.id}
					className="flex flex-wrap items-baseline gap-x-2 px-4 py-2 text-sm"
				>
					<code className="min-w-0 truncate font-mono text-[13px]">
						{job.what}
					</code>
					<span className={cn("text-xs", phaseTone(job))}>
						{phaseText(job)}
					</span>
					<span className="text-muted-foreground text-xs">
						{job.task === null ? "" : `${job.task}, `}started{" "}
						{ago(job.since, now)}
					</span>
				</li>
			))}
		</ul>
	);
}

/** Where a job stands, in words. */
export function phaseText(job: DirectJobReport): string {
	switch (job.phase) {
		case "placing":
			return "looking for a runner";
		case "making":
			return "making a runner";
		case "booting":
			return "waiting for its runner to boot";
		case "waiting":
			return "waiting for room";
		case "sending":
			return "sending the worktree";
		case "preparing":
			return "preparing";
		case "running":
			return "running";
		case "done":
			return job.code === 0 ? "passed" : `exited ${job.code}`;
		case "failed":
			return `failed${job.reason === null ? "" : `: ${job.reason}`}`;
	}
}

function phaseTone(job: DirectJobReport): string {
	if (job.phase === "failed" || (job.phase === "done" && job.code !== 0)) {
		return "text-destructive";
	}
	if (job.phase === "done" || job.phase === "running") {
		return "text-emerald-600 dark:text-emerald-400";
	}
	return "text-amber-600 dark:text-amber-400";
}

function runnerState(
	runner: DirectRunnerReport & { jobs: DirectJobReport[] },
): string {
	if (runner.state === "booting") {
		return "booting";
	}
	const going = runner.jobs.filter(
		(job) => job.phase !== "done" && job.phase !== "failed",
	).length;
	return going === 0 ? "idle" : going === 1 ? "1 job" : `${going} jobs`;
}

function sizeLine(runner: DirectRunnerReport): string {
	const size =
		runner.cpus === null || runner.memory === null
			? runner.type
			: `${runner.cpus} ${runner.cpus === 1 ? "CPU" : "CPUs"}, ${runner.memory} GB`;
	return runner.dollarsPerHour === null
		? size
		: `${size}, $${runner.dollarsPerHour.toFixed(2)}/h`;
}
