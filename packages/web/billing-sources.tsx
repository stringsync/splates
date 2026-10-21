import type { BillingView } from "@stringsync/splates-server/spend";
import type { JSX } from "react";
import { buttonVariants } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { nameOf } from "./billing-sums";
import { credAddress } from "./page-address";

/** Where billed amounts come from: a row for each provider, how its last pull went in full, and what to do about it. */
export function Sources({
	sources,
	pulling,
	error,
	onPull,
}: {
	sources: BillingView | null;
	pulling: boolean;
	error: string | null;
	onPull(): void;
}): JSX.Element {
	return (
		<section aria-label="billing sources" className="flex flex-col gap-2">
			<h3 className="flex items-baseline gap-2 font-medium text-sm">
				Billing sources
				<span
					role={pulling ? "status" : undefined}
					className="font-normal text-muted-foreground text-xs"
				>
					{pulling
						? "Pulling…"
						: sources?.pulledAt
							? `pulled ${new Date(sources.pulledAt).toLocaleTimeString()}`
							: ""}
				</span>
			</h3>
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					Could not read billing sources: {error}
				</p>
			)}
			{(sources?.providers.length ?? 0) > 0 && (
				<ul className="divide-y rounded-lg border bg-card">
					{sources?.providers.map((each) => (
						<SourceRow
							key={each.provider}
							source={each}
							pulling={pulling}
							onPull={onPull}
						/>
					))}
				</ul>
			)}
		</section>
	);
}

type Source = BillingView["providers"][number];

/** How each state reads on a source's row: its label, its dot's color, and what it says when the server says nothing. */
const STATES: Record<
	Source["state"],
	{ label: string; dot: string; text: string }
> = {
	ok: { label: "Pulled", dot: "bg-success", text: "text-success" },
	missing: { label: "Needs a key", dot: "bg-warning", text: "text-warning" },
	unreachable: {
		label: "Pull failed",
		dot: "bg-destructive",
		text: "text-destructive",
	},
	counted: {
		label: "Counted as used",
		dot: "bg-success",
		text: "text-success",
	},
	untracked: {
		label: "Not tracked yet",
		dot: "bg-muted-foreground",
		text: "text-muted-foreground",
	},
};

function SourceRow({
	source,
	pulling,
	onPull,
}: {
	source: Source;
	pulling: boolean;
	onPull(): void;
}): JSX.Element {
	const state = STATES[source.state];
	const detail =
		source.state === "ok"
			? source.added > 0
				? `${source.added} new ${source.added === 1 ? "charge" : "charges"}`
				: "Up to date"
			: source.state === "missing" && source.cred !== null
				? `Reads its costs with ${source.cred}, which is not on the Creds page.`
				: source.message;
	return (
		<li className="flex items-center gap-3 px-3 py-2.5">
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
					<span className="font-medium text-sm">{nameOf(source.provider)}</span>
					<span
						role={source.state === "unreachable" ? "alert" : undefined}
						className={cn("flex items-center gap-1.5 text-xs", state.text)}
					>
						<span
							aria-hidden
							className={cn("size-1.5 rounded-full", state.dot)}
						/>
						{state.label}
					</span>
				</span>
				<span className="text-muted-foreground text-xs">{detail}</span>
			</div>
			<div className="flex shrink-0 flex-wrap justify-end gap-1.5">
				{source.state === "missing" && source.cred !== null && (
					<a
						href={credAddress(source.cred)}
						aria-label={`Add ${source.cred} on the Creds page`}
						className={buttonVariants({ size: "sm" })}
					>
						Add key
					</a>
				)}
				{source.state === "unreachable" && source.cred !== null && (
					<a
						href={credAddress(source.cred)}
						aria-label={`Fix ${source.cred} on the Creds page`}
						className={buttonVariants({ size: "sm" })}
					>
						Fix token
					</a>
				)}
				{source.state === "unreachable" && (
					<button
						type="button"
						disabled={pulling}
						onClick={onPull}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						Retry
					</button>
				)}
			</div>
		</li>
	);
}
