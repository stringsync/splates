import type {
	LineupOverrides,
	ModelProvider,
	Pairing,
} from "@splates/server/stats/browser";
import { ActivityIcon, ArrowRightIcon, SendIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "#web/components/ui/alert.tsx";
import { Badge } from "#web/components/ui/badge.tsx";
import { Button } from "#web/components/ui/button.tsx";
import {
	autopickOverrides,
	dismissAutopickOverrides,
	sendAutopickOverrides,
} from "./autopick-api";
import { ModelProviderMark } from "./model-provider-mark";

/** Review new overrides across all periods, independent of the scorecard filter. */
export function OverrideReview(): JSX.Element | null {
	const [notice, setNotice] = useState<Awaited<
		ReturnType<typeof autopickOverrides>
	> | null>(null);
	const [sent, setSent] = useState<number | null>(null);
	const [sending, setSending] = useState(false);
	const [refused, setRefused] = useState<string | null>(null);
	useEffect(() => {
		let live = true;
		autopickOverrides().then(
			(each) => live && setNotice(each),
			() => {},
		);
		return () => {
			live = false;
		};
	}, []);
	if (notice === null || notice.rows.length === 0) {
		return null;
	}
	const { rows, cursor } = notice;
	const total = rows.reduce((sum, row) => sum + row.count, 0);
	const respond = async (action: "send" | "dismiss") => {
		setSending(true);
		setRefused(null);
		try {
			if (action === "send") {
				setSent(await sendAutopickOverrides());
			} else {
				await dismissAutopickOverrides(cursor);
				setNotice(null);
			}
		} catch (error) {
			setRefused(error instanceof Error ? error.message : String(error));
		} finally {
			setSending(false);
		}
	};
	return (
		<Alert
			className="border-warning/35 bg-warning/10 [&>svg]:text-warning md:has-[>svg]:grid-cols-[auto_minmax(0,1fr)_auto]"
			role="region"
			aria-label="Unreviewed overrides"
		>
			<ActivityIcon aria-hidden />
			<AlertTitle>
				{total} unreviewed {total === 1 ? "override" : "overrides"} across{" "}
				{rows.length} {rows.length === 1 ? "cell" : "cells"}
			</AlertTitle>
			<AlertDescription className="col-start-2 text-xs">
				The agent reviews flagged cells across all time.
			</AlertDescription>
			{refused !== null && (
				<p role="alert" className="col-start-2 text-destructive text-xs">
					{refused}
				</p>
			)}
			<div className="col-span-full mt-2 flex flex-wrap items-center justify-end gap-2 md:col-span-1 md:col-start-3 md:row-span-2 md:row-start-1 md:mt-0 md:self-center">
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
					<span role="status" className="text-muted-foreground text-sm">
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
		</Alert>
	);
}

/** The pairings people moved between, with a count for earlier overrides. */
export function OverrideMoves({
	overrides,
	onLog,
}: {
	overrides: LineupOverrides;
	onLog: () => void;
}): JSX.Element {
	const { moves, earlier } = overrides;
	return (
		<div className="flex flex-col items-start gap-2">
			{moves.length > 0 && (
				<>
					<p className="font-medium text-xs">Recorded moves</p>
					<ul
						className="flex max-w-full flex-col gap-2"
						aria-label="Recorded moves"
					>
						{moves.map(({ from, to, count, fromProvider, toProvider }) => (
							<li
								key={JSON.stringify([from, to])}
								className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-1.5 md:flex md:flex-wrap"
							>
								<PairingChip pairing={from} provider={fromProvider} />
								<ArrowRightIcon
									aria-hidden
									className="size-3 text-muted-foreground"
								/>
								<span className="sr-only">to</span>
								<PairingChip pairing={to} provider={toProvider} />
								<span className="whitespace-nowrap text-muted-foreground text-xs">
									{count} {count === 1 ? "time" : "times"}
								</span>
							</li>
						))}
					</ul>
				</>
			)}
			{earlier > 0 && (
				<p className="text-muted-foreground text-xs">
					{earlier} earlier {earlier === 1 ? "override" : "overrides"} with no
					pairing recorded
				</p>
			)}
			<button
				type="button"
				className="font-medium text-primary text-xs underline"
				onClick={onLog}
			>
				View cell in the pick log
			</button>
		</div>
	);
}

/** A model and its effort as one pairing, such as `Opus 5.5 · high`. */
function PairingChip({
	pairing,
	provider,
}: {
	pairing: Pairing;
	provider: ModelProvider | null;
}): JSX.Element {
	return (
		<Badge
			variant="outline"
			className="h-auto min-w-0 max-w-full items-start whitespace-normal rounded-md bg-card py-1"
		>
			<ModelProviderMark provider={provider} className="mt-0.5" />
			<span className="wrap-anywhere">
				{pairing.model ?? "Unknown model"}
				{pairing.effort !== null && (
					<span className="text-muted-foreground"> · {pairing.effort}</span>
				)}
			</span>
		</Badge>
	);
}
