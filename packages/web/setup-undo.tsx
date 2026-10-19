import { useReactive } from "@webappwiz/react";
import { type JSX, useContext, useEffect, useMemo } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#web/components/ui/dialog.tsx";
import { Field, FieldLabel } from "#web/components/ui/field.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { Markdown } from "./markdown";
import { SetupContext } from "./setup-state";
import { SetupUndoing } from "./setup-undoing";

/**
 * Undoes area `area` once the person has read what it removes: each done
 * step's things, last first, the creds it forgets and those it keeps for a
 * step still using them, and what only they can remove, which stays listed
 * once it is done. Something costly to lose needs its name typed.
 */
export function UndoDialog({
	area,
	onClose,
}: {
	/** The area to undo, or null while the dialog is shut. */
	area: string | null;
	onClose: () => void;
}): JSX.Element {
	const { settle } = useContext(SetupContext);
	const undoing = useMemo(
		() => (area === null ? null : new SetupUndoing(area)),
		[area],
	);
	useEffect(() => undoing?.events.on("settled", settle), [undoing, settle]);
	return (
		<Dialog
			open={area !== null}
			onOpenChange={(open) => {
				if (!open && undoing?.state.kind !== "working") {
					onClose();
				}
			}}
		>
			<DialogContent className="max-h-[85dvh] overflow-y-auto">
				{undoing !== null && <UndoBody undoing={undoing} onClose={onClose} />}
			</DialogContent>
		</Dialog>
	);
}

/** What the dialog asks, then what is left, as `undoing` stands. */
function UndoBody({
	undoing,
	onClose,
}: {
	undoing: SetupUndoing;
	onClose: () => void;
}): JSX.Element {
	const { plan, unread, typed, state, leaves, forgets, kept, ready } =
		useReactive(
			undoing,
			(undoing) => ({
				plan: undoing.plan,
				unread: undoing.unread,
				typed: undoing.typed,
				state: undoing.state,
				leaves: undoing.leaves,
				forgets: undoing.forgets,
				kept: undoing.kept,
				ready: undoing.ready,
			}),
			["changed"],
		);
	const done = state.kind === "done";
	const working = state.kind === "working";
	const asks = plan !== null && plan.refused === null;
	return (
		<>
			<DialogHeader>
				<DialogTitle>
					{done ? `${plan?.title} is undone` : `Undo ${plan?.title ?? ""}?`}
				</DialogTitle>
				{!done && (
					<DialogDescription>
						{plan?.refused ??
							unread ??
							(plan === null
								? "Reading what it would remove…"
								: "This removes what setting it up made, last step first.")}
					</DialogDescription>
				)}
			</DialogHeader>
			{asks && !done && (
				<section aria-label="removes" className="flex flex-col gap-3 text-sm">
					{plan.steps.map((step) =>
						step.removes.length === 0 ? null : (
							<div key={step.id}>
								<h3 className="font-medium">{step.title}</h3>
								<ul className="list-disc pl-5 text-muted-foreground">
									{step.removes.map((line) => (
										<li key={line}>
											<Markdown text={line} inline />
										</li>
									))}
								</ul>
							</div>
						),
					)}
					{forgets.length > 0 && (
						<p>
							Forgets{" "}
							{forgets.map((cred, index) => (
								<span key={cred.name}>
									{index > 0 && ", "}
									<code className="font-mono text-xs">{cred.name}</code>
								</span>
							))}{" "}
							from this device.
						</p>
					)}
					{kept.map((cred) => (
						<p key={cred.name} className="text-muted-foreground">
							Keeps <code className="font-mono text-xs">{cred.name}</code>:{" "}
							{cred.keptFor} still uses it.
						</p>
					))}
				</section>
			)}
			{asks && leaves.length > 0 && (
				<section aria-label="left for you" className="text-sm">
					<h3 className="font-medium">
						{done ? "Left for you to remove" : "Left for you afterwards"}
					</h3>
					<ul className="list-disc pl-5 text-muted-foreground">
						{leaves.map((line) => (
							<li key={line}>
								<Markdown text={line} inline />
							</li>
						))}
					</ul>
				</section>
			)}
			{asks && plan.confirm !== null && !done && (
				<Field>
					<FieldLabel htmlFor="undo-confirm">
						Type <code className="font-mono">{plan.confirm}</code> to go ahead
					</FieldLabel>
					<Input
						id="undo-confirm"
						autoComplete="off"
						value={typed}
						disabled={working}
						onChange={(event) => undoing.type(event.target.value)}
					/>
				</Field>
			)}
			{state.kind === "failed" && (
				<p role="alert" className="text-destructive text-sm">
					{state.problem}
				</p>
			)}
			<DialogFooter>
				{done ? (
					<Button onClick={onClose}>Done</Button>
				) : (
					<>
						<DialogClose
							render={<Button variant="outline" />}
							disabled={working}
						>
							Cancel
						</DialogClose>
						{asks && (
							<Button
								variant="destructive"
								disabled={!ready}
								onClick={() => void undoing.undo()}
							>
								{working
									? "Undoing…"
									: state.kind === "failed"
										? "Try again"
										: `Undo ${plan.title}`}
							</Button>
						)}
					</>
				)}
			</DialogFooter>
		</>
	);
}
