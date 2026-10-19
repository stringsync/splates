import type { Logger } from "webappwiz/log";
import {
	generateVapidKeys,
	type Pusher,
	PushFailure,
	type VapidKeys,
	WebPusher,
} from "webappwiz/push";
import { Duration, SystemTimer } from "webappwiz/time";
import { z } from "zod";
import { nameOf } from "../conversations";
import { fail } from "../exit";
import { type Needing, openedBy } from "../plans";
import type { Projects } from "../projects";
import type { Handler, Served } from "../server/shared";
import { body } from "../server/shared";
import type { Document, Storage } from "../storage";
import { keyOf, Notices } from "./notices";

/** How often the server looks for something worth pushing, while a device listens. */
export const PUSH_EVERY = Duration.secs(5);

/** Who push services may reach about this server's pushes, as VAPID asks. */
const SUBJECT = "https://github.com/stringsync/splates";

const WANTS = z.object({
	waiting: z.boolean(),
	finished: z.boolean(),
	quiet: z.boolean(),
	quietAfter: z.number().positive(),
	inFront: z.boolean(),
});

const SUBSCRIPTION = z.object({
	endpoint: z.url(),
	keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

const DEVICE = z.object({ subscription: SUBSCRIPTION, wants: WANTS });

/** A browser that asked to be pushed notices, and which it wants. */
type Device = z.infer<typeof DEVICE>;

const KEPT = z.object({
	keys: z.object({ publicKey: z.string(), privateKey: z.string() }),
	devices: z.array(DEVICE),
});

/** What `push.json` keeps. */
type Kept = z.infer<typeof KEPT>;

/** The devices alone, read again whatever keys the file keeps. */
const DEVICES = KEPT.pick({ devices: true });

/** What `Pushes` reads each served project through. */
export interface PushesDeps {
	/** The machine's storage, which keeps `push.json`. */
	storage: Storage;
	log: Logger;
	projects: Projects;
	/** By root, every project the server has opened. */
	served: Map<string, Promise<Served>>;
	/** What sends a push, signed with the keys kept; the Web Push services by default. */
	pusher?: (keys: VapidKeys) => Pusher;
	/** How often to look; `PUSH_EVERY` by default. */
	every?: Duration;
}

/**
 * Tells each device that subscribed, through its browser's push service,
 * what the page's own notifications would: an agent that came to wait,
 * finished its turn or went quiet, in any project the server has open. The
 * page cannot tell it itself once a phone freezes it, soon after the app
 * leaves the front. The keys it signs with and the devices it pushes to are
 * kept in one file for every project on the machine, so a restart keeps them.
 */
export class Pushes {
	private readonly pusher: Pusher;
	/** By device and project, what the last look saw. */
	private readonly notices = new Map<string, Notices>();
	private readonly tick: { dispose(): void };
	private looking: Promise<void> | null = null;

	static async start(deps: PushesDeps): Promise<Pushes> {
		const file = deps.storage.document<Kept>("push.json");
		let kept: Kept;
		try {
			kept = KEPT.parse(await file.read());
		} catch {
			// None yet, or unreadable: every subscription needs the keys it was
			// made with, so new ones start over with none.
			kept = { keys: await generateVapidKeys(), devices: [] };
			await file.write(kept);
		}
		return new Pushes(deps, file, kept.keys, kept.devices);
	}

	private constructor(
		private readonly deps: PushesDeps,
		private readonly file: Document<Kept>,
		private readonly keys: VapidKeys,
		private devices: Device[],
	) {
		this.pusher = (deps.pusher ?? ((keys) => new WebPusher(keys, SUBJECT)))(
			keys,
		);
		this.tick = new SystemTimer().setInterval(
			() => void this.look(),
			deps.every ?? PUSH_EVERY,
		);
	}

	/** The public key a page subscribes with. */
	readonly key: Handler = async () =>
		Response.json({ publicKey: this.keys.publicKey });

	/** Keeps a device's subscription and what it wants, replacing what it said before. */
	readonly subscribe: Handler = async (request) => {
		const parsed = DEVICE.safeParse(await body(request));
		if (!parsed.success) {
			fail("usage", `not a push subscription: ${parsed.error.message}`, {});
		}
		const device = parsed.data;
		await this.keep([
			...(await this.kept()).filter(
				(each) => each.subscription.endpoint !== device.subscription.endpoint,
			),
			device,
		]);
		return Response.json({ endpoint: device.subscription.endpoint });
	};

	/** Forgets the device whose subscription `endpoint` names. */
	readonly unsubscribe: Handler = async (request) => {
		const { endpoint } = await body(request);
		await this.forget(String(endpoint));
		return Response.json({ endpoint });
	};

	/**
	 * Compares every open project's rows with the last look, for each device,
	 * and pushes each notice it wants. A look still going when the next is due
	 * lets it pass.
	 */
	look(): Promise<void> {
		this.looking ??= this.lookOnce()
			.catch((error) => {
				// The next look tries again; one that throws must not take the
				// server down with it.
				this.deps.log.error(
					`splates server could not look for notices: ${String(error)}`,
				);
			})
			.finally(() => {
				this.looking = null;
			});
		return this.looking;
	}

	dispose(): void {
		this.tick.dispose();
	}

	private async lookOnce(): Promise<void> {
		const devices = await this.kept();
		if (devices.length === 0) {
			return;
		}
		const slugs = new Map(
			(await this.deps.projects.list()).map((each) => [each.root, each.slug]),
		);
		const now = Date.now();
		for (const settled of await Promise.allSettled(this.deps.served.values())) {
			if (settled.status !== "fulfilled") {
				continue;
			}
			const project = settled.value;
			const slug = slugs.get(project.root);
			if (slug === undefined) {
				continue;
			}
			const { rows, lanes } = await project.needing();
			const name = (row: Needing) =>
				row.conversation !== null
					? nameOf(row.conversation, lanes)
					: (row.task?.task ?? "");
			for (const device of devices) {
				const seen = `${device.subscription.endpoint} ${project.root}`;
				let notices = this.notices.get(seen);
				if (notices === undefined) {
					notices = new Notices();
					this.notices.set(seen, notices);
				}
				for (const notice of notices.look(rows, name, now, device.wants)) {
					const pushed: Pushed = {
						title: notice.title,
						body: notice.body,
						key: keyOf(notice.row),
						url: `?project=${encodeURIComponent(slug)}#conversations/${openedBy(notice.row)}`,
						inFront: device.wants.inFront,
					};
					await this.push(device, pushed);
				}
			}
		}
	}

	/**
	 * Pushes `notice` to every device at once, whatever it wants and
	 * however quiet the hour, for what must not be missed: a worker budget
	 * limit nearing or reached.
	 */
	async announce(notice: Omit<Pushed, "inFront">): Promise<void> {
		for (const device of await this.kept()) {
			await this.push(device, { ...notice, inFront: device.wants.inFront });
		}
	}

	private async push(device: Device, pushed: Pushed): Promise<void> {
		try {
			await this.pusher.push(device.subscription, JSON.stringify(pushed), {
				urgency: "high",
			});
		} catch (error) {
			if (error instanceof PushFailure && error.gone) {
				await this.forget(device.subscription.endpoint);
				return;
			}
			this.deps.log.error(
				`splates server could not push a notice: ${String(error)}`,
			);
		}
	}

	private async forget(endpoint: string): Promise<void> {
		for (const seen of this.notices.keys()) {
			if (seen.startsWith(`${endpoint} `)) {
				this.notices.delete(seen);
			}
		}
		await this.keep(
			(await this.kept()).filter(
				(each) => each.subscription.endpoint !== endpoint,
			),
		);
	}

	/**
	 * The devices as the file keeps them now, since undoing setup's
	 * notifications forgets them there; the last ones read when it will not
	 * read.
	 */
	private async kept(): Promise<Device[]> {
		try {
			this.devices = DEVICES.parse(await this.file.read()).devices;
		} catch {
			// Kept as they were: the next write puts the file right.
		}
		return this.devices;
	}

	private async keep(devices: Device[]): Promise<void> {
		this.devices = devices;
		await this.file.write({ keys: this.keys, devices });
	}
}

/**
 * Forgets every device `push.json` under `home` keeps, keeping the keys
 * their subscriptions were made with, so each browser subscribes again from
 * the page. A running server's `Pushes` reads the file before each push, so
 * it stops pushing to them too.
 */
export async function forgetDevices(storage: Storage): Promise<void> {
	const file = storage.document<{ devices?: unknown[] }>("push.json");
	const seen = await file.read();
	if (!Array.isArray(seen?.devices) || seen.devices.length === 0) {
		return;
	}
	await file.update((kept) => ({ ...kept, devices: [] }));
}

/** What the server pushes for a notice, as `Pushes` sends it. */
export interface Pushed {
	title: string;
	body: string;
	/** The row's key, which tags its notification and opens it. */
	key: string;
	/** The row's address, from the page's own: its `?project=` and hash. */
	url: string;
	/** Whether to show it even while a window of the page is in front. */
	inFront: boolean;
}
