import type { Logger } from "webappwiz/log";
import type { Ps } from "webappwiz/system";
import { fail } from "../exit";
import type { Git } from "../git";
import type { Projects, Reach } from "./projects";

/**
 * `splates projects list`: each other project, with what it may do in the one
 * `git` is in, and what that one may do there.
 */
export async function listReaches(
	{ projects, git, log }: { projects: Projects; git: Git; log: Logger },
	{ json = false }: { json?: boolean } = {},
): Promise<void> {
	const others = (await projects.list()).filter(
		(each) => each.root !== git.root,
	);
	const rows = await Promise.all(
		others.map(async ({ slug, root, gone }) => ({
			slug,
			root,
			gone,
			here: await projects.reach(root, git.root),
			there: await projects.reach(git.root, root),
		})),
	);
	if (json) {
		log.info(JSON.stringify(rows));
		return;
	}
	if (rows.length === 0) {
		log.info("no other splates project is on this machine");
		return;
	}
	log.info(
		rows
			.map(
				(row) =>
					`#${row.slug}  ${row.root}${row.gone ? " (gone)" : ""}\n  here: ${row.here}  there: ${row.there}`,
			)
			.join("\n"),
	);
}

/**
 * `splates projects grant`: lets agents of the project `slug` names do as much
 * as `reach` in the one `git` is in. The person's call alone, so an agent is
 * refused: it asks with a grant card, whose Allow grants it.
 */
export async function grantReach(
	{
		projects,
		git,
		log,
		ps,
	}: { projects: Projects; git: Git; log: Logger; ps: Ps },
	slug: string,
	reach: Reach,
): Promise<void> {
	const asking = ps.env("SPLATES_CONVERSATION") ?? ps.env("SPLATES_STARTED_BY");
	if (asking !== undefined) {
		const here =
			(await projects.list()).find((each) => each.root === git.root)?.slug ??
			git.root;
		fail(
			"not_granted",
			`a grant is the user's to give: ask for it with a \`## 🔐 Permission: grant ${here} ${reach} to ${slug}\` card, whose Allow grants it`,
			{ project: slug, reach },
		);
	}
	const other = await projects.named(slug);
	await projects.grant(git.root, other.root, reach);
	log.info(`#${other.slug} may now ${GRANTED[reach]} here`);
}

/** What `grantReach` says a project may now do. */
const GRANTED: Record<Reach, string> = {
	read: "only read",
	queue: "add tasks to the queue",
	tasks: "hand out tasks",
};
