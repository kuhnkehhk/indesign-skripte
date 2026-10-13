# InDesign-Skripte

Drei eigenständige ExtendScript-Werkzeuge für die Fehlerdiagnose bei der
InDesign-Datenzusammenführung (Data Merge). Entstanden als Beigabe zu einem
Nischenangebot zur Fehlerdiagnose bei der Datenzusammenführung
([kuhnke-owl.de](https://kuhnke-owl.de)).

## Die drei Werkzeuge

| Werkzeug | Was es tut |
|---|---|
| [`platzhalter-check/`](platzhalter-check/) | Findet Platzhalter im Layout, die auf kein Feld, ein Feld mit falschem Typ oder ein verwaistes Phantomfeld zeigen |
| [`bildpfad-check/`](bildpfad-check/) | Prüft Bildpfade in der Datenquelle gegen den Ordnerbaum, bevor InDesign beim Zusammenführen stillschweigend leere Rahmen erzeugt |
| [`grep-stile/`](grep-stile/) | Richtet GREP-Stile ein, die automatisch die passende Schrift für fremde Schriftsysteme wählen (Kyrillisch, Arabisch, CJK, Hangul, Thai, Devanagari, ...) |

Jedes Werkzeug ist unabhängig nutzbar – der einzige Zusammenhang ist der
gemeinsame Einsatzbereich: die InDesign-Datenzusammenführung.

## Installation

Die passende `.jsx`-Datei in den InDesign-Skriptordner legen
(**Fenster → Hilfsprogramme → Skripte**, im Bedienfeld Rechtsklick auf
**User → Im Explorer/Finder anzeigen**) und im Skripte-Bedienfeld
doppelklicken.

## Tests

`tests/` enthält eine Node-Testumgebung mit einer Attrappe des InDesign-
Objektmodells – lauffähig ohne InDesign, ersetzt aber den echten Lauf nicht.
Details dazu in [`tests/README.md`](tests/README.md).

## Status

**Beigabe, kein Produkt** – datiert, versioniert, kein Anpassungs-Support.
Geprüfte Umgebungen, bekannte Grenzen und offene Punkte stehen jeweils im
README des einzelnen Werkzeugs.

## Lizenz

[CC BY 4.0](LICENSE) – Nutzung, Anpassung und Weitergabe frei, mit
Namensnennung.
