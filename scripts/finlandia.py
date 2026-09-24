import json, sys, os, datetime

with open("fi_all.json", encoding="utf-8") as f:
    dati = json.load(f)

colonnine = []
for feat in dati.get("features", []):
    try:
        lng, lat = feat["geometry"]["coordinates"][:2]
        lat = float(lat)
        lng = float(lng)
    except Exception:
        continue
    p = feat.get("properties") or {}
    ind = p.get("address") or {}
    evses = p.get("evses") or []
    potenza = 0
    for e in evses:
        for c in (e.get("connectors") or []):
            w = c.get("maxElectricPower")
            if isinstance(w, (int, float)) and w > potenza:
                potenza = w
    operatore = ((p.get("operator") or {}).get("details") or {}).get("name") or ""
    colonnine.append({
        "n": p.get("name") or "",
        "o": operatore,
        "a": ", ".join(x for x in [ind.get("street"), ind.get("city")] if x),
        "lat": round(lat, 5),
        "lng": round(lng, 5),
        "k": len(evses),
        "kw": round(potenza / 1000, 1),
    })

if len(colonnine) < 100:
    print("Troppo poche colonnine, qualcosa non va:", len(colonnine))
    sys.exit(1)

risultato = {
    "aggiornato": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    "totale": len(colonnine),
    "colonnine": colonnine,
}

os.makedirs("dati", exist_ok=True)
with open("dati/finlandia.json", "w", encoding="utf-8") as f:
    json.dump(risultato, f, ensure_ascii=False, separators=(",", ":"))

print("Salvate", len(colonnine), "colonnine")
