import { EllipsisIcon, KeyRoundIcon } from "lucide-react";
import { type JSX, useState } from "react";
import { Button } from "#dev/components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "#dev/components/ui/dropdown-menu.tsx";
import { Input } from "#dev/components/ui/input.tsx";
import { cn } from "#dev/lib/utils.ts";
import type { Scope } from "../creds";
import { removeCred, saveCred } from "./api";
import { useWide } from "./app-nav";
import { touchItems } from "./board";
import { Paste } from "./cred-paste";
import { ScopeChip, scopeLabel } from "./cred-scope";
import { PHONE_TILE } from "./phone-rows";

/**
 * A kept cred: its name and scope, with Replace and Remove. On a phone it is
 * one of the inbox's rows, led by a key, its scope under its name and its
 * actions in a menu.
 */
export function KeptRow({
	name,
	scope,
	savedBy,
	project,
	picked = false,
	onChanged,
}: {
	name: string;
	scope: Scope;
	savedBy: string | null;
	project: string;
	/** Whether the address set the page on it. */
	picked?: boolean;
	onChanged: () => void;
}): JSX.Element {
	const wide = useWide();
	const [replacing, setReplacing] = useState(false);
	const [removing, setRemoving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const remove = () =>
		removeCred(name, scope)
			.then(onChanged)
			.catch((caught: Error) => setError(caught.message));
	const keep = (
		<Button variant="ghost" size="sm" onClick={() => setRemoving(false)}>
			Keep
		</Button>
	);
	const saved = savedBy !== null && (
		<span className="text-muted-foreground text-xs">saved by {savedBy}</span>
	);
	return (
		<li
			aria-label={name}
			data-cred={name}
			className={cn(
				"flex flex-col gap-2 px-4 py-2.5 text-sm",
				picked && "bg-muted ring-2 ring-ring ring-inset",
				"max-md:min-h-16 max-md:justify-center max-md:active:bg-muted",
			)}
		>
			{wide ? (
				<div className="flex flex-wrap items-center gap-3">
					<code className="font-mono text-[13px]">{name}</code>
					<ScopeChip scope={scope} project={project} />
					{saved}
					<span className="ml-auto flex gap-1">
						{removing ? (
							<>
								<Button
									variant="ghost"
									size="sm"
									className="text-destructive"
									onClick={remove}
								>
									Remove {name}
								</Button>
								{keep}
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
			) : (
				<div className="flex items-center gap-3">
					<span aria-hidden className={PHONE_TILE}>
						<KeyRoundIcon />
					</span>
					<span className="flex min-w-0 flex-1 flex-col gap-0.5">
						<code className="truncate font-mono text-[13px]">{name}</code>
						<span className="flex min-w-0 items-center gap-2">
							<ScopeChip scope={scope} project={project} />
							{saved}
						</span>
					</span>
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									variant="ghost"
									size="icon"
									aria-label={`Actions on ${name}`}
									className="size-10 shrink-0 text-muted-foreground"
								/>
							}
						>
							<EllipsisIcon />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className={`w-44 ${touchItems}`}>
							<DropdownMenuItem
								onClick={() => {
									setRemoving(false);
									setReplacing(true);
								}}
							>
								Replace
							</DropdownMenuItem>
							<DropdownMenuItem
								variant="destructive"
								onClick={() => {
									setReplacing(false);
									setRemoving(true);
								}}
							>
								Remove
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			)}
			{!wide && removing && (
				// As a request's footer: the way out, then the red one last.
				<div className="flex justify-end gap-2 [&>button]:h-10 [&>button]:px-4">
					{keep}
					<Button
						variant="destructive"
						size="sm"
						aria-label={`Remove ${name}`}
						onClick={remove}
					>
						Remove
					</Button>
				</div>
			)}
			{replacing && (
				<Paste
					name={name}
					save={(value) => saveCred(name, value, scope)}
					onSaved={() => {
						setReplacing(false);
						onChanged();
					}}
					besides={
						!wide && (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="text-muted-foreground"
								onClick={() => setReplacing(false)}
							>
								Cancel
							</Button>
						)
					}
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
export function AddCred({
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
					className="max-w-72 font-mono max-md:placeholder:font-sans max-md:h-10 max-md:max-w-none max-md:basis-full"
				/>
				<fieldset className="flex rounded-md border p-0.5">
					<legend className="sr-only">Kept for</legend>
					{(["project", "device"] as const).map((each) => (
						<button
							key={each}
							type="button"
							aria-pressed={each === scope}
							onClick={() => setScope(each)}
							className="rounded px-2 py-0.5 text-muted-foreground text-xs outline-none max-md:px-3 max-md:py-1.5 max-md:text-sm hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent aria-pressed:text-foreground"
						>
							{scopeLabel(each, project)}
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
