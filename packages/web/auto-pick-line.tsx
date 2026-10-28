import type { Event, Lifted } from "@stringsync/splates-server/records";
import { type JSX, useState } from "react";
import { Button } from "./components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "./components/ui/popover";
import { chooseSetting } from "./conversation-api";
import { PendingSpinner, useShowPending } from "./pending";
import { Refusal, useRefusal } from "./refusal";
import { SplatesEvent } from "./splates-event";

type AutoEvent = Extract<Event, { action: "auto"; reason: null }>;

/** Shows the chosen model as one clickable subject, opening its findings and Undo. */
export function AutoPickLine({
	event,
	details = false,
}: {
	event: AutoEvent;
	details?: boolean;
}): JSX.Element {
	const params = paramsOf(event);
	const lifted = event.lifted ?? null;
	const verb =
		lifted === null
			? "Auto picked"
			: lifted.switched
				? "Auto switched to"
				: "Auto moved up to";
	const undo = useUndo(event, lifted);
	if (details) {
		return (
			<div
				role="note"
				aria-label="splates"
				className="flex min-w-0 flex-col gap-2 text-xs wrap-anywhere"
			>
				<div className="flex flex-wrap items-center gap-2">
					<span>
						{verb} {params.picked}
					</span>
					{undo.control}
				</div>
				<Findings params={params} lifted={lifted} />
				<Refusal refusal={undo.refusal} />
			</div>
		);
	}
	const picked = params.picked.split(",")[0] ?? params.picked;
	return (
		<div>
			<SplatesEvent
				event={{ words: [lifted === null ? "Picked" : "Switched"] }}
			>
				<Popover>
					<PopoverTrigger
						render={
							<Button variant="outline" size="xs" className="min-w-0 shrink" />
						}
						title={params.picked}
					>
						<span className="min-w-0 truncate">{picked}</span>
					</PopoverTrigger>
					<PopoverContent className="flex w-80 flex-col gap-3 text-xs">
						<p>{params.picked}</p>
						<Findings params={params} lifted={lifted} />
						{undo.control}
					</PopoverContent>
				</Popover>
			</SplatesEvent>
			<Refusal refusal={undo.refusal} className="mt-1 text-center" />
		</div>
	);
}

/** What the judge found, one row a signal, with a bar for how sure it was. */
function Findings({
	params,
	lifted,
}: {
	params: Params;
	lifted: Lifted | null;
}): JSX.Element {
	return (
		<div className="flex flex-col gap-2 text-muted-foreground">
			{lifted !== null && <p>From {lifted.from}</p>}
			<dl className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5">
				{params.signals.map((signal) => {
					const [best] = signal.answers;
					return (
						<div key={signal.name} className="contents">
							<dt>{signal.name}</dt>
							<dd className="text-foreground">{best?.label ?? "none"}</dd>
							<dd className="flex items-center gap-1.5 tabular-nums">
								<span className="h-1 w-12 overflow-hidden rounded-full bg-muted">
									<span
										className="block h-full rounded-full bg-primary/60"
										style={{ width: `${Math.round((best?.sure ?? 0) * 100)}%` }}
									/>
								</span>
								{Math.round((best?.sure ?? 0) * 100)}%
							</dd>
						</div>
					);
				})}
			</dl>
			{params.rule !== null && <p>{capital(params.rule)}</p>}
			{params.notes.map((note) => (
				<p key={note}>{capital(note)}</p>
			))}
		</div>
	);
}

/**
 * The Undo of a pick that moved the conversation up, busy until the server
 * takes it, then said done, and any refusal; no Undo for
 * a starting pick.
 */
function useUndo(
	event: AutoEvent,
	lifted: Lifted | null,
): { control: JSX.Element | null; refusal: string | null } {
	const [undone, setUndone] = useState(false);
	const [busy, setBusy] = useState(false);
	const shown = useShowPending(busy);
	const { refusal, attempt } = useRefusal();
	const { conversation } = event;
	if (lifted === null || conversation === null) {
		return { control: null, refusal };
	}
	if (undone) {
		return {
			control: <span className="shrink-0">Back on {lifted.from}</span>,
			refusal,
		};
	}
	const undo = (): void => {
		setBusy(true);
		void attempt(
			Promise.all(
				Object.entries(lifted.undo).map(([id, value]) =>
					chooseSetting(conversation, id, value),
				),
			).then(() => {}),
			"Not undone",
		).then((landed) => {
			setBusy(false);
			setUndone(landed);
		});
	};
	return {
		control: (
			<Button
				variant="outline"
				size="xs"
				disabled={busy}
				aria-busy={busy}
				onClick={undo}
				className="shrink-0"
			>
				{busy && shown && <PendingSpinner shown />}
				Undo
			</Button>
		),
		refusal,
	};
}

/** One thing the judge weighed, with how sure it was of each answer, likeliest first. */
interface Signal {
	name: string;
	answers: { label: string; sure: number }[];
}

/** What a pick's reasons say, sorted out for showing. */
interface Params {
	/** The pick in words: `Opus 5.5, medium effort`. */
	picked: string;
	/** Kind, depth, then breadth, clarity, stakes and verification, as the judge found them. */
	signals: Signal[];
	/** The rule it took: `rule 2: Design, Moderate`; null when none is said. */
	rule: string | null;
	/** Anything else, such as an agent passed over, or why no judge answered. */
	notes: string[];
}

const SIGNAL = /^(judged|breadth|clarity|stakes|verification): (.*)$/;

/** `event`'s reasons, sorted into what the judge found, the rule and the rest. */
function paramsOf(event: AutoEvent): Params {
	const [picked = event.agent, ...rest] = event.reasons;
	const signals: Signal[] = [];
	const notes: string[] = [];
	let rule: string | null = null;
	for (const reason of rest) {
		const signal = SIGNAL.exec(reason);
		if (reason.startsWith("rule ")) {
			rule = reason;
		} else if (signal === null) {
			notes.push(reason);
		} else if (signal[1] === "judged") {
			const [kind, depth] = answersOf(signal[2] ?? "");
			signals.push(
				...(kind === undefined ? [] : [{ name: "Kind", answers: [kind] }]),
				...(depth === undefined ? [] : [{ name: "Depth", answers: [depth] }]),
			);
		} else {
			signals.push({
				name: capital(signal[1] ?? ""),
				answers: answersOf(signal[2] ?? "").toSorted(
					(one, other) => other.sure - one.sure,
				),
			});
		}
	}
	return { picked, signals, rule, notes };
}

/** `One spot 28%, One module 66%` as answers. */
function answersOf(said: string): { label: string; sure: number }[] {
	return said.split(", ").flatMap((each) => {
		const found = /^(.*) (\d+)%$/.exec(each.trim());
		return found === null
			? []
			: [{ label: found[1] ?? "", sure: Number(found[2]) / 100 }];
	});
}

function capital(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1);
}
