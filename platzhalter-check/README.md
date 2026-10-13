# Platzhalter-Check

Vergleicht die Platzhalter im InDesign-Layout (`<<Feldname>>`) gegen die
Felder der verknüpften Datenquelle und meldet, was beim Zusammenführen
scheitern wird – genau die Information, die InDesigns eigene Fehlermeldung
verschweigt.

**Aktuelle Fassung: `Platzhalter-Check_v2.jsx`.** Die anderen Dateien in
diesem Ordner sind frühere Entwicklungsstufen (siehe unten) und bleiben aus
Dokumentationsgründen erhalten – nicht zur Verwendung.

## Was es findet

| Meldung | Bedeutung |
|---|---|
| `VERWAIST` | Platzhalter nennt ein Feld, das es in der Datenquelle nicht gibt |
| `FALSCHER TYP` | Name stimmt, Feldtyp nicht – z. B. Text-Platzhalter auf einem QR- oder Bildfeld |
| `PHANTOMFELD` | InDesign hat bei doppeltem Spaltennamen automatisch umbenannt (`Abteilung` → `Abteilung1`) – das Feld sieht im Dokument normal aus, hat aber keine eigene Spalte |

## Herkunft der Vorstufen

- `Platzhalter-Check_Original_MichaelHan.jsx` – unverändertes Original von
  Michael Han (Kommentar vom 19.01.2025 auf Adobe InDesign UserVoice)
- `Platzhalter-Check_erweitert.jsx`, `Platzhalter-Check_Diagnose.jsx` –
  eigene Zwischenschritte

## Geprüft

Gegen eine Test-Attrappe des InDesign-Objektmodells, siehe
[`../tests/`](../tests/). **In echtem InDesign noch nicht gelaufen** – vor
Verwendung selbst testen.

## Was es nicht tut

Es ändert nichts im Dokument – rein lesend. Es prüft nur Felder, keine
Grafikrahmen-Zuordnung über Namen hinaus.
