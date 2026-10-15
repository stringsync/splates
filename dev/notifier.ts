import { Duration, SystemTimer } from "webappwiz/time";
import type { Needing } from "../needs";
import { keyOf, type Notice, Notices, type Wants } from "../notices";
import { openedBy } from "./conversation-address";
import type { Settings } from "./settings";
import type { Opening } from "./worker";

/**
 * Tells the person, with a browser notification and the sound they chose,
 * when an agent comes to wait on them, finishes its turn, or goes quiet, each
 * as `settings` say.
 */
export class Notifier {
	private readonly notices = new Notices();

	constructor(private readonly settings: Settings) {}

	/** What changed in `rows` since the last look, of the kinds the settings ask for (see `Notices.look`). */
	look(rows: Needing[], name: (row: Needing) => string, now: number): Notice[] {
		return this.notices.look(rows, name, now, wantsOf(this.settings));
	}

	/**
	 * Shows `notices` as browser notifications, while on and, unless the
	 * settings say otherwise, the page is not in front of the person; with a
	 * sound once when it is on. Each goes through the page's service worker
	 * where one is registered, since a phone shows them no other way, and its
	 * click comes back as a message `useNotifier` opens the row for; without
	 * one, as a plain notification, opening its row with `open` when clicked.
	 * When `pushed`, the server's pushes show them, so this only chimes.
	 */
	show(notices: Notice[], open: (row: Needing) => void, pushed = false): void {
		if (
			notices.length === 0 ||
			!this.settings.get("notifications.on") ||
			(document.hasFocus() && !this.settings.get("notifications.inFront"))
		) {
			return;
		}
		for (const notice of pushed ? [] : notices) {
			post(notice, open);
		}
		if (this.settings.get("notifications.sound")) {
			chime();
		}
	}
}

/**
 * Shows `notice` through the page's service worker, or else on its own,
 * at once where the browser has no workers at all.
 */
function post(notice: Notice, open: (row: Needing) => void): void {
	const workers = navigator.serviceWorker;
	if (workers === undefined) {
		alone(notice, open);
		return;
	}
	void workers.getRegistration().then((registration) => {
		if (registration === undefined) {
			alone(notice, open);
			return;
		}
		const data: Opening = {
			key: keyOf(notice.row),
			url: `${location.origin}${location.pathname}${location.search}#conversations/${openedBy(notice.row)}`,
		};
		return registration.showNotification(notice.title, {
			...optionsOf(notice),
			data,
		});
	});
}

/** Shows `notice` as the page's own notification, opening its row with `open` on a click. */
function alone(notice: Notice, open: (row: Needing) => void): void {
	const shown = new Notification(notice.title, optionsOf(notice));
	shown.onclick = () => {
		window.focus();
		open(notice.row);
		shown.close();
	};
}

function optionsOf(notice: Notice): NotificationOptions {
	return {
		body: notice.body,
		// One per row: a newer one replaces what it said before.
		tag: keyOf(notice.row),
	};
}

/** Which notices `settings` ask for. */
export function wantsOf(settings: Settings): Wants {
	return {
		waiting: settings.get("notifications.waiting"),
		finished: settings.get("notifications.finished"),
		quiet: settings.get("notifications.quiet"),
		quietAfter: settings.get("notifications.quietAfter"),
	};
}

/** Two short rising tones, made rather than loaded. */
function chime(): void {
	if (typeof AudioContext === "undefined") {
		return;
	}
	const audio = new AudioContext();
	const gain = audio.createGain();
	gain.connect(audio.destination);
	gain.gain.setValueAtTime(0.0001, audio.currentTime);
	for (const [at, pitch] of [
		[0, 660],
		[0.12, 880],
	] as const) {
		const tone = audio.createOscillator();
		tone.frequency.value = pitch;
		tone.connect(gain);
		const start = audio.currentTime + at;
		gain.gain.exponentialRampToValueAtTime(0.15, start + 0.01);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.11);
		tone.start(start);
		tone.stop(start + 0.12);
	}
	new SystemTimer().setTimeout(() => void audio.close(), Duration.ms(500));
}
