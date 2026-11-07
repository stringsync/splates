import { age } from "@splates/server/age";
import {
	shipFailureReference,
	shipSlowReference,
} from "@splates/server/plans/browser";
import type { CascadeSummary, StageKey } from "@splates/server/ship";
import { shipName } from "@splates/server/ship/browser";
import { type JSX, useEffect, useState } from "react";
import { ActiveShip } from "./active-ship";
import {
	actOnShip,
	recordShipAgent,
	shipHistory,
	shipHistoryEntry,
	shipStageLog,
} from "./api";
import { promptConversation, startAutoPick } from "./conversation-api";
import type { ConversationFeed } from "./conversation-feed";
import { HistoryRow, PLANNER_COLUMN } from "./history-row";
import { cn } from "./lib/utils";
import { RouteTrail } from "./route-trail";
import { ShipHistory } from "./ship-history";
import { ShipPlan } from "./ship-plan";
import { useAcknowledged } from "./ship-recap-seen";
import { ProjectStages } from "./ship-run";
import { ShipRunningCard } from "./ship-running-card";
import { TopBar } from "./top-bar";
import { type Live, useLiveShips } from "./use-live-ships";

/**
 * Where you plan a ship: pick the projects that release, press Start, and
 * open past ships. The ship under way, and each past one, has its own page.
 */
export function ShipsPage({
	feed = null,
}: {
	feed?: ConversationFeed | null;
}): JSX.Element {
	const viewed = useViewedShip();
	const live = useLiveShips();
	const [closed, setClosed] = useState<string | null>(null);
	const acknowledged = useAcknowledged();
	// The cascade on show when Start was pressed: the stream still holds it
	// until the new ship's first message, so it must not be shown as the new one.
	const [previous, setPrevious] = useState<string | null>(null);
	const busy =
		(live?.cascade?.status === "running" ||
			live?.cascade?.status === "stopped") &&
		live.cascade.id !== closed;
	// A finished ship's recap stays until the person acknowledges it.
	const unacknowledged =
		live?.cascade != null &&
		["done", "abandoned"].includes(live.cascade.status) &&
		live.cascade.id !== closed &&
		live.cascade.id !== acknowledged;
	// A ship put away has no page left: land on the planner.
	useEffect(() => {
		if (
			viewed === ACTIVE &&
			live !== null &&
			(live.cascade == null ||
				live.cascade.id === closed ||
				live.cascade.id === acknowledged)
		) {
			location.replace("#ships");
		}
	}, [viewed, live, closed, acknowledged]);
	const [past, setPast] = useState<CascadeSummary[] | null>(null);
	useEffect(() => {
		shipHistory().then(setPast, () => setPast([]));
	}, []);
	return (
		<section aria-label="ships" className="flex min-w-0 flex-col gap-6">
			<TopBar
				title={
					viewed === null ? (
						"Ship"
					) : (
						<RouteTrail
							items={[
								{
									label: "Ship",
									onClick: () => {
										location.hash = "ships";
									},
								},
								{
									label:
										viewed === ACTIVE
											? "Active ship"
											: viewed === HISTORY
												? "History"
												: "Past ship",
								},
							]}
						/>
					)
				}
			/>
			{viewed === ACTIVE ? (
				<ActiveShip
					live={live}
					closed={closed}
					previous={previous}
					onClose={(id) => {
						setClosed(id);
						location.hash = "ships";
					}}
					act={actOnShip}
					sendSlowToAgent={
						feed === null
							? undefined
							: async (slow) => {
									const opened = await sendSlowShipToAgent(feed, slow);
									location.hash = `conversations/${opened}`;
								}
					}
					sendToAgent={
						feed === null
							? undefined
							: async (failure) => {
									const opened = await sendShipToAgent(feed, failure);
									location.hash = `conversations/${opened}`;
								}
					}
				/>
			) : viewed === HISTORY ? (
				<div className={PLANNER_COLUMN}>
					<ShipHistory cascades={past} />
				</div>
			) : viewed !== null ? (
				<PastShip id={viewed} />
			) : (
				<div className={cn(PLANNER_COLUMN, "gap-3")}>
					{live?.cascade != null && (busy || unacknowledged) && (
						<ShipRunningCard cascade={live.cascade} href={`#ships/${ACTIVE}`} />
					)}
					<HistoryRow href={`#ships/${HISTORY}`} summary={lastShipped(past)} />
					<ShipPlan
						ready={live !== null && past !== null}
						ship={new URLSearchParams(location.search).get("ship")}
						endedAt={live?.cascade?.ended ?? null}
						busy={busy}
						loading={live === null}
						onStarted={() => {
							setPrevious(live?.cascade?.id ?? null);
							const url = new URL(location.href);
							url.searchParams.delete("ship");
							history.replaceState(null, "", url);
							location.hash = `ships/${ACTIVE}`;
						}}
					></ShipPlan>
				</div>
			)}
		</section>
	);
}

/**
 * Starts a conversation, on Auto pick, that
 * is told to look into the ship's failure; answers its id.
 */
async function sendShipToAgent(
	feed: ConversationFeed,
	failure: {
		id: string;
		project: string;
		stage: StageKey | null;
		note: string | null;
	},
): Promise<string> {
	// What the stage printed goes in the text: the agent may not reach the server.
	const log =
		failure.stage === null
			? null
			: await shipStageLog(failure.id, failure.project, failure.stage).catch(
					() => null,
				);
	const text = shipFailureReference({ ...failure, log });
	const state = await startAutoPick({ words: text, task: null });
	await recordShipAgent(failure.id, failure.project);
	feed.put(state);
	const sending = feed.send(state.id, text);
	void promptConversation(state.id, text, [], false, sending.id)
		.then((answered) => feed.answered(state.id, sending, answered))
		.catch((error: unknown) => feed.refused(state.id, sending, error));
	return state.id;
}

/** Like {@link sendShipToAgent}, for a stage that is slow while the ship goes on. */
async function sendSlowShipToAgent(
	feed: ConversationFeed,
	slow: {
		id: string;
		project: string;
		stage: StageKey;
		spent: number;
		expected: number;
	},
): Promise<string> {
	const log = await shipStageLog(slow.id, slow.project, slow.stage).catch(
		() => null,
	);
	const text = shipSlowReference({ ...slow, log });
	const state = await startAutoPick({ words: text, task: null });
	await recordShipAgent(slow.id, slow.project);
	feed.put(state);
	const sending = feed.send(state.id, text);
	void promptConversation(state.id, text, [], false, sending.id)
		.then((answered) => feed.answered(state.id, sending, answered))
		.catch((error: unknown) => feed.refused(state.id, sending, error));
	return state.id;
}

/** The History row's line: when the last ship that shipped started, if any did. */
function lastShipped(past: CascadeSummary[] | null): string | null {
	const last = past?.find((each) => each.status === "done");
	return last === undefined ? null : `Last shipped ${age(last.started)} ago`;
}

/** What `#ships/active` opens: the ship under way, rather than a past one. */
const ACTIVE = "active";

/** What `#ships/history` opens: every ship that ended. */
const HISTORY = "history";

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
