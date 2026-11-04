import { afterEach, beforeEach, expect, it } from "bun:test";
import {
	act,
	cleanup,
	fireEvent,
	Testing,
	todo,
	waitFor,
	within,
} from "./testing";

let testing: Testing;
beforeEach(() => {
	(
		window as unknown as { happyDOM: { setURL(url: string): void } }
	).happyDOM.setURL("http://localhost/");
	testing = new Testing();
});
afterEach(() => {
	cleanup();
	testing.dispose();
	history.replaceState(null, "", "/");
});
const boards = [
	{ id: 1, name: "Default", position: 1, archived: false },
	{ id: 2, name: "Product", position: 2, archived: false },
];

it("opens the chooser each time Boards is opened", async () => {
	const view = testing.render({ boards });
	await waitFor(() => view.getByRole("region", { name: "Boards" }));
	expect(view.getAllByRole("heading", { name: "Boards" })).toHaveLength(1);
	await act(async () =>
		fireEvent.click(view.getByRole("button", { name: "Product 0" })),
	);
	await waitFor(() => view.getByRole("navigation", { name: "Breadcrumb" }));
	expect(
		within(view.getByRole("navigation", { name: "Breadcrumb" })).getByText(
			"Product",
		),
	).toBeTruthy();
	await act(async () =>
		fireEvent.click(view.getByRole("tab", { name: "Automations" })),
	);
	await act(async () =>
		fireEvent.click(view.getByRole("tab", { name: "Boards" })),
	);
	await waitFor(() => view.getByRole("region", { name: "Boards" }));
	expect(view.getByRole("button", { name: "Product 0" })).toBeTruthy();
});

it("returns to the chooser if the remembered board is archived", async () => {
	history.replaceState(null, "", "/?board=2");
	const view = testing.render({
		boards: boards.map((board) => ({ ...board, archived: board.id === 2 })),
	});
	await waitFor(() => view.getByRole("region", { name: "Boards" }));
	expect(view.queryByRole("button", { name: "Product 0" })).toBeNull();
});

it("switches away from a populated board without following an unassigned task back to it", async () => {
	const view = testing.render({
		boards,
		lanes: [{ id: 1, name: "Plan", board: 2 }],
		todos: [
			todo({ id: 1, subject: "Unassigned work", lane: 1, takenBy: null }),
		],
	});
	await waitFor(() => view.getByRole("region", { name: "Boards" }));
	await act(async () =>
		fireEvent.click(view.getByRole("button", { name: "Product 1" })),
	);
	await waitFor(() => view.getByRole("button", { name: "Product actions" }));
	await act(async () =>
		fireEvent.click(view.getByRole("button", { name: "Boards" })),
	);
	await waitFor(() => view.getByRole("region", { name: "Boards" }));
	await act(async () =>
		fireEvent.click(view.getByRole("button", { name: "Default 0" })),
	);
	await waitFor(() => view.getByRole("button", { name: "Default actions" }));
	expect(location.search).toBe("?board=1");
});

it("adds a lane to the board being viewed", async () => {
	const view = testing.render({
		boards,
		lanes: [{ id: 1, name: "Plan", board: 2 }],
		todos: [todo({ id: 1, subject: "Work", lane: 1 })],
	});
	await waitFor(() => view.getByRole("region", { name: "Boards" }));
	await act(async () =>
		fireEvent.click(view.getByRole("button", { name: "Product 1" })),
	);
	await act(async () =>
		fireEvent.click(
			await view.findByRole("button", { name: "Add another lane" }),
		),
	);
	await act(async () =>
		fireEvent.change(view.getByRole("textbox", { name: "new lane name" }), {
			target: { value: "Ops" },
		}),
	);
	await act(async () =>
		fireEvent.click(view.getByRole("button", { name: "Add lane" })),
	);
	expect(testing.posts.at(-1)).toMatchObject({
		path: "/api/lanes",
		method: "POST",
		body: JSON.stringify({ name: "Ops", board: 2 }),
	});
});
