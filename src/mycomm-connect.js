// @mycomm/connect: lets a person pair their phone and connect its SIM to MyComm from your page.
//
// Your server creates a connect session (POST /v1/connect-sessions) and hands its `url` to the browser. The widget
// opens that URL in a popup (default) or an inline iframe and tells your page how it ended. It never sees an API key.

const VERSION = '0.1.0';

/** Message types the hosted page posts, and the widget events they become. */
const OUTCOMES = /** @type {const} */ ({
  'mycomm.connect.completed': 'completed',
  'mycomm.connect.cancelled': 'cancelled',
});

/** The hosted page asks for this when it cannot keep its session inside an iframe. */
const NEEDS_POPUP = 'mycomm.connect.needs-popup';

const POPUP_WIDTH = 480;
const POPUP_HEIGHT = 720;
const CLOSED_POLL_MS = 500;

/**
 * The origin of a session URL, or null when it is not one: absolute, https (http only for localhost), path /connect/….
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
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && local)) {
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
 * @returns {{kind: 'completed' | 'cancelled', detail: {sessionId: string | null, deviceId: string | null, channelId: string | null}} | {kind: 'needs-popup'} | null}
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
 * `<mycomm-connect url="…" mode="popup|inline" label="…" height="640">`
 *
 * Fires `mycomm-connect:completed` (detail {sessionId, deviceId, channelId}), `mycomm-connect:cancelled`,
 * `mycomm-connect:closed` and `mycomm-connect:error` (detail {reason}).
 */
export class MyCommConnectElement extends HTMLElement {
  static observedAttributes = ['url', 'mode', 'label', 'height'];

  /** @type {Window | null} */
  #popup = null;

  /** @type {ReturnType<typeof setInterval> | null} */
  #closedTimer = null;

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
    this.stopWatching();
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.render();
    }
  }

  get url() {
    return this.getAttribute('url') ?? '';
  }

  get mode() {
    return this.getAttribute('mode') === 'inline' ? 'inline' : 'popup';
  }

  /** Opens the flow in a popup, as a click on the button does. */
  open() {
    const url = this.url;
    if (sessionOrigin(url) === null) {
      this.emit('error', { reason: 'invalid-url' });
      return;
    }
    if (this.#popup !== null && !this.#popup.closed) {
      this.#popup.focus();
      return;
    }
    this.#finished = false;
    this.#popup = openPopup(url);
    if (this.#popup === null) {
      this.emit('error', { reason: 'blocked-popup' });
      return;
    }
    this.stopWatching();
    this.#closedTimer = setInterval(() => {
      if (this.#popup === null || this.#popup.closed) {
        this.stopWatching();
        this.#popup = null;
        if (!this.#finished) {
          this.emit('closed', {});
        }
      }
    }, CLOSED_POLL_MS);
  }

  /** @param {MessageEvent} event */
  onMessage(event) {
    const origin = sessionOrigin(this.url);
    if (origin === null) {
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
    this.#finished = true;
    if (this.#popup !== null && !this.#popup.closed) {
      this.#popup.close();
    }
    this.emit(message.kind, message.detail);
  }

  /**
   * @param {string} name
   * @param {object} detail
   */
  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(`mycomm-connect:${name}`, { detail, bubbles: true, composed: true }));
  }

  stopWatching() {
    if (this.#closedTimer !== null) {
      clearInterval(this.#closedTimer);
      this.#closedTimer = null;
    }
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
    if (!valid && this.url !== '') {
      queueMicrotask(() => this.emit('error', { reason: 'invalid-url' }));
    }
  }
}

/**
 * Opens a session without placing an element yourself. Resolves with how it ended; rejects when it cannot start.
 *
 * @param {string} url
 * @param {{mode?: 'popup' | 'inline', container?: HTMLElement, height?: number}} [options]
 * @returns {Promise<{status: 'completed' | 'cancelled' | 'closed', sessionId?: string | null, deviceId?: string | null, channelId?: string | null}>}
 */
export function open(url, options = {}) {
  return new Promise((resolve, reject) => {
    const element = /** @type {MyCommConnectElement} */ (document.createElement('mycomm-connect'));
    element.setAttribute('url', url);
    element.setAttribute('mode', options.mode ?? 'popup');
    if (options.height !== undefined) {
      element.setAttribute('height', String(options.height));
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
    element.addEventListener('mycomm-connect:cancelled', () => done(() => resolve({ status: 'cancelled' })));
    element.addEventListener('mycomm-connect:closed', () => done(() => resolve({ status: 'closed' })));
    element.addEventListener('mycomm-connect:error', (event) =>
      done(() => reject(new Error(`MyComm connect could not start: ${/** @type {CustomEvent} */ (event).detail.reason}`))));

    (options.container ?? document.body).append(element);
    if (options.mode !== 'inline') {
      element.open();
    }
  });
}

if (typeof customElements !== 'undefined' && customElements.get('mycomm-connect') === undefined) {
  customElements.define('mycomm-connect', MyCommConnectElement);
}

export const MyCommConnect = { open, version: VERSION };
export default MyCommConnect;
