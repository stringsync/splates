import type { CascadeSummary } from "@stringsync/splates-server/ship";
import { shipName } from "@stringsync/splates-server/ship/browser";
import { ArrowLeftIcon, ChevronRightIcon, ShipIcon } from "lucide-react";
import { type JSX, useContext, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { shipHistory, shipHistoryEntry } from "./api";
import type { ConversationFeed } from "./conversation-feed";
import { NavigationContext } from "./navigation";
import { refusalOf } from "./refusal";
import { ShipGraphTree } from "./ship-graph";
import { ProjectStages, ShipRun } from "./ship-run";
import { ShipStart } from "./ship-start";
import { TopBar } from "./top-bar";
import { type Live, useLiveShips } from "./use-live-ships";

/** Where the page keeps the stopped run the person closed, so it stays put away. */
const CLOSED_KEY = "splates.ship.closed";

/** What the person picked to ship: projects by slug, none to replan a stopped run, or every changed one. */
type PickedShip = { projects: string[]; label: string } | null;

/**
 * Every ship on this machine, across all its projects. With none under way,
 * the projects as a dependency tree, where the person picks what to ship and
 * starts its conversation in General; with one under way, or one that
 * stopped until the person closes it, its projects in order, each a stage of
 * steps checked off as they go, with what waits on the person pinned
 * beneath; then the cascades that ended.
 */
export function ShipsPage({
	feed = null,
}: {
	/** Where the ship's conversation starts, or null while `splates server` holds none. */
	feed?: ConversationFeed | null;
}): JSX.Element {
	const live = useLiveShips();
	const viewed = useViewedShip();
	const navigation = useContext(NavigationContext);
	const [history, setHistory] = useState<CascadeSummary[]>([]);
	const [picked, setPicked] = useState<PickedShip>(() => {
		const query = new URLSearchParams(location.search);
		// `?ship=` names the project a card asks to ship; `?project=` only
		// names the focused one.
		const project = query.get("ship");
		if (project === null) {
			return null;
		}
		query.delete("ship");
		const rest = query.toString();
		window.history.replaceState(
			null,
			"",
			`${location.pathname}${rest === "" ? "" : `?${rest}`}${location.hash}`,
		);
		return { projects: [project], label: project };
	});
	const [starting, setStarting] = useState(false);
	const [refusal, setRefusal] = useState<string | null>(null);
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
	const pick = (projects: string[], label: string) => {
		setRefusal(null);
		setPicked({ projects, label });
	};
	// A stopped run replans from what it published, so none are named.
	const recover = (run: { from: string }) => pick([], run.from);
	const start = async () => {
		if (picked === null || feed === null || starting) {
			return;
		}
		setStarting(true);
		setRefusal(null);
		try {
			navigation.go(await new ShipStart(feed).begin(picked.projects));
		} catch (error) {
			setRefusal(refusalOf(`The ship of ${picked.label} did not start`, error));
			setStarting(false);
		}
	};
	const choice = picked !== null && (
		<Picked
			picked={picked}
			ready={feed !== null}
			starting={starting}
			refusal={refusal}
			onStart={() => void start()}
			onCancel={() => setPicked(null)}
		/>
	);
	const close = (id: string) => {
		localStorage.setItem(CLOSED_KEY, id);
		setClosed(id);
	};
	if (viewed !== null) {
		return (
			<section aria-label="ships" className="flex min-w-0 flex-col gap-6">
				<TopBar title="Ship" />
				{choice}
				<PastShip id={viewed} onRecover={recover} />
			</section>
		);
	}
	return (
		<section aria-label="ships" className="flex min-w-0 flex-col gap-6">
			<TopBar title="Ship" />
			{choice}
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
					onRecover={() => recover(shown)}
				/>
			)}
			{live !== null && shown === null && (
				<ShipGraphTree
					endedAt={endedAt}
					onShip={(slug) => pick([slug], slug)}
					onShipChanged={(changed) => pick(changed, "every changed project")}
				/>
			)}
			{history.length > 0 && <History cascades={history} />}
		</section>
	);
}

/** What the person picked to ship, with Start for its conversation, which shapes the plan with them. */
function Picked({
	picked,
	ready,
	starting,
	refusal,
	onStart,
	onCancel,
}: {
	picked: NonNullable<PickedShip>;
	ready: boolean;
	starting: boolean;
	refusal: string | null;
	onStart: () => void;
	onCancel: () => void;
}): JSX.Element {
	return (
		<section
			aria-label="ship picked"
			className="flex flex-col gap-3 rounded-lg border border-primary/25 bg-primary/5 p-3"
		>
			<span className="flex flex-col">
				<span className="font-medium text-sm">
					{picked.projects.length === 0
						? `Replan the stopped ship of ${picked.label}`
						: `Ship ${picked.label}`}
				</span>
				<span className="text-muted-foreground text-xs">
					Starts a conversation in General that plans the ship with you. Nothing
					is published until you approve its plan.
				</span>
			</span>
			{refusal !== null && (
				<p role="alert" className="text-destructive text-xs">
					{refusal}
				</p>
			)}
			<div className="flex gap-2">
				<Button
					className="flex-1"
					size="lg"
					disabled={!ready || starting}
					onClick={onStart}
				>
					<ShipIcon />
					Start a ship conversation
				</Button>
				<Button
					size="lg"
					variant="outline"
					disabled={starting}
					onClick={onCancel}
				>
					Cancel
				</Button>
			</div>
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

/** One ended ship on its own page: its timeline, and Recover when it stopped. */
function PastShip({
	id,
	onRecover,
}: {
	id: string;
	onRecover: (run: { from: string; id: string }) => void;
}): JSX.Element {
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
					{(cascade.status === "stopped" || cascade.status === "abandoned") && (
						<Button
							className="w-full"
							size="lg"
							onClick={() => onRecover(cascade)}
						>
							Recover
						</Button>
					)}
					<ProjectStages cascade={cascade} ship={null} live={false} />
				</>
			)}
		</section>
	);
}
