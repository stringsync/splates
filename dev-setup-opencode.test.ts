import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { MemoryLogger } from "webappwiz/log";
import { FakeFs, FakePs } from "webappwiz/system/testing";
import { eventually } from "./conversation-testing";
import { HostGate } from "./dev-http";
import { OpenCodeSetupRoutes } from "./dev-setup-opencode";
import { CONNECTIONS, type Connection } from "./dev-sockets";
import { OpenCodeSetup, type OpenCodeStatus } from "./setup-opencode";

class CheckedSetup extends OpenCodeSetup {
	value: OpenCodeStatus = {
		version: "2.0.0-fixture",
		auth: "missing",
		protocol: "compatible",
		checking: false,
		problem: null,
		checkedAt: "fixture",
	};
	override read(): OpenCodeStatus {
		return { ...this.value };
	}
}

describe("OpenCode native setup routes", () => {
	let ps: FakePs;
	let setup: CheckedSetup;
	let routes: OpenCodeSetupRoutes;
	let server: Bun.Server<Connection>;
	let socket: WebSocket | null;
	let log: MemoryLogger;
	beforeEach(() => {
		ps = new FakePs();
		log = new MemoryLogger();
		setup = new CheckedSetup({ ps, fs: new FakeFs(), home: "/arbor" });
		routes = new OpenCodeSetupRoutes(setup, ps, new HostGate([], log));
		server = Bun.serve<Connection>({
			port: 0,
			fetch: (request, server) => routes.open(request, server),
			websocket: CONNECTIONS,
		});
		socket = null;
	});
	afterEach(async () => {
		socket?.close();
		await routes.disposeAsync();
		await server.stop(true);
	});

	const connect = async (
		action: string,
		origin = `http://localhost:${server.port}`,
	) => {
		const options: Bun.WebSocketOptions = { headers: { origin } };
		socket = new WebSocket(
			`ws://localhost:${server.port}/api/setup/opencode/native?action=${action}`,
			options as string[],
		);
		return new Promise<boolean>((resolve) => {
			if (socket === null) {
				return;
			}
			socket.onopen = () => resolve(true);
			socket.onerror = () => resolve(false);
		});
	};
	const terminal = async () => {
		await eventually(() => ps.getTerminals().length > 0);
		return ps.getTerminals()[0];
	};

	it("hands login to the exact native masked-key command, with input only on its terminal", async () => {
		expect(await connect("login")).toBe(true);
		const child = await terminal();
		socket?.send(new TextEncoder().encode("fixture-key\r"));
		await eventually(() => (child?.typed.length ?? 0) > 0);
		expect(child?.typed).toEqual(["fixture-key\r"]);
		expect(log.entries).toEqual([]);
		expect(ps.getCalls()).toEqual([
			"opencode auth login opencode-go --method key --standalone",
		]);
		expect(ps.getCallEnvs()).toEqual([{ TERM: "xterm-256color" }]);
		expect(ps.getCallDirs()).toEqual(["/arbor/setup-opencode"]);
		socket?.send(JSON.stringify({ type: "close" }));
		await eventually(() => child?.closed === true);
		expect(child?.closed).toBe(true);
		expect(child?.signals).toEqual(["SIGHUP"]);
	});

	it("requires an explicit install action and releases the command when the page disconnects", async () => {
		setup.value.version = null;
		expect(await connect("install")).toBe(true);
		const child = await terminal();
		expect(ps.getCalls()).toEqual([
			"npm install --global @opencode/cli@latest",
		]);
		socket?.close();
		await eventually(() => child?.closed === true);
		expect(child?.closed).toBe(true);
	});

	it("refuses cross-origin native actions", async () => {
		expect(await connect("login", "https://evil.example")).toBe(false);
		expect(ps.getCalls()).toEqual([]);
	});

	it("refuses arbitrary commands and unsupported login versions", async () => {
		expect(await connect("run-prompt")).toBe(false);
		setup.value.auth = "unsupported";
		expect(await connect("login")).toBe(false);
		expect(ps.getCalls()).toEqual([]);
	});

	it("does not overwrite an existing installation", async () => {
		expect(await connect("install")).toBe(false);
		expect(ps.getCalls()).toEqual([]);
	});

	it("blocks checks during a native operation and permits retry after cancellation", async () => {
		expect(await connect("login")).toBe(true);
		const child = await terminal();
		expect((await routes.check()).status).toBe(409);
		socket?.close();
		await eventually(() => child?.closed === true);
		expect(await connect("login")).toBe(true);
	});
});
