'use client';

const COPY = {
  idle: {
    title: 'Turn on location',
    body: 'This map needs your phone\u2019s GPS to place you in the park, measure range and bearing to your party, and point you at the meet-up. Nothing is stored until you join a party.',
    action: 'Allow location',
  },
  asking: {
    title: 'Waiting for a fix',
    body: 'Your phone should be asking for permission now. Say yes, then give it a few seconds \u2014 first fix under tree cover or inside a queue building can take a while.',
    action: 'Ask again',
  },
  denied: {
    title: 'Location is blocked',
    body: 'Your browser is refusing the request. On iPhone: Settings \u2192 Safari \u2192 Location \u2192 Ask, then reload. On Android Chrome: tap the padlock in the address bar \u2192 Permissions \u2192 Location \u2192 Allow.',
    action: 'Try again',
  },
  insecure: {
    title: 'Needs a secure connection',
    body: 'Browsers only hand out GPS over HTTPS or on localhost. Open this on http://localhost:3000 while developing, or deploy it and use the https:// address.',
    action: 'Try anyway',
  },
  unsupported: {
    title: 'No location API',
    body: 'This browser does not expose geolocation at all. You can still use every other part of the map by placing yourself by hand.',
    action: 'Try anyway',
  },
};

export default function GpsGate({ status, error, onRequest, onManual, onDismiss }) {
  const copy = COPY[status] || COPY.idle;
  return (
    <div className="gate">
      <div className="gateCard">
        <div className="gateEyebrow">Kings Island · Party tracker</div>
        <h2>{copy.title}</h2>
        <p>{copy.body}</p>
        {error && <p className="gateError">{error}</p>}
        <button type="button" className="btn primary" onClick={onRequest}>
          {status === 'asking' ? 'Ask again' : copy.action}
        </button>
        <button type="button" className="btn" onClick={onManual}>
          Place myself on the map instead
        </button>
        <button type="button" className="btnQuiet" onClick={onDismiss}>
          Just show me the park map
        </button>
        <p className="gateFine">
          Position stays on your device unless you join a party. Then it is encrypted
          and sent to the phone hosting that party — anything relaying it in between
          carries it without being able to read it.
        </p>
      </div>
    </div>
  );
}
