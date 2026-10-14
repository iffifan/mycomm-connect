import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MyCommConnect, { readMessage, sessionOrigin } from '../src/mycomm-connect.js';

const TOKEN = 'k3JqLZ0u8m2f9wQxV1bY7tR5sN4pC6dE8hG0aJ2kL3m';
const URL_OK = `https://mycomm.cogneer.tech/connect/${TOKEN}`;
const ORIGIN = 'https://mycomm.cogneer.tech';

/** A stand-in for the popup window the browser would open. */
function fakePopup() {
  return { closed: false, focus: vi.fn(), close: vi.fn(function () { this.closed = true; }) };
}

/** Dispatches a message as the hosted page would post it. */
function post(data, { origin = ORIGIN, source }) {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
}

function element(attributes) {
  const el = document.createElement('mycomm-connect');
  for (const [name, value] of Object.entries(attributes)) {
    el.setAttribute(name, value);
  }
  document.body.append(el);
  return el;
}

function events(el) {
  const seen = [];
  for (const name of ['completed', 'cancelled', 'closed', 'error']) {
    el.addEventListener(`mycomm-connect:${name}`, (event) => seen.push([name, event.detail]));
  }
  return seen;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('sessionOrigin', () => {
  it.each([
    [URL_OK, ORIGIN],
    [`http://localhost:8109/connect/${TOKEN}`, 'http://localhost:8109'],
    [`http://127.0.0.1/connect/${TOKEN}`, 'http://127.0.0.1'],
  ])('accepts %s', (url, origin) => {
    expect(sessionOrigin(url)).toBe(origin);
  });

  it.each([
    [''],
    [null],
    ['not a url'],
    [`http://mycomm.cogneer.tech/connect/${TOKEN}`],
    [`javascript:alert(1)//connect/${TOKEN}`],
    [`https://mycomm.cogneer.tech/app/connect/${TOKEN}`],
    ['https://mycomm.cogneer.tech/connect/short'],
    [`https://user:pass@mycomm.cogneer.tech/connect/${TOKEN}`],
  ])('refuses %s', (url) => {
    expect(sessionOrigin(url)).toBeNull();
  });
});

describe('readMessage', () => {
  const source = {};

  it('reads an outcome from the page window and origin', () => {
    const event = new MessageEvent('message', {
      origin: ORIGIN,
      source,
      data: { type: 'mycomm.connect.completed', session_id: 's-1', device_id: 'd-1', channel_id: 'c-1' },
    });

    expect(readMessage(event, ORIGIN, source)).toEqual({
      kind: 'completed',
      detail: { sessionId: 's-1', deviceId: 'd-1', channelId: 'c-1' },
    });
  });

  it.each([
    ['another origin', { origin: 'https://evil.example', source, data: { type: 'mycomm.connect.completed' } }],
    ['another window', { origin: ORIGIN, source: {}, data: { type: 'mycomm.connect.completed' } }],
    ['an unknown type', { origin: ORIGIN, source, data: { type: 'mycomm.connect.hacked' } }],
    ['a string', { origin: ORIGIN, source, data: 'mycomm.connect.completed' }],
  ])('ignores a message from %s', (_, init) => {
    expect(readMessage(new MessageEvent('message', init), ORIGIN, source)).toBeNull();
  });

  it('drops ids that are not short strings', () => {
    const event = new MessageEvent('message', {
      origin: ORIGIN,
      source,
      data: { type: 'mycomm.connect.completed', session_id: { evil: true }, device_id: 'x'.repeat(65), channel_id: 7 },
    });

    expect(readMessage(event, ORIGIN, source)?.detail).toEqual({ sessionId: null, deviceId: null, channelId: null });
  });
});

describe('<mycomm-connect> in popup mode', () => {
  it('opens the session in a popup and reports completion', () => {
    const popup = fakePopup();
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    const el = element({ url: URL_OK, label: 'Link your SIM' });
    const seen = events(el);

    const button = el.shadowRoot.querySelector('button');
    expect(button.textContent).toBe('Link your SIM');
    button.click();
    post({ type: 'mycomm.connect.completed', session_id: 's-1', device_id: 'd-1', channel_id: 'c-1' }, { source: popup });
    vi.advanceTimersByTime(1000);

    expect(open).toHaveBeenCalledWith(URL_OK, 'mycomm-connect', expect.stringContaining('popup,width=480,height=720'));
    expect(seen).toEqual([['completed', { sessionId: 's-1', deviceId: 'd-1', channelId: 'c-1' }]]);
    expect(popup.close).toHaveBeenCalled();
  });

  it('reports a cancellation', () => {
    const popup = fakePopup();
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const el = element({ url: URL_OK });
    const seen = events(el);

    el.open();
    post({ type: 'mycomm.connect.cancelled' }, { source: popup });

    expect(seen.map(([name]) => name)).toEqual(['cancelled']);
  });

  it('reports a popup closed without an outcome', () => {
    const popup = fakePopup();
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const el = element({ url: URL_OK });
    const seen = events(el);

    el.open();
    popup.closed = true;
    vi.advanceTimersByTime(600);

    expect(seen).toEqual([['closed', {}]]);
  });

  it('ignores outcomes posted by other origins or windows', () => {
    const popup = fakePopup();
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const el = element({ url: URL_OK });
    const seen = events(el);

    el.open();
    post({ type: 'mycomm.connect.completed' }, { source: popup, origin: 'https://evil.example' });
    post({ type: 'mycomm.connect.completed' }, { source: window });

    expect(seen).toEqual([]);
  });

  it('reports a blocked popup', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const el = element({ url: URL_OK });
    const seen = events(el);

    el.open();

    expect(seen).toEqual([['error', { reason: 'blocked-popup' }]]);
  });

  it('focuses the popup instead of opening a second one', () => {
    const popup = fakePopup();
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    const el = element({ url: URL_OK });

    el.open();
    el.open();

    expect(open).toHaveBeenCalledTimes(1);
    expect(popup.focus).toHaveBeenCalled();
  });

  it('disables itself and reports an invalid url', async () => {
    const el = document.createElement('mycomm-connect');
    const seen = events(el);
    el.setAttribute('url', 'http://evil.example/connect/x');
    document.body.append(el);
    await Promise.resolve();

    expect(el.shadowRoot.querySelector('button').disabled).toBe(true);
    expect(seen).toContainEqual(['error', { reason: 'invalid-url' }]);
  });
});

/** jsdom gives a frame inside a shadow root no window; stand one in, as a browser would have. */
function frameWindow(el) {
  const frame = el.shadowRoot.querySelector('iframe');
  const win = {};
  Object.defineProperty(frame, 'contentWindow', { value: win });
  return [frame, win];
}

describe('<mycomm-connect> in inline mode', () => {
  it('renders the session in a frame that reports back', () => {
    const el = element({ url: URL_OK, mode: 'inline', height: '700' });
    const seen = events(el);
    const [frame, win] = frameWindow(el);

    expect(frame.src).toBe(URL_OK);
    expect(frame.style.height).toBe('700px');
    expect(frame.referrerPolicy).toBe('no-referrer');

    post({ type: 'mycomm.connect.completed', session_id: 's-2' }, { source: win });

    expect(seen).toEqual([['completed', { sessionId: 's-2', deviceId: null, channelId: null }]]);
  });

  it('moves to a popup when the page asks for one or the person clicks the fallback', () => {
    const popup = fakePopup();
    const open = vi.spyOn(window, 'open').mockReturnValue(popup);
    const el = element({ url: URL_OK, mode: 'inline' });
    const [, win] = frameWindow(el);

    post({ type: 'mycomm.connect.needs-popup' }, { source: win });
    expect(open).toHaveBeenCalledTimes(1);

    popup.closed = true;
    el.shadowRoot.querySelector('a').click();
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe('MyCommConnect.open', () => {
  it('resolves with the outcome and removes its element', async () => {
    const popup = fakePopup();
    vi.spyOn(window, 'open').mockReturnValue(popup);

    const result = MyCommConnect.open(URL_OK);
    post({ type: 'mycomm.connect.completed', session_id: 's-3', device_id: 'd-3', channel_id: 'c-3' }, { source: popup });

    await expect(result).resolves.toEqual({ status: 'completed', sessionId: 's-3', deviceId: 'd-3', channelId: 'c-3' });
    expect(document.querySelector('mycomm-connect')).toBeNull();
  });

  it('rejects when it cannot start', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    await expect(MyCommConnect.open(URL_OK)).rejects.toThrow('blocked-popup');
    await expect(MyCommConnect.open('https://evil.example/x')).rejects.toThrow('invalid-url');
  });
});
