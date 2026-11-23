import type {
	Group,
	Rig,
	RigsPage as RigsListing,
	RunView,
} from "@splates/server/rigs/browser";
import { useReactive, useResource } from "core/react";
import { ChevronRightIcon, PlayIcon, RefreshCwIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { renderAnsiLine } from "./ansi-line";
import { rigsPage, stopRun } from "./api/rigs";
import { Button } from "./components/ui/button";
import { RigRunPage } from "./rig-run-page";
import { RigStartDialog } from "./rig-start-dialog";
import { RunDot } from "./rig-state";
import { type RigsApi, RigsFlow } from "./rigs-flow";
import { RouteTrail } from "./route-trail";
import { TopBar } from "./top-bar";

const SERVER: RigsApi = { rigsPage, stopRun };

/**
 * The Rigs page: the runs going now, each opening on its own page with its
 * links, log and stop, over the rigs the project's `rigs` commands declare,
 * grouped by the command that declares them, each started on main or a
 * task's worktree from a form of its options. `#rigs/<run>` opens a run.
 */
export function RigsPage({
	api = SERVER,
}: {
	/** Where it reads and stops runs; the server's by default. */
	api?: RigsApi;
} = {}): JSX.Element {
	const flow = useResource(() => new RigsFlow(api), [api]);
	useEffect(() => {
		const watching = flow.watch();
		return () => watching.dispose();
	}, [flow]);
	const { listing, failed, starting } = useReactive(
		flow,
		(each) => each.state,
		["changed"],
	);
	const open = useRunAddress();
	const opened = listing?.runs.find((run) => run.id === open) ?? null;
	const toList = () => {
		location.hash = LIST;
	};

	return (
		<>
			<TopBar
				title={
					open === null ? (
						"Rigs"
					) : (
						<RouteTrail
							items={[
								{ label: "Rigs", onClick: toList },
								{
									label:
										opened === null
											? "Run"
											: `${opened.label} on ${opened.tree}`,
								},
							]}
						/>
					)
				}
				actions={[
					{
						label: "Read the rigs again",
						icon: <RefreshCwIcon />,
						run: () => void flow.refresh(true),
					},
				]}
			/>
			<div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
				{failed !== null && listing === null && (
					<p className="text-destructive text-sm">{failed}</p>
				)}
				{listing === null && failed === null && (
					<p className="text-muted-foreground text-sm">Reading the rigs…</p>
				)}
				{listing !== null && open !== null && (
					<RunOrGone
						run={opened}
						onStop={(run) => {
							toList();
							void flow.stop(run.id);
						}}
						onAgain={(run) => {
							toList();
							void flow.again(run);
						}}
					/>
				)}
				{listing !== null && open === null && (
					<Listing
						listing={listing}
						onStart={(group, rig) => flow.startForm(group, rig)}
					/>
				)}
			</div>
			{starting !== null && listing !== null && (
				<RigStartDialog
					key={`${starting.group.name}/${starting.rig.name}`}
					group={starting.group.name}
					command={starting.group.command}
					rig={starting.rig}
					trees={listing.trees}
					tree={starting.tree}
					busy={flow.busy(starting.group.name, starting.rig.name)}
					presets={listing.presets}
					onPresets={(presets) => flow.presets(presets)}
					onStarted={(id) => {
						flow.started(id);
						location.hash = runAddress(id);
					}}
					onClose={() => flow.closeStart()}
				/>
			)}
		</>
	);
}

/** The address of the list, and of run `id` on its own page. */
const LIST = "#rigs";
const runAddress = (id: string) => `${LIST}/${encodeURIComponent(id)}`;

/** The run `hash` opens, or null for the list. */
function runIn(hash: string): string | null {
	const [, id] = hash.match(/^#rigs\/([^/]+)$/) ?? [];
	return id === undefined ? null : decodeURIComponent(id);
}

/** The run the address names, or a line saying it is gone. */
function RunOrGone({
	run,
	onStop,
	onAgain,
}: {
	run: RunView | null;
	onStop: (run: RunView) => void;
	onAgain: (run: RunView) => void;
}): JSX.Element {
	if (run === null) {
		return (
			<p className="text-muted-foreground text-sm">
				This run has stopped.{" "}
				<a href={LIST} className="underline underline-offset-2">
					Back to the rigs
				</a>
			</p>
		);
	}
	return (
		<RigRunPage
			key={run.id}
			run={run}
			onStop={() => onStop(run)}
			onAgain={() => onAgain(run)}
		/>
	);
}

function Listing({
	listing,
	onStart,
}: {
	listing: RigsListing;
	onStart: (group: Group, rig: Rig) => void;
}): JSX.Element {
	const label = (name: string) =>
		listing.groups.find((group) => group.name === name)?.label ?? name;
	// Exited runs sink below the live ones, which are what the user came for.
	const runs = [
		...listing.runs.filter((run) => run.state !== "exited"),
		...listing.runs.filter((run) => run.state === "exited"),
	];
	return (
		<>
			{runs.length > 0 && (
				<Section title={runsTitle(runs)}>
					<ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
						{runs.map((run) => (
							<li key={run.id}>
								<RunRow run={run} group={label(run.group)} />
							</li>
						))}
					</ul>
				</Section>
			)}
			{listing.errors.map((each) => (
				<p
					key={each.command}
					className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
				>
					<code className="font-mono text-xs">{each.command}</code> could not
					describe its rigs: {each.error}
				</p>
			))}
			{listing.groups.length === 0 && listing.errors.length === 0 ? (
				<NoRigs />
			) : (
				<Section
					title={listing.runs.length > 0 ? "Can start" : undefined}
					lead="Dev servers each project declares. A run on a task's worktree stops when the task ends."
				>
					{listing.groups.map((group) => (
						<RigGroup
							key={group.name}
							group={group}
							running={
								listing.runs.filter(
									(run) => run.group === group.name && run.state !== "exited",
								).length
							}
							onStart={(rig) => onStart(group, rig)}
						/>
					))}
				</Section>
			)}
		</>
	);
}

function Section({
	title,
	lead,
	children,
}: {
	title?: string;
	lead?: string;
	children: React.ReactNode;
}): JSX.Element {
	return (
		<section className="flex flex-col gap-3">
			{title !== undefined && (
				<h2 className="font-semibold text-muted-foreground text-xs uppercase tracking-wide">
					{title}
				</h2>
			)}
			{lead !== undefined && (
				<p className="-mt-1 text-muted-foreground text-sm">{lead}</p>
			)}
			{children}
		</section>
	);
}

/** A run going now, or exited, as a row opening its page. */
function RunRow({ run, group }: { run: RunView; group: string }): JSX.Element {
	const link = run.ports[0];
	const address =
		link === undefined
			? null
			: link.remote !== null
				? `${run.slot === null ? "" : `${run.slot.emoji} `}${bare(link.remote)}`
				: bare(link.local);
	const detail =
		run.state === "exited"
			? `Exited${run.exitCode === null ? "" : ` ${run.exitCode}`} · ${plain(run.lastLine ?? "")}`
			: run.state === "unhealthy"
				? `Unhealthy · ${run.health ?? ""}`
				: run.state === "starting"
					? "Starting…"
					: `Healthy${address === null ? "" : ` · ${address}`}`;
	return (
		<a
			href={runAddress(run.id)}
			aria-label={`${run.label} on ${run.tree}`}
			className="flex min-h-14 items-center gap-3 px-4 py-2.5 hover:bg-muted/40"
		>
			<RunDot state={run.state} />
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex min-w-0 items-baseline gap-1.5 text-sm">
					<span className="shrink-0 font-medium">{run.label}</span>
					<span className="shrink-0 text-muted-foreground text-xs">on</span>
					<span className="truncate font-mono text-[13px]">{run.tree}</span>
				</span>
				<span className="truncate text-muted-foreground text-xs">
					{group} · {detail}
				</span>
			</span>
			<ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
		</a>
	);
}

/** The rigs one command declares, as Signals groups a project's signals. */
function RigGroup({
	group,
	running,
	onStart,
}: {
	group: Group;
	running: number;
	onStart: (rig: Rig) => void;
}): JSX.Element {
	const count = group.rigs.length;
	return (
		<section
			aria-label={`rigs of ${group.label ?? group.name}`}
			className="overflow-hidden rounded-xl border bg-card shadow-xs"
		>
			<header className="flex items-baseline gap-2.5 border-b px-4 py-3">
				<h3 className="font-mono font-semibold text-sm">
					{group.label ?? group.name}
				</h3>
				<span className="text-muted-foreground text-xs">
					{count} {count === 1 ? "rig" : "rigs"}
					{running > 0 && ` · ${running} running`}
				</span>
			</header>
			<ul className="divide-y">
				{group.rigs.map((rig) => (
					<li
						key={rig.name}
						className="flex min-h-14 items-center gap-3 px-4 py-2.5"
					>
						<span className="flex min-w-0 flex-1 flex-col gap-0.5">
							<span className="font-medium text-sm">{rig.label}</span>
							{rig.description !== undefined && (
								<span className="text-muted-foreground text-xs">
									{rig.description}
								</span>
							)}
						</span>
						<Button
							variant="outline"
							aria-label={`Start ${rig.label}`}
							onClick={() => onStart(rig)}
						>
							<PlayIcon />
							Start
						</Button>
					</li>
				))}
			</ul>
		</section>
	);
}

function NoRigs(): JSX.Element {
	return (
		<div className="flex flex-col gap-2 rounded-xl border border-dashed p-5 text-sm">
			<p className="font-medium">No rigs declared</p>
			<p className="text-muted-foreground">
				Name the commands that declare this project's dev servers in{" "}
				<code className="font-mono text-xs">splates.config.ts</code>, as{" "}
				<code className="font-mono text-xs">rigs: ["bin/app rig"]</code>. Each
				answers <code className="font-mono text-xs">describe</code> with its
				rigs and <code className="font-mono text-xs">start &lt;rig&gt;</code> to
				run one, listening on <code className="font-mono text-xs">PORT</code>.
			</p>
		</div>
	);
}

/** The run the address opens, following it as it changes. */
function useRunAddress(): string | null {
	const [open, setOpen] = useState(() => runIn(location.hash));
	useEffect(() => {
		const changed = () => setOpen(runIn(location.hash));
		window.addEventListener("hashchange", changed);
		return () => window.removeEventListener("hashchange", changed);
	}, []);
	return open;
}

/** "Running · 2", with "· 1 exited" after it when any has; "Exited · 1" when none runs. */
function runsTitle(runs: RunView[]): string {
	const exited = runs.filter((run) => run.state === "exited").length;
	const live = runs.length - exited;
	if (live === 0) {
		return `Exited · ${exited}`;
	}
	return `Running · ${live}${exited > 0 ? ` · ${exited} exited` : ""}`;
}

/** `href` without its scheme. */
function bare(href: string): string {
	return href.replace(/^https?:\/\//, "");
}

/** `line` as a terminal would show it, without its colours. */
function plain(line: string): string {
	return renderAnsiLine(line)
		.map((span) => span.text)
		.join("");
}
