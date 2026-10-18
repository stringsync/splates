# Spinning Plates server

`@stringsync/splates-server` owns the HTTP server and backend operations shared
by the web app and CLI. Its `index.ts` exports `dev`, the server factory;
`start.ts` constructs the machine services used by `splates server`.

`packages/splates` owns command definitions and argument handling. The server
has no dependency on that package. The browser app lives in `packages/web`;
its build writes the assets imported by `assets.ts` into `web-build/` here.

Run `splates dev fix` and `splates dev test` from a checkout to check all packages.
