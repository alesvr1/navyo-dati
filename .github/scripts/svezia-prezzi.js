// svezia-prezzi.js
// Due volte al giorno scarica da bensinpriser.nu (prezzi segnalati dagli utenti)
// tutti i distributori della Svezia con i prezzi e salva dati/svezia.json,
// usato da Navyo per "vicino a me", lungo il percorso e i preferiti.
// Carburanti: benzina 95 e diesel. GPL e metano NON si prendono da qui.
// Per ogni distributore salva anche il collegamento alla sua pagina su
// bensinpriser.nu (prezzo e data dell'ultima segnalazione). Prezzi in corone (SEK).
// Se qualcosa non va (sito non raggiungibile, troppo pochi distributori)
// il file NON viene cambiato e il programma finisce con errore.

const fs = require('fs');
const path = require('path');

const URL_DATI = 'https://bensinpriser.nu/karta/data';
const FILE_DATI = path.join(process.cwd(), 'dati', 'svezia.json');
const MINIMO_STAZIONI = 2000;

const attesa = (ms) => new Promise(ok => setTimeout(ok, ms));

async function scarica() {
  for (let tentativo = 1; tentativo <= 3; tentativo++) {
    try {
      const res = await fetch(URL_DATI, { headers: { 'Accept': 'application/json', 'User-Agent': 'Navyo/1.0 (navyo-dati su GitHub)' }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const dati = await res.json();
      if (!Array.isArray(dati)) throw new Error('la risposta non è un elenco');
      return dati;
    } catch (err) {
      console.log('   tentativo ' + tentativo + '/3 non riuscito: ' + err.message);
      await attesa(5000 * tentativo);
    }
  }
  throw new Error('bensinpriser.nu non raggiungibile');
}

// "STORGATAN 1" -> "Storgatan 1"
const maiuscole = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase()
  .replace(/(^|[\s\-(/.,])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// prezzo in corone al litro: tiene solo valori sensati
const prezzo = (v) => {
  const n = Number(v);
  return n > 5 && n < 40 ? Math.round(n * 100) / 100 : null;
};

async function main() {
  const grezzi = await scarica();
  console.log('Distributori nel file di bensinpriser.nu: ' + grezzi.length);
  if (grezzi[0]) {
    console.log('Campi del primo distributore: ' + Object.keys(grezzi[0]).join(', '));
    console.log('Esempio: ' + JSON.stringify(grezzi[0]).slice(0, 600));
  }

  const visti = new Set();
  const elenco = [];
  for (const s of grezzi) {
    if (!s || typeof s !== 'object' || visti.has(s.id)) continue;
    visti.add(s.id);
    const lat = Number(s.lat), lng = Number(s.lng);
    if (!(lat > 55.3 && lat < 69.1 && lng > 11 && lng < 24.2)) continue;
    const marca = String(s.company || '').trim();
    const nome = marca && marca.toLowerCase() !== 'övriga' ? marca : 'Bensinstation';
    const indirizzo = [maiuscole(s.address), maiuscole(s.commune)].filter(Boolean).join(', ');
    elenco.push([nome, indirizzo, Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6, prezzo(s.price95), prezzo(s.priceDiesel), typeof s.link === 'string' && s.link.startsWith('/') ? s.link : null]);
  }
  const conta = (i) => elenco.filter(r => r[i] != null).length;
  console.log('Distributori salvati: ' + elenco.length + ' – con prezzo: benzina ' + conta(4) + ', diesel ' + conta(5) + ' – con collegamento: ' + conta(6));

  if (elenco.length < MINIMO_STAZIONI) {
    console.log('ERRORE: troppo pochi distributori, il file NON viene cambiato.');
    process.exit(1);
  }
  fs.writeFileSync(FILE_DATI, JSON.stringify({ s: elenco }), 'utf8');
  console.log('Salvato: dati/svezia.json');
}

main().catch(err => { console.log('ERRORE: ' + err.message); process.exit(1); });
