import { type JSX, useContext, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "#dev/components/ui/alert.tsx";
import { Button, buttonVariants } from "#dev/components/ui/button.tsx";
import { Field, FieldGroup, FieldLabel } from "#dev/components/ui/field.tsx";
import {
	NativeSelect,
	NativeSelectOption,
} from "#dev/components/ui/native-select.tsx";
import { Switch } from "#dev/components/ui/switch.tsx";
import type { OpenCodeModelState } from "../setup-opencode-models";
import { SetupContext } from "./setup-state";

/** Model selection continues the existing native setup; never sends a prompt. */
export function OpenCodeModelControls(): JSX.Element {
	const { refresh } = useContext(SetupContext);
	const [state, setState] = useState<OpenCodeModelState | null>(null);
	const [model, setModel] = useState("");
	const [auxiliary, setAuxiliary] = useState("");
	const [balanceOff, setBalanceOff] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		void request().then(
			(value) => {
				if (mounted.current) {
					setState(value);
				}
			},
			() => {
				if (mounted.current) {
					setError("Could not reach setup. Reconnect and retry.");
				}
			},
		);
		return () => {
			mounted.current = false;
		};
	}, []);
	const run = async (action: "refresh" | "preview" | "apply") => {
		setBusy(true);
		setError(null);
		const input =
			action === "preview"
				? { model, auxiliary }
				: action === "apply"
					? { token: state?.preview?.token, balanceOff }
					: undefined;
		setState((current) =>
			current ? { ...current, preview: null, saved: null } : current,
		);
		try {
			const value = await request(action, input);
			if (mounted.current) {
				setState(value);
				refresh();
			}
		} catch (error) {
			if (mounted.current) {
				setError(
					error instanceof Error
						? error.message
						: "Setup failed. Refresh and retry.",
				);
			}
		} finally {
			if (mounted.current) {
				setBusy(false);
			}
		}
	};
	const models = state?.catalog.models ?? [];
	const valid =
		models.includes(model) &&
		models.includes(auxiliary) &&
		!state?.catalog.problem;
	const changed = () => {
		setState((current) =>
			current ? { ...current, preview: null, saved: null } : current,
		);
		setBalanceOff(false);
	};
	return (
		<div className="flex min-w-0 flex-col gap-4">
			<p className="text-sm text-muted-foreground">
				Choose from OpenCode's current Go catalog. Listing models does not test
				subscription access, quota or inference. Go uses your subscription;
				optional Use balance overflow can add pay-as-you-go charges.
			</p>
			<div className="flex flex-wrap gap-2">
				<Button disabled={busy} onClick={() => void run("refresh")}>
					Refresh Go models
				</Button>
				{busy && (
					<Button
						variant="outline"
						onClick={() => {
							void fetch("/api/setup/opencode/cancel", {
								method: "POST",
							}).catch(() =>
								setError("Could not cancel. Reconnect and retry."),
							);
						}}
					>
						Cancel
					</Button>
				)}
			</div>
			<p
				role="status"
				aria-live="polite"
				className="text-sm text-muted-foreground"
			>
				{busy
					? "Checking model configuration…"
					: state?.saved
						? "Experiment configuration saved. Final conversation readiness and inference are separate checks."
						: state?.catalog.checkedAt
							? `Catalog checked ${state.catalog.checkedAt}`
							: "Check installation and connect Go first, then refresh models."}
			</p>
			{(error || state?.catalog.problem) && (
				<Alert variant="destructive">
					<AlertDescription>{error || state?.catalog.problem}</AlertDescription>
				</Alert>
			)}
			<FieldGroup>
				<Field
					data-disabled={busy}
					data-invalid={!!model && !models.includes(model)}
				>
					<FieldLabel htmlFor="opencode-main-model">Main model</FieldLabel>
					<NativeSelect
						id="opencode-main-model"
						value={model}
						disabled={busy}
						aria-invalid={!!model && !models.includes(model)}
						onChange={(event) => {
							setModel(event.target.value);
							changed();
						}}
					>
						<NativeSelectOption value="">Choose a Go model</NativeSelectOption>
						{model && !models.includes(model) && (
							<NativeSelectOption value={model} disabled>
								{model} : unavailable; choose again
							</NativeSelectOption>
						)}
						{models.map((id) => (
							<NativeSelectOption key={id} value={id}>
								{id}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</Field>
				<Field
					data-disabled={busy}
					data-invalid={!!auxiliary && !models.includes(auxiliary)}
				>
					<FieldLabel htmlFor="opencode-auxiliary-model">
						Auxiliary model
					</FieldLabel>
					<NativeSelect
						id="opencode-auxiliary-model"
						value={auxiliary}
						disabled={busy}
						aria-invalid={!!auxiliary && !models.includes(auxiliary)}
						onChange={(event) => {
							setAuxiliary(event.target.value);
							changed();
						}}
					>
						<NativeSelectOption value="">Choose a Go model</NativeSelectOption>
						{auxiliary && !models.includes(auxiliary) && (
							<NativeSelectOption value={auxiliary} disabled>
								{auxiliary} : unavailable; choose again
							</NativeSelectOption>
						)}
						{models.map((id) => (
							<NativeSelectOption key={id} value={id}>
								{id}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</Field>
			</FieldGroup>
			<Button
				variant="outline"
				disabled={busy || !valid}
				onClick={() => void run("preview")}
			>
				Review changes
			</Button>
			{state?.preview && (
				<>
					<p className="text-sm">
						Apply adds or updates only the OpenCode entry in{" "}
						<code className="break-all">{state.preview.path}</code>. Its launch
						command carries the Go-only policy and model choices in the same
						atomic save. Existing agents, models and defaults are preserved.
					</p>
					<p className="text-sm">
						For this experiment, project OpenCode configuration is disabled.
						Build and Plan use the main model; title, other auxiliary agents and
						observed custom agents use the auxiliary model. Global files remain
						unchanged. Conflicting managed/provider settings stop setup.
					</p>
					<p className="text-sm break-words">
						Observed agents: {state.preview.agents.join(", ")}
					</p>
					<details>
						<summary className="cursor-pointer text-sm">
							Exact experiment configuration
						</summary>
						<pre className="overflow-x-auto text-xs">
							{JSON.stringify(state.preview.config, null, 2)}
						</pre>
					</details>
					<a
						href="https://opencode.ai/auth"
						target="_blank"
						rel="noreferrer"
						className={buttonVariants({ variant: "outline" })}
					>
						Open OpenCode Console
					</a>
					<p className="text-sm text-muted-foreground">
						In your existing Go/Go Plus account, turn Use balance off, then
						return and confirm below. Arbor cannot inspect this billing setting
						through ACP.
					</p>
					<Field orientation="horizontal">
						<Switch
							id="opencode-balance-off"
							aria-label="I confirmed Use balance is off in Console"
							checked={balanceOff}
							disabled={busy}
							onCheckedChange={setBalanceOff}
						/>
						<FieldLabel htmlFor="opencode-balance-off">
							I confirmed Use balance is off in Console
						</FieldLabel>
					</Field>
					<Button
						disabled={busy || !balanceOff}
						onClick={() => void run("apply")}
					>
						Apply OpenCode experiment
					</Button>
					<Button variant="ghost" disabled={busy} onClick={changed}>
						Discard preview
					</Button>
				</>
			)}
		</div>
	);
}

async function request(
	action?: string,
	body?: object,
): Promise<OpenCodeModelState> {
	const response = await fetch(
		`/api/setup/opencode/models${action ? `/${action}` : ""}`,
		{
			method: action ? "POST" : "GET",
			...(body
				? {
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body),
					}
				: {}),
		},
	);
	if (!response.ok) {
		const result = (await response.json().catch(() => null)) as {
			message?: string;
		} | null;
		throw new Error(
			result?.message ?? "Could not reach setup. Refresh and retry.",
		);
	}
	return response.json() as Promise<OpenCodeModelState>;
}
