# Bildpfad-Check

`Bildpfad-Check.jsx`

Prüft vor der Datenzusammenführung alle Bildpfade der Datenquelle gegen den
tatsächlichen Ordnerbaum – und nennt zu jedem Problem Datensatz und Feld.
InDesign selbst zeigt zwar fehlende Bilder an, aber nicht, zu welchem
Datensatz sie gehören; im fertigen Dokument bleibt vom fehlenden Bild keine
Spur.

## Die drei Klassen

| Klasse | Bedeutung | Wer löst es |
|---|---|---|
| Nur Schreibweise | Datei liegt am richtigen Ort, nur die Notation stimmt nicht (fehlendes `./`, `/` statt `\`) | Das Werkzeug, automatisch |
| Gefunden, aber anders | Anderer Ordner oder Name (Endung, Umlaut, Groß-/Kleinschreibung) | Vorschlag, Entscheidung von Hand |
| Nirgends | Keine passende Datei im Ordnerbaum | Jemand muss ein Bild liefern |

## Wichtigster Befund

`./` bezieht sich beim Zusammenführen auf den Ordner der **Datenquelle**,
nicht auf den des Dokuments. Plattformfest ist nur `./ordner/datei.png` –
das setzt voraus, dass die Bilder neben der Datenquelle liegen.

## Geprüft

Gegen eine Test-Attrappe ([`../tests/`](../tests/)) sowie einen Trockenlauf
mit realen Testdateien. **In echtem InDesign noch nicht gelaufen.**

## Was es nicht tut

Es ändert nur die Datenquelle, nie die Bilddateien selbst, und nie das
InDesign-Dokument.
