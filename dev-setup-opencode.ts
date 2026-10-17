import type { Ps } from "webappwiz/system";
import { type HostGate, refuse } from "./dev-http";
import { NativeSetupConnection } from "./dev-setup-native";
import type { Connection } from "./dev-sockets";
import {
	OPENCODE_INSTALL,
	OPENCODE_LOGIN,
	type OpenCodeSetup,
} from "./setup-opencode";

/** Local/Access-protected setup operations, with no conversation or worker log. */
export class OpenCodeSetupRoutes {
	private terminal: NativeSetupConnection | null = null;
	constructor(
		readonly setup: OpenCodeSetup,
		private readonly ps: Ps,
		private readonly gate: HostGate,
	) {}

	readonly read = async (): Promise<Response> =>
		Response.json(this.setup.read());
	readonly check = async (): Promise<Response> =>
		this.terminal !== null
			? refuse(409, "busy", "Finish or cancel the native setup action first.")
			: Response.json(await this.setup.check());
	readonly cancel = async (): Promise<Response> => {
		this.setup.cancel();
		return Response.json(this.setup.read());
	};

	readonly open = (request: Request, server: Bun.Server<Connection>) =>
		this.gate.local(
			this.gate.guarded(async (request): Promise<Response | undefined> => {
				const origin = URL.parse(request.headers.get("origin") ?? "");
				if (origin === null || origin.host !== request.headers.get("host")) {
					return refuse(
						403,
						"forbidden",
						"Native setup opens only from its own page.",
					);
				}
				if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
					return refuse(400, "usage", "Native setup needs a WebSocket.");
				}
				const action = new URL(request.url).searchParams.get("action");
				if (action !== "install" && action !== "login") {
					return refuse(400, "usage", "Choose install or login.");
				}
				if (this.terminal !== null || this.setup.read().checking) {
					return refuse(
						409,
						"busy",
						"Another OpenCode setup action is running.",
					);
				}
				if (this.ps.platform === "win32") {
					return refuse(
						400,
						"unsupported",
						"Native setup terminals require macOS or Linux. Follow the official OpenCode installation and login instructions, then recheck here.",
					);
				}
				const status = this.setup.read();
				if (status.checkedAt === null) {
					return refuse(
						400,
						"usage",
						"Check this machine before starting native setup.",
					);
				}
				if (
					action === "login" &&
					(status.version === null ||
						!["stored", "missing"].includes(status.auth))
				) {
					return refuse(
						400,
						"usage",
						"Check the installed OpenCode login interface first.",
					);
				}
				if (action === "install" && status.version !== null) {
					return refuse(
						400,
						"usage",
						"OpenCode is already installed. Use the official update instructions to repair it.",
					);
				}
				await this.setup.prepare();
				if (this.terminal !== null || this.setup.read().checking) {
					return refuse(
						409,
						"busy",
						"Another OpenCode setup action is running.",
					);
				}
				const connection = new NativeSetupConnection(
					this.ps,
					action === "install" ? OPENCODE_INSTALL : OPENCODE_LOGIN,
					this.setup.cwd,
					this,
				);
				this.terminal = connection;
				this.setup.invalidate();
				if (server.upgrade(request, { data: connection })) {
					return undefined;
				}
				this.terminal = null;
				return refuse(
					400,
					"usage",
					"Could not open native setup. Retry from Setup.",
				);
			}),
		)(request);

	finished(): void {
		this.terminal = null;
	}

	async disposeAsync(): Promise<void> {
		this.setup.cancel();
		this.terminal?.dispose();
	}
}
