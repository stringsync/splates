/**
 * The page's service worker, which exists only to show notifications: a
 * phone's browser shows one only through a worker's registration. It caches
 * nothing, since the page is only of use live.
 *
 * Clicking a notification focuses a window on the row's project and tells it
 * which row to open, or, with none on that project, opens one at the row's
 * address.
 */

/** What a notification carries for its click, as `Notifier.show` sets it. */
export interface Opening {
	/** The row's key, which the page looks up among its rows. */
	key: string;
	/** The page's address with the row open, for when no window is. */
	url: string;
}

/** The message a window gets when one of its notifications is clicked. */
export interface Opened {
	type: "arbor:open";
	key: string;
}

/** The little of a service worker's scope this uses, which the DOM lib leaves out. */
interface WorkerScope {
	skipWaiting(): Promise<void>;
	clients: {
		claim(): Promise<void>;
		matchAll(options: {
			type: "window";
			includeUncontrolled: boolean;
		}): Promise<
			{
				url: string;
				focus(): Promise<unknown>;
				postMessage(message: Opened): void;
			}[]
		>;
		openWindow(url: string): Promise<unknown>;
	};
	addEventListener(type: "install", listener: () => void): void;
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
			const project = new URL(opening.url).search;
			const open = (
				await scope.clients.matchAll({
					type: "window",
					includeUncontrolled: true,
				})
			).find((window) => new URL(window.url).search === project);
			if (open === undefined) {
				await scope.clients.openWindow(opening.url);
				return;
			}
			open.postMessage({ type: "arbor:open", key: opening.key });
			await open.focus();
		})(),
	);
});
