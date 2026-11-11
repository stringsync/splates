import type { Logger } from "core/log";

/** A `Logger` that tells no one anything. */
export class NoopLogger implements Logger {
	info(_message: unknown, ..._optionalParams: unknown[]): void {}

	error(_message: unknown, ..._optionalParams: unknown[]): void {}
}
