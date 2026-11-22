import type { SignalRaise } from "@splates/server/signals";
import { ChevronDownIcon, ChevronRightIcon, CopyIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { todoAddress } from "./page-address";
import { ago } from "./signal-of";
import {
	cellOf,
	cellText,
	isEmpty,
	payloadColumns,
	taskNumbers,
	WHOLE,
} from "./signal-summary";

/** How many raises the table lists before Show all. */
const FIRST_RAISES = 20;

/** A signal's raises as a table to scan: pass them newest first; click a row to read its raw payload and copy it. */
export function Raises({
	raises,
	now,
}: {
	raises: SignalRaise[];
	now: number;
}): JSX.Element {
	const [open, setOpen] = useState<string | null>(null);
	const [all, setAll] = useState(false);
	if (raises.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No firings in the last 7 days.
			</p>
		);
	}
	const columns = payloadColumns(raises);
	const shown = all ? raises : raises.slice(0, FIRST_RAISES);
	return (
		<div className="flex flex-col gap-1.5">
			<div className="overflow-x-auto">
				<table className="w-full border-collapse whitespace-nowrap text-[13px]">
					<thead>
						<tr className="border-b text-left text-[11px] text-muted-foreground uppercase tracking-wide">
							<th className="w-24 px-2.5 py-1.5 font-medium">When</th>
							<th className="px-2.5 py-1.5 font-medium">By</th>
							{columns.map((column) => (
								<th key={column} className="px-2.5 py-1.5 font-medium">
									{column}
								</th>
							))}
							<th className="w-6" />
						</tr>
					</thead>
					<tbody>
						{shown.map((raise) => {
							const key = `${raise.at} ${raise.by}`;
							const expanded = open === key;
							const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon;
							return (
								<RaiseRow
									key={key}
									raise={raise}
									now={now}
									columns={columns}
									expanded={expanded}
									chevron={<Chevron className="size-3.5" />}
									onToggle={() => setOpen(expanded ? null : key)}
								/>
							);
						})}
					</tbody>
				</table>
			</div>
			{!all && raises.length > FIRST_RAISES && (
				<Button
					size="sm"
					variant="ghost"
					className="self-start"
					onClick={() => setAll(true)}
				>
					Show all {raises.length}
				</Button>
			)}
		</div>
	);
}

function RaiseRow({
	raise,
	now,
	columns,
	expanded,
	chevron,
	onToggle,
}: {
	raise: SignalRaise;
	now: number;
	columns: string[];
	expanded: boolean;
	chevron: JSX.Element;
	onToggle: () => void;
}): JSX.Element {
	return (
		<>
			<tr
				aria-expanded={expanded}
				onClick={onToggle}
				className={cn(
					"cursor-pointer border-b hover:bg-muted/40",
					expanded && "bg-muted/40",
				)}
			>
				<td className="whitespace-nowrap px-2.5 py-2 text-muted-foreground">
					{ago(raise.at, now)}
				</td>
				<td className="px-2.5 py-2 text-muted-foreground">{raise.by}</td>
				{columns.map((column) => (
					<td key={column} className="max-w-72 truncate px-2.5 py-2">
						<Cell column={column} value={cellOf(raise.payload, column)} />
					</td>
				))}
				<td className="px-1 text-muted-foreground">
					<button
						type="button"
						className="flex items-center"
						aria-label={expanded ? "hide payload" : "show payload"}
						onClick={(event) => {
							event.stopPropagation();
							onToggle();
						}}
					>
						{chevron}
					</button>
				</td>
			</tr>
			{expanded && (
				<tr className="border-b bg-muted/40">
					<td colSpan={columns.length + 3} className="px-2.5 pb-3">
						<div className="flex items-start gap-2">
							<pre className="min-w-0 flex-1 overflow-x-auto rounded-md border bg-sidebar px-3 py-2 font-mono text-xs">
								{raise.payload === null
									? "No payload"
									: JSON.stringify(raise.payload, null, 2)}
							</pre>
							{raise.payload !== null && (
								<Button
									size="sm"
									variant="ghost"
									onClick={() =>
										void navigator.clipboard
											?.writeText(JSON.stringify(raise.payload, null, 2))
											.catch(() => {})
									}
								>
									<CopyIcon /> Copy
								</Button>
							)}
						</div>
					</td>
				</tr>
			)}
		</>
	);
}

function Cell({
	column,
	value,
}: {
	column: string;
	value: unknown;
}): JSX.Element {
	if (isEmpty(value)) {
		return <span className="sr-only">empty</span>;
	}
	const numbers = taskNumbers(column, value);
	if (numbers !== null) {
		return (
			<span className="flex gap-1">
				{numbers.map((number) => (
					<a
						key={number}
						href={todoAddress(number)}
						onClick={(event) => event.stopPropagation()}
						className="rounded-md border px-1.5 text-info text-xs hover:bg-muted"
					>
						#{number}
					</a>
				))}
			</span>
		);
	}
	return (
		<span className={cn(column !== WHOLE && "font-mono")}>
			{cellText(value)}
		</span>
	);
}
