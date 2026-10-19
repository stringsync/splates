import { FsStorage } from "../storage";
import {
	KEY_PROVIDERS,
	type KeyProvider,
	WORKER_KEYS_FILE,
	WorkerKeys,
} from "../workers";
import type { SetupMachine, SetupStep } from "./setup";

/**
 * The Workers area's steps giving workers beside this machine API keys,
 * one provider at a time: each in a workspace or project with a spend
 * limit of its own, added on the Creds page, since a key is for a worker
 * and the page lists who may hold one.
 */
export const WORKER_KEY_STEPS: readonly SetupStep[] =
	KEY_PROVIDERS.map(workerKeyStep);

function workerKeyStep(provider: KeyProvider): SetupStep {
	const agents = provider.agents.join(", ");
	return {
		id: `worker-key-${provider.id}`,
		title: `Give workers ${provider.name} keys`,
		why: `Agents others start run ${agents} on a joined or made worker only once it holds a key from ${provider.name} of its own, so its spend has a limit of its own and no one's seat is shared. This machine's worker needs none.`,
		user: [
			`1. Make a ${provider.scope} for the worker at [${provider.name}'s ${provider.scope}s](${provider.limits}), and set its spend limit.`,
			`2. Make an API key in that ${provider.scope} at [${provider.name}'s keys](${provider.keys}).`,
			`3. On the **Creds** page, under **Worker keys**, press **Add key**, pick ${provider.name} and the worker, or every worker of a type, and paste it.`,
		].join("\n"),
		agent: `Walk the user through the steps, then have them add the key on the Creds page themselves: never ask for the key in chat. \`splates worker list\` shows which workers hold one under \`keys\`.`,
		optional: true,
		after: [],
		check: async (machine) => (await keysOf(machine, provider)).length > 0,
		notDone: `No worker holds a key from ${provider.name} yet: add one on the Creds page, then press Next.`,
		undo: {
			removes: async (machine) =>
				(await keysOf(machine, provider)).map(
					({ holder }) =>
						`The ${provider.name} key ${"worker" in holder ? `worker \`${holder.worker}\`` : `every \`${holder.type}\` worker`} holds`,
				),
			leaves: async () => [
				`Each key itself at [${provider.name}'s keys](${provider.keys}), still able to spend until you delete it there.`,
			],
			run: async (machine) => {
				if (machine.removeWorkerKeys !== undefined) {
					await machine.removeWorkerKeys(provider.id);
					return;
				}
				const keys = await openKeys(machine);
				for (const { holder } of keys.all) {
					await keys.remove(holder, provider.id);
				}
			},
		},
	};
}

/** The roster of workers' keys, read afresh as `splates server` keeps it. */
function openKeys({ fs, home, device }: SetupMachine): Promise<WorkerKeys> {
	return WorkerKeys.open(
		new FsStorage(home, fs).document(WORKER_KEYS_FILE),
		device,
	);
}

/** The keys from `provider` workers hold. */
async function keysOf(machine: SetupMachine, provider: KeyProvider) {
	return (await openKeys(machine)).all.filter(
		(each) => each.provider === provider.id,
	);
}
