export interface ConnectResult {
  sessionId: string | null;
  deviceId: string | null;
  channelId: string | null;
}

export type ConnectOutcome =
  | ({ status: 'completed' } & ConnectResult)
  | { status: 'cancelled' }
  | { status: 'closed' };

export interface OpenOptions {
  /** `popup` (default) or `inline`. */
  mode?: 'popup' | 'inline';
  /** Where an inline frame goes; the document body by default. */
  container?: HTMLElement;
  /** Inline frame height in pixels (default 640). */
  height?: number;
}

export declare function sessionOrigin(url: string | null | undefined): string | null;

/** Opens a connect session. Call it from a click handler, or the browser may block the popup. */
export declare function open(url: string, options?: OpenOptions): Promise<ConnectOutcome>;

export declare class MyCommConnectElement extends HTMLElement {
  static observedAttributes: string[];
  readonly url: string;
  readonly mode: 'popup' | 'inline';
  /** Opens the flow in a popup, as a click on the button does. */
  open(): void;
}

export declare const MyCommConnect: { open: typeof open; version: string };
export default MyCommConnect;

declare global {
  interface HTMLElementTagNameMap {
    'mycomm-connect': MyCommConnectElement;
  }
  interface HTMLElementEventMap {
    'mycomm-connect:completed': CustomEvent<ConnectResult>;
    'mycomm-connect:cancelled': CustomEvent<Record<string, never>>;
    'mycomm-connect:closed': CustomEvent<Record<string, never>>;
    'mycomm-connect:error': CustomEvent<{ reason: 'invalid-url' | 'blocked-popup' }>;
  }
}
