import type {
	KeyHolder,
	KeyProvider,
	WorkerKey,
} from "@stringsync/splates-server/workers";
import { PlusIcon, ServerIcon } from "lucide-react";
import { type JSX, useCallback, useEffect, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	NativeSelect,
	NativeSelectOption,
} from "#web/components/ui/native-select.tsx";
import { cn } from "#web/lib/utils.ts";
import {
	addWorkerKey,
	removeWorkerKey,
	type WorkerKeysListing,
	workerKeys,
} from "./api";
import { Paste } from "./cred-paste";
import { PHONE_HEADING } from "./phone-rows";

/**
 * The Creds page's worker keys: the API key each registered worker, or
 * every worker of a type a provider makes, runs its agents on, each in a
 * workspace or project with a spend limit of its own. This machine's
 * worker holds none: its agents sign in as the person.
 */
export function WorkerKeys({
	onRead,
}: {
	/** Told the store names of the keys each time they are read, so the page lists them here alone. */
	onRead?: (creds: string[]) => void;
}): JSX.Element {
	const [listing, setListing] = useState<WorkerKeysListing | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [adding, setAdding] = useState(false);
	const read = useCallback(() => {
		workerKeys()
			.then((read) => {
				setListing(read);
				setError(null);
				onRead?.(read.keys.map((each) => each.cred));
			})
			.catch((caught: Error) => setError(caught.message));
	}, [onRead]);
	useEffect(read, [read]);
	const changed = read;
	return (
		<section aria-label="worker keys" className="flex flex-col gap-3">
			<header className="flex flex-wrap items-center gap-x-2 gap-y-1">
				<h2 className={cn("font-medium text-sm", PHONE_HEADING)}>
					Worker keys
				</h2>
				<span className="order-last w-full text-muted-foreground text-xs sm:order-none sm:w-auto">
					what agents on other workers run on
				</span>
				<Button
					variant="outline"
					size="sm"
					className="ml-auto"
					aria-expanded={adding}
					disabled={listing === null}
					onClick={() => setAdding(!adding)}
				>
					<PlusIcon /> Add key
				</Button>
			</header>
			{adding && listing !== null && (
				<AddKey
					listing={listing}
					onAdded={() => {
						setAdding(false);
						changed();
					}}
					onCancel={() => setAdding(false)}
				/>
			)}
			{error !== null && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			{listing !== null &&
				(listing.keys.length === 0 ? (
					<p className="flex items-center gap-2 text-muted-foreground text-sm">
						<ServerIcon className="size-4" />
						No worker holds a key yet: agents others start run on this machine
						until one does.
					</p>
				) : (
					<ul className="divide-y rounded-xl border bg-card max-md:-mx-4 max-md:rounded-none max-md:border-x-0">
						{listing.keys.map((each) => (
							<KeyRow
								key={each.cred}
								held={each}
								provider={listing.providers.find(
									(provider) => provider.id === each.provider,
								)}
								onChanged={changed}
							/>
						))}
					</ul>
				))}
		</section>
	);
}

/** Who holds a key, as the page says it. */
function holderLabel(holder: KeyHolder): string {
	return "worker" in holder
		? `worker ${holder.worker}`
		: `every ${holder.type} worker`;
}

/** A holder as a select's value: `worker:<id>` or `type:<name>`. */
function holderValue(holder: KeyHolder): string {
	return "worker" in holder ? `worker:${holder.worker}` : `type:${holder.type}`;
}

function holderOf(value: string): KeyHolder {
	const at = value.indexOf(":");
	const what = value.slice(0, at);
	const id = value.slice(at + 1);
	return what === "worker" ? { worker: id } : { type: id };
}

/** Where to make `provider`'s key and set its limit, as a line. */
function MakeIt({ provider }: { provider: KeyProvider }): JSX.Element {
	return (
		<p className="text-muted-foreground text-xs leading-relaxed">
			Make a {provider.scope} for it, set its spend limit at{" "}
			<a
				href={provider.limits}
				target="_blank"
				rel="noreferrer"
				className="underline underline-offset-2"
			>
				{provider.name}'s {provider.scope}s
			</a>
			, then make a key in it at{" "}
			<a
				href={provider.keys}
				target="_blank"
				rel="noreferrer"
				className="underline underline-offset-2"
			>
				{provider.name}'s keys
			</a>{" "}
			and paste it here.
		</p>
	);
}

/** A key a worker holds: whose and which provider's, with Replace and Remove. */
function KeyRow({
	held,
	provider,
	onChanged,
}: {
	held: WorkerKey;
	provider: KeyProvider | undefined;
	onChanged: () => void;
}): JSX.Element {
	const [replacing, setReplacing] = useState(false);
	const [removing, setRemoving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const name = `${provider?.name ?? held.provider} key for ${holderLabel(held.holder)}`;
	return (
		<li
			aria-label={name}
			data-cred={held.cred}
			className="flex flex-col gap-2 px-4 py-2.5 text-sm"
		>
			<div className="flex flex-wrap items-center gap-3">
				<span className="font-medium">{provider?.name ?? held.provider}</span>
				<span className="text-muted-foreground">
					{holderLabel(held.holder)}
				</span>
				<span className="ml-auto flex gap-1">
					{removing ? (
						<>
							<Button
								variant="ghost"
								size="sm"
								className="text-destructive"
								onClick={() =>
									removeWorkerKey(held.holder, held.provider)
										.then(onChanged)
										.catch((caught: Error) => setError(caught.message))
								}
							>
								Remove {name}
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setRemoving(false)}
							>
								Keep
							</Button>
						</>
					) : (
						<>
							<Button
								variant="ghost"
								size="sm"
								aria-expanded={replacing}
								onClick={() => setReplacing(!replacing)}
							>
								Replace
							</Button>
							<Button
								variant="ghost"
								size="sm"
								className="text-muted-foreground hover:text-destructive"
								onClick={() => setRemoving(true)}
							>
								Remove
							</Button>
						</>
					)}
				</span>
			</div>
			{replacing && (
				<Paste
					name={name}
					saved
					save={(value) => addWorkerKey(held.holder, held.provider, value)}
					onSaved={() => {
						setReplacing(false);
						onChanged();
					}}
				/>
			)}
			{removing && (
				<p className="text-muted-foreground text-xs">
					Revoke it in {provider === undefined ? "its" : `${provider.name}'s`}{" "}
					console too: removing it here only forgets it.
				</p>
			)}
			{error !== null && (
				<p role="alert" className="text-destructive text-xs">
					{error}
				</p>
			)}
		</li>
	);
}

/** Adding a key: whose, which provider's, where to make it, and the field. */
function AddKey({
	listing,
	onAdded,
	onCancel,
}: {
	listing: WorkerKeysListing;
	onAdded: () => void;
	onCancel: () => void;
}): JSX.Element {
	const holders: KeyHolder[] = [
		...listing.holders.workers.map((worker) => ({ worker })),
		...listing.holders.types.map((type) => ({ type })),
	];
	const [provider, setProvider] = useState(listing.providers[0]?.id ?? "");
	const [holder, setHolder] = useState(
		holders[0] === undefined ? "" : holderValue(holders[0]),
	);
	const picked = listing.providers.find((each) => each.id === provider);
	if (holders.length === 0) {
		return (
			<div className="flex items-center gap-2 rounded-xl border bg-card px-4 py-3 text-muted-foreground text-sm">
				<span>
					No worker to hold a key yet: join one with{" "}
					<code className="font-mono text-xs">splates worker add</code>, or set
					a <code className="font-mono text-xs">workerProvider</code>.
				</span>
				<Button
					variant="ghost"
					size="sm"
					className="ml-auto"
					onClick={onCancel}
				>
					Cancel
				</Button>
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-3">
			<div className="flex flex-wrap items-center gap-2">
				<NativeSelect
					aria-label="Provider"
					value={provider}
					onChange={(event) => setProvider(event.target.value)}
				>
					{listing.providers.map((each) => (
						<NativeSelectOption key={each.id} value={each.id}>
							{each.name}
						</NativeSelectOption>
					))}
				</NativeSelect>
				<span className="text-muted-foreground text-sm">for</span>
				<NativeSelect
					aria-label="Held by"
					value={holder}
					onChange={(event) => setHolder(event.target.value)}
				>
					{holders.map((each) => (
						<NativeSelectOption
							key={holderValue(each)}
							value={holderValue(each)}
						>
							{holderLabel(each)}
						</NativeSelectOption>
					))}
				</NativeSelect>
				<Button
					variant="ghost"
					size="sm"
					className="ml-auto text-muted-foreground"
					onClick={onCancel}
				>
					Cancel
				</Button>
			</div>
			{picked !== undefined && <MakeIt provider={picked} />}
			<Paste
				key={`${provider}:${holder}`}
				name={`${picked?.name ?? provider} key`}
				save={(value) => addWorkerKey(holderOf(holder), provider, value)}
				onSaved={onAdded}
			/>
		</div>
	);
}
