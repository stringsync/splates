import type { Hook } from "@stringsync/splates-server/hooks";
import type { AgentPick } from "@stringsync/splates-server/models";
import { type FormEvent, type JSX, useState } from "react";
import { Badge } from "#web/components/ui/badge.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { AssigneeMenu } from "./dispatching";
import { PHONE_HEADING } from "./phone-rows";
import { Refusal, useRefusal } from "./refusal";

/** Sets the agent the groomer runs as, turning it on when it is off; says whether it took. */
export type Groom = (pick: AgentPick) => Promise<boolean>;

/** The agent `hook` grooms as, or null for one that grooms nothing. */
export function groomerPick(hook: Hook): AgentPick | null {
	if (hook.kind !== "groom") {
		return null;
	}
	const { kind: _, ...pick } = hook;
	return pick;
}

/** The groomer while it is off, with the button that turns it on. */
export function GroomerOff({ onGroom }: { onGroom: Groom }): JSX.Element {
	const [picking, setPicking] = useState(false);
	if (picking) {
		return (
			<li aria-label="groomer">
				<GroomerForm
					pick={null}
					title="Turn on the groomer"
					submit="Turn on"
					onSubmit={(pick) => {
						// Shown on at once; a refusal is said above the list.
						setPicking(false);
						void onGroom(pick);
					}}
					onCancel={() => setPicking(false)}
				/>
			</li>
		);
	}
	return (
		<li
			aria-label="groomer"
			className="flex items-start gap-2 rounded-xl border border-dashed p-3"
		>
			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				<div className="flex flex-wrap items-center gap-2 text-sm">
					<span className="font-medium">Groomer</span>
					<Badge variant="secondary">Off</Badge>
				</div>
				<p className="text-muted-foreground text-sm">
					On, it takes each task deferred rough to the backlog: checks no other
					task asks it, splits one too big, links what blocks it and picks its
					lane, then marks it ready, never doing it.
				</p>
			</div>
			<Button size="sm" variant="outline" onClick={() => setPicking(true)}>
				Turn on
			</Button>
		</li>
	);
}

/** The form that picks the agent, model and thinking level the groomer runs as. */
export function GroomerForm({
	pick,
	title,
	submit,
	onSubmit,
	onCancel,
}: {
	pick: AgentPick | null;
	title: string;
	submit: string;
	onSubmit: (pick: AgentPick) => void;
	onCancel: () => void;
}): JSX.Element {
	const [picked, setPicked] = useState(pick);
	const { refusal, refuse } = useRefusal();
	const submitted = (form: FormEvent) => {
		form.preventDefault();
		if (picked === null) {
			refuse("Not saved", new Error("pick the agent the groomer runs as"));
			return;
		}
		onSubmit(picked);
	};
	return (
		<form
			aria-label={title.toLowerCase()}
			onSubmit={submitted}
			className="flex flex-col gap-3 rounded-xl border p-3"
		>
			<h2 className={cn("font-medium text-sm", PHONE_HEADING)}>{title}</h2>
			<p className="text-muted-foreground text-sm">
				It grooms each task deferred rough to the backlog, one at a time, in a
				conversation of its own, as the agent picked here.
			</p>
			<AssigneeMenu assignee={picked} onPick={setPicked} />
			<Refusal refusal={refusal} />
			<div className="flex gap-2">
				<Button type="submit" size="sm">
					{submit}
				</Button>
				<Button type="button" size="sm" variant="ghost" onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</form>
	);
}
