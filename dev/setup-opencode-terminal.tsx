import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { type JSX, useEffect, useRef, useState } from "react";

/** A native masked login/installer, disconnected and erased when leaving the step. */
export function NativeSetupTerminal({
	action,
	onExit,
}: {
	action: "install" | "login";
	onExit: (code: number) => void;
}): JSX.Element {
	const element = useRef<HTMLElement>(null);
	const exit = useRef(onExit);
	exit.current = onExit;
	const [connection, setConnection] = useState("Connecting to native setup…");
	useEffect(() => {
		if (element.current === null) {
			return;
		}
		const terminal = new Terminal({
			cursorBlink: true,
			fontSize: 13,
			scrollback: 0,
			screenReaderMode: true,
		});
		const fit = new FitAddon();
		terminal.loadAddon(fit);
		terminal.open(element.current);
		fit.fit();
		const socket = new WebSocket(
			`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/setup/opencode/native?action=${action}`,
		);
		socket.binaryType = "arraybuffer";
		let disposed = false;
		let ended = false;
		const sendSize = () => {
			if (socket.readyState === WebSocket.OPEN) {
				socket.send(
					JSON.stringify({
						type: "resize",
						cols: terminal.cols,
						rows: terminal.rows,
					}),
				);
			}
		};
		const typing = terminal.onData((data) => {
			if (socket.readyState === WebSocket.OPEN) {
				socket.send(new TextEncoder().encode(data));
			}
		});
		const resizing = terminal.onResize(sendSize);
		const observer = new ResizeObserver(() => fit.fit());
		observer.observe(element.current);
		socket.onopen = () => {
			setConnection(
				action === "login"
					? "Native login open. Enter your key only at the masked prompt."
					: "Installing OpenCode…",
			);
			sendSize();
			terminal.focus();
		};
		socket.onmessage = ({ data }: MessageEvent) => {
			if (disposed) {
				return;
			}
			if (typeof data !== "string") {
				terminal.write(new Uint8Array(data as ArrayBuffer));
				return;
			}
			const control = JSON.parse(data) as { type: string; code: number };
			if (control.type === "exit") {
				ended = true;
				exit.current(control.code);
			}
		};
		socket.onclose = () => {
			if (!disposed && !ended) {
				exit.current(1);
			}
		};
		return () => {
			disposed = true;
			if (socket.readyState === WebSocket.OPEN) {
				socket.send(JSON.stringify({ type: "close" }));
			}
			socket.close();
			observer.disconnect();
			typing.dispose();
			resizing.dispose();
			terminal.dispose();
		};
	}, [action]);
	return (
		<div className="flex flex-col gap-2">
			<p role="status" className="text-sm">
				{connection}
			</p>
			<section
				ref={element}
				aria-label="OpenCode native setup terminal"
				className="h-72 min-w-0 overflow-hidden rounded-md"
			/>
		</div>
	);
}
