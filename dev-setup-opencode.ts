import type { Ps } from "webappwiz/system";
import { z } from "zod";
import { type HostGate, refuse } from "./dev-http";
import { NativeSetupConnection } from "./dev-setup-native";
import type { Connection } from "./dev-sockets";
import {
	OPENCODE_INSTALL,
	OPENCODE_LOGIN,
	type OpenCodeSetup,
} from "./setup-opencode";
import { OpenCodeModelError } from "./setup-opencode-model-error";
import { openCodeSelection } from "./setup-opencode-models";

/** Local/Access-protected setup operations, with no conversation or worker log. */
export class OpenCodeSetupRoutes {
	private terminal: NativeSetupConnection | null = null;
	constructor(
		readonly setup: OpenCodeSetup,
		private readonly ps: Ps,
		private readonly gate: HostGate,
		private readonly roster: SetupRoster = { refresh: async () => {} },
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

	readonly models = async (): Promise<Response> =>
		Response.json(this.setup.models.read());
	readonly refreshModels = async (): Promise<Response> =>
		this.modelOperation((signal) => this.setup.models.refresh(signal));
	readonly previewModels = async (request: Request): Promise<Response> => {
		const input = openCodeSelection.safeParse(
			await request.json().catch(() => null),
		);
		if (!input.success) {
			return refuse(400, "usage", "Choose exact Go model IDs.");
		}
		return this.modelOperation((signal) =>
			this.setup.models.preview(input.data, signal),
		);
	};
	readonly applyModels = async (request: Request): Promise<Response> => {
		const input = z
			.object({ token: z.string().uuid(), balanceOff: z.literal(true) })
			.safeParse(await request.json().catch(() => null));
		if (!input.success) {
			return refuse(
				400,
				"usage",
				"Review the preview and confirm Use balance is off in Console.",
			);
		}
		return this.modelOperation(async (signal) => {
			const state = await this.setup.models.apply(
				input.data.token,
				input.data.balanceOff,
				signal,
			);
			await this.roster.refresh();
			return state;
		});
	};
	async readiness(cwd: string, verify: boolean): Promise<Response> {
		if (this.terminal !== null) {
			return refuse(409, "busy", "Finish or cancel native setup first.");
		}
		const state = await this.setup.readiness(cwd, verify);
		if (state.ready) {
			await this.roster.refresh();
		}
		return Response.json(state);
	}
	readonly disable = async (): Promise<Response> => {
		if (this.terminal !== null || this.setup.read().checking) {
			return refuse(409, "busy", "Finish or cancel setup first.");
		}
		try {
			await this.setup.configure(
				(signal) => this.setup.models.recipes.disable(signal),
				false,
			);
			this.setup.models.invalidate();
			await this.roster.refresh();
			return Response.json({});
		} catch {
			return refuse(
				400,
				"setup",
				"Could not disable the saved recipe. Custom or changed configuration is left untouched; repair it and retry.",
			);
		}
	};

	private async modelOperation(
		operation: Parameters<OpenCodeSetup["configure"]>[0],
	): Promise<Response> {
		if (this.terminal !== null || this.setup.read().checking) {
			return refuse(
				409,
				"busy",
				"Finish or cancel the current setup action first.",
			);
		}
		const status = this.setup.read();
		if (
			status.auth !== "stored" ||
			status.protocol !== "compatible" ||
			status.problem
		) {
			return refuse(
				400,
				"usage",
				"Check installation and native Go authentication first.",
			);
		}
		try {
			return Response.json(await this.setup.configure(operation));
		} catch (error) {
			return refuse(
				400,
				"setup",
				error instanceof OpenCodeModelError
					? error.message
					: "Could not finish verifying or saving the experiment configuration. Recheck the saved configuration, then refresh and review again; check file permissions if saving failed.",
			);
		}
	}

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

export interface SetupRoster {
	refresh(): Promise<void>;
}
