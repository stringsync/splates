import type { OpenCodeSetup } from "./opencode";
import type { SetupArea, SetupMachine, SetupStep, StepOption } from "./setup";

/** The device cred OpenCode's Go key is kept as, beside OpenCode's own copy. */
export const OPENCODE_GO_KEY = "OPENCODE_GO_API_KEY";

/** Where the user gets a Go key and turns Use balance off. */
const CONSOLE = "https://opencode.ai/auth";

/** OpenCode on an OpenCode Go account, beside the other agents. */
export const OPENCODE_AREA: SetupArea = openCodeArea();

function openCodeArea(): SetupArea {
	const installStep: SetupStep = {
		id: "opencode-install",
		title: "Install OpenCode",
		why: "OpenCode runs your OpenCode Go models beside the other agents.",
		user: "OpenCode is not on this machine yet. Next installs it with npm.",
		agent:
			"Press Next on the page, or run `npm install --global @opencode/cli@latest`. Do not start a paid conversation or edit the roster.",
		optional: true,
		after: [],
		check: async (machine) => (await native(machine).version()) !== null,
		submit: async (machine) => {
			await native(machine).install();
		},
		doing: "Installing OpenCode with npm…",
		notDone:
			"npm installed OpenCode, but splates cannot find it on its PATH. Restart `splates server`, then press Next.",
	};
	const connectStep: SetupStep = {
		id: "opencode-connect",
		title: "Paste your OpenCode Go API key",
		why: "splates keeps it for this device and hands it to OpenCode, which keeps its own copy.",
		user: "Paste your OpenCode Go API key.",
		agent:
			"Have the user paste the key into the page; never ask for it in chat or read native credential files.",
		optional: true,
		after: [installStep],
		fields: [
			{
				kind: "cred",
				name: OPENCODE_GO_KEY,
				label: "OpenCode Go API key",
				help: `Copy it from your Go workspace in the [OpenCode Console](${CONSOLE}).`,
			},
		],
		check: async (machine) =>
			(await machine.device.get(OPENCODE_GO_KEY)) !== undefined &&
			(await native(machine).connected()),
		submit: async (machine) => {
			const opencode = native(machine);
			const key = await machine.device.get(OPENCODE_GO_KEY);
			if (key !== undefined && !(await opencode.connected())) {
				await opencode.login(key);
			}
			await opencode.handshake();
		},
		doing: "Connecting OpenCode to Go…",
		notDone: "OpenCode still lists no Go key. Paste it again, then press Next.",
	};
	const modelsStep: SetupStep = {
		id: "opencode-models",
		title: "Choose your models",
		why: `Turn **Use balance** off in the [OpenCode Console](${CONSOLE}), so conversations stay on your Go plan.`,
		user: "Pick a main and an auxiliary model.",
		agent: "Have the user pick on the page; no prompts or credential exports.",
		optional: true,
		after: [connectStep],
		fields: [
			{
				kind: "choice",
				name: "model",
				label: "Main model",
				options: (machine) => models(machine, "model"),
			},
			{
				kind: "choice",
				name: "auxiliary",
				label: "Auxiliary model, for titles",
				options: (machine) => models(machine, "auxiliary"),
			},
			{
				kind: "yes-no",
				name: "balanceOff",
				label: "Use balance is off in my OpenCode Console",
			},
		],
		check: async (machine) =>
			(await native(machine).models.recipes.stored()) !== null,
		submit: async (machine, answers) => {
			if (answers.balanceOff !== true) {
				throw new Error(
					"Turn Use balance off in your OpenCode Console first, then say so here.",
				);
			}
			await native(machine).choose({
				model: String(answers.model),
				auxiliary: String(answers.auxiliary),
			});
		},
		doing: "Saving your models…",
	};
	const readyStep: SetupStep = {
		id: "opencode-ready",
		title: "Check OpenCode",
		why: "Makes sure OpenCode runs your models before your first conversation.",
		user: "Next checks your models with OpenCode, without sending a prompt.",
		agent:
			"Press Finish on the page. Metadata and ACP initialize only; never send a paid test prompt.",
		optional: true,
		after: [modelsStep],
		check: async (machine) => native(machine).ready(),
		submit: async (machine) => {
			await native(machine).verify();
		},
		doing: "Checking OpenCode…",
	};

	return {
		id: "opencode",
		title: "OpenCode",
		steps: [installStep, connectStep, modelsStep, readyStep],
	};
}

/** The machine's OpenCode, which every OpenCode step reads. */
function native(machine: SetupMachine): OpenCodeSetup {
	if (machine.opencode === undefined) {
		throw new Error("OpenCode setup runs only under `splates server`.");
	}
	return machine.opencode;
}

/** The Go catalog as choices, the saved recipe's pick first. */
async function models(
	machine: SetupMachine,
	which: "model" | "auxiliary",
): Promise<StepOption[]> {
	const opencode = native(machine);
	const listed = await opencode.models.catalog();
	const saved = await opencode.models.recipes.stored().catch(() => null);
	const first = saved?.[which];
	return [
		...listed.filter((id) => id === first),
		...listed.filter((id) => id !== first),
	].map((id) => ({ value: id, label: id.replace(/^opencode-go\//, "") }));
}
