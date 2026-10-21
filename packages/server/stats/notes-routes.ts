import { splatesHome } from "../models";
import type { Project } from "../server/shared";
import { FsStorage } from "../storage";
import { Adherence } from "./adherence";
import { noteStats } from "./notes";
import { Outcomes } from "./outcomes";

/** More events than a journal keeps, so all it still holds is read. */
const EVENTS = 1_000_000;

/** What the Stats page's Notes section reads, for one project. Spread into a project's routes. */
export class NoteStatsRoutes {
	constructor(private readonly project: Project) {}

	readonly noteStats = async (): Promise<Response> => {
		const { fs, ps, journal, service } = this.project;
		const storage = new FsStorage(splatesHome(ps), fs);
		const outcomes = new Outcomes(storage);
		return Response.json(
			noteStats(
				await journal.tail(EVENTS),
				await outcomes.list(),
				await new Adherence(storage, outcomes, fs).list(),
				service.git.root,
			),
		);
	};
}
