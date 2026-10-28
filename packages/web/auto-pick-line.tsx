import type { Event, Lifted } from "@stringsync/splates-server/records";
import { InfoIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { AutoAgentMark } from "./auto-brand";
import { Button } from "./components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "./components/ui/popover";
import { chooseSetting } from "./conversation-api";
import { PendingSpinner, useShowPending } from "./pending";
import { Refusal, useRefusal } from "./refusal";

type AutoEvent = Extract<Event, { action: "auto"; reason: null }>;

/**
 * Auto pick's line in a conversation, led by its mark, split with the picked agent's: what it picked, or
 * moved up to, then the likeliest kind and depth, or why the judge found
 * none, which open a popover of everything it found, and for a move up, an
 * Undo. On a phone those findings fold into an icon, so the pick has the room.
 */
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
	const short =
		params.signals
			.slice(0, 2)
			.flatMap((each) => each.answers.slice(0, 1).map((best) => best.label))
			.join(" · ") ||
		(params.notes[0] ?? "no judge to ask");
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
	return (
		<div
			role="note"
			aria-label="splates"
			className="my-6 text-muted-foreground text-xs"
		>
			<div className="flex items-center gap-3">
				<Rule />
				<p className="flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap">
					<AutoAgentMark agent={event.agent} className="size-3.5" />
					<span className="min-w-0 truncate">
						{verb} {params.picked}
					</span>
					<span aria-hidden>·</span>
					<Popover>
						<PopoverTrigger
							aria-label={short}
							className="shrink-0 cursor-pointer rounded px-1 underline decoration-dotted underline-offset-2 hover:text-foreground"
						>
							<InfoIcon aria-hidden className="size-3.5 sm:hidden" />
							<span className="max-sm:hidden">{short}</span>
						</PopoverTrigger>
						<PopoverContent className="w-80 text-xs">
							<Findings params={params} lifted={lifted} />
						</PopoverContent>
					</Popover>
					{undo.control}
				</p>
				<Rule />
			</div>
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

/** A plain hairline beside the line, taking what room it leaves. */
function Rule(): JSX.Element {
	return <span aria-hidden className="h-px min-w-3 flex-1 bg-border" />;
}
