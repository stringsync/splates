import type { Scenario as Base } from "@evals/evals/scenario";

/** A scenario of the splates skill, which can also start in a project `splates init` has set up. */
export interface Scenario extends Base {
	/**
	 * Runs `splates init` after the seed commit, so `splates add` works as in
	 * a real project; the agent then starts a task like the skill says.
	 */
	initialized?: boolean;
}
