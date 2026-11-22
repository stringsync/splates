import type { CellOverrides, Pairing } from "@splates/server/stats/browser";
import { ActivityIcon, ChevronRightIcon, SendIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import {
	autoPickOverrides,
	dismissAutoPickOverrides,
	sendAutoPickOverrides,
} from "./auto-pick-api";
import { cellKeyLabel } from "./auto-pick-rules";

/** A model and an effort as one lineup, `Opus 5.5 · high`. */
function PairingChip({ pairing }: { pairing: Pairing }): JSX.Element {
	return (
		<span className="rounded-md border bg-card px-2.5 py-1 text-sm">
			<span className="font-medium">{pairing.model ?? "Unknown model"}</span>
			{pairing.effort !== null && (
				<span className="text-muted-foreground"> · {pairing.effort}</span>
			)}
		</span>
	);
}

/**
 * The picks the person changed, by the cell of the routes they were made
 * for, one row to a cell with its count. A cell opens to the lineups it was
 * moved between, a model and an effort always together, and the banner above
 * them sends it all to an agent to update the rules. Shows nothing until
 * there is one.
 */
export function AutoPickOverrides({
	onCell,
}: {
	/** Lists the picks of `cell`, `bugfix.deep`. */
	onCell: (cell: string) => void;
}): JSX.Element | null {
	const [{ rows, cursor }, setNotice] = useState<{
		rows: CellOverrides[];
		cursor: number;
	}>({ rows: [], cursor: 0 });
	const [sent, setSent] = useState<number | null>(null);
	const [sending, setSending] = useState(false);
	const [refused, setRefused] = useState<string | null>(null);
	useEffect(() => {
		let live = true;
		autoPickOverrides().then(
			(each) => live && setNotice(each),
			() => {},
		);
		return () => {
			live = false;
		};
	}, []);
	if (rows.length === 0) {
		return null;
	}
	const total = rows.reduce((sum, row) => sum + row.count, 0);
	const worst = rows[0];
	const respond = async (action: "send" | "dismiss") => {
		setSending(true);
		setRefused(null);
		try {
			if (action === "send") {
				setSent(await sendAutoPickOverrides());
			} else {
				await dismissAutoPickOverrides(cursor);
				setNotice({ rows: [], cursor });
			}
		} catch (error) {
			setRefused(error instanceof Error ? error.message : String(error));
		} finally {
			setSending(false);
		}
	};
	return (
		<section aria-label="Overrides" className="flex flex-col gap-3">
			<h3 className="font-semibold text-sm">Overrides</h3>
			<div className="flex flex-wrap items-center gap-3.5 rounded-lg border border-warning/35 bg-warning/10 px-4 py-3.5">
				<span className="flex size-8 flex-none items-center justify-center rounded-lg bg-warning/20 text-warning">
					<ActivityIcon aria-hidden className="size-4" />
				</span>
				<div className="min-w-40 flex-1">
					<p className="font-medium text-sm">
						{total} {total === 1 ? "override" : "overrides"} across{" "}
						{rows.length} {rows.length === 1 ? "cell" : "cells"}
					</p>
					<p className="text-muted-foreground text-xs">
						{worst !== undefined && rows.length > 1
							? `${cellKeyLabel(`${worst.kind}.${worst.depth}`)} alone is ${worst.count}. `
							: ""}
						An agent can read them and propose changes to the rules.
					</p>
					{refused !== null && (
						<p role="alert" className="text-destructive text-xs">
							{refused}
						</p>
					)}
				</div>
				<div className="ml-auto flex items-center gap-2">
					{sent === null ? (
						<Button
							size="sm"
							disabled={sending}
							onClick={() => void respond("send")}
						>
							<SendIcon aria-hidden data-icon="inline-start" />
							Send to agent
						</Button>
					) : (
						<span className="text-muted-foreground text-sm">
							Sent as task #{sent}
						</span>
					)}
					<Button
						size="sm"
						variant="outline"
						disabled={sending}
						onClick={() => void respond("dismiss")}
					>
						Dismiss
					</Button>
				</div>
			</div>
			<ul className="divide-y overflow-hidden rounded-lg border bg-card">
				{rows.map((row) => {
					const cell = `${row.kind}.${row.depth}`;
					return (
						<li key={cell}>
							<Collapsible>
								<CollapsibleTrigger
									className="group flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm"
									aria-label={cellKeyLabel(cell)}
								>
									<span className="flex-1 font-medium">
										{cellKeyLabel(cell)}
									</span>
									<span className="font-semibold tabular-nums">
										{row.count}
									</span>
									<ChevronRightIcon
										aria-hidden
										className="size-4 text-muted-foreground transition-transform group-aria-expanded:rotate-90"
									/>
								</CollapsibleTrigger>
								<CollapsibleContent className="flex flex-col gap-1 border-t bg-muted/40 px-4 pb-3.5">
									{row.moves.map((move) => (
										<div
											key={JSON.stringify([move.from, move.to])}
											className="flex items-center gap-2.5 border-b py-2.5 last:border-b-0"
										>
											<div className="flex flex-1 flex-wrap items-center gap-2.5">
												<PairingChip pairing={move.from} />
												<span aria-hidden className="text-muted-foreground">
													→
												</span>
												<PairingChip pairing={move.to} />
											</div>
											<span className="text-muted-foreground text-xs">
												{move.count} {move.count === 1 ? "time" : "times"}
											</span>
										</div>
									))}
									{row.earlier > 0 && (
										<p className="py-2 text-muted-foreground text-xs">
											{row.earlier} earlier, from before lineups were recorded
										</p>
									)}
									<button
										type="button"
										className="self-start font-medium text-primary text-xs"
										onClick={() => onCell(cell)}
									>
										View these picks in the log
									</button>
								</CollapsibleContent>
							</Collapsible>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
