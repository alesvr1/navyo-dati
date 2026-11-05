// gpl-mylpg.js
// Rifà gli elenchi GPL di Navyo dai file POI di myLPG.eu (già scaricati e scompattati
// dal programma su GitHub nella cartella "mylpg"). Una volta alla settimana.
// Regole (le stesse usate a mano fino al 05/11/2026):
// - tolte le stazioni "Temporarily out of order" / "Temp closed"
// - tolte quelle solo per gas tempo libero / camper ("Leisure gas", "Habitation use")
// - "Members only" tenute, segnate come riservate (5° valore = 1)
// - tolte le stazioni con coordinate fuori dal paese
// - tolti i doppioni (entro 50 m: si tiene quella con l'indirizzo)
// - eccezioni decise da Alex (vedi ESCLUSE)
// Se un elenco nuovo ha molte meno stazioni del vecchio, quel file non viene toccato
// e il programma finisce con errore (GitHub manda una mail).

const fs = require('fs');
const path = require('path');

const CARTELLA_MYLPG = path.join(process.cwd(), 'mylpg');
const CARTELLA_DATI = path.join(process.cwd(), 'dati');

const PAESI = [
  { codice: 'A', file: 'gpl-austria.json', nome: 'Austria', box: [46.3, 49.1, 9.4, 17.3] },
  { codice: 'D', file: 'gpl-germania.json', nome: 'Germania', box: [47.2, 55.1, 5.8, 15.1] },
  { codice: 'UK', file: 'gpl-regnounito.json', nome: 'Regno Unito', box: [49.8, 61.0, -8.8, 1.9] },
  { codice: 'N', file: 'gpl-norvegia.json', nome: 'Norvegia', box: [57.9, 71.3, 4.4, 31.3] },
  { codice: 'S', file: 'gpl-svezia.json', nome: 'Svezia', box: [55.2, 69.1, 10.9, 24.2] },
];

// Stazioni tolte per scelta di Alex (cerca nel nome + indirizzo, senza maiuscole)
const ESCLUSE = {
  N: [/svolv(æ|ae)r/i],
  S: [/svetskompaniet/i],
};

// Note da togliere dal nome
const NOTE_DA_TOGLIERE = [/\s*-\s*members only\s*/gi, /\s*-\s*new location\s*/gi, /\s*-\s*same price for bottles\s*/gi];

const FUORI_SERVIZIO = /out of order|temp(orarily)?\.? closed/i;
const SOLO_TEMPO_LIBERO = /leisure gas|habitation use/i;
const SOCI = /members only/i;

function leggiTesto(file) {
  const buf = fs.readFileSync(file);
  let testo = buf.toString('utf8');
  if (testo.includes('�')) testo = buf.toString('latin1');
  return testo.replace(/^﻿/, '');
}

// Legge una riga CSV con campi tra virgolette o no
function leggiRiga(riga) {
  const campi = [];
  let cur = '';
  let virgolette = false;
  for (let i = 0; i < riga.length; i++) {
    const c = riga[i];
    if (virgolette) {
      if (c === '"' && riga[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') virgolette = false;
      else cur += c;
    } else if (c === '"') virgolette = true;
    else if (c === ',') { campi.push(cur); cur = ''; }
    else cur += c;
  }
  campi.push(cur);
  return campi;
}

function distanzaM(a, b) {
  const R = 6371000;
  const dLat = (b[2] - a[2]) * Math.PI / 180;
  const dLng = (b[3] - a[3]) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[2] * Math.PI / 180) * Math.cos(b[2] * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function pulisci(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

function trovaCsv(codice) {
  const cartella = path.join(CARTELLA_MYLPG, codice);
  const trovati = fs.readdirSync(cartella).filter(f => f.toLowerCase().endsWith('.csv'));
  if (trovati.length === 0) throw new Error('nessun file CSV per ' + codice);
  return path.join(cartella, trovati[0]);
}

let errori = 0;

for (const paese of PAESI) {
  console.log('');
  console.log('=== ' + paese.nome + ' ===');
  try {
    const righe = leggiTesto(trovaCsv(paese.codice)).split(/\r?\n/).filter(r => r.trim());
    const scarti = { fuoriServizio: 0, tempoLibero: 0, coordinate: 0, escluse: 0, doppioni: 0 };
    const elenco = [];
    for (const r of righe) {
      const c = leggiRiga(r);
      if (c.length < 4) continue;
      const lng = parseFloat(c[0]);
      const lat = parseFloat(c[1]);
      let nome = pulisci(c[2]);
      const indirizzo = pulisci(String(c[3]).replace(/\s*-\s*myLPG\.eu\s*$/i, ''));
      if (isNaN(lat) || isNaN(lng)) continue;
      if (FUORI_SERVIZIO.test(nome)) { scarti.fuoriServizio++; continue; }
      if (SOLO_TEMPO_LIBERO.test(nome)) { scarti.tempoLibero++; continue; }
      const [latMin, latMax, lngMin, lngMax] = paese.box;
      if (lat < latMin || lat > latMax || lng < lngMin || lng > lngMax) { scarti.coordinate++; console.log('   coordinate fuori dal paese: ' + nome + ' (' + lat + ', ' + lng + ')'); continue; }
      if ((ESCLUSE[paese.codice] || []).some(re => re.test(nome + ' ' + indirizzo))) { scarti.escluse++; continue; }
      const soci = SOCI.test(nome);
      NOTE_DA_TOGLIERE.forEach(re => { nome = nome.replace(re, ' '); });
      nome = pulisci(nome).replace(/\s*-\s*$/, '');
      const voce = [nome, indirizzo, Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6];
      if (soci) voce.push(1);
      const doppione = elenco.findIndex(e => distanzaM(e, voce) < 50);
      if (doppione >= 0) {
        scarti.doppioni++;
        console.log('   doppione: "' + voce[0] + '" e "' + elenco[doppione][0] + '"');
        if (!elenco[doppione][1] && voce[1]) elenco[doppione] = voce;
        continue;
      }
      elenco.push(voce);
    }
    elenco.sort((a, b) => b[2] - a[2]);

    const fileDati = path.join(CARTELLA_DATI, paese.file);
    let vecchio = [];
    if (fs.existsSync(fileDati)) vecchio = JSON.parse(fs.readFileSync(fileDati, 'utf8')).s || [];
    console.log('Righe nel file myLPG: ' + righe.length + ' – stazioni in Navyo: ' + elenco.length + ' (prima: ' + vecchio.length + ')');
    console.log('Tolte: ' + scarti.fuoriServizio + ' fuori servizio, ' + scarti.tempoLibero + ' solo tempo libero/camper, ' + scarti.coordinate + ' coordinate sbagliate, ' + scarti.escluse + ' escluse da Alex, ' + scarti.doppioni + ' doppioni');

    const chiave = v => v[2].toFixed(4) + ',' + v[3].toFixed(4);
    const vecchie = new Set(vecchio.map(chiave));
    const nuove = new Set(elenco.map(chiave));
    elenco.filter(v => !vecchie.has(chiave(v))).forEach(v => console.log('   + nuova: ' + v[0] + ' – ' + v[1]));
    vecchio.filter(v => !nuove.has(chiave(v))).forEach(v => console.log('   - tolta: ' + v[0] + ' – ' + v[1]));

    if (vecchio.length > 0 && elenco.length < vecchio.length * 0.8) {
      console.log('ERRORE: troppe stazioni in meno rispetto a prima, il file NON viene cambiato.');
      errori++;
      continue;
    }
    fs.writeFileSync(fileDati, JSON.stringify({ agg: new Date().toISOString().slice(0, 10), s: elenco }), 'utf8');
    console.log('Salvato: dati/' + paese.file);
  } catch (err) {
    console.log('ERRORE ' + paese.nome + ': ' + err.message);
    errori++;
  }
}

if (errori > 0) process.exit(1);
console.log('');
console.log('Tutto finito.');
