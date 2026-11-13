// croazia.js
// Ogni ora scarica dal Ministero dell'Economia croato (MZOE, mzoe-gor.hr) tutti
// i distributori della Croazia con i prezzi e salva dati/croazia.json, usato da
// Navyo per "vicino a me", lungo il percorso e i preferiti.
// Carburanti: benzina = Eurosuper 95 (senza additivi), gasolio = Eurodizel
// (senza additivi), GPL = UNP (autoplin). Esclusi: versioni con additivi
// (premium), Eurosuper 100 e gasolio agricolo (plavi dizel). Prezzi in euro.
// Attenzione: nel file del Ministero latitudine e longitudine sono scambiate.
// Se qualcosa non va (sito non raggiungibile, troppo pochi distributori)
// il file NON viene cambiato e il programma finisce con errore.

const fs = require('fs');
const path = require('path');

const URL_DATI = 'https://mzoe-gor.hr/data.json';
const FILE_DATI = path.join(process.cwd(), 'dati', 'croazia.json');
const MINIMO_STAZIONI = 600;
// vrsta_goriva_id del Ministero -> colonna nel file di Navyo
const TIPI = { 2: 'benzina', 8: 'gasolio', 9: 'gpl' };

const attesa = (ms) => new Promise(ok => setTimeout(ok, ms));

async function scarica() {
  for (let tentativo = 1; tentativo <= 3; tentativo++) {
    try {
      const res = await fetch(URL_DATI, { headers: { 'Accept': 'application/json', 'User-Agent': 'Navyo/1.0 (navyo-dati su GitHub)' }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const dati = await res.json();
      if (!Array.isArray(dati.postajas)) throw new Error('risposta senza elenco dei distributori');
      return dati;
    } catch (err) {
      console.log('   tentativo ' + tentativo + '/3 non riuscito: ' + err.message);
      await attesa(5000 * tentativo);
    }
  }
  throw new Error('mzoe-gor.hr non raggiungibile');
}

// "ZAGREB - SAVSKA" -> "Zagreb - Savska"
const maiuscole = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase()
  .replace(/(^|[\s\-(/.,])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// prezzo in euro al litro: tiene solo valori sensati
const prezzo = (v) => {
  const n = Number(v);
  return n > 0.3 && n < 4 ? Math.round(n * 1000) / 1000 : null;
};

async function main() {
  const dati = await scarica();
  console.log('Distributori nel file del Ministero: ' + dati.postajas.length);
  console.log('Tipi di carburante: ' + JSON.stringify(dati.vrsta_gorivas || []));
  if (dati.postajas[0]) console.log('Esempio: ' + JSON.stringify(dati.postajas[0]).slice(0, 700));

  const tipoDiGorivo = new Map();
  for (const g of dati.gorivos || []) if (g.vrsta_goriva_id != null) tipoDiGorivo.set(g.id, g.vrsta_goriva_id);
  const marche = new Map();
  for (const o of dati.obvezniks || []) marche.set(o.id, String(o.naziv || '').replace(/\s*(d\.d\.|d\.o\.o\.?|j\.d\.o\.o\.)\s*$/i, '').trim());

  const visti = new Set();
  const elenco = [];
  for (const s of dati.postajas) {
    if (!s || visti.has(s.id)) continue;
    visti.add(s.id);
    let lat = parseFloat(String(s.long).replace(',', '.'));
    let lng = parseFloat(String(s.lat).replace(',', '.'));
    if (lat > 13 && lat < 20 && lng > 42 && lng < 47) [lat, lng] = [lng, lat];
    if (!(lat > 42.3 && lat < 46.6 && lng > 13.4 && lng < 19.5)) continue;
    const p = { benzina: null, gasolio: null, gpl: null };
    for (const c of s.cjenici || []) {
      const tipo = TIPI[tipoDiGorivo.get(c.gorivo_id)];
      const v = prezzo(c.cijena);
      if (tipo && v != null && (p[tipo] == null || v < p[tipo])) p[tipo] = v;
    }
    const nome = String(s.naziv || '').trim() || marche.get(s.obveznik_id) || 'Benzinska postaja';
    const indirizzo = [maiuscole(s.adresa), maiuscole(s.mjesto)].filter(Boolean).join(', ');
    elenco.push([nome, indirizzo, Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6, p.benzina, p.gasolio, p.gpl]);
  }
  const conta = (i) => elenco.filter(r => r[i] != null).length;
  console.log('Distributori salvati: ' + elenco.length + ' – con prezzo: benzina ' + conta(4) + ', diesel ' + conta(5) + ', GPL ' + conta(6));
  elenco.slice(0, 5).forEach(r => console.log('   ' + JSON.stringify(r)));

  if (elenco.length < MINIMO_STAZIONI) {
    console.log('ERRORE: troppo pochi distributori, il file NON viene cambiato.');
    process.exit(1);
  }
  fs.writeFileSync(FILE_DATI, JSON.stringify({ s: elenco }), 'utf8');
  console.log('Salvato: dati/croazia.json');
}

main().catch(err => { console.log('ERRORE: ' + err.message); process.exit(1); });
