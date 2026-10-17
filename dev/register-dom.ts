// Test-only: the page's tests that need a DOM import this for its side
// effect. Nothing the package exports imports it, so the build leaves it, and
// happy-dom, out of what is published.
//
// Imported per file rather than preloaded through bunfig. `wiz dev test` runs
// `bun test --parallel`, a worker per file, so importing it here registers
// happy-dom only in the workers that asked for a DOM. A preload would register
// it in every worker, and happy-dom replaces 33 globals: not just the HTTP
// classes below but `setTimeout`, `URL`, `AbortSignal` and the stream types,
// which the server side is tested against.
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// Even within one worker, `register()` replaces globals for the whole process,
// and happy-dom's HTTP classes are not the ones the runtime serves with:
// `Bun.serve` does not recognise a happy-dom `Response` and quietly answers
// with its own welcome page instead. That would corrupt any file loaded after
// this one in the same worker. Nothing that needs a DOM needs happy-dom's
// HTTP, so hand the runtime's back, its WebSocket too, whose happy-dom stand-in
// never reaches a `Bun.serve` socket.
const http = ["Response", "Request", "Headers", "fetch", "WebSocket"];
const runtime = http.map(
	(name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
);

GlobalRegistrator.register();

for (const [name, descriptor] of runtime) {
	if (descriptor !== undefined) {
		Object.defineProperty(globalThis, name, descriptor);
	}
}

// A failed matcher prints what it received, and Bun prints a happy-dom node by
// walking every field it holds: its parent, its document, the whole tree. On a
// page-sized tree that takes seconds and gigabytes, and can end in the matcher
// not throwing at all, so `expect(dialog).toBeNull()` passed on an open dialog.
// Print a node as its markup instead.
const limit = 300;
Object.defineProperty(Node.prototype, Bun.inspect.custom, {
	value(this: Node) {
		const text =
			this instanceof Element
				? this.outerHTML
				: `${this.nodeName} ${JSON.stringify(this.textContent)}`;
		return text.length > limit ? `${text.slice(0, limit)}…` : text;
	},
});
