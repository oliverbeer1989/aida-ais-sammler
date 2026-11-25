const WebSocket = require('ws');

const API_KEY = (process.env.AIS_API_KEY || '').trim();
const WORKER_URL = 'https://aida-flotte.oliver-beer1989.workers.dev/update';
const UPLOAD_SECRET = process.env.UPLOAD_SECRET || 'aida-geheim-2026';
const LAUSCH_ZEIT_MS = 90000;

const AIDA_FLOTTE = {
  '247389200': 'AIDAnova',
  '247435300': 'AIDAcosma',
  '247385300': 'AIDAperla',
  '247353800': 'AIDAprima',
  '247322800': 'AIDAstella',
  '247312900': 'AIDAmar',
  '247302900': 'AIDAsol',
  '247282500': 'AIDAblu',
  '247255400': 'AIDAluna',
  '247229700': 'AIDAbella',
  '247187700': 'AIDAdiva'
};

async function run() {
  if (!API_KEY) {
    console.error('FEHLER: AIS_API_KEY ist leer!');
    process.exit(1);
  }

  const funde = {};
  let msgCount = 0;
  const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

  await new Promise((resolve) => {
    const pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.ping(); } catch (e) {}
      }
    }, 15000);

    const timer = setTimeout(() => {
      clearInterval(pingTimer);
      try { ws.close(); } catch (e) {}
      resolve();
    }, LAUSCH_ZEIT_MS);

    ws.on('open', () => {
      console.log('WebSocket verbunden, lausche 90 Sekunden...');
      ws.send(JSON.stringify({
        APIKey: API_KEY,
        BoundingBoxes: [[[-90.0, -180.0], [90.0, 180.0]]],
        FiltersShipMMSI: Object.keys(AIDA_FLOTTE)
      }));
    });

    ws.on('message', (data) => {
      msgCount++;
      const text = data.toString();
      try {
        const msg = JSON.parse(text);
        if (msg.MessageType === 'SubscriptionConfirmation') {
          console.log('Abo bestätigt!');
          return;
        }

        const mmsi = String(msg.MetaData?.MMSI || msg.Message?.PositionReport?.UserID || '');
        const rohName = (msg.MetaData?.ShipName || msg.Message?.ShipStaticData?.Name || '').trim();
        const schiffsName = AIDA_FLOTTE[mmsi] || (rohName.toUpperCase().startsWith('AIDA') ? rohName : '');
        if (!schiffsName) return;

        const eintrag = funde[schiffsName] || {
          name: schiffsName,
          sog: null,
          lat: null,
          lon: null,
          ziel: '',
          zeit: ''
        };

        if (msg.MetaData?.latitude) eintrag.lat = msg.MetaData.latitude;
        if (msg.MetaData?.longitude) eintrag.lon = msg.MetaData.longitude;

        if (msg.Message?.PositionReport) {
          const p = msg.Message.PositionReport;
          eintrag.sog = p.Sog ?? eintrag.sog;
          eintrag.lat = p.Latitude ?? eintrag.lat;
          eintrag.lon = p.Longitude ?? eintrag.lon;
        }
        if (msg.Message?.ShipStaticData?.Destination) {
          eintrag.ziel = msg.Message.ShipStaticData.Destination.trim();
        }

        eintrag.zeit = new Date().toLocaleTimeString('de-DE', {
          timeZone: 'Europe/Berlin',
          hour: '2-digit',
          minute: '2-digit'
        });

        funde[schiffsName] = eintrag;
        console.log('Treffer:', schiffsName, eintrag.lat, eintrag.lon);
      } catch (e) {}
    });

    ws.on('error', (err) => console.error('WebSocket-Fehler:', err.message));
    ws.on('close', (code) => {
      console.log('WebSocket geschlossen, Code:', code);
      clearInterval(pingTimer);
      clearTimeout(timer);
      resolve();
    });
  });

  console.log('Empfangene Pakete gesamt:', msgCount);
  console.log('Gefundene AIDA-Schiffe:', Object.keys(funde));

  if (Object.keys(funde).length > 0) {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${UPLOAD_SECRET}`
      },
      body: JSON.stringify(funde)
    });
    console.log('Antwort vom Worker:', await res.text());
  }
}

run();
