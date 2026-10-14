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

Without a bundler, load an exact version with its integrity hash (listed on each release):

```html
<script type="module" src="https://cdn.jsdelivr.net/npm/@mycomm/connect@0.1.0/dist/mycomm-connect.min.js"
        integrity="sha384-…" crossorigin="anonymous"></script>
```

| Attribute | |
|---|---|
| `url` | The session URL from step 1. Required. |
| `mode` | `popup` (default): a button that opens the flow in a popup. `inline`: the flow in an iframe on your page. |
| `label` | Button text in popup mode. Default "Connect your phone". |
| `height` | Iframe height in pixels in inline mode. Default 640. |

## 3. Listen for the outcome

```js
const widget = document.querySelector('mycomm-connect');

widget.addEventListener('mycomm-connect:completed', (event) => {
  const { sessionId, deviceId, channelId } = event.detail;
  // The phone is paired and its number verified. Confirm on your server:
  // GET /v1/connect-sessions/{sessionId} reads "completed".
});
widget.addEventListener('mycomm-connect:cancelled', () => { /* the person cancelled */ });
widget.addEventListener('mycomm-connect:closed', () => { /* the popup was closed before the end */ });
widget.addEventListener('mycomm-connect:error', (event) => {
  // event.detail.reason: "blocked-popup" or "invalid-url"
});
```

Treat these events as a signal to refresh, not as proof: confirm on your server with
`GET /v1/connect-sessions/{id}`, or with the `device.paired` and `channel.connected` webhooks.

Or without an element (call it from a click handler, so the browser allows the popup):

```js
import { open } from '@mycomm/connect';

button.addEventListener('click', async () => {
  const result = await open(sessionUrl);       // { status: 'completed' | 'cancelled' | 'closed', ... }
});
```

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

- Messages are accepted only from the session URL's origin and from the popup or frame the widget opened, and
  only with the documented types.
- The session URL is a credential for one tenant: create it per visit, do not log it, do not put it in a URL
  of your own.

## Development

`./dev npm install`, then `./dev check` (types, tests, build). Everything runs in a Node container.

## License

MIT
