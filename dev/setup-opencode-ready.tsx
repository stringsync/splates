import { type JSX, useContext, useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "#dev/components/ui/alert.tsx";
import { Button, buttonVariants } from "#dev/components/ui/button.tsx";
import { Field, FieldLabel } from "#dev/components/ui/field.tsx";
import { Switch } from "#dev/components/ui/switch.tsx";
import type { ConversationState } from "../conversations";
import type { OpenCodeReadiness } from "../setup-opencode";
import { scoped } from "./api";
import type { ConversationFeed } from "./conversation-feed";
import { SetupContext } from "./setup-state";

export function OpenCodeReadyControls({
	feed,
	onOpen,
	onRepair,
}: {
	feed: ConversationFeed | null;
	onOpen: (id: string) => void;
	onRepair: () => void;
}): JSX.Element {
	const { refresh } = useContext(SetupContext);
	const [state, setState] = useState<OpenCodeReadiness | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [balanceOff, setBalanceOff] = useState(false);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		void request("readiness").then(
			(value) => {
				if (mounted.current) {
					setState(value as OpenCodeReadiness);
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
			void request("cancel", true).catch(() => {});
		};
	}, []);
	const run = async (action: "readiness" | "disable" | "conversation") => {
		setBusy(true);
		setError(null);
		setState((current) =>
			current ? { ...current, ready: false, problem: null } : null,
		);
		try {
			const value = await request(
				action,
				true,
				action === "conversation" ? { balanceOff } : undefined,
			);
			if (!mounted.current) {
				return;
			}
			if (action === "conversation") {
				const conversation = value as ConversationState;
				feed?.put(conversation);
				onOpen(conversation.id);
			} else if (action === "disable") {
				setState((await request("readiness")) as OpenCodeReadiness);
				setBalanceOff(false);
			} else {
				setState(value as OpenCodeReadiness);
			}
			refresh();
		} catch (error) {
			if (mounted.current) {
				setError(
					error instanceof Error ? error.message : "Reconnect and retry.",
				);
			}
		} finally {
			if (mounted.current) {
				setBusy(false);
			}
		}
	};
	return (
		<div className="flex min-w-0 flex-col gap-4">
			<p role="status" aria-live="polite" className="text-sm">
				{busy
					? "Checking saved configuration…"
					: state?.ready
						? "Configuration ready for this directory."
						: state?.selection
							? "Saved recipe found. Check it again before starting."
							: "No verified setup recipe yet. Revisit model selection to configure or repair it."}
			</p>
			{state && (
				<p className="text-sm break-all">
					Conversation directory: <code>{state.cwd}</code>
				</p>
			)}
			{state?.selection && (
				<dl className="text-sm break-all">
					<dt>Main model</dt>
					<dd>{state.selection.model}</dd>
					<dt>Auxiliary model</dt>
					<dd>{state.selection.auxiliary}</dd>
				</dl>
			)}
			<p className="text-sm text-muted-foreground">
				This checks the executable, stored native authentication, ACP handshake,
				model catalog and effective configuration. Project OpenCode
				configuration is disabled for this recipe. Global files remain
				unchanged.
			</p>
			<p className="text-sm text-muted-foreground">
				Live inference: not tested. Access, quota and billing: not verified. No
				prompt is sent by this check.
			</p>
			{(error || state?.problem) && (
				<Alert variant="destructive">
					<AlertDescription>{error || state?.problem}</AlertDescription>
				</Alert>
			)}
			<div className="flex flex-wrap gap-2">
				<Button disabled={busy} onClick={() => void run("readiness")}>
					Check configuration
				</Button>
				<Button variant="outline" disabled={busy} onClick={onRepair}>
					Revisit / repair setup
				</Button>
				{busy && (
					<Button
						variant="outline"
						onClick={() =>
							void request("cancel", true).catch(() =>
								setError("Could not cancel. Reconnect and retry."),
							)
						}
					>
						Cancel check
					</Button>
				)}
			</div>
			{state?.ready && (
				<>
					<a
						className={buttonVariants({ variant: "outline" })}
						href="https://opencode.ai/auth"
						target="_blank"
						rel="noreferrer"
					>
						Open OpenCode Console
					</a>
					<Field orientation="horizontal">
						<Switch
							id="opencode-ready-balance"
							checked={balanceOff}
							onCheckedChange={setBalanceOff}
							aria-label="I confirmed Use balance is off in Console"
						/>
						<FieldLabel htmlFor="opencode-ready-balance">
							I confirmed Use balance is off in Console
						</FieldLabel>
					</Field>
					<p className="text-sm text-muted-foreground">
						This is your confirmation, not an automatic billing check. Opening
						creates an empty conversation on the main model; sending your first
						message uses your account.
					</p>
					<Button
						disabled={busy || !balanceOff || feed === null}
						onClick={() => void run("conversation")}
					>
						New OpenCode conversation
					</Button>
					{feed === null && (
						<p className="text-sm">
							Open a project with conversations enabled to continue.
						</p>
					)}
				</>
			)}
			{state?.selection && (
				<>
					<p className="text-sm text-muted-foreground">
						Disable removes this setup recipe from the roster for new
						conversations. Existing conversations and native login remain.
					</p>
					<Button
						variant="outline"
						disabled={busy}
						onClick={() => void run("disable")}
					>
						Disable OpenCode experiment
					</Button>
				</>
			)}
		</div>
	);
}

async function request(
	action: string,
	post = false,
	body?: object,
): Promise<unknown> {
	const response = await fetch(scoped(`/api/setup/opencode/${action}`), {
		method: post ? "POST" : "GET",
		...(body
			? {
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				}
			: {}),
	});
	const value = await response.json();
	if (!response.ok) {
		throw new Error(
			value?.message ?? "Could not reach setup. Reconnect and retry.",
		);
	}
	return value;
}
