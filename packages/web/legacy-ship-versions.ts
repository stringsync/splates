import type { ShipBump, ShipProject } from "@splates/server/legacy-ship";

export const BUMPS: ShipBump[] = ["patch", "minor", "major"];

/** Preview the release identity for a selected project and version bump. */
export class ShipVersions {
	constructor(private readonly projects: ShipProject[]) {}
	after(slug: string, _bump: ShipBump): string | null {
		const project = this.projects.find((each) => each.slug === slug);
		if (project?.commandPlan !== undefined) {
			return project.commandPlan.identity.to;
		}
		if (project?.resuming !== undefined) {
			return project.resuming;
		}
		return null;
	}
}
