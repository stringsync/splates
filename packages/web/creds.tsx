import type { CredRequest, Provider } from "@splates/server/creds";
import { KeyRoundIcon, PlusIcon } from "lucide-react";
import { type JSX, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Card, CardHeader, CardList } from "#web/components/ui/card.tsx";
import { cn } from "#web/lib/utils.ts";
import { dismissCred, type KeptCreds, keptCreds, saveCred } from "./api";
import { RequestBody } from "./cred-how";
import { Paste } from "./cred-paste";
import { ProviderPicker, ScopeChip } from "./cred-scope";
import { AddCred, KeptRow } from "./kept-creds";
import { PageSection } from "./page-section";
import { usePendingWrites } from "./pending";
import { TaskChip } from "./reference-chip";
import { TopBar } from "./top-bar";

/** The requests still waiting on the person. */
export function openRequests(requests: CredRequest[]): CredRequest[] {
	return requests.filter((each) => each.status === "open");
}
/** A request on the Creds page: what, for whom, what for, how to get it, the field. */
function RequestRow({
	request,
	project,
	providers,
	picked,
	onChanged,
}: {
	request: CredRequest;
	project: string;
	/** Who can keep it, for the person to pick from. */
	providers: Provider[];
	/** Whether the address set the page on it. */
	picked: boolean;
	onChanged: () => void;
}): JSX.Element {
	const [error, setError] = useState<string | null>(null);
	const [provider, setProvider] = useState<Provider>(request.provider);
	const writes = usePendingWrites();
	return (
		<Card
			render={<li />}
			aria-label={`requested ${request.name}`}
			data-cred={request.name}
			className={cn(picked && "ring-2 ring-ring")}
		>
			<CardHeader render={<header />} variant="warning">
				<KeyRoundIcon className="size-4 text-warning" />
				<code className="font-medium font-mono text-[13px]">
					{request.name}
				</code>
				<ScopeChip
					scope={request.scope}
					project={project}
					provider={request.provider}
				/>
				<ProviderPicker
					providers={providers}
					provider={provider}
					onPick={setProvider}
				/>
				{request.task !== null && (
					<span className="ml-auto flex items-center gap-1.5 text-muted-foreground text-xs">
						for <TaskChip task={request.task} inline />
					</span>
				)}
			</CardHeader>
			<RequestBody request={request} />
			<div className="px-4 pb-4">
				<Paste
					name={request.name}
					save={(value) => saveCred(request.name, value, undefined, provider)}
					onSaved={onChanged}
					besides={
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="text-muted-foreground"
							disabled={writes.pending()}
							onClick={() =>
								writes
									.run("dismiss", () => dismissCred(request.name))
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
		</Card>
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
	// A link to a cred nothing has asked for or kept opens the form on its name.
	const unkept =
		cred !== null &&
		kept !== null &&
		!kept.kept.some((each) => each.name === cred) &&
		!open.some((each) => each.name === cred);
	const system = kept?.labels.system.device.replace(/ as ".*"$/, "") ?? null;

	return (
		<section
			ref={page}
			aria-label="creds"
			className="flex min-w-0 flex-col gap-8"
		>
			<TopBar title="Creds" />
			{open.length > 0 && (
				<PageSection title="Requested" count={open.length}>
					<ul className="flex flex-col gap-4">
						{open.map((request) => (
							<RequestRow
								key={`${request.name}:${request.requestedAt}`}
								request={request}
								project={project}
								providers={kept?.providers ?? [request.provider]}
								picked={request.name === cred}
								onChanged={read}
							/>
						))}
					</ul>
				</PageSection>
			)}
			<PageSection
				title="Kept"
				description={
					system !== null
						? `in ${system}. Values never come back to this page.`
						: undefined
				}
				aside={
					<Button
						variant="outline"
						size="sm"
						aria-expanded={adding}
						onClick={() => setAdding(!adding)}
					>
						<PlusIcon /> Add
					</Button>
				}
			>
				{(adding || unkept) && (
					<AddCred
						project={project}
						providers={kept?.providers ?? ["system"]}
						initial={
							unkept && !adding ? { name: cred, scope: "device" } : undefined
						}
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
						<Card className="max-md:-mx-4 max-md:rounded-none max-md:border-x-0">
							<CardList>
								{kept.kept.map((each) => (
									<KeptRow
										key={`${each.provider}:${each.scope}:${each.name}`}
										{...each}
										picked={each.name === cred}
										project={project}
										request={requests.find(
											(request) =>
												request.name === each.name &&
												request.scope === each.scope &&
												request.status === "saved",
										)}
										onChanged={read}
									/>
								))}
							</CardList>
						</Card>
					))}
			</PageSection>
		</section>
	);
}
