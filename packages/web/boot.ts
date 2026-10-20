// The page's entry, which only starts the app. The app and every page loaded on
// demand import what they share from each other by content-hashed name, which
// they could not from an entry file the shell asks for under a `?v=` of its
// own: the browser would run it twice.
await import("./main.tsx");
