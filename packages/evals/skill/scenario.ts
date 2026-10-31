/**
 * One eval: a repo seeded for it, the person's message, the skill requirement
 * it checks in words, and how the outcome is graded: code checks for what is
 * concrete, a judge's rubric for behaviour.
 */
export interface Scenario {
	/** `aspect/name`, as a run card lists it. */
	id: string;
	aspect: string;
	/** What the skill asks of the agent here, in words; the judge reads it. */
	requirement: string;
	/** Adds what the scenario needs to the minimal splates repo, before the seed commit. */
	seed?: (repo: Repo) => Promise<void>;
	/**
	 * Runs `splates init` after the seed commit, so `splates add` works as in
	 * a real project; the agent then starts a task like the skill says.
	 */
	initialized?: boolean;
	/** Leaves uncommitted work in the repo, after the seed commit. */
	change?: (repo: Repo) => Promise<void>;
	/** What the person says to the agent. */
	message: string;
	checks?: Check[];
	/** What the judge decides from the transcript; no judge when absent. */
	judge?: string;
	limits?: Limits;
}

/** A plain question of the outcome, true when it holds. */
export interface Check {
	id: string;
	/** What it checks, in words, shown beside its result. */
	about: string;
	test: (outcome: Outcome) => boolean | Promise<boolean>;
}

/** How far one run may go before it is stopped. */
export interface Limits {
	turns?: number;
	minutes?: number;
	/** Dollars, where the agent can cap its own spend. */
	usd?: number;
}

/** The repo a scenario seeds, and runs shell commands in. */
export interface Repo {
	dir: string;
	write(path: string, text: string): Promise<void>;
	/** Runs `argv` in the repo with the run's environment; throws when it fails. */
	run(argv: string[]): Promise<string>;
}

/** One step of what the agent did: something it said, or a tool it called and what came back. */
export type Step =
	| { kind: "text"; text: string }
	| { kind: "tool"; name: string; input: string; output: string | null };

/** What a run left: the agent's words and steps, and the repo as it ended. */
export interface Outcome {
	reply: string;
	transcript: Step[];
	/** Each shell command the agent ran, as it wrote it. */
	commands: string[];
	repo: Repo;
}
