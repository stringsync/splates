/**
 * The server end of a terminal's WebSocket, standing in for `WebSocket` on the
 * page: what the page sent, and the shell's side for a test to play.
 */
export class FakeShell {
	static readonly CONNECTING = 0;
	static readonly OPEN = 1;
	static readonly CLOSED = 3;

	readyState = FakeShell.CONNECTING;
	binaryType = "blob";
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: (() => void) | null = null;
	/** Typing as text, and every control message the page sent, in order. */
	readonly sent: unknown[] = [];

	constructor(readonly url: string) {}

	/** The task the page asked for a shell in, or null for the main tree. */
	get task(): string | null {
		return new URL(this.url).searchParams.get("task");
	}

	/** Lets the page in, as the server does once the shell is up. */
	accept(): void {
		this.readyState = FakeShell.OPEN;
		this.onopen?.();
	}

	/** The shell writes `text` to the screen. */
	print(text: string): void {
		this.onmessage?.({ data: new TextEncoder().encode(text).buffer });
	}

	/** The shell exits with `code`, and the server hangs up. */
	exit(code: number): void {
		this.onmessage?.({ data: JSON.stringify({ type: "exit", code }) });
		this.close();
	}

	// The page's own calls, as on a `WebSocket`.

	send(data: string | Uint8Array): void {
		this.sent.push(
			typeof data === "string"
				? JSON.parse(data)
				: new TextDecoder().decode(data),
		);
	}

	close(): void {
		if (this.readyState === FakeShell.CLOSED) {
			return;
		}
		this.readyState = FakeShell.CLOSED;
		this.onclose?.();
	}
}
