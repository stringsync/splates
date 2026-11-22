import type { Snapshot } from "@splates/server/tasks";
import { useReactive } from "core/react";
import { CheckIcon } from "lucide-react";
import { type JSX, useEffect, useRef, useState } from "react";
import {
	shipCurrent,
	shipPlan,
	shipRuns,
	shipTargets,
	shipUnshipped,
	startShip,
} from "./api/ship";
import { Button } from "./components/ui/button";
import type { ConversationFeed } from "./conversation-feed";
import { HistoryRow, PLANNER_COLUMN } from "./history-row";
import { cn } from "./lib/utils";
import { SHIP_HISTORY, shipRunAddress } from "./page-address";
import { RouteTrail } from "./route-trail";
import { ShipAgents } from "./ship-agents";
import { ShipAutoApprove } from "./ship-auto-approve";
import { ShipFlow } from "./ship-flow";
import { ShipHeading } from "./ship-heading";
import { backToShipDepth, shipDepth, useShipHistory } from "./ship-history";
import { ShipNeededFirst } from "./ship-needed-first";
import { ShipPastRuns, ShipRunList } from "./ship-past-runs";
import { chosen, ShipPickList } from "./ship-pick-list";
import { recapSeen } from "./ship-recap-seen";
import { ShipReview } from "./ship-review";
import { SHIP_BUS } from "./ship-run-bus";
import { ShipRunScreen } from "./ship-run-view";
import { useSpawnedOf } from "./ship-spawned-of";
import { ShipSupervise } from "./ship-supervise";
import { TopBar } from "./top-bar";

const TITLES = {
	pick: "Ships",
	needed: "Needed first",
	review: "Review",
};

/**
 * The Ships page: pick targets, add what they depend on, review the plan
 * and ship it. Given `run`, it shows that run live instead; `onRun` opens a
 * run once shipped, and `onClose` goes back to the pick, by default by moving
 * the page's address.
 */
export function ShipsPage({
	run = null,
	onRun = openRun,
	onClose = closeRun,
	snapshot = null,
	talk = null,
}: {
	/** The run shown, by id, or null for the pick. */
	run?: string | null;
	/** The project's board and tasks, for what a run spawned. */
	snapshot?: Snapshot | null;
	/** The project's conversations, for where what a run spawned stands. */
	talk?: ConversationFeed | null;
	onRun?: (id: string) => void;
	onClose?: () => void;
}): JSX.Element {
	const [flow] = useState(
		() => new ShipFlow({ plan: shipPlan, start: startShip }),
	);
	const {
		listing,
		failed,
		unshipped,
		current,
		counting,
		readingVersion,
		picks,
		added,
		stage,
		planning,
		refused,
		starting,
		active,
		supervise,
		autoApprove,
	} = useReactive(flow, (flow) => flow.state, ["changed"]);
	const spawnedOf = useSpawnedOf(snapshot, talk);
	const depth = shipDepth(stage);
	// A failed ship stays shown, but only one under way holds the next back.
	const holding = active?.status === "running";
	const opened = useRef(run !== null);
	useShipHistory(flow, depth);
	useEffect(() => {
		shipTargets().then(
			(listing) => {
				flow.listed(listing);
				// The server's last listing shows at once; the fresh one replaces it.
				if (listing.stale) {
					shipTargets({ fresh: true }).then(
						(fresh) => flow.listed(fresh),
						() => {},
					);
				}
			},
			(error: unknown) => flow.unlisted(error),
		);
		// Counted apart, so a slow or failing count never holds the targets.
		shipUnshipped().then(
			(counts) => flow.counted(counts),
			() => flow.counted({}),
		);
		// Read apart too: a slow registry never holds the targets or a ship.
		shipCurrent().then(
			(versions) => flow.versioned(versions),
			() => flow.versioned({}),
		);
		// Only the run under way is read up front; past runs wait for a tap.
		const readUnderWay = (opening: boolean) => {
			const stamp = flow.reading();
			shipRuns({ running: true }).then(
				(runs) => {
					flow.underWay(runs, stamp);
					// Opening the page while a ship runs goes to it, once.
					const running = runs.find((each) => each.status === "running");
					if (opening && running !== undefined && !opened.current) {
						opened.current = true;
						if (location.hash !== SHIP_HISTORY) {
							onRun(running.id);
						}
					}
					if (running === undefined && (!opening || !opened.current)) {
						// With none running, the newest run goes to its recap once, until seen.
						shipRuns({ limit: 1 }).then(
							(all) => {
								const latest = all.at(0);
								flow.newest(latest, stamp);
								if (
									opening &&
									(latest?.status === "failed" ||
										(latest?.status === "done" && latest.id !== recapSeen())) &&
									!opened.current &&
									location.hash !== SHIP_HISTORY
								) {
									opened.current = true;
									onRun(latest.id);
								}
							},
							() => {},
						);
					}
				},
				() => {},
			);
		};
		readUnderWay(true);
		const off = [
			SHIP_BUS.on("run", ({ state }) => flow.moved(state)),
			// Back after the stream dropped, a ship may have ended unsaid: read again.
			SHIP_BUS.on("open", (again) => {
				if (again) {
					readUnderWay(false);
				}
			}),
		];
		return () => {
			for (const unlisten of off) {
				unlisten();
			}
		};
	}, [flow, onRun]);

	const history = useShipHistoryRoute();
	if (run === null && history) {
		return (
			<>
				<TopBar
					title={
						<RouteTrail
							items={[
								{ label: "Ships", onClick: onClose },
								{ label: "History" },
							]}
						/>
					}
				/>
				<div className={cn(PLANNER_COLUMN, "gap-3")}>
					<ShipPastRuns />
				</div>
			</>
		);
	}

	if (run !== null) {
		return (
			<>
				<TopBar
					title={
						<RouteTrail
							items={[
								{ label: "Ships", onClick: onClose },
								{ label: "Shipping" },
							]}
						/>
					}
				/>
				<div className={cn(PLANNER_COLUMN, "gap-3")}>
					<ShipRunScreen
						key={run}
						id={run}
						spawned={spawnedOf}
						agents={<ShipAgents id={run} talk={talk} />}
					/>
				</div>
			</>
		);
	}

	return (
		<>
			<TopBar
				title={
					stage.at === "pick" ? (
						TITLES.pick
					) : (
						<RouteTrail
							items={[
								{
									label: TITLES.pick,
									onClick: () => backToShipDepth(depth, 0),
								},
								...(stage.at === "review" && depth === 2
									? [
											{
												label: TITLES.needed,
												onClick: () => backToShipDepth(depth, 1),
											},
										]
									: []),
								{ label: TITLES[stage.at] },
							]}
						/>
					)
				}
			/>
			<div className={cn(PLANNER_COLUMN, "gap-5")}>
				{stage.at === "pick" && (
					<ShipHeading
						title="Pick what to ship"
						line={
							listing?.targets.some((each) => each.plan.versioned)
								? "Tick each target to ship and choose its bump or version."
								: listing?.targets.some((each) => each.plan.bump !== undefined)
									? "Tick each target to ship and choose its bump."
									: "Tick each target to ship."
						}
					/>
				)}
				{stage.at === "needed" && (
					<ShipHeading
						title="Ship these first?"
						line="Your picks depend on unshipped changes here. Unticked ones are skipped."
					/>
				)}
				{stage.at === "review" && (
					<ShipHeading
						title={`Ready to ship ${targets(stage.plan.targets.length)}`}
						line={
							stage.plan.waves.length > 1
								? `${stage.plan.waves.length} groups, in order: each starts once the one before is done.`
								: "Approve starts the ship."
						}
					/>
				)}
				{active !== null && (
					<section aria-label="Shipping now" className="flex flex-col gap-2.5">
						<h3 className="font-semibold text-sm">Shipping now</h3>
						<ShipRunList runs={[active]} bar />
					</section>
				)}
				{stage.at === "pick" && (
					<>
						{failed !== null && (
							<p className="text-destructive text-sm">
								Could not read the ship targets: {failed}
							</p>
						)}
						{listing === null && failed === null && (
							<p className="text-muted-foreground text-sm">
								Reading the targets…
							</p>
						)}
						{listing !== null && listing.targets.length === 0 && (
							<p className="text-muted-foreground text-sm">
								No ship targets: list ship commands under <code>ships</code> in
								splates.config.ts.
							</p>
						)}
						{active !== null &&
							listing !== null &&
							listing.targets.length > 0 && (
								<h3 className="font-semibold text-sm">Targets</h3>
							)}
						{listing !== null && listing.targets.length > 0 && (
							<ShipPickList
								targets={listing.targets}
								unshipped={unshipped}
								loadingDetails={counting || readingVersion}
								current={current}
								picks={picks}
								onPicks={(picks) => flow.pick(picks)}
							/>
						)}
						{listing?.errors.map((error) => (
							<p key={error.command} className="text-destructive text-sm">
								<code>{error.command}</code>: {error.error}
							</p>
						))}
					</>
				)}
				{stage.at === "needed" && listing !== null && (
					<ShipNeededFirst
						offered={stage.offered}
						targets={listing.targets}
						added={added}
						onAdded={(added) => flow.add(added)}
					/>
				)}
				{stage.at === "review" && <ShipReview plan={stage.plan} />}
				{stage.at === "review" && (
					<ShipSupervise
						on={supervise.on}
						budget={supervise.budget}
						onOn={(on) => flow.supervising(on)}
						onFixes={(budget) => flow.fixes(budget)}
					/>
				)}
				{stage.at === "review" && (
					<ShipAutoApprove
						on={autoApprove}
						onOn={(on) => flow.autoApproving(on)}
					/>
				)}
				{refused !== null && (
					<p className="text-destructive text-sm">{refused}</p>
				)}
				{holding && (
					<p className="text-muted-foreground text-sm">
						One ship runs at a time: the next can start once this one ends.
					</p>
				)}
				{listing !== null && listing.targets.length > 0 && (
					<div className="sticky bottom-0 z-30 bg-background pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
						{stage.at === "pick" && (
							<Button
								block
								disabled={
									picks.size === 0 || !chosen(picks) || planning || holding
								}
								onClick={() => flow.next()}
							>
								{planning ? "Planning…" : "Next"}
							</Button>
						)}
						{stage.at === "needed" && (
							<Button
								block
								disabled={planning || !chosen(added)}
								onClick={() => flow.next()}
							>
								{planning ? "Planning…" : "Next"}
							</Button>
						)}
						{stage.at === "review" && (
							<Button
								block
								className="gap-1.5 bg-emerald-600 text-white hover:bg-emerald-600/90 dark:bg-emerald-600 dark:hover:bg-emerald-600/90"
								disabled={
									starting ||
									holding ||
									stage.plan.targets.some((each) => each.error !== undefined)
								}
								onClick={async () => {
									const started = await flow.ship();
									if (started !== null) {
										// A read still in flight must not send the page elsewhere.
										opened.current = true;
										onRun(started.id);
									}
								}}
							>
								{starting ? (
									"Starting…"
								) : (
									<>
										<CheckIcon data-icon="inline-start" />
										Approve
									</>
								)}
							</Button>
						)}
					</div>
				)}
				{stage.at === "pick" && (
					<HistoryRow href={SHIP_HISTORY} summary={null} />
				)}
			</div>
		</>
	);
}

/** "1 target" or "3 targets". */
function targets(count: number): string {
	return count === 1 ? "1 target" : `${count} targets`;
}

/** Whether the address is `#ships/history`, kept as the hash changes. */
function useShipHistoryRoute(): boolean {
	const [on, setOn] = useState(() => location.hash === SHIP_HISTORY);
	useEffect(() => {
		const sync = () => setOn(location.hash === SHIP_HISTORY);
		window.addEventListener("hashchange", sync);
		return () => window.removeEventListener("hashchange", sync);
	}, []);
	return on;
}

/** Shows run `id`, at its own address, so a reload lands on it. */
function openRun(id: string): void {
	// Replaces the Review entry, so Back from the run is not the screen shipped.
	location.replace(shipRunAddress(id));
}

/** Back to the pick from a run. */
function closeRun(): void {
	location.hash = "#ships";
}
