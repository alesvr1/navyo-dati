// carburanti-finlandia.js
// Rifà ogni settimana l'elenco dei distributori della Finlandia di Navyo
// (dati/carburanti-finlandia.json) da OpenStreetMap, con una sola richiesta.
// Regole (le stesse usate a mano il 04/11/2026): tolti i distributori dismessi,
// privati, per barche, militari, solo metano/biogas, per camion, senza nome e
// senza dati, e i doppioni della stessa marca entro 60 m.
// I prezzi (prezzi-finlandia.json) si riabbinano da soli al giro successivo
// del programma "Prezzi Finlandia".
// Se le stazioni sono troppo poche il file NON viene cambiato e il programma
// finisce con errore (GitHub manda una mail).
// Prova senza salvare: node carburanti-finlandia.js prova risultati-osm-finlandia.json

const fs = require('fs');
const path = require('path');

const FILE_DATI = path.join(process.cwd(), 'dati', 'carburanti-finlandia.json');
const MINIMO_STAZIONI = 1500;
const SERVER = [
  'https://api.overspan.dev/BD86EEB6-BD47-4C4D-9525-4AD4EE4F852F/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const QUERY = '[out:json][timeout:180];area["ISO3166-1"="FI"][admin_level=2]->.fi;nwr["amenity"="fuel"](area.fi);out center tags;';

async function scaricaOSM() {
  for (const s of SERVER) {
    for (let tentativo = 1; tentativo <= 2; tentativo++) {
      try {
        console.log('Provo il server: ' + s);
        const res = await fetch(s, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'User-Agent': 'Navyo/1.0 (navyo-dati su GitHub)' },
          body: 'data=' + encodeURIComponent(QUERY),
          signal: AbortSignal.timeout(240000),
        });
        const dati = JSON.parse(await res.text());
        if (!Array.isArray(dati.elements) || dati.remark) throw new Error(dati.remark || 'risposta senza elenco');
        return dati.elements;
      } catch (err) {
        console.log('   non riuscito: ' + err.message);
        await new Promise(ok => setTimeout(ok, 10000));
      }
    }
  }
  throw new Error('nessun server OpenStreetMap ha risposto');
}

function distanzaM(a, b) {
  const r = (x) => x * Math.PI / 180;
  const x = Math.sin(r(b[0] - a[0]) / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(r(b[1] - a[1]) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x));
}

const marca = (s) => {
  s = String(s || '').toLowerCase().trim();
  return s ? s.split(/[\s,]+/)[0] : '';
};

function rifaiElenco(elementi) {
  const motivi = {};
  const conta = (m) => { motivi[m] = (motivi[m] || 0) + 1; };
  const tenuti = [];
  for (const e of elementi) {
    const t = e.tags || {};
    const si = (k) => t[k] === 'yes';
    const nome = t.name || t.brand || t.operator || null;
    const nm = t.name || '';
    const br = (t.brand || '') + ' ' + nm;
    if (Object.keys(t).some(k => k.startsWith('disused') || k.startsWith('abandoned'))) { conta('dismesso'); continue; }
    if (['private', 'customers', 'no'].includes(t.access)) { conta('privato'); continue; }
    if (t.boat === 'yes' || t.waterway === 'fuel' || br.toLowerCase().includes('vene')) { conta('barche'); continue; }
    if (br.includes('Puolustusvoimat')) { conta('militare'); continue; }
    const petrolio = ['fuel:diesel', 'fuel:octane_95', 'fuel:octane_98', 'fuel:e10', 'fuel:HGV_diesel'].some(si) || t['fuel:diesel'] === 'only';
    const gas = si('fuel:cng') || si('fuel:biogas') || si('fuel:lng');
    if ((gas && !petrolio) || ['Gasum', 'e-kaasuasemat', 'BIG', 'Mustankorkea'].includes(t.brand)) { conta('solo metano/biogas'); continue; }
    const low = nm.toLowerCase();
    const camion = ['Neste Truck', 'Teboil D'].includes(t.brand) || br.toLowerCase().includes('truck') || low.includes('diesel') || t['fuel:diesel'] === 'only' || /^(neste d\b|neste d-|teboil d\b|teboil d-|teboil d\d|d teboil|dieselpiste)/.test(low);
    if (camion) { conta('camion'); continue; }
    if (!nome && !petrolio && Object.keys(t).filter(k => k !== 'amenity').length <= 2) { conta('senza nome e senza dati'); continue; }
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (lat == null || lon == null) { conta('senza coordinate'); continue; }
    tenuti.push({ t, nome, ll: [lat, lon] });
  }
  tenuti.sort((a, b) => ((a.nome === null) - (b.nome === null)) || (Object.keys(b.t).length - Object.keys(a.t).length));
  const fin = [];
  for (const s of tenuti) {
    let doppione = false;
    for (const f of fin) {
      if (Math.abs(f.ll[0] - s.ll[0]) > 0.001) continue;
      if (distanzaM(f.ll, s.ll) < 60) {
        const bf = marca(f.t.brand || f.nome);
        const bs = marca(s.t.brand || s.nome);
        if (!bs || !bf || bs === bf) { doppione = true; break; }
      }
    }
    if (doppione) { conta('doppione'); continue; }
    fin.push(s);
  }
  const arrotonda = (x) => Number(x.toFixed(6));
  const righe = fin.map(s => {
    const t = s.t;
    const nome = (s.nome || 'Huoltoasema').trim();
    const via = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(' ');
    const indirizzo = [via, t['addr:city']].filter(Boolean).join(', ');
    return [nome, indirizzo, arrotonda(s.ll[0]), arrotonda(s.ll[1]), marca(t.brand || nome)];
  });
  return { righe, motivi };
}

async function main() {
  const prova = process.argv[2] === 'prova';
  const elementi = prova ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')).elements : await scaricaOSM();
  console.log('Distributori su OpenStreetMap: ' + elementi.length);
  const { righe, motivi } = rifaiElenco(elementi);
  console.log('Tolti: ' + JSON.stringify(motivi));
  let vecchio = [];
  try { vecchio = JSON.parse(fs.readFileSync(FILE_DATI, 'utf8')).s || []; } catch {}
  console.log('Distributori in Navyo: ' + righe.length + ' (prima: ' + vecchio.length + ')');
  const chiave = (v) => v[2].toFixed(4) + ',' + v[3].toFixed(4);
  const vecchie = new Set(vecchio.map(chiave));
  const nuove = new Set(righe.map(chiave));
  righe.filter(v => !vecchie.has(chiave(v))).forEach(v => console.log('   + nuovo: ' + v[0] + ' – ' + v[1]));
  vecchio.filter(v => !nuove.has(chiave(v))).forEach(v => console.log('   - tolto: ' + v[0] + ' – ' + v[1]));
  if (righe.length < MINIMO_STAZIONI) {
    console.log('ERRORE: troppo pochi distributori, il file NON viene cambiato.');
    process.exit(1);
  }
  if (prova) { fs.writeFileSync('prova-carburanti-finlandia.json', JSON.stringify({ s: righe }), 'utf8'); console.log('Prova salvata in prova-carburanti-finlandia.json'); return; }
  fs.writeFileSync(FILE_DATI, JSON.stringify({ s: righe }), 'utf8');
  console.log('Salvato: dati/carburanti-finlandia.json');
}

main().catch(err => { console.log('ERRORE: ' + err.message); process.exit(1); });
