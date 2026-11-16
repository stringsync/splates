import type { Signal } from "./signals";

/** A signal in a line: its kind and the facts that name it. */
export function describeSignal(signal: Signal): string {
	const detail = signal.detail;
	const what =
		detail.text ??
		detail.request ??
		detail.label ??
		detail.element ??
		detail.action ??
		detail.kind ??
		"";
	const extra =
		signal.signal === "request-failed" || signal.signal === "request-slow"
			? ` ${detail.status ?? ""} ${detail.ms ?? ""}ms`
			: "";
	return `${signal.signal} ${String(what)}${extra}`.trim().slice(0, 240);
}
