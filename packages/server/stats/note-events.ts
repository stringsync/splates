import type { Event } from "../records";
import type { Project } from "../server/shared";

/** More events than a journal keeps, so all it still holds is read. */
const EVENTS = 1_000_000;

/** One project's journal, by its main tree. */
export interface NoteSource {
	project: string;
	events: Event[];
}

/** What a project gives the Stats page's Notes section: its journal. Spread into a project's routes. */
export class NoteEventsRoutes {
	constructor(private readonly project: Project) {}

	readonly noteEvents = async (): Promise<NoteSource> => ({
		project: this.project.service.git.root,
		events: await this.project.journal.tail(EVENTS),
	});
}
