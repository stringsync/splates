import type { SignalOverview } from "@splates/server/signals";
import { PlusIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { checkFormOf, SignalCheckForm } from "./signal-check-form";
import { SignalDetail } from "./signal-detail";
import { SignalList } from "./signal-list";
import { familiesOf } from "./signal-summary";
import { TopBar } from "./top-bar";
import { useSignals } from "./use-signals";

/**
 * The Signals page: a list of every signal across every project, armed ones
 * first and each under its family, showing only how often it was raised this
 * week; beside it, the chosen signal in full. Nothing here says a signal is
 * currently true: a raise is only what happened and when.
 */
export function SignalsPage({
	onOpen,
}: {
	/** Opens conversation `id`. */
	onOpen: (id: string) => void;
}): JSX.Element {
	const { signals, read } = useSignals();
	const at = useSignalsAddress();
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
	const chosen =
		signals.find((each) => each.name === at.signal) ??
		(at.signal === null ? firstOf(signals) : undefined);
	return (
		<section aria-label="signals" className="flex min-w-0 flex-col gap-6">
			<TopBar title="Signals" />
			<div>
				<Button
					size="sm"
					variant="outline"
					onClick={() => {
						location.hash = checkAddress(NEW);
					}}
				>
					<PlusIcon /> New check
				</Button>
			</div>
			{signals.length === 0 ? (
				<p className="text-muted-foreground text-sm">
					Nothing has been raised, checked or waited on in the last 7 days.
				</p>
			) : (
				<div className="grid items-start gap-4 md:grid-cols-[minmax(14rem,20rem)_1fr]">
					<SignalList
						signals={signals}
						selected={chosen?.name ?? null}
						picked={at.signal !== null}
						address={signalAddress}
						className={cn(at.signal !== null && "max-md:hidden")}
					/>
					{chosen === undefined ? (
						<p
							className={cn(
								"text-muted-foreground text-sm",
								at.signal === null && "max-md:hidden",
							)}
						>
							No signal {at.signal} in the last 7 days.
						</p>
					) : (
						<SignalDetail
							key={chosen.name}
							signal={chosen}
							checkHref={checkAddress(chosen.name)}
							onOpen={onOpen}
							onChanged={read}
							className={cn(at.signal === null && "max-md:hidden")}
						/>
					)}
				</div>
			)}
		</section>
	);
}

/** The signal shown when none is chosen: the first armed, else the latest raised. */
function firstOf(signals: SignalOverview[]): SignalOverview | undefined {
	return (
		familiesOf(signals.filter((each) => each.armed))[0]?.signals[0] ??
		familiesOf(signals)[0]?.signals[0]
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
}

export function signalsAt(hash: string): SignalsAt {
	if (hash === "#signals/new") {
		return { check: NEW, signal: null };
	}
	const [, name, check] = hash.match(/^#signals\/([^/]+)(\/check)?$/) ?? [];
	if (name === undefined) {
		return { check: null, signal: null };
	}
	const decoded = decodeURIComponent(name);
	return check === undefined
		? { check: null, signal: decoded }
		: { check: decoded, signal: null };
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
