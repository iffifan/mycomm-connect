import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MyCommConnect, { MyCommConnectError, readMessage, sessionOrigin } from '../src/mycomm-connect.js';

const TOKEN = 'k3JqLZ0u8m2f9wQxV1bY7tR5sN4pC6dE8hG0aJ2kL3m';
const URL_OK = `https://mycomm.cogneer.tech/connect/${TOKEN}`;
const URL_OTHER = `https://mycomm.cogneer.tech/connect/${TOKEN.split('').reverse().join('')}`;
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
  for (const name of ['completed', 'ended', 'cancelled', 'closed', 'error']) {
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
    ['expired', 'expired'],
    ['revoked', 'revoked'],
    ['completed_elsewhere', 'completed_elsewhere'],
    ['something new', 'unknown'],
    [undefined, 'unknown'],
  ])('reads an ended session with reason %s as %s', (sent, reason) => {
    const event = new MessageEvent('message', { origin: ORIGIN, source, data: { type: 'mycomm.connect.ended', session_id: 's-1', reason: sent } });

    expect(readMessage(event, ORIGIN, source)).toEqual({ kind: 'ended', detail: { sessionId: 's-1', reason } });
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

  it('reports a session that ended, with the reason', () => {
    const popup = fakePopup();
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const el = element({ url: URL_OK });
    const seen = events(el);

    el.open();
    post({ type: 'mycomm.connect.ended', session_id: 's-1', reason: 'expired' }, { source: popup });

    expect(seen).toEqual([['ended', { sessionId: 's-1', reason: 'expired' }]]);
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

  it('ignores messages after the flow has ended', () => {
    const popup = fakePopup();
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const el = element({ url: URL_OK });
    const seen = events(el);

    el.open();
    post({ type: 'mycomm.connect.completed', session_id: 's-1' }, { source: popup });
    post({ type: 'mycomm.connect.cancelled' }, { source: popup });

    expect(seen.map(([name]) => name)).toEqual(['completed']);
  });

  it('reports a blocked popup with a typed error', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const el = element({ url: URL_OK });
    const seen = events(el);

    el.open();

    expect(seen).toEqual([['error', { code: 'blocked-popup', message: expect.stringContaining('blocked the popup') }]]);
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
    expect(seen).toEqual([['error', { code: 'invalid-url', message: expect.any(String) }]]);
  });

  it('reports a missing url instead of staying silent', async () => {
    const el = document.createElement('mycomm-connect');
    const seen = events(el);
    document.body.append(el);
    await Promise.resolve();

    expect(seen.map(([name, detail]) => [name, detail.code])).toEqual([['error', 'missing-url']]);
  });

  it('does not report a missing url when the page sets it right away', async () => {
    const el = document.createElement('mycomm-connect');
    const seen = events(el);
    document.body.append(el);
    el.setAttribute('url', URL_OK);
    await Promise.resolve();

    expect(seen).toEqual([]);
  });

  it('ends an unfinished flow with a timeout error', () => {
    const popup = fakePopup();
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const el = element({ url: URL_OK, timeout: '5' });
    const seen = events(el);

    el.open();
    vi.advanceTimersByTime(4 * 60_000);
    expect(seen).toEqual([]);
    vi.advanceTimersByTime(61_000);

    expect(seen.map(([name, detail]) => [name, detail.code])).toEqual([['error', 'timeout']]);
    expect(popup.close).toHaveBeenCalled();
  });

  it('does not time out once the flow has an outcome', () => {
    const popup = fakePopup();
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const el = element({ url: URL_OK, timeout: '1' });
    const seen = events(el);

    el.open();
    post({ type: 'mycomm.connect.completed' }, { source: popup });
    vi.advanceTimersByTime(5 * 60_000);

    expect(seen.map(([name]) => name)).toEqual(['completed']);
  });
});

describe('lifecycle', () => {
  it('closes the popup and stops watching when the url changes', () => {
    const popup = fakePopup();
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const el = element({ url: URL_OK });
    const seen = events(el);

    el.open();
    el.setAttribute('url', URL_OTHER);
    vi.advanceTimersByTime(2000);

    expect(popup.close).toHaveBeenCalled();
    expect(seen).toEqual([]);
  });

  it('closes the popup and stops watching when the element is removed', () => {
    const popup = fakePopup();
    vi.spyOn(window, 'open').mockReturnValue(popup);
    const el = element({ url: URL_OK });
    const seen = events(el);

    el.open();
    el.remove();
    popup.closed = true;
    vi.advanceTimersByTime(2000);
    post({ type: 'mycomm.connect.completed' }, { source: popup });

    expect(popup.close).toHaveBeenCalled();
    expect(seen).toEqual([]);
  });

  it('allows a new flow after an outcome', () => {
    const popup = fakePopup();
    const next = fakePopup();
    const open = vi.spyOn(window, 'open').mockReturnValueOnce(popup).mockReturnValueOnce(next);
    const el = element({ url: URL_OK });
    const seen = events(el);

    el.open();
    post({ type: 'mycomm.connect.cancelled' }, { source: popup });
    el.open();
    post({ type: 'mycomm.connect.completed', session_id: 's-9' }, { source: next });

    expect(open).toHaveBeenCalledTimes(2);
    expect(seen.map(([name]) => name)).toEqual(['cancelled', 'completed']);
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

  it('reports an ended session shown in the frame', () => {
    const el = element({ url: URL_OK, mode: 'inline' });
    const seen = events(el);
    const [, win] = frameWindow(el);

    post({ type: 'mycomm.connect.ended', reason: 'revoked' }, { source: win });

    expect(seen).toEqual([['ended', { sessionId: null, reason: 'revoked' }]]);
  });

  it('times out an inline flow that nobody finishes', () => {
    const el = element({ url: URL_OK, mode: 'inline', timeout: '2' });
    const seen = events(el);

    vi.advanceTimersByTime(121_000);

    expect(seen.map(([name, detail]) => [name, detail.code])).toEqual([['error', 'timeout']]);
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

  it('reports an inline element without a usable url', async () => {
    const el = document.createElement('mycomm-connect');
    el.setAttribute('mode', 'inline');
    const seen = events(el);
    document.body.append(el);
    await Promise.resolve();

    expect(seen.map(([, detail]) => detail.code)).toEqual(['missing-url']);
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

  it('resolves, not rejects, when the session ended', async () => {
    const popup = fakePopup();
    vi.spyOn(window, 'open').mockReturnValue(popup);

    const result = MyCommConnect.open(URL_OK);
    post({ type: 'mycomm.connect.ended', session_id: 's-4', reason: 'expired' }, { source: popup });

    await expect(result).resolves.toEqual({ status: 'ended', sessionId: 's-4', reason: 'expired' });
  });

  it('rejects with a typed error when it cannot start', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    await expect(MyCommConnect.open(URL_OK)).rejects.toMatchObject({ name: 'MyCommConnectError', code: 'blocked-popup' });
    await expect(MyCommConnect.open('https://evil.example/x')).rejects.toBeInstanceOf(MyCommConnectError);
    await expect(MyCommConnect.open('https://evil.example/x')).rejects.toMatchObject({ code: 'invalid-url' });
    await expect(MyCommConnect.open('')).rejects.toMatchObject({ code: 'missing-url' });
  });

  it('checks its options before touching the page', async () => {
    const open = vi.spyOn(window, 'open');

    await expect(MyCommConnect.open(URL_OK, { mode: 'sideways' })).rejects.toMatchObject({ code: 'invalid-option' });
    await expect(MyCommConnect.open(URL_OK, { mode: 'inline', container: '#slot' })).rejects.toMatchObject({ code: 'invalid-option' });
    await expect(MyCommConnect.open(URL_OK, { height: -5 })).rejects.toMatchObject({ code: 'invalid-option' });
    await expect(MyCommConnect.open(URL_OK, { timeout: 0 })).rejects.toMatchObject({ code: 'invalid-option' });

    expect(document.querySelector('mycomm-connect')).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it('renders inline into a container', async () => {
    const container = document.createElement('div');
    document.body.append(container);

    const result = MyCommConnect.open(URL_OK, { mode: 'inline', container, height: 500 });
    const el = container.querySelector('mycomm-connect');
    const [frame, win] = frameWindow(el);
    expect(frame.style.height).toBe('500px');
    post({ type: 'mycomm.connect.cancelled' }, { source: win });

    await expect(result).resolves.toEqual({ status: 'cancelled' });
    expect(container.querySelector('mycomm-connect')).toBeNull();
  });

  it('rejects with a timeout error', async () => {
    const popup = fakePopup();
    vi.spyOn(window, 'open').mockReturnValue(popup);

    const result = MyCommConnect.open(URL_OK, { timeout: 1 });
    const settled = expect(result).rejects.toMatchObject({ code: 'timeout' });
    vi.advanceTimersByTime(61_000);

    await settled;
  });
});
