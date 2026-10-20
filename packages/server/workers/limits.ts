/** The limits a worker budget holds made workers to, each in US dollars. */
export const WORKER_LIMITS = ["hour", "day", "month"] as const;

/**
 * `hour` is a rate cap, the dollars per hour the made workers running at
 * once may cost together; `day` and `month` are what they may cost in all
 * since the day or month began, in local time.
 */
export type WorkerLimit = (typeof WORKER_LIMITS)[number];

/** What each limit is until the user sets it. */
export const DEFAULT_WORKER_LIMITS: Readonly<Record<WorkerLimit, number>> = {
	hour: 0.25,
	day: 5,
	month: 75,
};
