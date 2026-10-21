import type { Config } from "../config";
import type { WorkerBudget, WorkerRecords } from "../workers";

/**
 * Whether the box gets workers with this machine off, and, as a deploy
 * says before it moves, how, or why not.
 */
export interface WorkersWithout {
	ok: boolean;
	said: string;
}

/**
 * How the box gets workers once this machine, which the move joins as its
 * worker, is off: the `workerProvider` the config of the project the box's
 * server starts in names, with a cloud token its API takes and a budget
 * above nothing, or a worker besides this machine that has joined.
 */
export async function workersWithout(
	opts: WorkersWithoutOptions,
): Promise<WorkersWithout> {
	const { config, budget, records, worker } = opts;
	const others = records.all
		.filter((each) => each.id !== worker && !each.removing)
		.map((each) => each.id);
	const joined =
		others.length === 0
			? null
			: `${others.length === 1 ? "worker" : "workers"} ${others.join(", ")}`;
	const provider = await makes(config, budget);
	if (provider.ok) {
		return {
			ok: true,
			said: `with this machine off, ${provider.said}${joined === null ? "" : `, and agents run on ${joined}, joined already`}`,
		};
	}
	if (joined !== null) {
		return {
			ok: true,
			said: `with this machine off, agents run on ${joined}, joined already`,
		};
	}
	return {
		ok: false,
		said: `with this machine off, nothing runs agents, so the box needs it up: ${provider.said}`,
	};
}

/** What `workersWithout` reads. */
export interface WorkersWithoutOptions {
	/** The config of the project the box's server starts in; null for none. */
	config: Pick<Config, "cloud" | "workerProvider"> | null;
	budget: WorkerBudget;
	records: WorkerRecords;
	/** What this machine is known by as a worker. */
	worker: string;
}

/** Whether `config`'s `workerProvider` makes workers within `budget`. */
async function makes(
	config: Pick<Config, "cloud" | "workerProvider"> | null,
	budget: WorkerBudget,
): Promise<WorkersWithout> {
	if (config?.workerProvider == null) {
		return {
			ok: false,
			said: "no `workerProvider` or `cloud` in the splates.config.ts of the project the box serves from, and no other worker joined",
		};
	}
	const { cloud } = config;
	const name = cloud?.name ?? "its `workerProvider`";
	if (cloud !== null && !(await cloud.accepted().catch(() => false))) {
		return {
			ok: false,
			said: `${cloud.name} takes no ${cloud.token.label} kept here: \`splates setup\` keeps one`,
		};
	}
	const spent = budget.standing().find((each) => each.dollars <= 0);
	if (spent !== undefined) {
		return {
			ok: false,
			said: `the worker budget's ${spent.limit} limit is $0: raise it with \`splates budget set\``,
		};
	}
	return { ok: true, said: `the box makes workers with ${name}` };
}
