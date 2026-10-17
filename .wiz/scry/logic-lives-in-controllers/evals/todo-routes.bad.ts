import { Hono } from "hono";
import { db } from "./db";

export const app = new Hono();

app.get("/todos/overdue", async (c) => {
	const rows = await db.query("select * from todos where done = false");
	const now = Date.now();
	const overdue = rows
		.filter((row) => row.due !== null && row.due < now)
		.sort((left, right) => left.due - right.due);
	if (overdue.length === 0) {
		return c.json({ overdue: [], message: "All caught up" });
	}
	return c.json({ overdue, oldest: overdue[0].id });
});
