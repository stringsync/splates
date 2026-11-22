import { PlusIcon } from "lucide-react";
import { type JSX, type ReactNode, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import type { RunOpens } from "./automation-face";
import { RouteTrail } from "./route-trail";
import { checkFormOf, SignalCheckForm } from "./signal-check-form";
import { SignalDetail } from "./signal-detail";
import { SignalIndex } from "./signal-list";
import { SubscriptionsPanel } from "./subscriptions-panel";
import { TopBar } from "./top-bar";
import { useSignals } from "./use-signals";

/**
 * The Signals page, at `#signals`: the index of every signal, and at
 * `#signals/<name>` that signal on its own page.
 */
export function SignalsPage({
	onOpen,
	opens,
}: {
	/** Opens conversation `id`. */
	onOpen: (id: string) => void;
	/** Opens the task a subscription's run was for. */
	opens: RunOpens;
}): JSX.Element {
	const { signals, read } = useSignals();
	const at = useSignalsAddress();
	const [subscriptions, setSubscriptions] = useState<number | null>(null);
	if (at.check !== null) {
		const probe = signals.find((each) => each.name === at.check)?.probe ?? null;
		return (
			<SignalCheckForm
				key={at.check}
				initial={checkFormOf(probe, at.check === NEW ? "" : at.check)}
				isNew={at.check === NEW}
				onBack={() => {
					location.hash =
						at.check === NEW ? "#signals" : signalAddress(at.check ?? "");
					void read();
				}}
			/>
		);
	}
	const chosen = signals.find((each) => each.name === at.signal);
	const newPollScript = (
		<Button
			size="sm"
			variant="outline"
			className="h-11 sm:h-9"
			onClick={() => {
				location.hash = checkAddress(NEW);
			}}
		>
			<PlusIcon /> New poll script
		</Button>
	);
	return (
		<section aria-label="signals" className="flex min-w-0 flex-col gap-6">
			<TopBar
				title={
					at.signal === null ? (
						"Signals"
					) : (
						<RouteTrail
							items={[
								{
									label: "Signals",
									onClick: () => {
										location.hash = "#signals";
									},
								},
								{ label: at.signal },
							]}
						/>
					)
				}
			/>
			<nav
				aria-label="signals views"
				className={cn(
					"flex gap-4 border-b text-sm",
					at.signal !== null && "hidden",
				)}
			>
				<TabLink href="#signals" current={!at.subscriptions}>
					Signals
				</TabLink>
				<TabLink href={SUBSCRIPTIONS} current={at.subscriptions}>
					Subscriptions
					{subscriptions !== null && (
						<span className="ml-1.5 text-muted-foreground tabular-nums">
							{subscriptions}
						</span>
					)}
				</TabLink>
			</nav>
			{at.subscriptions && (
				<SubscriptionsPanel onCount={setSubscriptions} opens={opens} />
			)}
			{at.subscriptions ? null : at.signal !== null ? (
				chosen === undefined ? (
					<p className="text-muted-foreground text-sm">
						No signal {at.signal} in the last 7 days.
					</p>
				) : (
					<SignalDetail
						key={chosen.name}
						signal={chosen}
						checkHref={checkAddress(chosen.name)}
						onOpen={onOpen}
						onChanged={read}
					/>
				)
			) : signals.length === 0 ? (
				<div className="flex flex-col items-start gap-3">
					{newPollScript}
					<p className="text-muted-foreground text-sm">
						Nothing has been raised, checked or waited on in the last 7 days.
					</p>
				</div>
			) : (
				<SignalIndex
					signals={signals}
					address={signalAddress}
					actions={newPollScript}
				/>
			)}
		</section>
	);
}

/** The address of the blank check form, `#signals/new`; no signal is named `new`, every name having a dot. */
const NEW = "new";

/** The address that shows signal `name`, `#signals/<name>`. */
function signalAddress(name: string): string {
	return `#signals/${encodeURIComponent(name)}`;
}

/** The address of signal `name`'s check form, `#signals/<name>/check`, or `#signals/new` for a blank one. */
function checkAddress(name: string): string {
	return name === NEW ? "#signals/new" : `${signalAddress(name)}/check`;
}

/** What the address shows: a check form (`new` for a blank one) or a signal, each null for none. */
interface SignalsAt {
	check: string | null;
	signal: string | null;
	/** Whether the Subscriptions tab shows. */
	subscriptions: boolean;
}

/** The address of the Subscriptions tab; no signal is named `subscriptions`, every name having a dot. */
const SUBSCRIPTIONS = "#signals/subscriptions";

export function signalsAt(hash: string): SignalsAt {
	if (hash === SUBSCRIPTIONS) {
		return { check: null, signal: null, subscriptions: true };
	}
	if (hash === "#signals/new") {
		return { check: NEW, signal: null, subscriptions: false };
	}
	const [, name, check] = hash.match(/^#signals\/([^/]+)(\/check)?$/) ?? [];
	if (name === undefined) {
		return { check: null, signal: null, subscriptions: false };
	}
	const decoded = decodeURIComponent(name);
	return check === undefined
		? { check: null, signal: decoded, subscriptions: false }
		: { check: decoded, signal: null, subscriptions: false };
}

function useSignalsAddress(): SignalsAt {
	const [at, setAt] = useState(() => signalsAt(location.hash));
	useEffect(() => {
		const changed = () => setAt(signalsAt(location.hash));
		window.addEventListener("hashchange", changed);
		return () => window.removeEventListener("hashchange", changed);
	}, []);
	return at;
}

/** A tab of the page: a link to its address, marked when it is the one shown. */
function TabLink({
	href,
	current,
	children,
}: {
	href: string;
	current: boolean;
	children: ReactNode;
}): JSX.Element {
	return (
		<a
			href={href}
			aria-current={current ? "page" : undefined}
			className={cn(
				"-mb-px flex h-11 items-center border-b-2 sm:h-9",
				current
					? "border-foreground font-medium"
					: "border-transparent text-muted-foreground",
			)}
		>
			{children}
		</a>
	);
}
