// regnounito.js
// Ogni 3 ore scarica da CheapFuelNearMe (che ripubblica i dati ufficiali del
// Fuel Finder del governo britannico, Open Government Licence v3.0) tutti i
// distributori del Regno Unito con i prezzi e salva dati/regnounito.json,
// usato da Navyo lungo il percorso e nei preferiti.
// Carburanti: benzina = E10 (se manca, E5), gasolio = diesel normale (B7).
// Esclusi diesel premium e altri carburanti. Prezzi in sterline (da pence).
// Per ogni prezzo salva anche la data e l'ora della segnalazione (ora britannica).
// Contains public sector information licensed under the Open Government Licence v3.0.
// Se qualcosa non va (sito non raggiungibile, troppo pochi distributori)
// il file NON viene cambiato e il programma finisce con errore.

const fs = require('fs');
const path = require('path');

const URL_DATI = 'https://cheapfuelnearme.uk/api/v1/stations.json';
const FILE_DATI = path.join(process.cwd(), 'dati', 'regnounito.json');
const MINIMO_STAZIONI = 6000;
const GIORNI_MASSIMI = 30;

const attesa = (ms) => new Promise(ok => setTimeout(ok, ms));

async function scarica() {
  for (let tentativo = 1; tentativo <= 3; tentativo++) {
    try {
      const res = await fetch(URL_DATI, { headers: { 'Accept': 'application/json', 'User-Agent': 'Navyo/1.0 (navyo-dati su GitHub)' }, signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const dati = await res.json();
      if (!Array.isArray(dati.stations)) throw new Error('risposta senza elenco dei distributori');
      return dati;
    } catch (err) {
      console.log('   tentativo ' + tentativo + '/3 non riuscito: ' + err.message);
      await attesa(10000 * tentativo);
    }
  }
  throw new Error('cheapfuelnearme.uk non raggiungibile');
}

// "TESCO" -> "Tesco"; "BP" resta "BP"
const maiuscole = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase()
  .replace(/(^|[\s\-(/.,'&])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const marca = (t) => /^(BP|JET|MFG|SGN|ESSO|EG|TOTAL|SPAR|COOP|CO-OP|MRH|BWOC|ASDA)$/i.test(String(t || '').trim()) ? String(t).trim().toUpperCase() : maiuscole(t);

// "2026-11-13T17:00:00Z" -> "13.11. 17:00" (ora del Regno Unito)
const formatoData = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const data = (iso) => {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const p = Object.fromEntries(formatoData.formatToParts(d).map(x => [x.type, x.value]));
  return `${p.day}.${p.month}. ${p.hour}:${p.minute}`;
};

// prezzo in pence -> sterline; tiene solo valori sensati e non troppo vecchi
const leggi = (voce) => {
  if (!voce) return null;
  const pence = Number(voce.pence_per_litre);
  if (!(pence > 50 && pence < 350)) return null;
  const quando = new Date(voce.submitted_at);
  if (!isNaN(quando) && Date.now() - quando > GIORNI_MASSIMI * 86400000) return null;
  return { prezzo: Math.round(pence * 10) / 1000, data: data(voce.submitted_at) };
};

async function main() {
  const dati = await scarica();
  console.log('Distributori nel file: ' + dati.stations.length + ' – dati ufficiali del ' + dati.source_generated_at + ', file preparato il ' + dati.built_at);
  const codici = {};
  for (const s of dati.stations) for (const c of Object.keys(s.prices || {})) codici[c] = (codici[c] || 0) + 1;
  console.log('Carburanti nel file: ' + JSON.stringify(codici));

  const visti = new Set();
  const elenco = [];
  for (const s of dati.stations) {
    if (!s || visti.has(s.id)) continue;
    visti.add(s.id);
    const lat = Number(s.lat), lng = Number(s.lon);
    if (!(lat > 49 && lat < 61 && lng > -11 && lng < 2.5)) continue;
    const pr = s.prices || {};
    const benzina = leggi(pr.E10) || leggi(pr.E5);
    const gasolio = leggi(pr.B7S) || leggi(pr.B7) || leggi(pr.B7_STANDARD);
    if (!benzina && !gasolio) continue;
    const nome = marca(s.brand) || maiuscole(s.name) || 'Petrol station';
    const indirizzo = [maiuscole(s.name), [maiuscole(s.town), String(s.postcode || '').toUpperCase()].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    elenco.push([nome, indirizzo, Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6, benzina ? benzina.prezzo : null, benzina ? benzina.data : null, gasolio ? gasolio.prezzo : null, gasolio ? gasolio.data : null]);
  }
  const conta = (i) => elenco.filter(r => r[i] != null).length;
  console.log('Distributori salvati: ' + elenco.length + ' – con prezzo: benzina ' + conta(4) + ', diesel ' + conta(6));
  elenco.slice(0, 10).forEach(r => console.log('   ' + JSON.stringify(r)));

  if (elenco.length < MINIMO_STAZIONI) {
    console.log('ERRORE: troppo pochi distributori, il file NON viene cambiato.');
    process.exit(1);
  }
  fs.writeFileSync(FILE_DATI, JSON.stringify({ s: elenco }), 'utf8');
  console.log('Salvato: dati/regnounito.json');
}

main().catch(err => { console.log('ERRORE: ' + err.message); process.exit(1); });
