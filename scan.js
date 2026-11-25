const WebSocket = require('ws');

const API_KEY = process.env.AIS_API_KEY;
const WORKER_URL = 'https://workers.dev';
const UPLOAD_SECRET = process.env.UPLOAD_SECRET || 'aida-geheim-2026';
const LAUSCH_ZEIT_MS = 25000;

async function run() {
  const funde = {};
  const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { ws.close(); } catch (e) {}
      resolve();
    }, LAUSCH_ZEIT_MS);

    ws.on('open', () => {
      const gebiete = [
        [[27.0, -18.5], [29.5, -13.0]], // Kanaren
        [[36.0, -5.5],  [44.5, 16.0]],  // Westliches Mittelmeer
        [[34.0, 16.0],  [42.0, 30.0]],  // Östliches Mittelmeer
        [[53.0, 4.0],   [62.0, 21.0]],  // Nord- und Ostsee
        [[11.0, -85.0], [26.0, -59.0]], // Karibik
        [[23.5, 51.0],  [26.5, 57.0]]   // Orient
      ];

      ws.send(JSON.stringify({
        APIKey: API_KEY,
        BoundingBoxes: gebiete,
        FilterMessageTypes: ['ShipStaticData', 'PositionReport']
      }));
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const funkName = (
          msg.MetaData?.ShipName ||
          msg.Message?.ShipStaticData?.Name ||
          ''
        ).trim();

        if (!funkName.toUpperCase().startsWith('AIDA')) return;

        const saubererName = 'AIDA' + funkName.slice(4).trim().toLowerCase();
        const eintrag = funde[saubererName] || {
          name: saubererName,
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

        funde[saubererName] = eintrag;
      } catch (e) {}
    });

    ws.on('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });

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
