import { Field, FieldLabel } from "#web/components/ui/field.tsx";
import { Switch } from "#web/components/ui/switch.tsx";
import { syncPush } from "./push";
import type { Settings } from "./settings";
import type { BrowserSteps } from "./setup-journey";
import type { StepBodies } from "./setup-steps";

/** The notice page: both switches start on, as the settings do. */
export const NOTIFY_STEPS: StepBodies = {
	"notifications-notices": ({ step }) => (
		<>
			{step.fields.map((field) => (
				<Field key={field.name} orientation="horizontal">
					<Switch id={field.name} name={field.name} defaultChecked />
					<FieldLabel htmlFor={field.name}>{field.label}</FieldLabel>
				</Field>
			))}
		</>
	),
};

/**
 * What the notification pages do in this browser before the server is
 * asked: turn "Notify me" on, which asks the browser for permission, and
 * keep which notices are wanted, each time telling the server by pushing
 * this device's subscription, which the server's check reads.
 */
export function notifyBrowserSteps(settings: Settings): BrowserSteps {
	return {
		"notifications-device": async () => {
			if (!(await settings.set("notifications.on", true))) {
				throw new Error(
					"The browser did not allow notifications: allow them in its site settings, then try again.",
				);
			}
			await subscribed(settings);
		},
		"notifications-notices": async (answers) => {
			await settings.set("notifications.waiting", answers.waiting === true);
			await settings.set("notifications.finished", answers.finished === true);
			await subscribed(settings);
		},
	};
}

/** Subscribes this device to the server's pushes, or says it cannot be. */
async function subscribed(settings: Settings): Promise<void> {
	if (!(await syncPush(settings))) {
		throw new Error(
			"This browser could not subscribe to pushes: on a phone, add the page to the home screen first, then try again.",
		);
	}
}
