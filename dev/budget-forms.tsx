import { type FormEvent, type JSX, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { Input } from "#dev/components/ui/input.tsx";
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
				className="font-mono max-md:h-10"
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
					className="w-24 font-mono max-md:h-10"
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
