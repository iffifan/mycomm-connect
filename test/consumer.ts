// Type-checked in CI (`npm run lint`): what a TypeScript project writes against the published declarations.
import MyCommConnect, { MyCommConnectError, open, readMessage, sessionOrigin, type ConnectOutcome } from '../src/mycomm-connect.js';

async function pair(sessionUrl: string): Promise<string> {
  try {
    const outcome: ConnectOutcome = await open(sessionUrl, { mode: 'inline', height: 600, timeout: 30 });
    switch (outcome.status) {
      case 'completed':
        return `channel ${outcome.channelId} on device ${outcome.deviceId}`;
      case 'ended':
        return `ended: ${outcome.reason}`;
      case 'cancelled':
      case 'closed':
        return outcome.status;
    }
  } catch (error) {
    if (error instanceof MyCommConnectError) {
      return error.code === 'blocked-popup' ? 'allow popups' : error.message;
    }
    throw error;
  }
}

const widget = document.querySelector('mycomm-connect');
widget?.addEventListener('mycomm-connect:completed', (event) => {
  const { sessionId } = event.detail;
  console.log(sessionId);
});
widget?.addEventListener('mycomm-connect:error', (event) => {
  console.log(event.detail.code, event.detail.message);
});

window.addEventListener('message', (event) => {
  const origin = sessionOrigin('https://mycomm.cogneer.tech/connect/x');
  if (origin !== null) {
    console.log(readMessage(event, origin, window)?.kind);
  }
});

void MyCommConnect.version;
void pair;
