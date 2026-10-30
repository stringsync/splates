import type { CascadeSummary } from "@stringsync/splates-server/ship";
import { shipName } from "@stringsync/splates-server/ship/browser";
import { ChevronRightIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { actOnShip, shipHistory, shipHistoryEntry } from "./api";
import { BackButton } from "./back-button";
import type { ConversationFeed } from "./conversation-feed";
import { ShipPlan } from "./ship-plan";
import { ProjectStages, ShipRun } from "./ship-run";
import { TopBar } from "./top-bar";
import { type Live, useLiveShips } from "./use-live-ships";

/**
 * Where you plan a ship: pick the projects that release, press Start, and
 * open past ships. The ship under way, and each past one, has its own page.
 */
export function ShipsPage(_props: {
	feed?: ConversationFeed | null;
}): JSX.Element {
	const viewed = useViewedShip();
	const live = useLiveShips();
	const busy =
		live?.cascade?.status === "running" || live?.cascade?.status === "stopped";
	// Planning waits while a ship is under way: the Ship tab opens that ship.
	useEffect(() => {
		if (viewed === null && busy) {
			location.replace(`#ships/${ACTIVE}`);
		}
	}, [viewed, busy]);
	const [closed, setClosed] = useState<string | null>(null);
	const [past, setPast] = useState<CascadeSummary[]>([]);
	useEffect(() => {
		shipHistory().then(setPast, () => undefined);
	}, []);
	return (
		<section aria-label="ships" className="flex min-w-0 flex-col gap-6">
			<TopBar
				leading={
					viewed === null || (viewed === ACTIVE && busy) ? undefined : (
						<BackButton
							parent="Ship"
							onBack={() => {
								location.hash = "ships";
							}}
						/>
					)
				}
				title={
					viewed === null
						? "Ship"
						: viewed === ACTIVE
							? "Active ship"
							: "Past ship"
				}
			/>
			{viewed === ACTIVE ? (
				<ActiveShip
					live={live}
					closed={closed}
					onClose={setClosed}
					act={actOnShip}
				/>
			) : viewed !== null ? (
				<PastShip id={viewed} />
			) : (
				<>
					<ShipPlan
						ship={new URLSearchParams(location.search).get("ship")}
						endedAt={live?.cascade?.ended ?? null}
						busy={busy}
						loading={live === null}
						onStarted={() => {
							const url = new URL(location.href);
							url.searchParams.delete("ship");
							history.replaceState(null, "", url);
							location.hash = `ships/${ACTIVE}`;
						}}
					/>
					{past.length > 0 && <History cascades={past} />}
				</>
			)}
		</section>
	);
}

/** What `#ships/active` opens: the ship under way, rather than a past one. */
const ACTIVE = "active";

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

/** The ship under way, which a started plan brings the person to. */
function ActiveShip({
	live,
	closed,
	onClose,
	act,
}: {
	live: Live | null;
	closed: string | null;
	onClose: (id: string | null) => void;
	act: (action: "abandon" | "retry" | "agent") => Promise<void>;
}): JSX.Element {
	if (live === null) {
		return <p className="text-muted-foreground text-sm">Reading…</p>;
	}
	if (live.cascade == null || live.cascade.id === closed) {
		return (
			<p className="text-muted-foreground text-sm">
				No ship is under way. <a href="#ships">Plan one</a>
			</p>
		);
	}
	return (
		<ShipRun
			cascade={live.cascade}
			ship={live.ship}
			onClose={() => {
				onClose(live.cascade?.id ?? null);
				location.hash = "ships";
			}}
			abandon={() => act("abandon")}
			retry={() => act("retry")}
			agent={() => act("agent")}
		/>
	);
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
				<span className="text-muted-foreground text-sm">
					{stoppedAt(summary)}
				</span>
				<time
					dateTime={summary.started}
					className="ml-auto text-muted-foreground text-sm"
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
			{kept === null && (
				<p className="text-muted-foreground text-sm">Reading…</p>
			)}
			{cascade !== null && (
				<>
					<div className="flex items-center gap-2">
						<h2 className="font-medium text-sm">{shipName(cascade.from)}</h2>
						<span className="text-muted-foreground text-sm">
							{cascade.status}
						</span>
					</div>
					<ProjectStages cascade={cascade} ship={null} live={false} />
				</>
			)}
		</section>
	);
}
