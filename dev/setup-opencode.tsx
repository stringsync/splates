import { type JSX, useContext, useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "#dev/components/ui/button.tsx";
import type { OpenCodeStatus } from "../setup-opencode";
import { NativeSetupTerminal } from "./setup-opencode-terminal";
import { SetupContext } from "./setup-state";

/** Native controls within the shared Setup wizard; never starts an agent conversation. */
export function OpenCodeControls({ step }: { step: string }): JSX.Element {
	const { refresh } = useContext(SetupContext);
	const [status, setStatus] = useState<OpenCodeStatus | null>(null);
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState<string | null>(null);
	const [action, setAction] = useState<"install" | "login" | null>(null);
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		void readStatus().then(
			(value) => {
				if (mounted.current) {
					setStatus(value);
				}
			},
			() => {
				if (mounted.current) {
					setMessage("Could not reach setup. Retry when connected.");
				}
			},
		);
		return () => {
			mounted.current = false;
		};
	}, []);
	const check = async () => {
		setBusy(true);
		setMessage(null);
		try {
			const value = await readStatus("check");
			if (mounted.current) {
				setStatus(value);
				refresh();
			}
		} catch {
			if (mounted.current) {
				setMessage(
					"Could not check OpenCode. Finish any native setup action, then retry.",
				);
			}
		} finally {
			if (mounted.current) {
				setBusy(false);
			}
		}
	};
	const cancel = async () => {
		try {
			await readStatus("cancel");
		} catch {
			setMessage("Could not cancel the check. Reconnect and retry.");
		}
	};
	const install = step === "opencode-install";
	return (
		<div className="flex flex-col gap-4">
			<p
				role="status"
				aria-live="polite"
				className="text-sm text-muted-foreground"
			>
				{busy
					? "Checking installation, native authentication and ACP…"
					: status?.version
						? `OpenCode ${status.version}. ${status.protocol === "compatible" ? "ACP handshake passed; no inference tested." : "ACP compatibility has not passed."}`
						: "OpenCode has not been detected on this machine."}
			</p>
			{!install && (
				<>
					<p className="text-sm text-muted-foreground">
						{status?.auth === "stored"
							? "OpenCode lists a stored Go credential. Subscription access and billing are not verified."
							: "No supported Go connection has been confirmed yet."}
					</p>
					<a
						href="https://opencode.ai/auth"
						target="_blank"
						rel="noreferrer"
						className={buttonVariants({ variant: "outline" })}
					>
						Open OpenCode Console
					</a>
					<p className="text-sm text-muted-foreground">
						Use your existing account. Keep Use balance overflow off in Console.
						Paste the key only at OpenCode's masked API key prompt, never in a
						conversation. OpenCode keeps the credential in its own native store.
					</p>
				</>
			)}
			{status?.problem && (
				<p role="alert" className="text-sm text-destructive">
					{status.problem}
				</p>
			)}
			{message && (
				<p role="status" className="text-sm">
					{message}
				</p>
			)}
			{action === null ? (
				<div className="flex flex-wrap gap-2">
					<Button disabled={busy} onClick={() => void check()}>
						Check again
					</Button>
					{busy && (
						<Button variant="outline" onClick={() => void cancel()}>
							Cancel check
						</Button>
					)}
					{install && (
						<Button
							variant="outline"
							disabled={busy || status?.version != null || !status?.checkedAt}
							onClick={() => {
								setMessage(null);
								setAction("install");
							}}
						>
							Install OpenCode with npm
						</Button>
					)}
					{!install && (
						<Button
							variant="outline"
							disabled={
								busy ||
								!status?.version ||
								!["missing", "stored"].includes(status.auth)
							}
							onClick={() => {
								setMessage(null);
								setAction("login");
							}}
						>
							Connect existing Go account
						</Button>
					)}
				</div>
			) : (
				<>
					<NativeSetupTerminal
						action={action}
						onExit={(code) => {
							setAction(null);
							setStatus(null);
							setMessage(
								code === 0
									? "Native setup finished. Check again to verify."
									: code === 124
										? "Native setup timed out. Retry when ready."
										: "Native setup did not finish. It may have been canceled, or installation/login failed. Check again or use the official recovery instructions.",
							);
						}}
					/>
					<Button
						variant="outline"
						onClick={() => {
							setAction(null);
							setStatus(null);
							setMessage(
								"Native setup canceled. Any completed installation or saved credential remains; check again before retrying.",
							);
						}}
					>
						Cancel native setup
					</Button>
				</>
			)}
			{install && (
				<p className="text-sm text-muted-foreground">
					Install downloads the official @opencode/cli package into this
					machine's npm global location. It requires npm and write access; it
					never uses sudo. If OpenCode is already installed but missing from
					PATH, restart arbor before retrying.
				</p>
			)}
			<a
				className="text-sm underline"
				href="https://opencode.ai/docs/"
				target="_blank"
				rel="noreferrer"
			>
				Official installation and recovery instructions
			</a>
			<p className="text-sm text-muted-foreground">
				You can skip this optional step and return later. Model selection and
				conversation readiness are separate checks.
			</p>
		</div>
	);
}

async function readStatus(
	action?: "check" | "cancel",
): Promise<OpenCodeStatus> {
	const response = await fetch(
		`/api/setup/opencode${action ? `/${action}` : ""}`,
		{ method: action ? "POST" : "GET" },
	);
	if (!response.ok) {
		throw new Error("setup unavailable");
	}
	return response.json() as Promise<OpenCodeStatus>;
}
