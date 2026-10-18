import type {
	WorkerLimit,
	WorkerStanding,
} from "@stringsync/splates-server/workers";
import {
	DEFAULT_WORKER_LIMITS,
	dollars,
	WORKER_LIMITS,
} from "@stringsync/splates-server/workers/browser";
import { type FormEvent, type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import type { RoleBudget } from "./api";

/** How long a raise or a pause can last, as the CLI's `--for` takes it. */
const SPANS = [
	["4h", "4 hours"],
	["1d", "1 day"],
	["3d", "3 days"],
	["1w", "1 week"],
] as const;

/** What a role may spend, as the CLI writes it, with a way back to the configs. */
export function EditForm({
	role,
	onSave,
	onCancel,
}: {
	role: RoleBudget;
	onSave: (spend: string | null) => void;
	onCancel: () => void;
}): JSX.Element {
	const [spend, setSpend] = useState(role.spend ?? "");
	const submit = (event: FormEvent) => {
		event.preventDefault();
		onSave(spend.trim());
	};
	return (
		<form
			aria-label={`edit ${role.role} budget`}
			onSubmit={submit}
			className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3"
		>
			<Input
				aria-label="spend"
				value={spend}
				autoFocus
				onChange={(event) => setSpend(event.target.value)}
				placeholder="5m/day"
				className="font-mono"
			/>
			<p className="text-muted-foreground text-xs">
				<code>nothing</code>, <code>unlimited</code>, or limits joined by
				commas, like <code>5m/day</code> or <code>2m/month,300k/7d</code>.
			</p>
			<div className="flex flex-wrap items-center gap-2">
				{role.set && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="text-muted-foreground"
						onClick={() => onSave(null)}
					>
						Use the configs'
					</Button>
				)}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="ml-auto"
					onClick={onCancel}
				>
					Cancel
				</Button>
				<Button type="submit" size="sm" disabled={spend.trim() === ""}>
					Save
				</Button>
			</div>
		</form>
	);
}

/** More tokens on each of a role's limits, for a while. */
export function RaiseForm({
	onRaise,
	onCancel,
}: {
	onRaise: (tokens: string, span: string) => void;
	onCancel: () => void;
}): JSX.Element {
	const [amount, setAmount] = useState("");
	const [span, setSpan] = useState<string>("1d");
	const submit = (event: FormEvent) => {
		event.preventDefault();
		onRaise(amount.trim(), span);
	};
	return (
		<form
			aria-label="raise"
			onSubmit={submit}
			className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3"
		>
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-sm">Add</span>
				<Input
					aria-label="tokens"
					value={amount}
					autoFocus
					onChange={(event) => setAmount(event.target.value)}
					placeholder="2m"
					className="w-24 font-mono"
				/>
				<span className="text-sm">tokens for</span>
				<SpanPicker span={span} onPick={setSpan} />
			</div>
			<p className="text-muted-foreground text-xs">
				Added to each of its limits until the raise ends.
			</p>
			<div className="flex items-center justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="submit" size="sm" disabled={amount.trim() === ""}>
					Raise
				</Button>
			</div>
		</form>
	);
}

/** A while a model asks nothing, whatever it may spend. */
export function PauseForm({
	onPause,
	onCancel,
}: {
	onPause: (span: string) => void;
	onCancel: () => void;
}): JSX.Element {
	const [span, setSpan] = useState<string>("1d");
	const submit = (event: FormEvent) => {
		event.preventDefault();
		onPause(span);
	};
	return (
		<form
			aria-label="pause"
			onSubmit={submit}
			className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3"
		>
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-sm">Ask nothing for</span>
				<SpanPicker span={span} onPick={setSpan} />
			</div>
			<p className="text-muted-foreground text-xs">
				Checks leave its questions unasked until the pause ends or you resume
				it.
			</p>
			<div className="flex items-center justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="submit" size="sm">
					Pause
				</Button>
			</div>
		</form>
	);
}

/** What each worker limit is called in its form. */
export const WORKER_LIMIT_NAMES: Record<WorkerLimit, string> = {
	hour: "Rate cap",
	day: "Per day",
	month: "Per month",
};

/** What each worker limit is called where a raise picks one: "add $2 to the day". */
export const RAISE_NAMES: Record<WorkerLimit, string> = {
	hour: "the rate cap",
	day: "the day",
	month: "the month",
};

/**
 * What made workers may cost, limit by limit, in dollars: those changed are
 * saved, and each one set can go back to its default.
 */
export function WorkerLimitsForm({
	standing,
	onSave,
	onCancel,
}: {
	standing: WorkerStanding[];
	onSave: (changes: [WorkerLimit, number | null][]) => void;
	onCancel: () => void;
}): JSX.Element {
	const now = (limit: WorkerLimit): WorkerStanding | undefined =>
		standing.find((each) => each.limit === limit);
	const kept = (limit: WorkerLimit): string => {
		const each = now(limit);
		return each === undefined
			? ""
			: String(Number((each.dollars - each.raised).toFixed(4)));
	};
	const [amounts, setAmounts] = useState<Record<WorkerLimit, string>>(() => ({
		hour: kept("hour"),
		day: kept("day"),
		month: kept("month"),
	}));
	const read = (text: string): number | null => {
		const value = Number(text.trim().replace(/^\$/, ""));
		return text.trim() !== "" && Number.isFinite(value) && value >= 0
			? value
			: null;
	};
	const valid = WORKER_LIMITS.every((limit) => read(amounts[limit]) !== null);
	const submit = (event: FormEvent) => {
		event.preventDefault();
		onSave(
			WORKER_LIMITS.filter((limit) => amounts[limit] !== kept(limit)).map(
				(limit) => [limit, read(amounts[limit])],
			),
		);
	};
	const set = WORKER_LIMITS.filter((limit) => now(limit)?.set === true);
	return (
		<form
			aria-label="edit workers budget"
			onSubmit={submit}
			className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3"
		>
			<div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
				{WORKER_LIMITS.map((limit, at) => (
					<div key={limit} className="contents text-sm">
						<span>{WORKER_LIMIT_NAMES[limit]}</span>
						<span className="flex items-center gap-1">
							<span className="text-muted-foreground">$</span>
							<Input
								aria-label={`${limit} dollars`}
								value={amounts[limit]}
								autoFocus={at === 0}
								inputMode="decimal"
								onChange={(event) =>
									setAmounts({ ...amounts, [limit]: event.target.value })
								}
								placeholder={String(DEFAULT_WORKER_LIMITS[limit])}
								className="w-24 font-mono"
							/>
							{limit === "hour" && (
								<span className="text-muted-foreground text-xs">
									an hour, for those running at once
								</span>
							)}
						</span>
					</div>
				))}
			</div>
			<p className="text-muted-foreground text-xs">
				Defaults: {dollars(DEFAULT_WORKER_LIMITS.hour)}/h,{" "}
				{dollars(DEFAULT_WORKER_LIMITS.day)} a day,{" "}
				{dollars(DEFAULT_WORKER_LIMITS.month)} a month. Raises come on top.
			</p>
			<div className="flex flex-wrap items-center gap-2">
				{set.length > 0 && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="text-muted-foreground"
						onClick={() => onSave(set.map((limit) => [limit, null]))}
					>
						Use the defaults
					</Button>
				)}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="ml-auto"
					onClick={onCancel}
				>
					Cancel
				</Button>
				<Button type="submit" size="sm" disabled={!valid}>
					Save
				</Button>
			</div>
		</form>
	);
}

/** More dollars on one worker limit, for a while. */
export function WorkerRaiseForm({
	onRaise,
	onCancel,
}: {
	onRaise: (limit: WorkerLimit, dollars: number, span: string) => void;
	onCancel: () => void;
}): JSX.Element {
	const [limit, setLimit] = useState<WorkerLimit>("day");
	const [amount, setAmount] = useState("");
	const [span, setSpan] = useState<string>("1d");
	const value = Number(amount.trim().replace(/^\$/, ""));
	const valid = amount.trim() !== "" && Number.isFinite(value) && value > 0;
	const submit = (event: FormEvent) => {
		event.preventDefault();
		onRaise(limit, value, span);
	};
	return (
		<form
			aria-label="raise"
			onSubmit={submit}
			className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3"
		>
			<div className="flex flex-wrap items-center gap-2">
				<span className="text-sm">Add $</span>
				<Input
					aria-label="dollars"
					value={amount}
					autoFocus
					inputMode="decimal"
					onChange={(event) => setAmount(event.target.value)}
					placeholder="2"
					className="w-20 font-mono"
				/>
				<span className="text-sm">to</span>
				<div role="radiogroup" aria-label="limit" className="flex gap-1">
					{WORKER_LIMITS.map((each) => (
						<Button
							key={each}
							type="button"
							role="radio"
							aria-checked={limit === each}
							variant={limit === each ? "secondary" : "ghost"}
							size="sm"
							onClick={() => setLimit(each)}
						>
							{RAISE_NAMES[each]}
						</Button>
					))}
				</div>
				<span className="text-sm">for</span>
				<SpanPicker span={span} onPick={setSpan} />
			</div>
			<p className="text-muted-foreground text-xs">
				{limit === "hour"
					? "Dollars an hour more for the made workers running at once."
					: "Added to the limit until the raise ends."}
			</p>
			<div className="flex items-center justify-end gap-2">
				<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
				<Button type="submit" size="sm" disabled={!valid}>
					Raise
				</Button>
			</div>
		</form>
	);
}

/** How long a raise or a pause lasts, from `SPANS`. */
function SpanPicker({
	span,
	onPick,
}: {
	span: string;
	onPick: (span: string) => void;
}): JSX.Element {
	return (
		<div role="radiogroup" aria-label="for" className="flex gap-1">
			{SPANS.map(([value, label]) => (
				<Button
					key={value}
					type="button"
					role="radio"
					aria-checked={span === value}
					aria-label={label}
					variant={span === value ? "secondary" : "ghost"}
					size="sm"
					onClick={() => onPick(value)}
				>
					{value}
				</Button>
			))}
		</div>
	);
}

const ENDS = new Intl.DateTimeFormat("en", {
	weekday: "short",
	hour: "numeric",
	minute: "2-digit",
});

/** When a raise or a pause ends, and how long until then: `Thu 3:00 PM, in 5h`. */
export function ends(at: number, now: number): string {
	const hours = Math.max(0, Math.round((at - now) / 3_600_000));
	return `${ENDS.format(at)}, in ${hours >= 48 ? `${Math.round(hours / 24)}d` : `${hours}h`}`;
}
