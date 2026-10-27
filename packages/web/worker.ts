/**
 * The page's service worker: it shows notifications, since a phone's browser
 * shows one only through a worker's registration, and hears of one the
 * server pushes while the page is frozen only through a worker; and it keeps
 * the page's own files, so a page opened again draws without waiting on the
 * network (see `PageCache`). It keeps nothing the server says under `/api`.
 *
 * Clicking a notification focuses a window on the row's project and tells it
 * which row to open, or, with none on that project, opens one at the row's
 * address.
 */

import type { Pushed } from "@stringsync/splates-server/push";
import { PageCache, type PageCaches, type Stale } from "./page-cache";

/** What a notification carries for its click, as `Notifier.show` and a push set it. */
export interface Opening {
	/** The row's key, which the page looks up among its rows. */
	key: string;
	/** The page's address with the row open, for when no window is. */
	url: string;
}

/** The message a window gets when one of its notifications is clicked. */
export interface Opened {
	type: "splates:open";
	key: string;
}

/** The little of a service worker's scope this uses, which the DOM lib leaves out. */
interface WorkerScope {
	skipWaiting(): Promise<void>;
	caches: PageCaches;
	clients: {
		claim(): Promise<void>;
		get(id: string): Promise<{ postMessage(message: Stale): void } | undefined>;
		matchAll(options: {
			type: "window";
			includeUncontrolled: boolean;
		}): Promise<
			{
				url: string;
				focused: boolean;
				focus(): Promise<unknown>;
				postMessage(message: Opened): void;
			}[]
		>;
		openWindow(url: string): Promise<unknown>;
	};
	registration: {
		scope: string;
		showNotification(
			title: string,
			options: NotificationOptions,
		): Promise<void>;
	};
	addEventListener(type: "install", listener: () => void): void;
	addEventListener(
		type: "fetch",
		listener: (event: {
			request: Request;
			resultingClientId: string;
			respondWith(response: Promise<Response>): void;
			waitUntil(done: Promise<unknown>): void;
		}) => void,
	): void;
	addEventListener(
		type: "push",
		listener: (event: {
			waitUntil(done: Promise<unknown>): void;
			data: { json(): unknown } | null;
		}) => void,
	): void;
	addEventListener(
		type: "activate" | "notificationclick",
		listener: (event: {
			waitUntil(done: Promise<unknown>): void;
			notification?: Notification;
		}) => void,
	): void;
}

const scope = self as unknown as WorkerScope;

// A new worker takes over at once: it holds nothing an old page relies on.
scope.addEventListener("install", () => void scope.skipWaiting());
scope.addEventListener("activate", (event) =>
	event.waitUntil(scope.clients.claim()),
);

const cache = new PageCache(scope.caches, scope.clients);
scope.addEventListener("fetch", (event) => {
	const answer = cache.respond(event.request, event.resultingClientId);
	if (answer !== null) {
		event.respondWith(answer.response);
		event.waitUntil(answer.after.catch(() => {}));
	}
});

scope.addEventListener("notificationclick", (event) => {
	const notification = event.notification;
	notification?.close();
	const opening = notification?.data as Opening | undefined;
	if (opening === undefined) {
		return;
	}
	event.waitUntil(
		(async () => {
			// One server holds every project, each at its own `?project=`.
			const project = projectOf(opening.url);
			const open = (
				await scope.clients.matchAll({
					type: "window",
					includeUncontrolled: true,
				})
			).find((window) => projectOf(window.url) === project);
			if (open === undefined) {
				await scope.clients.openWindow(opening.url);
				return;
			}
			open.postMessage({ type: "splates:open", key: opening.key });
			await open.focus();
		})(),
	);
});

/** The project `url` is on, by its `?project=`, whatever else it asks. */
function projectOf(url: string): string | null {
	return new URL(url).searchParams.get("project");
}

scope.addEventListener("push", (event) => {
	const pushed = event.data?.json() as Pushed | undefined;
	if (pushed === undefined) {
		return;
	}
	event.waitUntil(
		(async () => {
			const windows = await scope.clients.matchAll({
				type: "window",
				includeUncontrolled: true,
			});
			// In front, the sidebar's marks already say it.
			if (!pushed.inFront && windows.some((window) => window.focused)) {
				return;
			}
			const data: Opening = {
				key: pushed.key,
				url: new URL(pushed.url, scope.registration.scope).href,
			};
			await scope.registration.showNotification(pushed.title, {
				body: pushed.body,
				// One per row: a newer one replaces what it said before.
				tag: pushed.key,
				data,
			});
		})(),
	);
});
