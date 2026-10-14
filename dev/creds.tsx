import { makeAssistantDataUI } from "@assistant-ui/react";
import {
	CheckIcon,
	CircleSlashIcon,
	FolderIcon,
	KeyRoundIcon,
	LaptopIcon,
	PlusIcon,
} from "lucide-react";
import {
	createContext,
	type JSX,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { Button } from "#dev/components/ui/button.tsx";
import { Input } from "#dev/components/ui/input.tsx";
import type { CredRequest, Scope } from "../creds";
import {
	dismissCred,
	type KeptCreds,
	keptCreds,
	removeCred,
	saveCred,
} from "./api";
import { CardShell } from "./card-shell";
import { CredPrivacy } from "./cred-privacy";
import { Markdown } from "./markdown";
import { TaskChip } from "./reference-chip";

/** The project's cred requests, for a card in a thread to follow its own. */
export const CredsContext = createContext<{
	requests: CredRequest[];
	/** The project's name, which its own scope is shown as. */
	project: string;
} | null>(null);

/** The requests still waiting on the person. */
export function openRequests(requests: CredRequest[]): CredRequest[] {
	return requests.filter((each) => each.status === "open");
}

function ScopeChip({
	scope,
	project,
}: {
	scope: Scope;
	project: string;
}): JSX.Element {
	const Icon = scope === "project" ? FolderIcon : LaptopIcon;
	return (
		<span
			className="inline-flex items-center gap-1 text-muted-foreground text-xs"
			title={
				scope === "project"
					? "Kept for this project"
					: "Kept for every project on this device"
			}
		>
			<Icon className="size-3" />
			{scope === "project" ? project : "this device"}
		</span>
	);
}

/**
 * A field to paste a value into, and Save, which reads Saved in place once
 * it is kept, over a line on how the value stays private. The value goes to the store and the field empties: nothing
 * holds it after.
 */
function Paste({
	name,
	save,
	saved: savedBefore = false,
	onSaved,
}: {
	name: string;
	save: (value: string) => Promise<void>;
	/** Whether it is kept already, so the field offers to replace it. */
	saved?: boolean;
	onSaved?: () => void;
}): JSX.Element {
	const [value, setValue] = useState("");
	const [saved, setSaved] = useState(savedBefore);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	return (
		<form
			className="flex flex-col gap-1.5"
			onSubmit={(event) => {
				event.preventDefault();
				if (value.trim() === "") {
					return;
				}
				setBusy(true);
				save(value)
					.then(() => {
						setValue("");
						setSaved(true);
						setError(null);
						onSaved?.();
					})
					.catch((caught: Error) => setError(caught.message))
					.finally(() => setBusy(false));
			}}
		>
			<div className="flex items-center gap-2">
				<Input
					type="password"
					autoComplete="off"
					aria-label={`Value of ${name}`}
					placeholder={
						saved ? "Saved. Paste again to replace it" : "Paste the value"
					}
					value={value}
					onChange={(event) => setValue(event.target.value)}
					className="font-mono"
				/>
				<Button
					type="submit"
					size="sm"
					disabled={busy || (value.trim() === "" && !saved)}
				>
					{saved && value === "" ? (
						<>
							<CheckIcon /> Saved
						</>
					) : (
						"Save"
					)}
				</Button>
			</div>
			{error !== null && (
				<p role="alert" className="text-destructive text-xs">
					{error}
				</p>
			)}
			<CredPrivacy />
		</form>
	);
}

/** A request on the Creds page: what, for whom, how to get it, the field. */
function RequestRow({
	request,
	project,
	onChanged,
}: {
	request: CredRequest;
	project: string;
	onChanged: () => void;
}): JSX.Element {
	const [error, setError] = useState<string | null>(null);
	return (
		<li
			aria-label={`requested ${request.name}`}
			className="overflow-hidden rounded-xl border bg-card shadow-xs"
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
			<Markdown
				text={request.instructions}
				className="px-4 py-3 text-sm leading-relaxed [&_p:first-child]:mt-0"
			/>
			{/* Dismiss goes under the field on a phone, leaving the field the width. */}
			<div className="flex flex-col gap-2 px-4 pb-4 sm:flex-row sm:items-start">
				<div className="min-w-0 flex-1">
					<Paste
						name={request.name}
						save={(value) => saveCred(request.name, value)}
						onSaved={onChanged}
					/>
				</div>
				<Button
					variant="ghost"
					size="sm"
					className="self-end text-muted-foreground sm:self-auto"
					onClick={() =>
						dismissCred(request.name)
							.then(onChanged)
							.catch((caught: Error) => setError(caught.message))
					}
				>
					Dismiss
				</Button>
			</div>
			{error !== null && (
				<p role="alert" className="px-4 pb-3 text-destructive text-xs">
					{error}
				</p>
			)}
		</li>
	);
}

/** A kept cred: its name and scope, with Replace and Remove. */
function KeptRow({
	name,
	scope,
	savedBy,
	project,
	onChanged,
}: {
	name: string;
	scope: Scope;
	savedBy: string | null;
	project: string;
	onChanged: () => void;
}): JSX.Element {
	const [replacing, setReplacing] = useState(false);
	const [removing, setRemoving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	return (
		<li aria-label={name} className="flex flex-col gap-2 px-4 py-2.5 text-sm">
			<div className="flex flex-wrap items-center gap-3">
				<code className="font-mono text-[13px]">{name}</code>
				<ScopeChip scope={scope} project={project} />
				{savedBy !== null && (
					<span className="text-muted-foreground text-xs">
						saved by {savedBy}
					</span>
				)}
				<span className="ml-auto flex gap-1">
					{removing ? (
						<>
							<Button
								variant="ghost"
								size="sm"
								className="text-destructive"
								onClick={() =>
									removeCred(name, scope)
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
					save={(value) => saveCred(name, value, scope)}
					onSaved={() => {
						setReplacing(false);
						onChanged();
					}}
				/>
			)}
			{error !== null && (
				<p role="alert" className="text-destructive text-xs">
					{error}
				</p>
			)}
		</li>
	);
}

/**
 * A cred the person adds of their own accord: a name, where, and the value,
 * with Remove to drop it unsaved.
 */
function AddCred({
	project,
	onAdded,
	onRemoved,
}: {
	project: string;
	onAdded: () => void;
	onRemoved: () => void;
}): JSX.Element {
	const [name, setName] = useState("");
	const [scope, setScope] = useState<Scope>("project");
	return (
		<div className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-3">
			<div className="flex flex-wrap items-center gap-2">
				<Input
					aria-label="Name"
					placeholder="NAME_OF_THE_CRED"
					value={name}
					onChange={(event) => setName(event.target.value.trim())}
					className="max-w-72 font-mono"
				/>
				<fieldset className="flex rounded-md border p-0.5">
					<legend className="sr-only">Kept for</legend>
					{(["project", "device"] as const).map((each) => (
						<button
							key={each}
							type="button"
							aria-pressed={each === scope}
							onClick={() => setScope(each)}
							className="rounded px-2 py-0.5 text-muted-foreground text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent aria-pressed:text-foreground"
						>
							{each === "project" ? project : "this device"}
						</button>
					))}
				</fieldset>
				<Button
					variant="ghost"
					size="sm"
					className="ml-auto text-muted-foreground hover:text-destructive"
					onClick={onRemoved}
				>
					Remove
				</Button>
			</div>
			{name !== "" && (
				<Paste
					key={`${name}:${scope}`}
					name={name}
					save={(value) => saveCred(name, value, scope)}
					onSaved={() => {
						setName("");
						onAdded();
					}}
				/>
			)}
		</div>
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
}: {
	requests: CredRequest[];
	project: string;
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
	const system = kept?.labels.device.replace(/ as ".*"$/, "") ?? null;

	return (
		<section aria-label="creds" className="flex min-w-0 flex-col gap-8">
			{open.length > 0 && (
				<div className="flex flex-col gap-3">
					<header className="flex items-baseline gap-2">
						<h2 className="font-medium text-sm">Requested</h2>
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
								onChanged={read}
							/>
						))}
					</ul>
				</div>
			)}
			<div className="flex flex-col gap-3">
				<header className="flex flex-wrap items-center gap-x-2 gap-y-1">
					<h2 className="font-medium text-sm">Kept</h2>
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
						<ul className="divide-y rounded-xl border bg-card">
							{kept.kept.map((each) => (
								<KeptRow
									key={`${each.scope}:${each.name}`}
									{...each}
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

/**
 * The request an agent said it made, as `## 🔑 Requested <NAME>`, in its
 * thread: how to get it and a field to paste it in while it is open, then
 * what became of it, as its record says now.
 */
function CredRequestCard({ name }: { name: string }): JSX.Element {
	const creds = useContext(CredsContext);
	const request = creds?.requests.find((each) => each.name === name);
	const project = creds?.project ?? "";
	const aside = (
		<span className="flex items-center gap-2">
			<code className="font-mono text-xs">{name}</code>
			{request !== undefined && (
				<ScopeChip scope={request.scope} project={project} />
			)}
		</span>
	);
	if (request === undefined || request.status === "dismissed") {
		return (
			<CardShell
				label={`requested ${name}`}
				Icon={CircleSlashIcon}
				title={request === undefined ? "No longer requested" : "Dismissed"}
				aside={aside}
			/>
		);
	}
	const saved = request.status === "saved";
	return (
		<CardShell
			label={`requested ${name}`}
			Icon={saved ? CheckIcon : KeyRoundIcon}
			title={saved ? "Saved" : "Requested"}
			tone={saved ? "success" : "warning"}
			aside={aside}
		>
			{!saved && (
				<Markdown
					text={request.instructions}
					className="px-4 py-3 text-sm leading-relaxed [&_p:first-child]:mt-0"
				/>
			)}
			<div className={saved ? "px-4 py-3" : "px-4 pt-1 pb-4"}>
				<Paste
					// Anew when it is filled elsewhere, so it says Saved here too.
					key={request.status}
					name={name}
					saved={saved}
					save={(value) => saveCred(name, value, request.scope)}
				/>
			</div>
		</CardShell>
	);
}

/** Renders a `data-cred` part: the request an agent said it made. */
export const CredUI = makeAssistantDataUI<{ name: string }>({
	name: "cred",
	render: ({ data }) => <CredRequestCard name={data.name} />,
});
