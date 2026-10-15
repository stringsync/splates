import { KeyRoundIcon, PlusIcon } from "lucide-react";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { CredRequest } from "../creds";
import { dismissCred, type KeptCreds, keptCreds, saveCred } from "./api";
import { Paste } from "./cred-paste";
import { ScopeChip } from "./cred-scope";
import { AddCred, KeptRow } from "./kept-creds";
import { Markdown } from "./markdown";
import { PHONE_HEADING } from "./phone-rows";
import { TaskChip } from "./reference-chip";

/** The requests still waiting on the person. */
export function openRequests(requests: CredRequest[]): CredRequest[] {
	return requests.filter((each) => each.status === "open");
}
/**
 * What a request is for, then how to get it, so the person knows why before
 * going to get it. A record from before requests said what for shows only how.
 */
function RequestBody({ request }: { request: CredRequest }): JSX.Element {
	return (
		<div className="flex flex-col gap-2 px-4 py-3 text-sm leading-relaxed">
			{request.purpose !== "" && (
				<p className="font-medium">
					<Markdown text={request.purpose} inline />
				</p>
			)}
			<Markdown
				text={request.instructions}
				className="[&_p:first-child]:mt-0"
			/>
		</div>
	);
}

/** A request on the Creds page: what, for whom, what for, how to get it, the field. */
function RequestRow({
	request,
	project,
	picked,
	onChanged,
}: {
	request: CredRequest;
	project: string;
	/** Whether the address set the page on it. */
	picked: boolean;
	onChanged: () => void;
}): JSX.Element {
	const [error, setError] = useState<string | null>(null);
	return (
		<li
			aria-label={`requested ${request.name}`}
			data-cred={request.name}
			className={cn(
				"overflow-hidden rounded-xl border bg-card shadow-xs",
				picked && "ring-2 ring-ring",
			)}
		>
			<header className="flex flex-wrap items-center gap-2 border-b bg-warning/[0.08] px-4 py-2.5">
				<KeyRoundIcon className="size-4 text-warning" />
				<code className="font-medium font-mono text-[13px]">
					{request.name}
				</code>
				<ScopeChip scope={request.scope} project={project} />
				{request.task !== null && (
					<span className="ml-auto flex items-center gap-1.5 text-muted-foreground text-xs">
						for <TaskChip task={request.task} inline />
					</span>
				)}
			</header>
			<RequestBody request={request} />
			<div className="px-4 pb-4">
				<Paste
					name={request.name}
					save={(value) => saveCred(request.name, value)}
					onSaved={onChanged}
					besides={
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="text-muted-foreground"
							onClick={() =>
								dismissCred(request.name)
									.then(onChanged)
									.catch((caught: Error) => setError(caught.message))
							}
						>
							Dismiss
						</Button>
					}
				/>
			</div>
			{error !== null && (
				<p role="alert" className="px-4 pb-3 text-destructive text-xs">
					{error}
				</p>
			)}
		</li>
	);
}
/**
 * The Creds page: the creds agents asked for, each with how to get it and a
 * field to paste it in, then those the stores keep, by name. A value only
 * ever goes from here to a store.
 */
export function CredsPage({
	requests,
	project,
	cred = null,
}: {
	requests: CredRequest[];
	project: string;
	/** The cred the address sets the page on, by name, to scroll to and mark. */
	cred?: string | null;
}): JSX.Element {
	const open = openRequests(requests);
	const [kept, setKept] = useState<KeptCreds | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const read = useCallback(() => {
		keptCreds()
			.then((read) => {
				setKept(read);
				setError(null);
			})
			.catch((caught: Error) => setError(caught.message));
	}, []);
	// Read again whenever a request moves, as one filled from a thread does.
	const moved = JSON.stringify(requests);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `moved` is when to read again
	useEffect(read, [read, moved]);
	const page = useRef<HTMLElement>(null);
	// Once the creds are drawn: scroll to the cred, mark it, and for a request
	// put the cursor in its field, ready to paste.
	useEffect(() => {
		if (cred === null || kept === null) {
			return;
		}
		const row = [...(page.current?.querySelectorAll("[data-cred]") ?? [])].find(
			(each) => each.getAttribute("data-cred") === cred,
		);
		row?.scrollIntoView({ block: "center" });
		row?.querySelector<HTMLElement>("input, textarea")?.focus({
			preventScroll: true,
		});
	}, [cred, kept]);
	const system = kept?.labels.device.replace(/ as ".*"$/, "") ?? null;

	return (
		<section
			ref={page}
			aria-label="creds"
			className="flex min-w-0 flex-col gap-8"
		>
			{open.length > 0 && (
				<div className="flex flex-col gap-3">
					<header className="flex items-baseline gap-2">
						<h2 className={cn("font-medium text-sm", PHONE_HEADING)}>
							Requested
						</h2>
						<span className="text-muted-foreground text-xs tabular-nums">
							{open.length}
						</span>
					</header>
					<ul className="flex flex-col gap-4">
						{open.map((request) => (
							<RequestRow
								key={`${request.name}:${request.requestedAt}`}
								request={request}
								project={project}
								picked={request.name === cred}
								onChanged={read}
							/>
						))}
					</ul>
				</div>
			)}
			<div className="flex flex-col gap-3">
				<header className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<h2 className={cn("font-medium text-sm", PHONE_HEADING)}>Kept</h2>
					{system !== null && (
						// Under the heading on a phone, so neither is squeezed.
						<span className="order-last w-full text-muted-foreground text-xs sm:order-none sm:w-auto">
							in {system}. Values never come back to this page.
						</span>
					)}
					<Button
						variant="outline"
						size="sm"
						className="ml-auto"
						aria-expanded={adding}
						onClick={() => setAdding(!adding)}
					>
						<PlusIcon /> Add
					</Button>
				</header>
				{adding && (
					<AddCred
						project={project}
						onAdded={() => {
							setAdding(false);
							read();
						}}
						onRemoved={() => setAdding(false)}
					/>
				)}
				{error !== null && (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				)}
				{kept !== null &&
					(kept.kept.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							Nothing kept yet. Agents request what they need here, or Add one.
						</p>
					) : (
						// On a phone, the inbox's rows out to the screen's edges.
						<ul className="divide-y rounded-xl border bg-card max-md:-mx-4 max-md:rounded-none max-md:border-x-0">
							{kept.kept.map((each) => (
								<KeptRow
									key={`${each.scope}:${each.name}`}
									{...each}
									picked={each.name === cred}
									project={project}
									onChanged={read}
								/>
							))}
						</ul>
					))}
			</div>
		</section>
	);
}
