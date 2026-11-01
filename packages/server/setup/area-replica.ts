import { Duration, timeAgo } from "core/time";
import {
	REPLICA_ACCESS_KEY,
	REPLICA_SECRET_KEY,
	type ReplicaPlace,
	type ReplicaStatus,
} from "../replica";
import { REPLICA_KEY_FIELDS } from "./replica-key-fields";
import type { SetupArea, SetupMachine, SetupProject, SetupStep } from "./setup";

/** The copy of a project's records `splates server` keeps in a bucket or a folder. */
export const REPLICA_AREA: SetupArea = replicaArea();

function replicaArea(): SetupArea {
	const placeStep: SetupStep = {
		id: "replica-place",
		title: "Name a replica",
		why: "A replica is a copy of this project's records a few seconds behind every change, in a bucket or a folder, so they outlive this machine and can move to another.",
		user: "Have an agent add a `replica` to this project's `splates.config.ts` in a task: tell it the bucket (and endpoint and prefix) or the folder, approve its diff here, restart the server, then press Next.",
		agent:
			"The page makes the `replica` change in a task named `setup-replica-place`, and you ask the user for the bucket or folder there; they approve it and restart the server on the page, then run `splates setup replica-place`.",
		notDone:
			"`splates.config.ts` names no `replica` yet: have an agent make the change above and approve it, then press Next.",
		optional: true,
		after: [],
		fields: [
			{
				kind: "config",
				name: "replica",
				label: "Name a replica",
				change:
					'Ask the user where the replica goes, then add it to `splates.config.ts`: for a bucket of any S3-compatible store, `replica: { provider: "s3", endpoint: "https://<region>.digitaloceanspaces.com", bucket: "<bucket>" }` (adding `prefix` for projects that share a bucket); for a folder, `replica: { provider: "dir", path: "/Volumes/Backup/splates" }`.',
			},
		],
		detail: async (machine) => {
			const place = (await projectOf(machine).config()).replica;
			return place === null ? null : `Named: \`${whereIs(place)}\`.`;
		},
		check: async (machine) =>
			(await projectOf(machine).config()).replica !== null,
		undo: {
			removes: async () => [],
			leaves: async () => [
				"`replica` in this project's `splates.config.ts`: take it out in a task and merge it, then restart the server, or it keeps copying.",
				"The copy already made, in the bucket or folder: delete it there if you no longer want it.",
			],
			run: async () => {},
		},
	};

	const credsStep: SetupStep = {
		id: "replica-creds",
		title: "Give splates the bucket's key",
		why: "splates signs each request to the bucket with a key and secret of yours, kept in the project's creds and never shown again.",
		user: "In the store's control panel, make an access key limited to the bucket if it can be, and paste its key id and its secret here, then press Next. The replica starts as soon as both are saved.",
		agent: `Have the user paste \`${REPLICA_ACCESS_KEY}\` and \`${REPLICA_SECRET_KEY}\` in this step (or fill them on the Creds page), then run \`splates setup replica-creds\`.`,
		notDone: `\`${REPLICA_ACCESS_KEY}\` and \`${REPLICA_SECRET_KEY}\` are not both saved yet: paste them here, then press Next.`,
		optional: true,
		after: [placeStep],
		fields: REPLICA_KEY_FIELDS,
		shown: async (machine) =>
			(await projectOf(machine).config()).replica?.provider === "s3",
		check: async (machine) => {
			const { kept } = projectOf(machine);
			if (kept === undefined) {
				throw new Error(UNREAD);
			}
			return (
				(await kept(REPLICA_ACCESS_KEY)) && (await kept(REPLICA_SECRET_KEY))
			);
		},
		undo: {
			removes: async () => [],
			leaves: async () => [
				`\`${REPLICA_ACCESS_KEY}\` and \`${REPLICA_SECRET_KEY}\` in the project's creds: forget them on the [Creds page](#creds), and delete the key in the store's control panel.`,
			],
			run: async () => {},
		},
	};

	const statusStep: SetupStep = {
		id: "replica",
		title: "Keep the replica caught up",
		why: "A replica is only as good as the last time it held every change.",
		user: "Nothing to do while it keeps up: this says where it stands. Restart the server from the replica step above if it ran before the replica was named.",
		agent:
			"Run `splates replica status`; when it is failing, put right what it says, then run `splates setup replica`.",
		notDone:
			"The replica has not caught up yet: put right what it says, or wait for it, then press Next.",
		optional: true,
		after: [placeStep],
		detail: async (machine) => {
			const project = projectOf(machine);
			const place = (await project.config()).replica;
			if (place === null) {
				return null;
			}
			return standing(
				whereIs(place),
				(await project.replica?.()) ?? null,
				Date.now(),
			);
		},
		warning: async (machine) => {
			const error = (await projectOf(machine).replica?.())?.error ?? null;
			return error === null ? null : failing(error);
		},
		check: async (machine) => {
			const { replica } = projectOf(machine);
			if (replica === undefined) {
				throw new Error(UNREAD);
			}
			const status = await replica();
			return status?.caughtUpAt != null && status.error === null;
		},
	};

	return {
		id: "replica",
		title: "Replica",
		purpose: "Keep a copy of your tasks and conversations in a bucket you own.",
		steps: [placeStep, credsStep, statusStep],
	};
}

/** What a step reads with no project open. */
const UNREAD =
	"No project to check: open Setup from a project, or run `splates setup` in its repository.";

function projectOf(machine: SetupMachine): SetupProject {
	if (machine.project === undefined) {
		throw new Error(UNREAD);
	}
	return machine.project;
}

/** Where `place` is, as the replica names itself: `s3://bucket/prefix`, or the folder. */
function whereIs(place: ReplicaPlace): string {
	if (place.provider === "dir") {
		return place.path;
	}
	const prefix = place.prefix?.replace(/^\/+|\/+$/g, "") ?? "";
	return `s3://${place.bucket}${prefix === "" ? "" : `/${prefix}`}`;
}

/** Where the replica at `where` stands as of `now`, in a line for the page. */
function standing(
	where: string,
	status: ReplicaStatus | null,
	now: number,
): string {
	if (status === null) {
		return `\`${where}\` has not started: \`splates server\` starts it as it serves the project.`;
	}
	const ago = (at: number) => timeAgo(Duration.ms(now - at));
	const { caughtUpAt, pending, behindSince } = status;
	const caught =
		caughtUpAt === null
			? "never caught up yet"
			: `caught up ${ago(caughtUpAt)}`;
	const behind =
		behindSince === null
			? "nothing waits"
			: `${pending} change${pending === 1 ? " waits" : "s wait"}, the oldest from ${ago(behindSince)}`;
	return `\`${status.replica}\`: ${caught}; ${behind}.`;
}

/** What the page says of a replica failing with `error`, and what puts it right. */
function failing(error: string): string {
	if (error.startsWith(`no ${REPLICA_ACCESS_KEY}`)) {
		return `It has no key for the bucket yet: fill \`${REPLICA_ACCESS_KEY}\` and \`${REPLICA_SECRET_KEY}\` on the [Creds page](#creds), and it starts at once.`;
	}
	if (error.includes("holds the records of another server")) {
		return `It refuses to write: ${error}.`;
	}
	return `The last batch failed: ${error}. It is tried again on its own, waiting up to five minutes.`;
}
