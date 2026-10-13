# Testumgebung für die InDesign-Skripte

Die Skripte in diesem Ordner lassen sich ohne InDesign laufen lassen – gegen
eine **Attrappe** des Objektmodells. Das ersetzt den Lauf in InDesign nicht,
fängt aber alles ab, was man sonst erst nach dem Kopieren, Doppelklicken und
Hinsehen merkt.

## Ausführen

```bash
cd indesign-skripte/tests
node alle.js                 # alles
node test-grep.js            # nur die GREP-Stile
SKRIPT=../grep-stile/GREP-Stile_einrichten_v4.jsx node test-grep.js   # eine andere Fassung
```

Braucht nur Node, keine Pakete.

## Warum die Attrappe die Macken nachbildet

Ein Test, der nur die heile Welt nachstellt, findet genau die Fehler nicht,
die hier Zeit gekostet haben. `indesign-attrappe.js` bildet deshalb bewusst
nach, was InDesign **tatsächlich** tut:

| Nachgebildet | Was dahintersteckt |
|---|---|
| `nestedGrepStyles.add()` ignoriert `appliedCharacterStyle` aus dem Eigenschaftsobjekt | Deshalb: setzen, zurücklesen, notfalls über den Namen |
| `File.open()` erkennt ein BOM, setzt die Kodierung um und verschluckt es | Deshalb: erst öffnen, dann auf `BINARY` stellen |
| `appliedFont` ist nicht immer ein Objekt mit `fontFamily` | Sonst steht `undefined` im Bericht |
| Dateisystem wahlweise mit oder ohne Beachtung der Groß-/Kleinschreibung | Windows gegen macOS |

**Wer eine neue Macke findet, baut sie hier ein.** Dann kann sie kein zweites
Mal durchrutschen.

## Eine Umgebung bauen

```js
const A = require('./indesign-attrappe');

const u = A.umgebung({
    os: 'Macintosh',                       // oder 'Windows 10/64'
    grossKleinBeachten: true,              // macOS-Dateisystem
    zeichenformate: [['Schrift Kyrillisch', 'Arial']],
    absatzformate:  ['Name', 'Firma'],
    dialog: {
        haken:  { 'Vorhandene GREP-Stile': true },
        felder: { '.': 'Source Han Sans' },
        vor: (REG) => { /* Zustand vor dem OK setzen */ },
        abbrechen: false
    }
});

A.laufen('../grep-stile/GREP-Stile_einrichten_v5.jsx', u);

console.log(u.meldungen);                  // alert()-Texte
console.log(u.berichte.map(b => b.text));  // geschriebene Berichtsdateien
```

## Prüfhilfen

```js
A.pruefe('Titel des Tests', istWert, sollWert);
process.exit(A.bilanz() ? 0 : 1);
```

## Grenzen

- Die Attrappe kennt nur, was die Skripte hier benutzen. Neue API-Aufrufe
  müssen ergänzt werden.
- Sie sagt nichts über Geschwindigkeit. Der String-Anhäng-Fehler, der InDesign
  minutenlang blockierte, fällt hier nicht auf.
- **Grün heißt nicht fertig.** Jede Fassung muss einmal in InDesign gelaufen
  sein, bevor sie als geprüft gilt.
