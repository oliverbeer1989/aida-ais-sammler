const WebSocket = require('ws');

const API_KEY = (process.env.AIS_API_KEY || '').trim();
const WORKER_URL = 'https://aida-flotte.oliver-beer1989.workers.dev/update';
const UPLOAD_SECRET = process.env.UPLOAD_SECRET || 'aida-geheim-2026';
const GESAMT_ZEIT_MS = 210000; // Gut 3 Minuten (erwischt auch Schiffe im Hafen!)

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

function verbindeEinmal(restZeitMs, funde) {
  return new Promise((resolve) => {
    const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    let pakete = 0;

    const timer = setTimeout(() => {
      try { ws.close(); } catch (e) {}
      resolve(pakete);
    }, restZeitMs);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        APIKey: API_KEY,
        BoundingBoxes: [[[-90.0, -180.0], [90.0, 180.0]]],
        FiltersShipMMSI: Object.keys(AIDA_FLOTTE)
      }));
    });

    ws.on('message', (data) => {
      pakete++;
      try {
        const msg = JSON.parse(data.toString());
        if (msg.MessageType === 'SubscriptionConfirmation') return;

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
        console.log('Treffer:', schiffsName, eintrag.lat, eintrag.lon, 'Speed:', eintrag.sog);
      } catch (e) {}
    });

    ws.on('error', () => {});
    ws.on('close', () => {
      clearTimeout(timer);
      resolve(pakete);
    });
  });
}

async function run() {
  if (!API_KEY) {
    console.error('FEHLER: AIS_API_KEY ist leer!');
    process.exit(1);
  }

  const funde = {};
  const ende = Date.now() + GESAMT_ZEIT_MS;
  let runde = 0;

  console.log('Starte 3-Minuten-Scan für alle 11 AIDA-Schiffe...');

  while (Date.now() < ende) {
    runde++;
    const rest = ende - Date.now();
    if (rest <= 2000) break;
    await verbindeEinmal(rest, funde);
    if (Date.now() < ende) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  console.log(`Scan beendet nach ${runde} Verbindungen.`);
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
