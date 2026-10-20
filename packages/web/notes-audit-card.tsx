import type { Hook, Trigger } from "@stringsync/splates-server/hooks";
import { AUDIT_TRIGGER } from "@stringsync/splates-server/hooks/browser";
import type { AgentPick } from "@stringsync/splates-server/models";
import { type FormEvent, type JSX, useState } from "react";
import { Badge } from "#web/components/ui/badge.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { cn } from "#web/lib/utils.ts";
import { AutomationMark } from "./automation-face";
import type { AuditSchedule } from "./automation-list";
import { AssigneeMenu } from "./dispatching";
import { PHONE_HEADING } from "./phone-rows";
import { Refusal, useRefusal } from "./refusal";

/** Sets the agent the notes audit runs as and when, turning it on when it is off; says whether it took. */
export type Audit = (
	pick: AgentPick,
	schedule: AuditSchedule,
) => Promise<boolean>;

/** The agent `hook` audits the notes as, or null for one that audits nothing. */
export function auditPick(hook: Hook): AgentPick | null {
	if (hook.kind !== "audit") {
		return null;
	}
	const { kind: _, ...pick } = hook;
	return pick;
}

/** `trigger` as the form's one schedule field: `7d`, or a cron line. */
function scheduleText(trigger: Trigger): string {
	return "every" in trigger
		? trigger.every
		: "cron" in trigger
			? trigger.cron
			: "";
}

/** The schedule field read back: a cron line has fields apart, an interval none. */
function scheduleOf(text: string): AuditSchedule {
	const trimmed = text.trim();
	return /\s/.test(trimmed) ? { cron: trimmed } : { every: trimmed };
}

/** The notes audit while it is off, with the button that turns it on. */
export function AuditOff({ onAudit }: { onAudit: Audit }): JSX.Element {
	const [picking, setPicking] = useState(false);
	if (picking) {
		return (
			<li aria-label="notes audit">
				<AuditForm
					pick={null}
					trigger={AUDIT_TRIGGER}
					title="Turn on the notes audit"
					submit="Turn on"
					onSubmit={(pick, schedule) => {
						// Shown on at once; a refusal is said above the list.
						setPicking(false);
						void onAudit(pick, schedule);
					}}
					onCancel={() => setPicking(false)}
				/>
			</li>
		);
	}
	return (
		<li
			aria-label="notes audit"
			className="flex items-start gap-3 rounded-xl border border-dashed p-3"
		>
			<AutomationMark trigger={AUDIT_TRIGGER} />
			<div className="flex min-w-0 flex-1 flex-col gap-1">
				<div className="flex flex-wrap items-center gap-2 text-sm">
					<span className="font-medium">Notes audit</span>
					<Badge variant="secondary">Off</Badge>
				</div>
				<p className="text-muted-foreground text-sm">
					On, it checks each project note against the code and the other notes,
					on a schedule, and defers a task for each one gone stale or
					contradicting another, never fixing it. Each run reads code for every
					note, on your tokens.
				</p>
			</div>
			<Button size="sm" variant="outline" onClick={() => setPicking(true)}>
				Turn on
			</Button>
		</li>
	);
}

/** The form that picks the agent the notes audit runs as, and when. */
export function AuditForm({
	pick,
	trigger,
	title,
	submit,
	onSubmit,
	onCancel,
}: {
	pick: AgentPick | null;
	trigger: Trigger;
	title: string;
	submit: string;
	onSubmit: (pick: AgentPick, schedule: AuditSchedule) => void;
	onCancel: () => void;
}): JSX.Element {
	const [picked, setPicked] = useState(pick);
	const [schedule, setSchedule] = useState(() => scheduleText(trigger));
	const { refusal, refuse } = useRefusal();
	const submitted = (form: FormEvent) => {
		form.preventDefault();
		if (picked === null) {
			refuse("Not saved", new Error("pick the agent the notes audit runs as"));
			return;
		}
		onSubmit(picked, scheduleOf(schedule));
	};
	return (
		<form
			aria-label={title.toLowerCase()}
			onSubmit={submitted}
			className="flex flex-col gap-3 rounded-xl border p-3"
		>
			<div className="flex items-center gap-3">
				<AutomationMark trigger={trigger} />
				<h2 className={cn("font-medium text-sm", PHONE_HEADING)}>{title}</h2>
			</div>
			<p className="text-muted-foreground text-sm">
				It reads each note no open task names yet, in a conversation of its own,
				as the agent picked here, every so often (7d) or on a cron line (0 9 * *
				1).
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<AssigneeMenu assignee={picked} onPick={setPicked} />
				<Input
					aria-label="Schedule"
					required
					className="w-48"
					placeholder="7d or 0 9 * * 1"
					value={schedule}
					onChange={(change) => setSchedule(change.target.value)}
				/>
			</div>
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
