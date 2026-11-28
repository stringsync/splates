import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { useState } from "react";
import { type Category, Settings } from "./settings";
import { SettingsPage } from "./settings-page";
import { cleanup, fireEvent, render, within } from "./testing";

describe("SettingsPage", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		cleanup();
	});

	it("renders a desktop sidebar with Back, grouped categories, and visual Light/System/Dark theme cards", () => {
		const settings = new Settings(localStorage);
		let closed = 0;
		let welcomed = 0;
		const view = render(
			<OpenedSettings
				settings={settings}
				wide={true}
				onClose={() => {
					closed += 1;
				}}
				onWelcome={() => {
					welcomed += 1;
				}}
			/>,
		);

		const theme = view.getByRole("group", { name: "Theme" });
		expect(
			within(theme)
				.getAllByRole("radio")
				.map((radio) => (radio as HTMLInputElement).value),
		).toEqual(["light", "system", "dark"]);
		expect(within(theme).getByRole("radio", { name: "System" })).toHaveProperty(
			"checked",
			true,
		);

		fireEvent.click(within(theme).getByRole("radio", { name: "Light" }));
		expect(settings.get("appearance.theme")).toBe("light");

		fireEvent.click(view.getByRole("button", { name: "Welcome page" }));
		expect(closed).toBe(1);
		expect(welcomed).toBe(1);

		fireEvent.click(view.getByRole("button", { name: "Back" }));
		expect(closed).toBe(2);
	});

	it("renders a grouped category index on phones and drills into sections with Settings back navigation", () => {
		const settings = new Settings(localStorage);
		let closed = 0;
		const view = render(
			<OpenedSettings
				settings={settings}
				wide={false}
				onClose={() => {
					closed += 1;
				}}
			/>,
		);

		// Starts on the grouped index rather than a section.
		expect(view.queryByRole("group", { name: "Theme" })).toBeNull();
		expect(view.getByText("General")).toBeTruthy();
		expect(view.getByText("Workspace")).toBeTruthy();

		// Tapping a category drills into its section with < Settings back nav.
		fireEvent.click(view.getByRole("button", { name: "Appearance" }));
		expect(view.getByRole("group", { name: "Theme" })).toBeTruthy();
		expect(view.getByRole("button", { name: "Settings" })).toBeTruthy();

		// Tapping < Settings returns to the index; < Back leaves Settings.
		fireEvent.click(view.getByRole("button", { name: "Settings" }));
		expect(view.queryByRole("group", { name: "Theme" })).toBeNull();
		fireEvent.click(view.getByRole("button", { name: "Back" }));
		expect(closed).toBe(1);
	});

	it("filters settings inline while searching on phones", () => {
		const settings = new Settings(localStorage);
		const view = render(<OpenedSettings settings={settings} wide={false} />);

		fireEvent.change(view.getByRole("searchbox", { name: "Search settings" }), {
			target: { value: "theme" },
		});
		expect(view.getByRole("group", { name: "Theme" })).toBeTruthy();

		fireEvent.change(view.getByRole("searchbox", { name: "Search settings" }), {
			target: { value: "" },
		});
		expect(view.queryByRole("group", { name: "Theme" })).toBeNull();
	});
});

function OpenedSettings({
	settings,
	wide,
	onClose = () => {},
	onWelcome = () => {},
}: {
	settings: Settings;
	wide: boolean;
	onClose?: () => void;
	onWelcome?: () => void;
}) {
	const [picked, setPicked] = useState<Category>("Appearance");
	return (
		<SettingsPage
			settings={settings}
			wide={wide}
			picked={picked}
			onPick={setPicked}
			onClose={onClose}
			onWelcome={onWelcome}
			project="mono"
		/>
	);
}
