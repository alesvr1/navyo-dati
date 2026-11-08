// germania-prezzi.js
// Rifà ogni giorno l'elenco dei distributori tedeschi di Navyo (dati/germania.json)
// con il prezzo di mezzogiorno di Super E5 e Diesel.
// Fonte: archivio pubblico tankzeit.de (licenza CC0), che ogni notte salva
// l'elenco delle stazioni e i prezzi di mezzogiorno di MTS-K via Tankerkönig.
// Restano solo i distributori attivi (con un prezzo di mezzogiorno).
// Se qualcosa non va (file mancanti, troppe poche stazioni) il file NON viene
// cambiato e il programma finisce con errore (GitHub manda una mail).

const fs = require('fs');
const path = require('path');

const BASE = 'https://raw.githubusercontent.com/volzinnovation/tankzeit.de/master/data/';
const FILE_DATI = path.join(process.cwd(), 'dati', 'germania.json');
const MINIMO_STAZIONI = 10000;
const GIORNI_VALIDITA = 3;

const pulisci = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

async function scarica(nome) {
  for (let tentativo = 1; tentativo <= 3; tentativo++) {
    try {
      const res = await fetch(BASE + nome, { headers: { 'User-Agent': 'Navyo/1.0 (navyo-dati su GitHub)' }, signal: AbortSignal.timeout(60000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } catch (err) {
      console.log('   tentativo ' + tentativo + '/3 non riuscito per ' + nome + ': ' + err.message);
      await new Promise(ok => setTimeout(ok, 5000 * tentativo));
    }
  }
  throw new Error('impossibile scaricare ' + nome);
}

// CSV semplice (separatore virgola, campi eventualmente tra virgolette)
function leggiCsv(testo) {
  const righe = testo.replace(/^﻿/, '').split(/\r?\n/).filter(r => r.trim());
  const dividi = (riga) => {
    const campi = []; let cur = ''; let q = false;
    for (let i = 0; i < riga.length; i++) {
      const c = riga[i];
      if (q) { if (c === '"' && riga[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { campi.push(cur); cur = ''; } else cur += c;
    }
    campi.push(cur);
    return campi;
  };
  const intest = dividi(righe[0]);
  return righe.slice(1).map(r => { const v = dividi(r); const o = {}; intest.forEach((k, i) => { o[k] = v[i]; }); return o; });
}

function prezzo(valore, quando, adesso) {
  const p = parseFloat(String(valore || '').replace(',', '.'));
  if (!(p > 0.5 && p < 5)) return null;
  const t = Date.parse(quando || '');
  if (isNaN(t) || adesso - t > GIORNI_VALIDITA * 86400000) return null;
  return Math.round(p * 1000) / 1000;
}

// "2026-11-06T12:01:12+01:00" -> "06.11. 12:01" (ora tedesca, come scritta nel file)
function dataBreve(quando) {
  const m = String(quando || '').match(/^\d{4}-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[2]}.${m[1]}. ${m[3]}:${m[4]}` : null;
}

async function main() {
  console.log('Scarico i file di tankzeit.de...');
  const stazioni = JSON.parse(await scarica('stations.json'));
  const mezzogiorno = leggiCsv(await scarica('noon.csv'));
  console.log('Stazioni nell\'elenco: ' + stazioni.length + ' – stazioni con prezzo di mezzogiorno: ' + mezzogiorno.length);

  const prezzi = new Map(mezzogiorno.map(r => [r.station_uuid, r]));
  const adesso = Date.now();
  const elenco = [];
  let senzaCoordinate = 0, nonAttive = 0, conE5 = 0, conDiesel = 0;
  for (const s of stazioni) {
    const lat = Number(s.latitude), lng = Number(s.longitude);
    if (!(lat > 47 && lat < 55.2 && lng > 5.5 && lng < 15.5)) { senzaCoordinate++; continue; }
    const p = prezzi.get(s.uuid);
    if (!p) { nonAttive++; continue; }
    const e5 = prezzo(p.e5, p.e5_last_update || p.last_update, adesso);
    const diesel = prezzo(p.diesel, p.diesel_last_update || p.last_update, adesso);
    if (e5 != null) conE5++;
    if (diesel != null) conDiesel++;
    const nome = pulisci(s.brand) || pulisci(s.name) || 'Tankstelle';
    const via = pulisci(`${pulisci(s.street)} ${pulisci(s.house_number)}`);
    const citta = pulisci(`${pulisci(s.post_code)} ${pulisci(s.city)}`);
    elenco.push([nome, [via, citta].filter(Boolean).join(', '), Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5, e5, diesel, dataBreve(p.last_update)]);
  }
  console.log('Tenute: ' + elenco.length + ' (scartate ' + nonAttive + ' non attive, ' + senzaCoordinate + ' senza coordinate valide)');
  console.log('Con prezzo Super E5: ' + conE5 + ' – con prezzo Diesel: ' + conDiesel);

  if (elenco.length < MINIMO_STAZIONI) {
    console.log('ERRORE: troppo poche stazioni, il file NON viene cambiato.');
    process.exit(1);
  }
  fs.writeFileSync(FILE_DATI, JSON.stringify({ agg: new Date().toISOString().slice(0, 10), s: elenco }), 'utf8');
  console.log('Salvato: dati/germania.json');
}

main().catch(err => { console.log('ERRORE: ' + err.message); process.exit(1); });
