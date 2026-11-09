// slovenija.js
// Ogni ora scarica da goriva.si (fonte ufficiale slovena) tutti i distributori
// della Slovenia con i prezzi e salva dati/slovenija.json, usato da Navyo
// per la ricerca lungo il percorso.
// Carburanti: benzina 95, dizel, GPL (avtoplin-lpg), metano (cng).
// Se qualcosa non va (sito non raggiungibile, troppo pochi distributori)
// il file NON viene cambiato e il programma finisce con errore.

const fs = require('fs');
const path = require('path');

const PRIMA_PAGINA = 'https://goriva.si/api/v1/search/?position=46.15,14.99&radius=250000';
const FILE_DATI = path.join(process.cwd(), 'dati', 'slovenija.json');
const MINIMO_STAZIONI = 400;
const MAX_PAGINE = 60;

const attesa = (ms) => new Promise(ok => setTimeout(ok, ms));

// "PETROL LJUBLJANA - TIVOLSKA" -> "Petrol Ljubljana - Tivolska"
const maiuscole = (t) => String(t || '').replace(/\s+/g, ' ').trim().toLowerCase()
  .replace(/(^|[\s\-(/.,])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

async function scaricaPagina(url) {
  for (let tentativo = 1; tentativo <= 3; tentativo++) {
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json', 'User-Agent': 'Navyo/1.0 (navyo-dati su GitHub)' }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) {
      console.log('   tentativo ' + tentativo + '/3 non riuscito: ' + err.message);
      await attesa(3000 * tentativo);
    }
  }
  throw new Error('pagina non raggiungibile: ' + url);
}

const prezzo = (v) => {
  const n = Number(v);
  return n > 0.3 && n < 5 ? Math.round(n * 1000) / 1000 : null;
};

async function main() {
  const stazioni = [];
  let url = PRIMA_PAGINA;
  let totale = null;
  for (let pagina = 1; url && pagina <= MAX_PAGINE; pagina++) {
    const d = await scaricaPagina(url);
    if (totale === null) totale = d.count;
    stazioni.push(...(d.results || []));
    url = d.next;
    await attesa(1000);
  }
  console.log('Distributori dichiarati da goriva.si: ' + totale + ' – letti: ' + stazioni.length);

  const visti = new Set();
  const elenco = [];
  for (const s of stazioni) {
    if (visti.has(s.pk)) continue;
    visti.add(s.pk);
    const lat = Number(s.lat), lng = Number(s.lng);
    if (!(lat > 45.3 && lat < 47 && lng > 13.3 && lng < 16.7)) continue;
    const p = s.prices || {};
    const p95 = prezzo(p['95']), dizel = prezzo(p['dizel']), lpg = prezzo(p['avtoplin-lpg']), cng = prezzo(p['cng']);
    if (p95 == null && dizel == null && lpg == null && cng == null) continue;
    const indirizzo = [maiuscole(s.address), s.zip_code].filter(Boolean).join(', ');
    elenco.push([maiuscole(s.name), indirizzo, Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6, p95, dizel, lpg, cng]);
  }
  const conta = (i) => elenco.filter(r => r[i] != null).length;
  console.log('Distributori salvati: ' + elenco.length + ' (benzina ' + conta(4) + ', diesel ' + conta(5) + ', GPL ' + conta(6) + ', metano ' + conta(7) + ')');

  if (elenco.length < MINIMO_STAZIONI) {
    console.log('ERRORE: troppo pochi distributori, il file NON viene cambiato.');
    process.exit(1);
  }
  fs.writeFileSync(FILE_DATI, JSON.stringify({ s: elenco }), 'utf8');
  console.log('Salvato: dati/slovenija.json');
}

main().catch(err => { console.log('ERRORE: ' + err.message); process.exit(1); });
