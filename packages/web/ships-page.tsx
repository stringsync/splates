import type { CascadeSummary } from "@stringsync/splates-server/ship";
import { ChevronRightIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { shipHistory, shipHistoryEntry } from "./api";
import { cn } from "./lib/utils";
import { ShipApproval } from "./ship-approval";
import { ShipDialog } from "./ship-dialog";
import { ShipGraphTree } from "./ship-graph";
import { ProjectStages, ShipRun } from "./ship-run";
import { TopBar } from "./top-bar";
import { type Live, useLiveShips } from "./use-live-ships";

/** Where the page keeps the stopped run the person closed, so it stays put away. */
const CLOSED_KEY = "splates.ship.closed";

/**
 * Every ship on this machine, across all its projects. With none under way,
 * the projects as a dependency tree, each with its Ship; with one under way,
 * or one that stopped until the person closes it, its projects in order,
 * each a stage of steps checked off as they go, with what waits on the
 * person pinned beneath; then the cascades that ended.
 */
export function ShipsPage(): JSX.Element {
	const live = useLiveShips();
	const [history, setHistory] = useState<CascadeSummary[]>([]);
	const [planning, setPlanning] = useState<ShipApproval | null>(() => {
		const query = new URLSearchParams(location.search);
		const project = query.get("project");
		if (project === null) {
			return null;
		}
		const approval = new ShipApproval(project);
		const bump = query.get("bump");
		if (bump === "patch" || bump === "minor" || bump === "major") {
			approval.bump = bump;
		}
		return approval;
	});
	const [closed, setClosed] = useState(() => localStorage.getItem(CLOSED_KEY));
	const cascade = live?.cascade ?? null;
	const shown =
		cascade?.status === "running" ||
		(cascade?.status === "stopped" && cascade.id !== closed)
			? cascade
			: null;
	const endedAt = cascade?.ended ?? null;
	// Read when the page opens, and again as a cascade ends.
	useEffect(() => {
		void endedAt;
		shipHistory().then(setHistory, () => undefined);
	}, [endedAt]);
	const close = (id: string) => {
		localStorage.setItem(CLOSED_KEY, id);
		setClosed(id);
	};
	return (
		<section aria-label="ships" className="flex min-w-0 flex-col gap-6">
			<TopBar title="Ship" />
			{planning !== null && (
				<ShipDialog approval={planning} onClose={() => setPlanning(null)} />
			)}
			{live === null && (
				<p role="status" className="text-muted-foreground text-sm">
					Reading ships…
				</p>
			)}
			{shown !== null && live !== null && (
				<ShipRun
					cascade={shown}
					ship={live.ship}
					onClose={() => close(shown.id)}
				/>
			)}
			{live !== null && shown === null && (
				<ShipGraphTree
					endedAt={endedAt}
					onShip={(slug) => setPlanning(new ShipApproval(slug))}
				/>
			)}
			{history.length > 0 && <History cascades={history} />}
		</section>
	);
}

/** The cascades that ended, newest first, each opening as the timeline it was. */
function History({ cascades }: { cascades: CascadeSummary[] }): JSX.Element {
	return (
		<section aria-label="history" className="flex flex-col gap-2">
			<h2 className="font-medium text-sm">History</h2>
			<ul className="flex flex-col divide-y">
				{cascades
					.filter((each) => each.status !== "running")
					.map((each) => (
						<Past key={each.id} summary={each} />
					))}
			</ul>
		</section>
	);
}

function Past({ summary }: { summary: CascadeSummary }): JSX.Element {
	const [open, setOpen] = useState(false);
	const [kept, setKept] = useState<Live | null>(null);
	useEffect(() => {
		if (open && kept === null) {
			shipHistoryEntry(summary.id).then(setKept, () => undefined);
		}
	}, [open, kept, summary.id]);
	const stopped = summary.projects.find(
		(each) => each.status !== "done" && each.status !== "dropped",
	);
	return (
		<li aria-label={summary.id} className="flex flex-col gap-1 py-2">
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="flex items-center gap-2 text-left text-sm"
			>
				<ChevronRightIcon
					aria-hidden
					className={cn("size-3.5 transition-transform", open && "rotate-90")}
				/>
				<span className="font-medium">{summary.from}</span>
				<span className="text-muted-foreground text-xs">
					{summary.status === "abandoned" || summary.status === "stopped"
						? `${summary.status}${stopped === undefined ? "" : ` at ${stopped.slug}`}`
						: `${summary.projects.length} project${summary.projects.length === 1 ? "" : "s"}`}
				</span>
				<time
					dateTime={summary.started}
					className="ml-auto text-muted-foreground text-xs"
				>
					{new Date(summary.started).toLocaleString()}
				</time>
			</button>
			{open && kept === null && (
				<p className="pl-5 text-muted-foreground text-xs">Reading…</p>
			)}
			{open && kept?.cascade != null && (
				<ProjectStages
					cascade={kept.cascade}
					ship={null}
					live={false}
					className="ml-5 pt-1"
				/>
			)}
		</li>
	);
}
