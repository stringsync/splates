/** Run with bun from the task worktree. Uses a preconfigured Access slot only. */

import { FakeSecretStore } from "webappwiz/creds/testing";
import { ConsoleLogger } from "webappwiz/log";
import { NodeFs, NodePs, type TerminalOptions } from "webappwiz/system";
import { FakeFs } from "webappwiz/system/testing";
import { SYSTEM_STORES } from "../creds";
import { assets } from "../dev/assets";
import { Access } from "../dev-access";
import { HostGate } from "../dev-http";
import { OpenCodeSetupRoutes } from "../dev-setup-opencode";
import { devSlot } from "../dev-slot";
import { CONNECTIONS, type Connection } from "../dev-sockets";
import { savedTunnelConfig, startTunnel } from "../dev-tunnel";
import { SavedTunnel } from "../saved-tunnel";
import { Setup } from "../setup";
import { SETUP_AREAS } from "../setup-areas";
import { OpenCodeSetup } from "../setup-opencode";
import { OpenCodeFixturePs } from "../setup-opencode-fixture";
import { SERVER_PID } from "../slots";

class DemoPs extends OpenCodeFixturePs {
	override startOnTerminal(argv: string[], opts: TerminalOptions) {
		const child = super.startOnTerminal(argv, opts);
		child.print(
			"Fixture only. Do not enter credentials. Simulating native action…\r\n",
		);
		setTimeout(() => {
			if (child.closed) {
				return;
			}
			if (argv[0] === "npm") {
				this.installed = true;
			} else {
				this.connected = true;
			}
			child.print("Fixture action completed. Check again.\r\n");
			child.exit(0);
		}, 1500);
		return child;
	}
}
const log = new ConsoleLogger();
const fs = new NodeFs();
const ps = new NodePs();
const slot = await devSlot({
	fs,
	ps,
	log,
	assets,
	fetch: (async () => {
		throw new Error(
			"Review refuses all account changes; use an already configured slot.",
		);
	}) as unknown as typeof fetch,
});
const home = slot.env.ARBOR_HOME as string;
const saved = await savedTunnelConfig(
	new SavedTunnel(`${home}/tunnel.json`, { fs, store: SYSTEM_STORES.device }),
	ps,
	log,
);
if (!saved) {
	throw new Error("An existing Access-protected slot is required.");
}
const gate = new HostGate([slot.host], log, new Access(saved.access));
let fakeFs: FakeFs;
let fakePs: DemoPs;
let native: OpenCodeSetup;
let routes: OpenCodeSetupRoutes;
let setup: Setup;
async function scenario(name: string) {
	await routes?.disposeAsync();
	fakeFs = new FakeFs();
	fakePs = new DemoPs();
	native = new OpenCodeSetup({
		fs: fakeFs,
		ps: fakePs,
		home: "/fixture/arbor",
	});
	routes = new OpenCodeSetupRoutes(native, fakePs, gate);
	setup = new Setup(
		{
			fs: fakeFs,
			home: "/fixture/arbor",
			device: new FakeSecretStore(),
			opencode: native,
		},
		SETUP_AREAS,
	);
	await setup.see();
	if (name !== "fresh" && name !== "missing-login") {
		await native.check();
		const signal = new AbortController().signal;
		await native.models.refresh(signal);
		const preview = await native.models.preview(
			{ model: "opencode-go/Main", auxiliary: "opencode-go/Small" },
			signal,
		);
		await native.models.apply(preview.preview?.token ?? "", true, signal);
	}
	fakePs.installed = name !== "fresh";
	fakePs.connected = !["fresh", "missing-login"].includes(name);
	fakePs.unavailable = name === "invalid-model";
	fakePs.conflict = name === "conflict";
	fakePs.offline = name === "offline";
}
await scenario("saved");
const built = await Bun.build({
	entrypoints: [`${import.meta.dirname}/opencode-page.tsx`],
	target: "browser",
	define: { "process.env.NODE_ENV": '"production"' },
});
const js = await built.outputs[0]?.text();
if (!js) {
	throw new Error(String(built.logs));
}
const handle = gate.local(
	gate.guarded(async (request) => {
		const path = new URL(request.url).pathname;
		if (path === "/fixture") {
			await scenario((await request.json()).scenario);
			return Response.json({});
		}
		if (path === "/review.js") {
			return new Response(js, {
				headers: { "content-type": "text/javascript; charset=utf-8" },
			});
		}
		if (path === "/review.css") {
			return new Response(assets.styles, {
				headers: { "content-type": "text/css" },
			});
		}
		if (path === "/api/setup/seen") {
			await setup.see();
			return Response.json(await setup.read());
		}
		const skipped = /^\/api\/setup\/([^/]+)\/skipped$/.exec(path);
		if (skipped?.[1]) {
			const body = await request.json();
			if (body.skipped) {
				await setup.skip(skipped[1]);
			} else {
				await setup.unskip(skipped[1]);
			}
			return Response.json(await setup.read());
		}
		if (path === "/api/setup") {
			return Response.json(await setup.read());
		}
		if (path === "/api/setup/opencode") {
			return routes.read();
		}
		if (path === "/api/setup/opencode/check") {
			return routes.check();
		}
		if (path === "/api/setup/opencode/cancel") {
			return routes.cancel();
		}
		if (path === "/api/setup/opencode/models") {
			return routes.models();
		}
		if (path.endsWith("/models/refresh")) {
			return routes.refreshModels();
		}
		if (path.endsWith("/models/preview")) {
			return routes.previewModels(request);
		}
		if (path.endsWith("/models/apply")) {
			return routes.applyModels(request);
		}
		if (path.endsWith("/readiness")) {
			return routes.readiness("/fixture/project", request.method === "POST");
		}
		if (path.endsWith("/disable")) {
			return routes.disable();
		}
		if (path.endsWith("/conversation")) {
			const state = await native.readiness("/fixture/project", true);
			if (!state.ready) {
				return Response.json({ message: state.problem }, { status: 400 });
			}
			return Response.json({
				id: "fixture-empty",
				agent: "opencode",
				messages: [],
				status: "idle",
				settings: [],
			});
		}
		if (path.startsWith("/api/")) {
			return Response.json({});
		}
		return new Response(
			'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/review.css"></head><body><div id="root"></div><script src="/review.js"></script></body></html>',
			{ headers: { "content-type": "text/html" } },
		);
	}),
);
const server = Bun.serve<Connection>({
	hostname: "127.0.0.1",
	port: Number(Bun.argv[2] ?? 0),
	websocket: CONNECTIONS,
	fetch: (request, server) =>
		new URL(request.url).pathname === "/api/setup/opencode/native"
			? routes.open(request, server)
			: handle(request),
});
await fs.write(`${home}/${SERVER_PID}`, String(ps.pid));
const tunnel = await startTunnel(
	saved.tunnel,
	`http://127.0.0.1:${server.port}`,
	log,
);
console.log(
	`Fixture review: https://${slot.host} | http://localhost:${server.port}`,
);
process.on("SIGTERM", async () => {
	await routes.disposeAsync();
	await tunnel?.disposeAsync();
	await server.stop(true);
	process.exit(0);
});
