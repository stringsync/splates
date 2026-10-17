---
version: 0.0.46
---
# Logic lives in controllers

A program does not care whether React, a web server or a CLI drives it.
Keep it that way: the logic, the meaningful state and the decisions live in
a controller, a plain class that bridges the program and the framework, and
the framework's code only translates. A controller is a role, not a name:
it may be a `FavoritesController`, a `TodoService` or a `Prune` program,
whatever suits the codebase and the framework. The test: everything but the
framework's code works, and can be tested, with plain calls. If something
can only be exercised by rendering a component, sending a request or
running a command, the framework is holding logic.

In React that makes four layers: the program, a controller, a thin hook,
and a component. Say people can save scores as favorites:

```tsx
// The program: favorites as the API stores them. It knows nothing of React.
interface FavoriteStore {
	list(): Promise<readonly string[]>;
	set(scoreId: string, saved: boolean): Promise<void>;
}

// The controller: what the screen needs to know, and what each control does.
// It holds whether each score is saved, whether a change is pending and why
// one failed, and undoes a toggle the store refused.
class FavoritesController implements Eventful<{ changed: undefined }> {
	constructor(store: FavoriteStore, savedIds: readonly string[]);
	state(scoreId: string): FavoriteState;
	toggle(scoreId: string): Promise<void>;
}

// The hook: reads one score's state, and decides nothing.
function useFavorite(favorites: FavoritesController, scoreId: string) {
	return useReactive(favorites, (each) => each.state(scoreId), ["changed"]);
}

// The component: shows that state, and calls one method per control.
function FavoriteToggle({ favorites, scoreId }: FavoriteToggleProps) {
	const { saved, pending, error } = useFavorite(favorites, scoreId);
	return (
		<button disabled={pending} title={error} onClick={() => favorites.toggle(scoreId)}>
			{saved ? "Saved" : "Save"}
		</button>
	);
}
```

The pending flag, the error and the rollback are the bridge. The store has
no use for them, and a component that kept them in `useState` could only be
tested by rendering it. In the controller, a test calls `toggle` against a
fake store and reads `state`.

Servers and CLIs work the same way. A Hono or koa route translates the
request into one call on a service with a method per route, and the result
into a response, which keeps the boundary plain and another web server easy
to swap in. So does a handler `Bun.serve` or a Worker calls with a
`Request`. A `webappwiz/cmd` action passes its options to a program.

In the framework's code, these are fine:

- translating input into one call per control, route or command;
- translating results into output: markup, a response, lines on stdout;
- purely visual state nothing else cares about, like whether a menu is open;
- keeping up with the framework itself, like a hook that ties a
  controller's life to a component's mount.

Everything else goes in the controller: a draft and whether it changed,
whether a move is allowed, what a save does next, a query and what is
computed from it. The reverse counts too: a controller that uses a
framework's names, like a service whose methods take koa's `Context`, can
no longer run without that framework.

This rule asks whether decisions and state live in the framework's code at
all. Several pieces of `useState` kept in step by hand are what
reactive-over-use-state reports.

Its cases are in `evals/`: each `.good.` file follows the rule, and each
`.bad.` file breaks it.
