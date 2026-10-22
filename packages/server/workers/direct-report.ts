import { z } from "zod";
import { DirectJobReport, DirectRunnerReport } from "./direct-runner-report";

/**
 * What `splates run` sends `POST /api/runner-reports` when a server is up:
 * the runners it listed, all of them, and the job it moved on.
 */
export const DirectReport = z.object({
	runners: z.array(DirectRunnerReport).optional(),
	job: DirectJobReport.optional(),
});
export type DirectReport = z.infer<typeof DirectReport>;

/** The runners and jobs of `splates run`, as `GET /api/workers` gives them. */
export interface DirectBoardView {
	runners: (DirectRunnerReport & { jobs: DirectJobReport[] })[];
	/** Jobs that have no runner yet. */
	unplaced: DirectJobReport[];
}
