import type { Logger } from "webappwiz/log";
import type { Fs, Ps } from "webappwiz/system";
import { ConfigFiles } from "../config";
import { fail } from "../exit";
import type { Git } from "../git";
import type { Projects } from "../projects";
import { DEFAULT_PORT } from "../server/shared";
import { table } from "../table";
import type { Cascade } from "./cascade";
import { readGraph, type ShipGraph } from "./graph";
import { planShip, ShipPlanError, type ShipStep } from "./plan";
import type { Ship } from "./run";

/** What `shipPlan` works with. */
export interface ShipContext {
	projects: Pick<Projects, "list">;
	git: Pick<Git, "root">;
	fs: Fs;
	ps: Ps;
	log: Logger;
	/** What each project's `ship` is read from; its `splates.config.ts` by default. */
	configs?: Pick<ConfigFiles, "read">;
	/** How a ship reaches `splates server`; the global fetch by default. */
	fetch?: (url: string, init?: RequestInit) => Promise<Response>;
}

/**
 * `splates ship`: asks `splates server` (`dev`, else the one SPLATES_DEV
 * names, else this machine's on its default port) to ship `project`, the one
 * `git` is in for none, and its cascade through the projects downstream,
 * following the first ship to its end; while a cascade is under way, prints
 * it instead of starting another. With `plan`, prints what shipping it would
 * do, running nothing; with `drop`, takes that project out of the cascade
 * under way. A ship is the person's to start, so an agent is refused even
 * the plan and told to ask with a card, whose Ship on the page starts it.
 */
export async function ship(
	ctx: ShipContext,
	{
		project,
		plan = false,
		json = false,
		dev = "",
		drop,
	}: {
		project?: string;
		plan?: boolean;
		json?: boolean;
		dev?: string;
		drop?: string;
	},
): Promise<void> {
	const asking =
		ctx.ps.env("SPLATES_CONVERSATION") ?? ctx.ps.env("SPLATES_STARTED_BY");
	if (asking !== undefined) {
		fail(
			"not_granted",
			`a ship is the person's to start: ask for one with a \`## 🔐 Permission: run command: <why>\` card naming \`splates ship${project === undefined ? "" : ` ${project}`}\`, whose Ship starts it on splates server, and end your turn; on [SPLATES RUN ALLOWED] it is already running, so do not run it`,
			{ caller: asking },
		);
	}
	if (!plan) {
		await shipOnServer(ctx, {
			slug: drop ?? project ?? (await thisProject(ctx)),
			dev,
			drop: drop !== undefined,
		});
		return;
	}
	const graph = await registeredGraph(ctx);
	const slug =
		project ??
		graph.projects.find((each) => each.root === ctx.git.root)?.slug ??
		fail("usage", "this repository is not a registered splates project", {
			root: ctx.git.root,
		});
	let steps: ShipStep[];
	try {
		steps = planShip(graph, slug).steps;
	} catch (error) {
		if (error instanceof ShipPlanError) {
			fail(error.reason, error.message, { project: slug });
		}
		throw error;
	}
	if (json) {
		ctx.log.info(JSON.stringify({ from: slug, steps }));
		return;
	}
	ctx.log.info(
		table(
			["#", "PROJECT", "ACTION", "VERSION", "PUBLISHES", "TAKES", "WHY"],
			steps.map((step, i) => [
				String(i + 1),
				step.slug,
				step.action,
				step.to === null
					? (step.from ?? "-")
					: `${step.from ?? "-"} → ${step.to}`,
				step.publishes.join(", ") || "-",
				step.takes
					.flatMap((use) => use.pins.map((pin) => pin.name))
					.join(", ") || "-",
				step.why,
			]),
		),
	);
}

/** The registered project `git` is in. */
async function thisProject(ctx: ShipContext): Promise<string> {
	return (
		(await ctx.projects.list()).find((each) => each.root === ctx.git.root)
			?.slug ??
		fail("usage", "this repository is not a registered splates project", {
			root: ctx.git.root,
		})
	);
}

/**
 * Starts the cascade of `slug`'s ship on the server, which runs each ship
 * on its machine under the person's npm sign-in, and prints the first
 * ship's output until it ends: npm's links are in it, and on the page as
 * well, for any device. Prints the cascade under way instead when there is
 * one; with `drop`, drops `slug` from it.
 */
async function shipOnServer(
	ctx: ShipContext,
	{ slug, dev, drop }: { slug: string; dev: string; drop: boolean },
): Promise<void> {
	const url =
		dev || ctx.ps.env("SPLATES_DEV") || `http://localhost:${DEFAULT_PORT}`;
	const send = ctx.fetch ?? fetch;
	const ask = async (method: string, path: string): Promise<Response> => {
		let response: Response;
		try {
			// The server refuses a request from any other origin than its own.
			response = await send(
				new URL(`${path}?project=${encodeURIComponent(slug)}`, url).toString(),
				{ method, headers: { origin: url } },
			);
		} catch (error) {
			fail(
				"not_found",
				`splates server at ${url} could not be reached: ${error instanceof Error ? error.message : String(error)}; give its URL with --dev`,
			);
		}
		if (!response.ok) {
			fail(
				response.status === 409 ? "conflict" : "usage",
				`splates server at ${url} refused: ${response.status} ${await response.text()}`,
				{ project: slug },
			);
		}
		return response;
	};
	if (drop) {
		const left = (await (
			await ask("DELETE", "/api/ship/cascade")
		).json()) as Cascade;
		ctx.log.info(`dropped ${slug} from the ship of ${left.from}`);
		ctx.log.info(cascadeTable(left));
		return;
	}
	const response = await ask("POST", "/api/ship");
	const cascade = (await response.json()) as Cascade;
	if (response.status !== 201) {
		ctx.log.info(
			`the ship of ${cascade.from} is under way, so no other starts until it is done; \`splates ship --drop <project>\` takes a stopped project out of it`,
		);
		ctx.log.info(cascadeTable(cascade));
		return;
	}
	const downstream = cascade.steps.length - 1;
	ctx.log.info(
		`shipping ${slug} from ${cascade.steps[0]?.from ?? "its current version"} on ${url}, which shows npm's sign-in and 2FA links too${downstream === 0 ? "" : `, then ${downstream} project(s) downstream`}`,
	);
	const output = (await ask("GET", "/api/ship/output")).body;
	if (output !== null) {
		let pending = "";
		const decoder = new TextDecoder();
		for await (const chunk of output) {
			const lines = (pending + decoder.decode(chunk, { stream: true })).split(
				"\n",
			);
			pending = lines.pop() ?? "";
			for (const line of lines) {
				ctx.log.info(line);
			}
		}
		if (pending !== "") {
			ctx.log.info(pending);
		}
	}
	const ended = (await (await ask("GET", "/api/ship")).json()) as Ship | null;
	if (ended?.status === "failed") {
		fail("hook_failed", ended.error ?? `the ship of ${slug} failed`, {
			project: slug,
		});
	}
	ctx.log.info(
		ended?.status === "done"
			? `shipped ${slug}${ended.to === null ? "" : ` ${ended.to}`}`
			: `the ship of ${slug} goes on in splates server; the page shows it`,
	);
	if (downstream > 0) {
		ctx.log.info(
			`the cascade goes on in splates server, through bump tasks queued in each project downstream: \`splates ship\` shows where it stands`,
		);
	}
}

/** Each project of `cascade` and where it stands. */
function cascadeTable(cascade: Cascade): string {
	return table(
		["#", "PROJECT", "ACTION", "STATUS", "TASK", "NOTE"],
		cascade.steps.map((step, i) => [
			String(i + 1),
			step.slug,
			step.action,
			step.status,
			step.task === null ? "-" : `#${step.task}`,
			step.note ?? "",
		]),
	);
}

/**
 * The graph of every registered project still on disk, each with the `ship`
 * its `splates.config.ts` names. One whose config does not load is warned of
 * and drawn as never shipped, rather than leaving every plan without it.
 */
export async function registeredGraph(
	ctx: Pick<ShipContext, "projects" | "fs" | "log" | "configs">,
): Promise<ShipGraph> {
	const files = ctx.configs ?? new ConfigFiles(ctx.fs);
	const sources = await Promise.all(
		(await ctx.projects.list())
			.filter((each) => !each.gone)
			.map(async ({ slug, root }) => {
				const ship = await files.read(root).then(
					(config) => config.ship ?? null,
					(error: unknown) => {
						ctx.log.error(`${slug}: ${error}; drawn as never shipped`);
						return null;
					},
				);
				return { slug, root, ship };
			}),
	);
	return readGraph(ctx.fs, sources);
}
