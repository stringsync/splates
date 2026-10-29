import type { CascadeSummary } from "@stringsync/splates-server/ship";
import { shipName } from "@stringsync/splates-server/ship/browser";
import { ArrowLeftIcon, ChevronRightIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { actOnShip, shipHistory, shipHistoryEntry } from "./api";
import type { ConversationFeed } from "./conversation-feed";
import { ShipGraphTree } from "./ship-graph";
import { ProjectStages, ShipRun } from "./ship-run";
import { TopBar } from "./top-bar";
import { type Live, useLiveShips } from "./use-live-ships";

/** Browse projects, unshipped commits and past ships; new ship planning is coming. */
export function ShipsPage(_props: {
	feed?: ConversationFeed | null;
}): JSX.Element {
	const viewed = useViewedShip();
	const live = useLiveShips();
	const [closed, setClosed] = useState<string | null>(null);
	const [history, setHistory] = useState<CascadeSummary[]>([]);
	useEffect(() => {
		shipHistory().then(setHistory, () => undefined);
	}, []);
	return (
		<section aria-label="ships" className="flex min-w-0 flex-col gap-6">
			<TopBar title="Ship" />
			{viewed !== null ? (
				<PastShip id={viewed} />
			) : (
				<>
					{live?.cascade != null && live.cascade.id !== closed && (
						<ShipRun
							cascade={live.cascade}
							ship={live.ship}
							onClose={() => setClosed(live.cascade?.id ?? null)}
							abandon={() => actOnShip("abandon")}
							retry={() => actOnShip("retry")}
							agent={() => actOnShip("agent")}
						/>
					)}
					<p className="text-muted-foreground text-sm">
						Ship-step planning is coming.
					</p>
					<ShipGraphTree
						endedAt={null}
						ready={false}
						starting={null}
						refusal={null}
						onShip={() => {}}
						onShipChanged={() => {}}
					/>
					{history.length > 0 && <History cascades={history} />}
				</>
			)}
		</section>
	);
}

const readViewed = () => location.hash.match(/^#ships\/([^/]+)$/)?.[1] ?? null;

/** The id `#ships/<id>` opens, kept as the hash changes. */
function useViewedShip(): string | null {
	const [id, setId] = useState(readViewed);
	useEffect(() => {
		const sync = () => setId(readViewed());
		window.addEventListener("hashchange", sync);
		return () => window.removeEventListener("hashchange", sync);
	}, []);
	return id === null ? null : decodeURIComponent(id);
}

/** The cascades that ended, newest first, each linking to its own page. */
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

function stoppedAt(summary: CascadeSummary): string {
	const stopped = summary.projects.find(
		(each) => each.status !== "done" && each.status !== "dropped",
	);
	return summary.status === "abandoned" || summary.status === "stopped"
		? `${summary.status}${stopped === undefined ? "" : ` at ${stopped.slug}`}`
		: `${summary.projects.length} project${summary.projects.length === 1 ? "" : "s"}`;
}

function Past({ summary }: { summary: CascadeSummary }): JSX.Element {
	return (
		<li aria-label={summary.id} className="py-2">
			<a
				href={`#ships/${encodeURIComponent(summary.id)}`}
				className="flex items-center gap-2 text-sm"
			>
				<span className="font-medium">{shipName(summary.from)}</span>
				<span className="text-muted-foreground text-xs">
					{stoppedAt(summary)}
				</span>
				<time
					dateTime={summary.started}
					className="ml-auto text-muted-foreground text-xs"
				>
					{new Date(summary.started).toLocaleString()}
				</time>
				<ChevronRightIcon aria-hidden className="size-3.5" />
			</a>
		</li>
	);
}

/** One legacy ship with its recorded timeline. */
function PastShip({ id }: { id: string }): JSX.Element {
	const [kept, setKept] = useState<Live | null>(null);
	useEffect(() => {
		setKept(null);
		shipHistoryEntry(id).then(setKept, () => undefined);
	}, [id]);
	const cascade = kept?.cascade ?? null;
	return (
		<section aria-label={id} className="flex flex-col gap-4">
			<a
				href="#ships"
				className="flex items-center gap-1 text-muted-foreground text-sm"
			>
				<ArrowLeftIcon aria-hidden className="size-3.5" />
				Ship
			</a>
			{kept === null && (
				<p className="text-muted-foreground text-xs">Reading…</p>
			)}
			{cascade !== null && (
				<>
					<div className="flex items-center gap-2">
						<h2 className="font-medium text-sm">{shipName(cascade.from)}</h2>
						<span className="text-muted-foreground text-xs">
							{cascade.status}
						</span>
					</div>
					<ProjectStages cascade={cascade} ship={null} live={false} />
				</>
			)}
		</section>
	);
}
