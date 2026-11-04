// prezzi-finlandia.js
// Gira da solo su GitHub (GitHub Actions) due volte al giorno.
// 1. Legge le pagine di polttoaine.net (citta', aree, autostrade) con nome, data e prezzi.
// 2. Prende le coordinate dei distributori da dati/coordinate-polttoaine.json;
//    per i distributori nuovi legge la loro pagina della mappa e aggiunge le coordinate al file.
// 3. Abbina ogni distributore di polttoaine.net a quello di OpenStreetMap
//    (dati/carburanti-finlandia.json): stessa marca entro 400 m, oppure il piu' vicino entro 50 m.
// 4. Salva dati/prezzi-finlandia.json, che Navyo scarica.
// Se legge troppo pochi distributori (sito cambiato o non raggiungibile) si ferma con un errore
// e non tocca il file dei prezzi: GitHub manda una mail al proprietario dell'archivio.

const fs = require('fs');
const path = require('path');

const BASE = 'https://www.polttoaine.net';
const PAUSA_MS = 500;
const CARTELLA_DATI = path.join(process.cwd(), 'dati');
const FILE_ELENCO = path.join(CARTELLA_DATI, 'carburanti-finlandia.json');
const FILE_COORDINATE = path.join(CARTELLA_DATI, 'coordinate-polttoaine.json');
const FILE_PREZZI = path.join(CARTELLA_DATI, 'prezzi-finlandia.json');

const PAGINE = [
  'Helsinki', 'Espoo', 'Vantaa', 'Tampere', 'Turku', 'Oulu',
  'Jyva_skyla_', 'Kuopio', 'Lahti', 'Rovaniemi', 'Kotka', 'Kouvola',
  'Vaasa', 'Salo', 'Mikkeli', 'Raahe', 'Rauma', 'Savonlinna',
  'Seina_joki', 'Ha_meenlinna', 'Kokkola', 'Imatra', 'Kemi',
  'Riihima_ki', 'Lohja', 'Forssa', 'Heinola', 'Akaa',
  'Ja_rvenpa_a_', 'Nurmija_rvi', 'Tuusula', 'Vihti', 'Hollola',
  'Kangasala', 'Pirkkala', 'Lempa_a_la_', 'Kaarina', 'Raisio',
  'Naantali', 'Lieto', 'Kempele', 'Liminka', 'Ii',
  'Kuusamo', 'Tornio', 'Kittila_', 'Inari', 'Muonio', 'Kolari',
  'A_a_nekoski', 'Varkaus', 'Nurmes', 'Ylivieska', 'Oulainen',
  'Alavus', 'Lapua', 'Ikaalinen', 'Parkano', 'Uusikaupunki',
  'Laitila', 'Hanko', 'Raasepori', 'Ma_ntsa_la_', 'Ka_rko_la_',
  'Nastola', 'Asikkala', 'Orivesi', 'Paimio', 'Masku',
  'Hankasalmi', 'Hyrynsalmi', 'Iitti', 'Isokyro_', 'Juupajoki',
  'Juva', 'Kuhmoinen', 'Kuortane', 'Leppa_virta', 'Luuma_ki',
  'Ma_ntta_-Vilppula', 'Muhos', 'Outokumpu', 'Parainen',
  'Pederso_re', 'Pielavesi', 'Pihtipudas', 'Pudasja_rvi',
  'Pukkila', 'Pyhta_a_', 'Pyha_nta_', 'Pa_lka_ne', 'Po_ytya_',
  'Ristiina', 'Siikalatva', 'Sulkava', 'Suonenjoki',
  'Tohmaja_rvi', 'Utaja_rvi', 'Valtimo', 'Viitasaari', 'Virrat',
  'index.php?t=PK-Seutu',
  'index.php?t=Turun_seutu',
  'index.php?t=Tampereen_seutu',
  'index.php?t=Oulun_seutu',
  'index.php?t=Jyva_skyla_n_seutu',
  'index.php?t=Porin_seutu',
  'index.php?t=Seina_joen_seutu',
  '1-tie', '3-tie', '4-tie', '5-tie', '7-tie', '8-tie', '9-tie',
];

const INTESTAZIONI = {
  'Accept': 'text/html',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'fi-FI,fi;q=0.9,en;q=0.8',
};

const attesa = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function scarica(url) {
  for (let tentativo = 0; tentativo < 3; tentativo++) {
    try {
      const res = await fetch(url, { headers: INTESTAZIONI, signal: AbortSignal.timeout(20000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      const tipo = (res.headers.get('content-type') || '').toLowerCase();
      let codifica = (tipo.match(/charset=([\w-]+)/) || [])[1];
      if (!codifica) codifica = (buf.toString('latin1', 0, 4000).match(/charset=["']?([\w-]+)/i) || [])[1];
      codifica = (codifica || 'utf-8').toLowerCase();
      if (codifica === 'utf8') codifica = 'utf-8';
      try { return new TextDecoder(codifica).decode(buf); } catch { return buf.toString('latin1'); }
    } catch (err) {
      console.log('   tentativo non riuscito (' + (tentativo + 1) + '/3): ' + url + ' - ' + err.message);
      await attesa(2000 * (tentativo + 1));
    }
  }
  return null;
}

function pulisci(testo) {
  let prima = '';
  while (prima !== testo) { prima = testo; testo = testo.replace(/<[^>]+>/g, ''); }
  const lettere = { auml: 'ä', Auml: 'Ä', ouml: 'ö', Ouml: 'Ö', uuml: 'ü', Uuml: 'Ü', aring: 'å', Aring: 'Å', eacute: 'é', Eacute: 'É' };
  return testo
    .replace(/&(auml|Auml|ouml|Ouml|uuml|Uuml|aring|Aring|eacute|Eacute);/g, (m, n) => lettere[n])
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ').trim();
}

function prezzo(cella) {
  const t = pulisci(cella).replace(/^\*/, '').trim();
  const v = parseFloat(t);
  if (isNaN(v) || v < 0.8 || v > 4) return null;
  return v;
}

function leggiPagina(html) {
  const trovati = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let tr;
  while ((tr = trRe.exec(html)) !== null) {
    const celle = [];
    tdRe.lastIndex = 0;
    let td;
    while ((td = tdRe.exec(tr[1])) !== null) celle.push(td[1]);
    if (celle.length !== 5) continue;
    const link = celle[0].match(/cmd=map&(?:amp;)?id=(\d+)/i);
    if (!link) continue;
    const testo = pulisci(celle[0].replace(/<a[^>]*>[\s\S]*?<\/a>/i, ''));
    const data = pulisci(celle[1]);
    const p95 = prezzo(celle[2]);
    const p98 = prezzo(celle[3]);
    const pDi = prezzo(celle[4]);
    if (!testo || (p95 == null && p98 == null && pDi == null)) continue;
    trovati.push({ id: link[1], testo, data, p95, p98, pDi });
  }
  return trovati;
}

function leggiCoordinate(html) {
  let m = html.match(/new\s+google\.maps\.LatLng\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
  if (!m) {
    const lat = html.match(/lat:\s*'([-\d.]+)'/);
    const lon = html.match(/lon:\s*'([-\d.]+)'/);
    if (lat && lon) m = [null, lat[1], lon[1]];
  }
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  if (isNaN(lat) || isNaN(lng) || lat < 59.5 || lat > 70.5 || lng < 19 || lng > 32) return null;
  return [lat, lng];
}

// "dd.mm." -> numero confrontabile (mese*100 + giorno), per tenere la segnalazione piu' recente
function valoreData(d) {
  const m = (d || '').match(/(\d{1,2})\.(\d{1,2})\./);
  return m ? Number(m[2]) * 100 + Number(m[1]) : 0;
}

function distanza(a, b) {
  const r = Math.PI / 180;
  const x = Math.sin((b[0] - a[0]) * r / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin((b[1] - a[1]) * r / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x));
}

function marcaNormale(m) {
  m = (m || '').toLowerCase();
  if (m.startsWith('shell') || m.startsWith('st1')) return 'st1'; // in Finlandia le Shell sono diventate St1
  if (m.startsWith('neste')) return 'neste';
  if (m.startsWith('seo')) return 'seo';
  if (m.startsWith('teboil')) return 'teboil';
  if (m.includes('kärkkäinen')) return 'kark';
  return m.slice(0, 3);
}

// Marca dal testo di polttoaine.net: "Neste Oil, Munkkiniemi ..." oppure (pagine autostrade) "Hyvinkää, ABC, ..."
function marcaPolttoaine(testo) {
  const parti = testo.split(',').map((s) => s.trim());
  const marche = /^(abc|neste|st1|shell|teboil|seo|ysi5|j\.k|futura|gulf|ritoil)/i;
  if (parti.length > 2 && !marche.test(parti[0]) && marche.test(parti[1])) return marcaNormale(parti[1].split(' ')[0]);
  return marcaNormale(parti[0].split(' ')[0]);
}

async function main() {
  const elenco = JSON.parse(fs.readFileSync(FILE_ELENCO, 'utf8')).s;
  let coordinate = {};
  try { coordinate = JSON.parse(fs.readFileSync(FILE_COORDINATE, 'utf8')); } catch {}

  console.log('Lettura delle pagine di polttoaine.net (' + PAGINE.length + ' pagine)...');
  const distributori = new Map();
  for (const pagina of PAGINE) {
    const html = await scarica(BASE + '/' + pagina);
    if (html) {
      leggiPagina(html).forEach((r) => {
        const prima = distributori.get(r.id);
        if (!prima || valoreData(r.data) > valoreData(prima.data)) distributori.set(r.id, r);
      });
    }
    await attesa(PAUSA_MS);
  }
  console.log('Distributori con prezzo: ' + distributori.size);
  if (distributori.size < 50) {
    console.log('Troppo pochi distributori: il sito potrebbe essere cambiato o non raggiungibile. Il file dei prezzi non viene toccato.');
    process.exit(1);
  }

  let nuovi = 0;
  for (const d of distributori.values()) {
    if (coordinate[d.id]) continue;
    const html = await scarica(BASE + '/index.php?cmd=map&id=' + d.id);
    const c = html ? leggiCoordinate(html) : null;
    if (c) { coordinate[d.id] = c; nuovi++; }
    await attesa(PAUSA_MS);
  }
  console.log('Coordinate nuove lette: ' + nuovi);

  const prezzi = {};
  let abbinati = 0;
  for (const d of distributori.values()) {
    const c = coordinate[d.id];
    if (!c) continue;
    const marca = marcaPolttoaine(d.testo);
    let migliore = null;
    let migliorePunti = Infinity;
    for (const s of elenco) {
      if (Math.abs(s[2] - c[0]) > 0.005 || Math.abs(s[3] - c[1]) > 0.01) continue;
      const dist = distanza(c, [s[2], s[3]]);
      const stessa = marcaNormale(s[4] || s[0]) === marca;
      if (stessa && dist <= 400) { if (dist < migliorePunti) { migliore = s; migliorePunti = dist; } }
      else if (dist <= 50 && dist + 1000 < migliorePunti) { migliore = s; migliorePunti = dist + 1000; }
    }
    if (!migliore) continue;
    const chiave = migliore[2] + ',' + migliore[3];
    const prima = prezzi[chiave];
    if (prima && valoreData(prima[3]) >= valoreData(d.data)) continue;
    prezzi[chiave] = [d.p95, d.p98, d.pDi, d.data];
    abbinati++;
  }
  console.log('Distributori abbinati a OpenStreetMap: ' + abbinati);

  fs.writeFileSync(FILE_COORDINATE, JSON.stringify(coordinate), 'utf8');
  fs.writeFileSync(FILE_PREZZI, JSON.stringify({ agg: new Date().toISOString(), p: prezzi }), 'utf8');
  console.log('Tutto finito.');
}

main().catch((err) => { console.log('Errore:', err); process.exit(1); });
