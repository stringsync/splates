import type {
	BillingView,
	PlanProvider,
	PlanView,
} from "@splates/server/spend";
import { type FormEvent, type JSX, useState } from "react";
import { Button, buttonVariants } from "#web/components/ui/button.tsx";
import { cn } from "#web/lib/utils.ts";
import { formatMoney, nameOf } from "./billing-sums";
import { credAddress } from "./page-address";

/** Lists agent plan subscriptions and billed providers, with controls to set plans or retry failed pulls. */
export function Sources({
	sources,
	pulling,
	savingPlan = null,
	error,
	onPull,
	onSavePlan,
	onClearPlan,
}: {
	sources: BillingView | null;
	pulling: boolean;
	savingPlan?: PlanProvider | null;
	error: string | null;
	onPull(): void;
	onSavePlan?(
		provider: PlanProvider,
		amount: number,
		renewalDay: number,
	): Promise<void>;
	onClearPlan?(provider: PlanProvider): Promise<void>;
}): JSX.Element {
	const plans = sources?.plans ?? [];
	const providers = (sources?.providers ?? []).filter(
		(each) => each.provider !== "fly",
	);
	const currency = sources?.currency ?? "USD";
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
			{(plans.length > 0 || providers.length > 0) && (
				<ul className="divide-y rounded-lg border bg-card">
					{plans.map((plan) => (
						<PlanRow
							key={`plan:${plan.provider}`}
							plan={plan}
							currency={currency}
							saving={savingPlan === plan.provider}
							onSave={onSavePlan}
							onClear={onClearPlan}
						/>
					))}
					{providers.map((each) => (
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

const PLAN_STATES: Record<
	PlanView["source"],
	{ label: string; dot: string; text: string }
> = {
	detected: {
		label: "Plan detected",
		dot: "bg-success",
		text: "text-success",
	},
	manual: {
		label: "Plan set",
		dot: "bg-success",
		text: "text-success",
	},
	none: {
		label: "Plan not detected",
		dot: "bg-muted-foreground",
		text: "text-muted-foreground",
	},
};

function PlanRow({
	plan,
	currency,
	saving,
	onSave,
	onClear,
}: {
	plan: PlanView;
	currency: string;
	saving: boolean;
	onSave?: (
		provider: PlanProvider,
		amount: number,
		renewalDay: number,
	) => Promise<void>;
	onClear?: (provider: PlanProvider) => Promise<void>;
}): JSX.Element {
	const [editing, setEditing] = useState(false);
	const [amount, setAmount] = useState("");
	const [renewalDay, setRenewalDay] = useState("");
	const [formError, setFormError] = useState<string | null>(null);
	const name = nameOf(plan.provider);
	const state = PLAN_STATES[plan.source];

	const openEditor = () => {
		setAmount(plan.amount === null ? "" : String(plan.amount));
		setRenewalDay(plan.renewalDay === null ? "1" : String(plan.renewalDay));
		setFormError(null);
		setEditing(true);
	};

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		const parsedAmount = Number(amount);
		const parsedDay = Number(renewalDay);
		if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
			setFormError("Enter a monthly price greater than 0.");
			return;
		}
		if (!Number.isInteger(parsedDay) || parsedDay < 1 || parsedDay > 31) {
			setFormError("Enter a renewal day from 1 to 31.");
			return;
		}
		setFormError(null);
		try {
			await onSave?.(plan.provider, parsedAmount, parsedDay);
			setEditing(false);
		} catch (caught) {
			setFormError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const clear = async () => {
		setFormError(null);
		try {
			await onClear?.(plan.provider);
			setEditing(false);
		} catch (caught) {
			setFormError(caught instanceof Error ? caught.message : String(caught));
		}
	};

	const detail =
		plan.source === "none" || plan.amount === null || plan.currency === null
			? `Set a monthly fee to include ${name} in the total`
			: [
					plan.source === "detected" ? plan.service : null,
					`${formatMoney(plan.amount, plan.currency)}/mo`,
					plan.renewalDay === null ? null : `renews on day ${plan.renewalDay}`,
				]
					.filter((part) => part !== null)
					.join(" · ");

	return (
		<li aria-label={`${name} subscription`} className="flex flex-col">
			<div className="flex items-center gap-3 px-3 py-2.5">
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
						<span className="font-medium text-sm">{name}</span>
						<span
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
				{onSave !== undefined && (
					<div className="flex shrink-0 flex-wrap justify-end gap-1.5">
						{editing ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={saving}
								onClick={() => setEditing(false)}
							>
								Cancel
							</Button>
						) : (
							<Button
								type="button"
								variant="outline"
								size="sm"
								aria-label={
									plan.source === "none"
										? `Set ${name} plan`
										: `Edit ${name} plan`
								}
								onClick={openEditor}
							>
								{plan.source === "none" ? "Set plan" : "Edit plan"}
							</Button>
						)}
					</div>
				)}
			</div>
			{editing && (
				<form
					aria-label={`${name} plan form`}
					onSubmit={(event) => void submit(event)}
					className="flex flex-col gap-2 border-t bg-muted/40 px-3 py-2.5 text-xs"
				>
					<div className="flex flex-wrap items-center gap-3">
						<label className="flex items-center gap-1.5 text-muted-foreground">
							<span>Monthly ({currency})</span>
							<input
								type="number"
								inputMode="decimal"
								step="any"
								min="0"
								required
								aria-label={`${name} monthly price`}
								value={amount}
								onChange={(event) => setAmount(event.target.value)}
								className="w-20 rounded-md border bg-card px-2 py-1 text-foreground tabular-nums"
							/>
						</label>
						<label className="flex items-center gap-1.5 text-muted-foreground">
							<span>Renewal day</span>
							<input
								type="number"
								inputMode="numeric"
								step="1"
								min="1"
								max="31"
								required
								aria-label={`${name} renewal day`}
								value={renewalDay}
								onChange={(event) => setRenewalDay(event.target.value)}
								className="w-16 rounded-md border bg-card px-2 py-1 text-foreground tabular-nums"
							/>
						</label>
						<div className="ml-auto flex items-center gap-1.5">
							<Button type="submit" size="sm" disabled={saving}>
								{saving ? "Saving…" : "Save"}
							</Button>
							{plan.source === "manual" && onClear !== undefined && (
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={saving}
									onClick={() => void clear()}
								>
									{plan.hasDetected ? "Reset" : "Clear"}
								</Button>
							)}
						</div>
					</div>
					{formError !== null && (
						<p role="alert" className="text-destructive text-xs">
							{formError}
						</p>
					)}
				</form>
			)}
		</li>
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
	estimated: {
		label: "Estimated",
		dot: "bg-warning",
		text: "text-warning",
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
			? [
					source.added > 0
						? `${source.added} new ${source.added === 1 ? "charge" : "charges"}`
						: "Up to date",
					source.message,
				]
					.filter((part) => part !== "")
					.join(". ")
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
				{source.dashboard !== null && (
					<a
						href={source.dashboard}
						target="_blank"
						rel="noreferrer"
						aria-label={`Open ${nameOf(source.provider)}'s billing`}
						className={buttonVariants({ variant: "outline", size: "sm" })}
					>
						Open bill
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
