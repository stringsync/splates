import type { Fs, Ps } from "webappwiz/system";
import { splatesHome } from "../models";
import type { Handler } from "../server/shared";
import { FsStorage } from "../storage";
import { Adherence } from "./adherence";
import type { NoteSource } from "./note-events";
import { noteStats } from "./notes";
import { Outcomes } from "./outcomes";

/** What the Stats page's Notes section reads, across the projects its filter takes in. */
export class NoteStatsRoutes {
	/**
	 * `sources` gives the journals of the project at main tree `root`, or of
	 * every project for none.
	 */
	constructor(
		private readonly home: {
			fs: Fs;
			ps: Ps;
			sources: (root: string | null) => Promise<NoteSource[]>;
		},
	) {}

	/** `?project=` narrows it to that main tree; all projects for none. */
	readonly noteStats: Handler = async (request) => {
		const { fs, ps, sources } = this.home;
		const root = new URL(request.url).searchParams.get("project") || null;
		const storage = new FsStorage(splatesHome(ps), fs);
		const outcomes = new Outcomes(storage);
		return Response.json(
			noteStats(
				await sources(root),
				await outcomes.list(),
				await new Adherence(storage, outcomes, fs).list(),
			),
		);
	};
}
