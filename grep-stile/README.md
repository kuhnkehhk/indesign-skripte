# GREP-Stile für Schriftsysteme

Richtet GREP-Stile in Absatzformaten ein, die automatisch die passende
Schrift für neun Schriftsysteme wählen (Griechisch, Kyrillisch, Hebräisch,
Arabisch, Kana, CJK-Ideogramme, Hangul, Thai, Devanagari). Keine Schrift
deckt alle Schriftsysteme ab – das Absatzformat wählt die Schrift
stattdessen selbst, ohne dass ein Rahmen angefasst wird.

**Aktuelle Fassung: `GREP-Stile_einrichten_v5.jsx`.** Die übrigen Dateien
sind frühere Entwicklungsstufen und bleiben aus Dokumentationsgründen
erhalten.

## Bedienung

Links die Absatzformate auswählen (Mehrfachauswahl), rechts die
Schriftsysteme ankreuzen und je eine Schrift wählen. Das Skript schlägt
installierte Schriften selbst vor und hakt ein System an, wenn es eine
passende findet.

## Geprüft

Gegen eine Test-Attrappe ([`../tests/`](../tests/)), inklusive der
nachgebildeten Eigenheit, dass `nestedGrepStyles.add()` das übergebene
Zeichenformat ignoriert. **In echtem InDesign noch nicht gelaufen.**

## Was es garantiert nicht tut

- Vorhandene Zeichenformate werden ohne ausdrückliches Häkchen nicht
  überschrieben
- Ein GREP-Stil mit demselben Ausdruck wird nicht doppelt angelegt
- Es entstehen keine neuen Absatzformate, bestehende werden nur ergänzt

Alles läuft in einem einzigen Arbeitsschritt – ein Strg+Z macht alles
rückgängig.
