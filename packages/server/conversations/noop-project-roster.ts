import type { Reach } from "../projects";
import type { ProjectRef, ProjectRoster } from "./host";

/** The splates projects of a machine that has none: it lists nothing and lets nothing reach further than a project grants by default. */
export class NoopProjectRoster implements ProjectRoster {
	async list(): Promise<(ProjectRef & { gone: boolean })[]> {
		return [];
	}

	async reach(_from: string, _to: string): Promise<Reach> {
		return "queue";
	}
}
