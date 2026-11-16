# core/push

Sends Web Push messages from a server to a browser's service worker, which
shows them even while the page is closed or frozen, as an installed app on a
phone is soon after it leaves the front. Each message is encrypted to its
subscription (RFC 8291) and signed as the server it subscribed to (VAPID,
RFC 8292), on WebCrypto alone.

```ts
import { generateVapidKeys, WebPusher } from "core/push";

const keys = await generateVapidKeys(); // keep them: subscriptions need the same pair
// The page subscribes with `applicationServerKey: keys.publicKey` and sends
// the server `subscription.toJSON()`.
const pusher = new WebPusher(keys, "mailto:you@example.com");
await pusher.push(subscription, JSON.stringify({ title: "Done" }));
```

A push the service refuses throws `PushFailure`, whose `gone` says the
subscription will never work again and should be forgotten.

In a test, `FakePusher` from `core/push/testing` records each push in
`pusher.pushed`, and answers 410 for the endpoints in `pusher.gone`.
