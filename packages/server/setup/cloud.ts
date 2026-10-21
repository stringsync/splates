import {
	ChosenCloud,
	CLOUDS,
	type CloudProvider,
	DIGITALOCEAN_TOKEN,
} from "../cloud";
import type { StepField } from "./fields";
import type { SetupMachine, SetupStep } from "./setup";

/**
 * The cloud chosen, as a step names it among what it `uses`, so undoing
 * one journey leaves the choice while another still makes machines there.
 */
export const CLOUD_CHOICE = "cloud.json";

/**
 * What a step that makes or reads machines in the chosen cloud `uses`: the
 * choice, and whichever cloud's token is kept.
 */
export const CLOUD_USES: readonly string[] = [CLOUD_CHOICE, DIGITALOCEAN_TOKEN];

/** The cloud chosen on this machine, reading its token from the machine's device creds. */
export function cloudOf(machine: SetupMachine): Promise<CloudProvider> {
	return new ChosenCloud(machine.home, machine.fs).cloud({
		store: machine.device,
		...(machine.fetch === undefined ? {} : { fetch: machine.fetch }),
	});
}

/**
 * Choosing the cloud provider splates makes machines in, the cloud workers
 * and the server's box alike, before either asks for its token. Each
 * journey that needs a cloud opens with one, `id` its own, and all of them
 * keep the one choice, so choosing in one reads done in the others.
 */
export function cloudChoiceStep(id: string): SetupStep {
	return {
		id,
		title: "Choose a cloud provider",
		why: `Cloud workers and the server's always-on box are machines splates makes in your own account with a cloud provider, through its API. It offers ${CLOUDS.map((each) => each.name).join(" and ")}.`,
		user: "Pick the cloud provider to make machines in, then press Next.",
		agent:
			"Have the user pick on the page and press Next, which keeps the choice in `~/.splates/cloud.json`; the steps after it ask for that provider's token.",
		optional: true,
		after: [],
		fields: [
			{
				kind: "choice",
				name: "cloud",
				label: "Cloud provider",
				options: async () =>
					CLOUDS.map((each) => ({ value: each.id, label: each.name })),
			},
		],
		check: async ({ home, fs }) =>
			(await new ChosenCloud(home, fs).read()) !== null,
		submit: async ({ home, fs }, answers) => {
			await new ChosenCloud(home, fs).choose(String(answers.cloud));
		},
		notDone: "No cloud provider is chosen yet: pick one, then press Next.",
		undo: {
			removes: async (_machine, kept) =>
				kept?.has(CLOUD_CHOICE)
					? []
					: ["The cloud provider chosen, kept in `~/.splates/cloud.json`"],
			run: async ({ home, fs }, kept) => {
				if (!kept?.has(CLOUD_CHOICE)) {
					await new ChosenCloud(home, fs).clear();
				}
			},
		},
	};
}

/**
 * The chosen cloud's token as a page asks for it, pasted there and saved
 * for the device: the token step's, and any step that needs it beside its
 * own work.
 */
export async function cloudTokenFields(
	machine: SetupMachine,
): Promise<StepField[]> {
	const { token } = await cloudOf(machine);
	return token === null
		? []
		: [
				{
					kind: "cred",
					name: token.cred,
					label: token.label,
					help: token.help,
				},
			];
}

/** Whether the device keeps a token the chosen cloud takes. */
export async function cloudTokenAccepted(
	machine: SetupMachine,
): Promise<boolean> {
	return (await cloudOf(machine)).accepted();
}

/** Throws the chosen cloud's own words when it does not take the token kept. */
export async function requireCloudToken(machine: SetupMachine): Promise<void> {
	const cloud = await cloudOf(machine);
	if (!(await cloud.accepted())) {
		throw new Error(
			cloud.token?.refused ??
				`${cloud.name} takes no sign-in found here: \`aws configure\`, or an instance role on the box`,
		);
	}
}

/** Why a step that needs the cloud's token is not done, once Next has said the cloud's own reason. */
export const CLOUD_TOKEN_MISSING =
	"Your cloud provider does not take the token kept: paste a read-and-write one, then press Next.";
