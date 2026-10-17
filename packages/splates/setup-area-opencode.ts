import type { SetupArea, SetupStep } from "./setup";

/** OpenCode on an OpenCode Go account, beside the other agents. */
export const OPENCODE_AREA: SetupArea = openCodeArea();

function openCodeArea(): SetupArea {
	const installStep: SetupStep = {
		id: "opencode-install",
		title: "Install OpenCode",
		why: "Optionally add OpenCode alongside your existing agents.",
		user: "Check this machine, or install OpenCode here with npm. No model prompt is sent.",
		agent:
			"Use the native OpenCode controls in Setup; do not start a paid conversation or edit the roster.",
		optional: true,
		after: [],
		check: async ({ opencode }) => opencode?.read().version != null,
	};
	const connectStep: SetupStep = {
		id: "opencode-connect",
		title: "Connect OpenCode Go",
		why: "Connect your existing Go or Go Plus account through OpenCode's own secure login.",
		user: "Open your existing account in Console, then enter its key only into the native login prompt below. Return here and check again.",
		agent:
			"Never ask for keys in chat or read native credential files. Native auth listing confirms only stored credentials; ACP initialize checks protocol compatibility, not entitlement or billing.",
		optional: true,
		after: [installStep],
		check: async ({ opencode }) =>
			opencode?.read().auth === "stored" &&
			opencode.read().protocol === "compatible" &&
			opencode.read().problem === null,
	};
	const openCodeModelsStep: SetupStep = {
		id: "opencode-models",
		title: "Choose OpenCode Go models",
		why: "Select exact Go models and review an experiment-only configuration.",
		user: "Refresh available models, choose main and auxiliary models, then confirm Use balance is off in Console before applying.",
		agent:
			"Use the native model controls; no prompts or credential exports. Saved configuration is not proof of inference or billing.",
		optional: true,
		after: [connectStep],
		check: async ({ opencode }) =>
			(await opencode?.models.recipes.stored().catch(() => null)) != null,
	};
	const openCodeReadyStep: SetupStep = {
		id: "opencode-ready",
		title: "Check OpenCode configuration",
		why: "Verify the saved recipe for a new conversation in this project.",
		user: "Check configuration, then open a new conversation on your selected main model.",
		agent:
			"Metadata and ACP initialize only. Never send a paid test prompt or claim billing is verified.",
		optional: true,
		after: [openCodeModelsStep],
		check: async () => false,
	};

	return {
		id: "opencode",
		title: "OpenCode",
		steps: [installStep, connectStep, openCodeModelsStep, openCodeReadyStep],
	};
}
