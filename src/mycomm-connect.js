// @mycomm/connect: lets a person pair their phone and connect its SIM to MyComm from your page.
//
// Your server creates a connect session (POST /v1/connect-sessions) and hands its `url` to the browser. The widget
// opens that URL in a popup (default) or an inline iframe and tells your page how it ended. It never sees an API key.
//
// Every flow ends in exactly one outcome: `completed`, `ended` (the link expired, was revoked or was used elsewhere),
// `cancelled`, `closed` (the popup was closed without an outcome) or `error` (it could not start, or timed out).

const VERSION = '0.2.0';

/**
 * Whether the build accepts http://localhost session links. The published bundles are built without it
 * (`MYCOMM_CONNECT_DEV=1 npm run build` keeps it); the source and the tests keep it.
 */
const ALLOW_LOCAL = typeof __MYCOMM_CONNECT_DEV__ === 'undefined' ? true : __MYCOMM_CONNECT_DEV__;

/** Message types the hosted page posts, and the widget events they become. */
const OUTCOMES = /** @type {const} */ ({
  'mycomm.connect.completed': 'completed',
  'mycomm.connect.cancelled': 'cancelled',
  'mycomm.connect.ended': 'ended',
});

/** Why a session ended without being completed here. Anything else the page might send reads as `unknown`. */
const END_REASONS = ['expired', 'revoked', 'completed_elsewhere'];

/** The hosted page asks for this when it cannot keep its session inside an iframe. */
const NEEDS_POPUP = 'mycomm.connect.needs-popup';

const POPUP_WIDTH = 480;
const POPUP_HEIGHT = 720;
const CLOSED_POLL_MS = 500;

const ERROR_MESSAGES = {
  'missing-url': 'No session URL was given. Create a connect session on your server and pass its url.',
  'invalid-url': 'The session URL is not a MyComm connect link (https, path /connect/<token>).',
  'blocked-popup': 'The browser blocked the popup. Open the flow from a click.',
  'invalid-option': 'An option is not valid.',
  timeout: 'The flow was not finished in time.',
};

/** Why a flow could not start or finish. `code` is one of `missing-url`, `invalid-url`, `blocked-popup`, `invalid-option` and `timeout`. */
export class MyCommConnectError extends Error {
  /**
   * @param {keyof typeof ERROR_MESSAGES} code
   * @param {string} [message]
   */
  constructor(code, message) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = 'MyCommConnectError';
    this.code = code;
  }
}

/**
 * The origin of a session URL, or null when it is not one: absolute, https (http only for localhost in a dev build), path /connect/….
 *
 * @param {string | null | undefined} url
 * @returns {string | null}
 */
export function sessionOrigin(url) {
  if (typeof url !== 'string' || url === '') {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const local = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
  if (parsed.protocol !== 'https:' && !(ALLOW_LOCAL && parsed.protocol === 'http:' && local)) {
    return null;
  }
  if (!/^\/connect\/[A-Za-z0-9_-]{20,}$/.test(parsed.pathname) || parsed.username !== '' || parsed.password !== '') {
    return null;
  }

  return parsed.origin;
}

/**
 * Reads a message from the hosted page: only from its origin and its window, and only documented types.
 *
 * @param {MessageEvent} event
 * @param {string} origin
 * @param {Window | null} source
 * @returns {{kind: 'completed' | 'cancelled', detail: {sessionId: string | null, deviceId: string | null, channelId: string | null}}
 *   | {kind: 'ended', detail: {sessionId: string | null, reason: 'expired' | 'revoked' | 'completed_elsewhere' | 'unknown'}}
 *   | {kind: 'needs-popup'} | null}
 */
export function readMessage(event, origin, source) {
  if (event.origin !== origin || source === null || event.source !== source) {
    return null;
  }
  const data = event.data;
  if (data === null || typeof data !== 'object' || typeof data.type !== 'string') {
    return null;
  }
  if (data.type === NEEDS_POPUP) {
    return { kind: 'needs-popup' };
  }
  const kind = OUTCOMES[/** @type {keyof typeof OUTCOMES} */ (data.type)];
  if (kind === undefined) {
    return null;
  }
  const text = (/** @type {unknown} */ value) => (typeof value === 'string' && value.length <= 64 ? value : null);

  if (kind === 'ended') {
    const reason = END_REASONS.includes(data.reason) ? data.reason : 'unknown';

    return { kind, detail: { sessionId: text(data.session_id), reason } };
  }

  return {
    kind,
    detail: { sessionId: text(data.session_id), deviceId: text(data.device_id), channelId: text(data.channel_id) },
  };
}

/**
 * Opens the session in a popup centred over the current window; null when the browser blocked it.
 *
 * @param {string} url
 * @returns {Window | null}
 */
function openPopup(url) {
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - POPUP_WIDTH) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2));
  // No `noopener`: the hosted page reports back through window.opener.
  return window.open(url, 'mycomm-connect', `popup,width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top}`);
}

const STYLE = `
  :host { display: block; font: inherit; }
  :host([hidden]) { display: none; }
  button {
    font: inherit; cursor: pointer; border: 0; border-radius: var(--mycomm-connect-radius, 8px);
    padding: var(--mycomm-connect-padding, 0.7em 1.2em);
    background: var(--mycomm-connect-background, #0f766e); color: var(--mycomm-connect-color, #fff);
  }
  button:disabled { cursor: default; opacity: 0.6; }
  button:focus-visible { outline: 2px solid var(--mycomm-connect-background, #0f766e); outline-offset: 2px; }
  iframe { display: block; width: 100%; border: 0; border-radius: var(--mycomm-connect-radius, 8px); }
  p { margin: 0.5em 0 0; font-size: 0.875em; }
  a { color: inherit; }
`;

/**
 * `<mycomm-connect url="…" mode="popup|inline" label="…" height="640" timeout="30">`
 *
 * Fires one of `mycomm-connect:completed` (detail {sessionId, deviceId, channelId}), `mycomm-connect:ended`
 * (detail {sessionId, reason}), `mycomm-connect:cancelled`, `mycomm-connect:closed` or `mycomm-connect:error`
 * (detail {code, message}) when a flow ends. Changing `url` or `mode`, or removing the element, abandons a flow in progress.
 */
export class MyCommConnectElement extends HTMLElement {
  static observedAttributes = ['url', 'mode', 'label', 'height', 'timeout'];

  /** @type {Window | null} */
  #popup = null;

  /** @type {ReturnType<typeof setInterval> | null} */
  #closedTimer = null;

  /** @type {ReturnType<typeof setTimeout> | null} */
  #deadline = null;

  /** @type {HTMLIFrameElement | null} */
  #frame = null;

  #finished = false;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.onMessage = this.onMessage.bind(this);
  }

  connectedCallback() {
    window.addEventListener('message', this.onMessage);
    this.render();
  }

  disconnectedCallback() {
    window.removeEventListener('message', this.onMessage);
    this.reset();
  }

  /**
   * @param {string} name
   * @param {string | null} before
   * @param {string | null} after
   */
  attributeChangedCallback(name, before, after) {
    if (before === after || !this.isConnected) {
      return;
    }
    if (name === 'url' || name === 'mode') {
      // A flow for the old link must not report for the new one.
      this.reset();
    }
    this.render();
  }

  get url() {
    return this.getAttribute('url') ?? '';
  }

  get mode() {
    return this.getAttribute('mode') === 'inline' ? 'inline' : 'popup';
  }

  /** Minutes after which an unfinished flow ends in a `timeout` error; 0 for no limit. */
  get timeout() {
    const value = Number(this.getAttribute('timeout'));

    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  /** Opens the flow in a popup, as a click on the button does. */
  open() {
    const url = this.url;
    if (url === '') {
      this.fail('missing-url');
      return;
    }
    if (sessionOrigin(url) === null) {
      this.fail('invalid-url');
      return;
    }
    if (this.#popup !== null && !this.#popup.closed) {
      this.#popup.focus();
      return;
    }
    this.#finished = false;
    this.#popup = openPopup(url);
    if (this.#popup === null) {
      this.fail('blocked-popup');
      return;
    }
    this.stopWatching();
    this.#closedTimer = setInterval(() => {
      if (this.#popup === null || this.#popup.closed) {
        this.stopWatching();
        this.#popup = null;
        if (!this.#finished) {
          this.finish('closed', {});
        }
      }
    }, CLOSED_POLL_MS);
    this.startDeadline();
  }

  /** @param {MessageEvent} event */
  onMessage(event) {
    const origin = sessionOrigin(this.url);
    if (origin === null || this.#finished) {
      return;
    }
    const source = this.#popup ?? this.#frame?.contentWindow ?? null;
    const message = readMessage(event, origin, source);
    if (message === null) {
      return;
    }
    if (message.kind === 'needs-popup') {
      this.open();
      return;
    }
    this.finish(message.kind, message.detail);
  }

  /**
   * Ends the flow with one outcome; later messages from the page are ignored.
   *
   * @param {string} name
   * @param {object} detail
   */
  finish(name, detail) {
    this.#finished = true;
    this.stopWatching();
    if (this.#popup !== null && !this.#popup.closed) {
      this.#popup.close();
    }
    this.#popup = null;
    this.emit(name, detail);
  }

  /** @param {keyof typeof ERROR_MESSAGES} code */
  fail(code) {
    this.finish('error', { code, message: ERROR_MESSAGES[code] });
  }

  /**
   * @param {string} name
   * @param {object} detail
   */
  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(`mycomm-connect:${name}`, { detail, bubbles: true, composed: true }));
  }

  startDeadline() {
    this.clearDeadline();
    if (this.timeout > 0) {
      this.#deadline = setTimeout(() => {
        if (!this.#finished) {
          this.fail('timeout');
        }
      }, this.timeout * 60_000);
    }
  }

  clearDeadline() {
    if (this.#deadline !== null) {
      clearTimeout(this.#deadline);
      this.#deadline = null;
    }
  }

  stopWatching() {
    if (this.#closedTimer !== null) {
      clearInterval(this.#closedTimer);
      this.#closedTimer = null;
    }
    this.clearDeadline();
  }

  /** Abandons a flow in progress without reporting it: closes the popup, stops the timers. */
  reset() {
    this.stopWatching();
    if (this.#popup !== null && !this.#popup.closed) {
      this.#popup.close();
    }
    this.#popup = null;
    this.#finished = false;
  }

  render() {
    const root = /** @type {ShadowRoot} */ (this.shadowRoot);
    const valid = sessionOrigin(this.url) !== null;
    const style = document.createElement('style');
    style.textContent = STYLE;
    root.replaceChildren(style);
    this.#frame = null;

    if (this.mode === 'inline' && valid) {
      const frame = document.createElement('iframe');
      frame.setAttribute('part', 'frame');
      frame.title = 'Connect your phone';
      frame.src = this.url;
      frame.referrerPolicy = 'no-referrer';
      frame.style.height = /^\d+$/.test(this.getAttribute('height') ?? '') ? `${this.getAttribute('height')}px` : '640px';
      this.#frame = frame;
      this.#finished = false;
      this.startDeadline();

      // When the browser keeps no cookies inside the frame, a new window always works.
      const fallback = document.createElement('p');
      fallback.setAttribute('part', 'fallback');
      const link = document.createElement('a');
      link.href = this.url;
      link.textContent = 'Trouble? Open in a new window';
      link.addEventListener('click', (event) => {
        event.preventDefault();
        this.open();
      });
      fallback.append(link);
      root.append(frame, fallback);
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('part', 'button');
    button.textContent = this.getAttribute('label') || 'Connect your phone';
    button.disabled = !valid;
    button.addEventListener('click', () => this.open());
    root.append(button);
    if (!valid) {
      // A page that sets the link right after creating the element is not an error: report what is still wrong a moment later.
      queueMicrotask(() => {
        if (this.isConnected && !this.#finished && sessionOrigin(this.url) === null) {
          this.fail(this.url === '' ? 'missing-url' : 'invalid-url');
        }
      });
    }
  }
}

/**
 * Throws a `MyCommConnectError` for an option that cannot work, before anything is added to the page.
 *
 * @param {unknown} url
 * @param {{mode?: unknown, container?: unknown, height?: unknown, timeout?: unknown}} options
 */
function checkOptions(url, options) {
  if (typeof url !== 'string' || url === '') {
    throw new MyCommConnectError('missing-url');
  }
  if (sessionOrigin(url) === null) {
    throw new MyCommConnectError('invalid-url');
  }
  if (options.mode !== undefined && options.mode !== 'popup' && options.mode !== 'inline') {
    throw new MyCommConnectError('invalid-option', `mode must be 'popup' or 'inline' (got ${JSON.stringify(options.mode)}).`);
  }
  if (options.container !== undefined && !(options.container instanceof HTMLElement)) {
    throw new MyCommConnectError('invalid-option', 'container must be an HTML element.');
  }
  if (options.height !== undefined && !(Number.isInteger(options.height) && /** @type {number} */ (options.height) > 0)) {
    throw new MyCommConnectError('invalid-option', 'height must be a whole number of pixels.');
  }
  if (options.timeout !== undefined && !(typeof options.timeout === 'number' && options.timeout > 0)) {
    throw new MyCommConnectError('invalid-option', 'timeout must be a number of minutes above zero.');
  }
}

/**
 * Opens a session without placing an element yourself. Resolves with how it ended (`completed`, `ended`, `cancelled` or
 * `closed`) and rejects with a `MyCommConnectError` only when it cannot start or times out.
 *
 * @param {string} url
 * @param {{mode?: 'popup' | 'inline', container?: HTMLElement, height?: number, timeout?: number}} [options]
 * @returns {Promise<{status: 'completed', sessionId: string | null, deviceId: string | null, channelId: string | null}
 *   | {status: 'ended', sessionId: string | null, reason: 'expired' | 'revoked' | 'completed_elsewhere' | 'unknown'}
 *   | {status: 'cancelled'} | {status: 'closed'}>}
 */
export function open(url, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      checkOptions(url, options);
    } catch (error) {
      reject(error);
      return;
    }

    const element = /** @type {MyCommConnectElement} */ (document.createElement('mycomm-connect'));
    element.setAttribute('url', url);
    element.setAttribute('mode', options.mode ?? 'popup');
    if (options.height !== undefined) {
      element.setAttribute('height', String(options.height));
    }
    if (options.timeout !== undefined) {
      element.setAttribute('timeout', String(options.timeout));
    }
    if (options.mode !== 'inline') {
      element.hidden = true;
    }

    const done = (/** @type {() => void} */ settle) => {
      settle();
      element.remove();
    };
    element.addEventListener('mycomm-connect:completed', (event) =>
      done(() => resolve({ status: 'completed', .../** @type {CustomEvent} */ (event).detail })));
    element.addEventListener('mycomm-connect:ended', (event) =>
      done(() => resolve({ status: 'ended', .../** @type {CustomEvent} */ (event).detail })));
    element.addEventListener('mycomm-connect:cancelled', () => done(() => resolve({ status: 'cancelled' })));
    element.addEventListener('mycomm-connect:closed', () => done(() => resolve({ status: 'closed' })));
    element.addEventListener('mycomm-connect:error', (event) => {
      const { code, message } = /** @type {CustomEvent} */ (event).detail;
      done(() => reject(new MyCommConnectError(code, message)));
    });

    (options.container ?? document.body).append(element);
    if (options.mode !== 'inline') {
      element.open();
    }
  });
}

if (typeof customElements !== 'undefined' && customElements.get('mycomm-connect') === undefined) {
  customElements.define('mycomm-connect', MyCommConnectElement);
}

export const MyCommConnect = { open, version: VERSION, MyCommConnectError };
export default MyCommConnect;
