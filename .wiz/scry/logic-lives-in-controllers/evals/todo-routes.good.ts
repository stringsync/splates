import { Hono } from "hono";
import type { TodoService } from "./todo-service";

export function todoRoutes(todos: TodoService): Hono {
	const app = new Hono();
	app.get("/todos/overdue", async (c) => c.json(await todos.overdue()));
	app.post("/todos/:id/done", async (c) => c.json(await todos.finish(c.req.param("id"))));
	return app;
}
