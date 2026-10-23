import { Duration } from "webappwiz/time";

/** The limits a worker budget holds made workers to, each in US dollars. */
export const WORKER_LIMITS = ["hour", "day", "month"] as const;

/**
 * `hour` is a rate cap, the dollars per hour the made workers running at
 * once may cost together; `day` and `month` are what they may cost in all
 * since the day or month began, in local time.
 */
export type WorkerLimit = (typeof WORKER_LIMITS)[number];

/** How many runners may be up at once in the account until the user sets it, whoever made them. */
export const DEFAULT_RUNNER_CAP = 16;

/** How long a runner runs after its last job, until the user sets it, before it stops itself. */
export const DEFAULT_RUNNER_IDLE = Duration.mins(10);

/** What each limit is until the user sets it. */
export const DEFAULT_WORKER_LIMITS: Readonly<Record<WorkerLimit, number>> = {
	hour: 1,
	day: 15,
	month: 200,
};
