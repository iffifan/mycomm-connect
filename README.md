# @mycomm/connect

A drop-in widget that lets the people using your product pair their Android phone and connect its SIM to
[MyComm](https://mycomm.cogneer.tech), without leaving your app and without a MyComm login. Built for partners
whose tenants each bring their own phone.

The widget shows MyComm's hosted connect page in a popup (default) or inline, and tells your page how it ended.
It never sees an API key: your server creates a short-lived **connect session** and gives the browser only its
URL.

## 1. Create a connect session on your server

With the PHP SDK, acting as the tenant's managed account:

```php
$session = $mycomm->forAccount($tenant->mycomm_account_id)->connectSessions->create(
    return_url: 'https://app.example.com/settings/sms',
    allowed_origins: ['https://app.example.com'],
);

// Hand $session->url to the page. It works once per tenant session, for 30 minutes by default.
```

Or with any HTTP client: `POST /v1/connect-sessions` with your key (and `MyComm-Account` for a partner key).
`allowed_origins` must list the origin of the page that shows the widget: the hosted page reports back only to
those origins, and only they may frame it.

## 2. Show the widget

```bash
npm install @mycomm/connect
```

```js
import '@mycomm/connect';
```

```html
<mycomm-connect url="https://mycomm.cogneer.tech/connect/k3J…"></mycomm-connect>
```

Without a bundler, load an exact version with its integrity hash (printed by the build and listed in the
[changelog](CHANGELOG.md) and on each release):

```html
<!-- as a module: import "@mycomm/connect" semantics, the element registers itself -->
<script type="module" src="https://cdn.jsdelivr.net/npm/@mycomm/connect@1.0.0/dist/mycomm-connect.min.js"
        integrity="sha384-RnjF+Gn70M3rRVDW52U1GrcAatKnWRl8XGW1k3s5KKY8a4NIkV1+0Mo3/bFpLOjv" crossorigin="anonymous"></script>

<!-- as a classic script: also sets window.MyCommConnect.open() -->
<script src="https://cdn.jsdelivr.net/npm/@mycomm/connect@1.0.0/dist/mycomm-connect.iife.min.js"
        integrity="sha384-Y7JqAI9m3TXZQgCgvUrmxDUTKmoGTWrvfMvXYNB/C+8/9ce0+fRRV7ylmhmDAK/k" crossorigin="anonymous"></script>
```

| Attribute | |
|---|---|
| `url` | The session URL from step 1. Required; without it the element reports a `missing-url` error. |
| `mode` | `popup` (default): a button that opens the flow in a popup. `inline`: the flow in an iframe on your page. |
| `label` | Button text in popup mode. Default "Connect your phone". |
| `height` | Iframe height in pixels in inline mode. Default 640. |
| `timeout` | Minutes after which an unfinished flow ends in a `timeout` error. Default: no limit. |

Changing `url` or `mode`, or removing the element, abandons a flow in progress: the popup is closed and nothing is reported
for the old link.

## 3. Listen for the outcome

Every flow ends in exactly one of these:

| Event | Detail | When |
|---|---|---|
| `mycomm-connect:completed` | `{sessionId, deviceId, channelId}` | The phone is paired and its SIM connected |
| `mycomm-connect:ended` | `{sessionId, reason}` | The link cannot be used: `expired`, `revoked`, `completed_elsewhere` (or `unknown` for a reason newer than this version) |
| `mycomm-connect:cancelled` | | The person cancelled |
| `mycomm-connect:closed` | | The popup was closed before any outcome |
| `mycomm-connect:error` | `{code, message}` | The flow could not start or finish. `code` is `missing-url`, `invalid-url`, `blocked-popup`, `invalid-option` or `timeout` |

```js
const widget = document.querySelector('mycomm-connect');

widget.addEventListener('mycomm-connect:completed', (event) => {
  const { sessionId, deviceId, channelId } = event.detail;
  // The phone is paired and its number verified. Confirm on your server:
  // GET /v1/connect-sessions/{sessionId} reads "completed".
});
widget.addEventListener('mycomm-connect:ended', (event) => { /* ask your server for a new session */ });
widget.addEventListener('mycomm-connect:cancelled', () => { /* the person cancelled */ });
widget.addEventListener('mycomm-connect:closed', () => { /* the popup was closed before the end */ });
widget.addEventListener('mycomm-connect:error', (event) => {
  console.error(event.detail.code, event.detail.message);
});
```

Treat these events as a signal to refresh, not as proof: confirm on your server with
`GET /v1/connect-sessions/{id}`, or with the `device.paired` and `channel.connected` webhooks.

Or without an element (call it from a click handler, so the browser allows the popup):

```js
import { open, MyCommConnectError } from '@mycomm/connect';

button.addEventListener('click', async () => {
  try {
    const outcome = await open(sessionUrl, { timeout: 30 });   // { status: 'completed' | 'ended' | 'cancelled' | 'closed', ... }
  } catch (error) {
    if (error instanceof MyCommConnectError) {
      console.error(error.code, error.message);
    }
  }
});
```

`open()` resolves with the outcome (`ended`, `cancelled` and `closed` are outcomes, not failures) and rejects with a
`MyCommConnectError` only when the flow cannot start or times out. It checks its options first and throws
`invalid-option` before it touches the page.

| Option | |
|---|---|
| `mode` | `'popup'` (default) or `'inline'` |
| `container` | An element for an inline frame; `document.body` by default |
| `height` | Inline frame height in pixels (default 640) |
| `timeout` | Minutes until the flow ends in a `timeout` error |

### TypeScript

Types are included. `ConnectOutcome` is a union you can `switch` on by `status`, and the event names are typed on
`HTMLElementEventMap`, so `event.detail` is typed in `addEventListener('mycomm-connect:completed', ...)`.

### React

```jsx
import '@mycomm/connect';
import { useEffect, useRef } from 'react';

export function ConnectPhone({ sessionUrl, onDone }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const done = (event) => onDone(event.type.split(':')[1], event.detail);
    const names = ['completed', 'ended', 'cancelled', 'closed', 'error'].map((name) => `mycomm-connect:${name}`);
    names.forEach((name) => el.addEventListener(name, done));
    return () => names.forEach((name) => el.removeEventListener(name, done));
  }, [onDone]);

  return <mycomm-connect ref={ref} url={sessionUrl} />;
}
```

### Livewire and Blade

```blade
<mycomm-connect url="{{ $sessionUrl }}"
                x-on:mycomm-connect:completed="$wire.phoneConnected($event.detail.sessionId)"></mycomm-connect>
```

Create `$sessionUrl` per visit on the server (step 1) and never cache or log it.

## Browser support and your Content-Security-Policy

Chrome 86+, Safari 14+ and Firefox 78+ (custom elements, shadow DOM, `postMessage`). If your page sets a
Content-Security-Policy:

| Directive | Needs | For |
|---|---|---|
| `frame-src https://mycomm.cogneer.tech` | inline mode | the iframe |
| `script-src https://cdn.jsdelivr.net` | CDN use only | the script tag (not needed with a bundler) |

A popup needs no directive. The widget makes no network requests of its own and loads no fonts or images.

## Styling

The button and frame are in a shadow root. Style them with `::part(button)`, `::part(frame)` and
`::part(fallback)`, or the custom properties `--mycomm-connect-background`, `--mycomm-connect-color`,
`--mycomm-connect-radius` and `--mycomm-connect-padding`.

## Popup or inline?

Popup works everywhere. Inline needs the browser to keep MyComm's cookie inside a cross-site frame, which
browsers that block third-party cookies allow only as a partitioned cookie; when they block even that, the
hosted page asks for a popup and the widget opens one. A "Trouble? Open in a new window" link sits under the
frame for the same reason.

## Security

- The session URL must be `https://…/connect/<token>` (no user info). `http://localhost` links work only in a build made with
  `MYCOMM_CONNECT_DEV=1`; the published bundles refuse them.
- The iframe has no `sandbox` attribute: the hosted page needs its cookies, `postMessage` and top-level navigation to pair a
  phone, and a sandbox that allows them adds nothing. What protects you is that the widget accepts messages only from the
  session URL's origin and only from the window it opened.
- Messages are accepted only from the session URL's origin and from the popup or frame the widget opened, and
  only with the documented types.
- The session URL is a credential for one tenant: create it per visit, do not log it, do not put it in a URL
  of your own.

## Development

`./dev npm install`, then `./dev check` (types, a TypeScript consumer snippet, tests, build). Everything runs in a Node
container. `./dev build` prints the SRI hash of each bundle; paste them into the changelog when you release.

## License

MIT
