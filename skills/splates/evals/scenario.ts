import type { Scenario as Base } from "@evals/evals/scenario";
import { it as baseIt, describe, type SpecDefinition } from "@evals/evals/spec";

export { describe };

/** A scenario of the splates skill, which can also start in a project `splates init` has set up. */
export interface Scenario extends Base {
	/**
	 * Runs `splates init` after the seed commit, so `splates add` works as in
	 * a real project; the agent then starts a task like the skill says.
	 */
	initialized?: boolean;
}

/** A spec of the splates skill; `initialized` starts it in an initialized project. */
export interface Spec extends SpecDefinition {
	initialized?: boolean;
}

/** `it(sentence, spec)` that also carries `initialized`, keeping the spec's identity for `describe`. */
export function it(sentence: string, spec: Spec): Scenario {
	const { initialized, ...rest } = spec;
	const scenario: Scenario = baseIt(sentence, rest);
	if (initialized !== undefined) {
		scenario.initialized = initialized;
	}
	return scenario;
}
