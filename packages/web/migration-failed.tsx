import { useReactive } from "@webappwiz/react";
import { BotIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import { type JSX, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "#web/components/ui/empty.tsx";
import type { Feed } from "./feed";
import { MigrationRepair } from "./migration-repair";
import { MainTerminal } from "./terminal";
import type { Terminals } from "./terminals";

/**
 * What the page shows in place of a project whose records `splates server`
 * could not move to the format it reads: what failed, as kept beside the
 * records, and three ways on, never a dead end. Fix with an agent opens a
 * terminal at the project's root that starts one, told what failed;
 * Retry asks the server to try again; and the release that still reads the
 * records as they are serves them meanwhile.
 */
export function MigrationFailed({
	message,
	feed,
	terminals,
}: {
	/** What the server refused the project with. */
	message: string;
	feed: Feed;
	terminals: Terminals;
}): JSX.Element {
	const [repair] = useState(() => new MigrationRepair(feed, terminals));
	const { said, retrying, refused, fixing } = useReactive(
		repair,
		(repair) => ({
			said: repair.said,
			retrying: repair.retrying,
			refused: repair.refused,
			fixing: repair.fixing,
		}),
		["changed"],
	);
	// Again with each refusal, which a retry that failed afresh brings.
	useEffect(() => void repair.read(message), [repair, message]);

	if (fixing !== null) {
		return (
			<MainTerminal
				terminals={terminals}
				terminal={fixing}
				trunk={said?.trunk ?? ""}
				onBack={() => repair.back()}
				onExit={() => repair.back()}
				onClose={() => repair.close()}
			/>
		);
	}
	const failure = said?.failure ?? null;
	return (
		<Empty className="flex-1 py-16">
			<EmptyHeader className="max-w-xl">
				<EmptyMedia variant="icon">
					<TriangleAlertIcon />
				</EmptyMedia>
				<EmptyTitle>This project's records could not be updated</EmptyTitle>
				<EmptyDescription>
					{failure === null
						? message
						: `They could not move from format ${failure.from} to ${failure.to}${failure.step === null ? "" : `, at the step that ${failure.step}`}. splates put them back as they were, so nothing is lost.`}
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent className="max-w-xl">
				{failure !== null && (
					<pre className="max-h-64 w-full overflow-auto rounded-md bg-muted p-3 text-left font-mono text-xs whitespace-pre-wrap">
						{failure.error}
					</pre>
				)}
				<div className="flex flex-wrap justify-center gap-2">
					<Button onClick={() => repair.fix()} disabled={said?.fix == null}>
						<BotIcon data-icon="inline-start" />
						Fix with an agent
					</Button>
					<Button
						variant="outline"
						onClick={() => void repair.retry()}
						disabled={retrying}
					>
						<RotateCcwIcon data-icon="inline-start" />
						{retrying ? "Retrying…" : "Retry"}
					</Button>
				</div>
				{refused !== null && (
					<p role="alert" className="text-destructive text-sm">
						Still failing: {refused.split("\n")[0]}
					</p>
				)}
				{failure?.fallback != null && (
					<p className="text-muted-foreground text-xs">
						Meanwhile, splates {failure.fallback} still reads them as they are:{" "}
						<code className="font-mono">
							bunx @stringsync/splates@{failure.fallback} server
						</code>
					</p>
				)}
			</EmptyContent>
		</Empty>
	);
}
