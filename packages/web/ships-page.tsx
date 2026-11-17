import { useReactive } from "core/react";
import { CheckIcon } from "lucide-react";
import { type JSX, useEffect, useRef, useState } from "react";
import { shipPlan, shipRuns, shipTargets, startShip } from "./api/ship";
import { Button } from "./components/ui/button";
import { HistoryRow, PLANNER_COLUMN } from "./history-row";
import { cn } from "./lib/utils";
import { SHIP_HISTORY, shipRunAddress } from "./page-address";
import { RouteTrail } from "./route-trail";
import { ShipFlow } from "./ship-flow";
import { backToShipDepth, shipDepth, useShipHistory } from "./ship-history";
import { ShipNeededFirst } from "./ship-needed-first";
import { ShipPastRuns, ShipRunList } from "./ship-past-runs";
import { ShipPickList } from "./ship-pick-list";
import { recapSeen } from "./ship-recap-seen";
import { ShipReview } from "./ship-review";
import { SHIP_BUS } from "./ship-run-bus";
import { ShipRunScreen } from "./ship-run-view";
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
}: {
	/** The run shown, by id, or null for the pick. */
	run?: string | null;
	onRun?: (id: string) => void;
	onClose?: () => void;
}): JSX.Element {
	const [flow] = useState(
		() => new ShipFlow({ plan: shipPlan, start: startShip }),
	);
	const {
		listing,
		failed,
		picks,
		added,
		stage,
		planning,
		refused,
		starting,
		active,
	} = useReactive(flow, (flow) => flow.state, ["changed"]);
	const depth = shipDepth(stage);
	// A failed ship stays shown, but only one under way holds the next back.
	const holding = active?.status === "running";
	const opened = useRef(run !== null);
	useShipHistory(flow, depth);
	useEffect(() => {
		shipTargets().then(
			(listing) => flow.listed(listing),
			(error: unknown) => flow.unlisted(error),
		);
		// Only the run under way is read up front; past runs wait for a tap.
		shipRuns({ running: true }).then(
			(runs) => {
				flow.underWay(runs);
				// Opening the page while a ship runs goes to it, once.
				const running = runs.find((each) => each.status === "running");
				if (running !== undefined && !opened.current) {
					opened.current = true;
					if (location.hash !== SHIP_HISTORY) {
						onRun(running.id);
					}
				}
				if (running === undefined && !opened.current) {
					// With none running, the newest run goes to its recap once, until seen.
					shipRuns().then(
						(all) => {
							const latest = all.at(0);
							flow.newest(latest);
							if (
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
		return SHIP_BUS.on("run", ({ state }) => flow.moved(state));
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
					<ShipRunScreen key={run} id={run} />
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
						{listing !== null && listing.targets.length > 0 && (
							<h3 className="font-semibold text-sm">Targets</h3>
						)}
						{listing !== null && listing.targets.length > 0 && (
							<ShipPickList
								targets={listing.targets}
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
								className="h-11 w-full"
								disabled={picks.size === 0 || planning || holding}
								onClick={() => flow.next()}
							>
								{planning ? "Planning…" : "Next"}
							</Button>
						)}
						{stage.at === "needed" && (
							<Button
								className="h-11 w-full"
								disabled={planning}
								onClick={() => flow.next()}
							>
								{planning ? "Planning…" : "Next"}
							</Button>
						)}
						{stage.at === "review" && (
							<Button
								className="h-11 w-full gap-1.5 bg-emerald-600 text-white hover:bg-emerald-600/90 dark:bg-emerald-600 dark:hover:bg-emerald-600/90"
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
