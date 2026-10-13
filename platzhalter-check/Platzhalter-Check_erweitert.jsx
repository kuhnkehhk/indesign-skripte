/*
    Platzhalter-Check – ERWEITERTE FASSUNG
    ------------------------------------------------------------------
    Aufbauend auf dem Skript von Michael Han (UserVoice, 19.01.2025),
    erweitert am 21.09.2026 für die Testreihe Datenzusammenführung.

    WAS GEGENÜBER DEM ORIGINAL ANDERS IST

    1. Erfasst ALLE Textrahmen über doc.allPageItems – also auch
       Rahmen auf Musterseiten und in Gruppen. Das Original nutzt
       doc.textFrames und übersieht beides. Ausgerechnet der
       ursprüngliche Fragesteller auf UserVoice hatte das Problem
       auf seinen Musterseiten.

    2. Überlaufende Rahmen werden nicht mehr als Fehler gemeldet.
       Überlauf ist ein Layoutproblem, kein Platzhalterproblem.
       Der Text wird trotzdem geprüft.

    3. Zusätzlich: Liste aller Felder der Datenquelle mit der Angabe,
       ob sie im Layout verwendet werden. Das entspricht der
       Zahlenspalte im Bedienfeld.

    4. Warnt ausdrücklich davor, dass Bild- und QR-Platzhalter mit
       diesem Ansatz NICHT prüfbar sind.

    NUR LESEND. Das Skript ändert nichts am Dokument.

    AUSFÜHREN  Fenster > Hilfsprogramme > Skripte, Datei in den Ordner
               "User" legen, dann doppelklicken.
*/

function platzhalterCheck() {

    if (app.documents.length === 0) {
        alert("Kein Dokument geöffnet.");
        return;
    }

    var doc = app.activeDocument;

    // ---------- Feldliste der Datenquelle ----------
    var felder = [];
    try {
        if (!doc.dataMergeProperties || doc.dataMergeProperties.dataMergeFields.length === 0) {
            alert("Keine Datenquelle verknüpft, oder die Datenquelle enthält keine Felder.");
            return;
        }
        var mf = doc.dataMergeProperties.dataMergeFields;
        for (var i = 0; i < mf.length; i++) {
            felder.push(String(mf[i].fieldName));
        }
    } catch (e) {
        alert("Feldliste konnte nicht gelesen werden: " + e.message);
        return;
    }

    function enthaelt(arr, wert) {
        for (var i = 0; i < arr.length; i++) {
            if (arr[i] === wert) return true;
        }
        return false;
    }

    // ---------- Alle Textrahmen einsammeln, inkl. Musterseiten und Gruppen ----------
    var rahmen = [];
    try {
        var alle = doc.allPageItems;
        for (var a = 0; a < alle.length; a++) {
            var it = alle[a];
            try {
                if (it.constructor.name === "TextFrame") rahmen.push(it);
            } catch (e1) {}
        }
    } catch (e2) {
        // Rückfallebene: wie im Original
        var tf = doc.textFrames;
        for (var b = 0; b < tf.length; b++) rahmen.push(tf[b]);
    }

    // ---------- Platzhalter suchen ----------
    var unbekannt = [];      // Platzhalter ohne Feld in der Quelle
    var gefunden = [];       // Feldnamen, die im Layout vorkommen
    var muster = /<<([^>]+)>>/g;

    for (var j = 0; j < rahmen.length; j++) {
        var f = rahmen[j];
        var inhalt = "";
        try { inhalt = String(f.contents); } catch (e3) { continue; }

        // Ort des Rahmens beschreiben
        var ort = "Rahmen " + (j + 1);
        try {
            var p = f.parentPage;
            if (p === null) {
                ort += " (Musterseite oder Montagefläche)";
            } else {
                ort += " (Seite " + p.name + ")";
            }
        } catch (e4) {}

        muster.lastIndex = 0;
        var treffer;
        while ((treffer = muster.exec(inhalt)) !== null) {
            var name = String(treffer[1]).replace(/^\s+|\s+$/g, "");
            if (enthaelt(felder, name)) {
                if (!enthaelt(gefunden, name)) gefunden.push(name);
            } else {
                unbekannt.push("<<" + name + ">>  –  " + ort);
            }
        }
    }

    // ---------- Bericht ----------
    var z = [];
    z.push("PLATZHALTER-CHECK");
    z.push("Dokument: " + doc.name);
    z.push("Geprüfte Textrahmen: " + rahmen.length + "  (inkl. Musterseiten und Gruppen)");
    z.push("");

    if (unbekannt.length > 0) {
        z.push("PROBLEM – Platzhalter ohne passendes Feld in der Datenquelle:");
        z.push("");
        for (var u = 0; u < unbekannt.length; u++) z.push("   " + unbekannt[u]);
    } else {
        z.push("Alle gefundenen Textplatzhalter haben ein Feld in der Datenquelle.");
    }

    z.push("");
    z.push("------------------------------------------------------------");
    z.push("Felder der Datenquelle (verwendet / nicht verwendet):");
    z.push("");
    for (var k = 0; k < felder.length; k++) {
        z.push("   " + (enthaelt(gefunden, felder[k]) ? "[x] " : "[ ] ") + felder[k]);
    }

    z.push("");
    z.push("------------------------------------------------------------");
    z.push("WICHTIG – was dieses Skript NICHT sieht:");
    z.push("");
    z.push("Bild- und QR-Platzhalter (@Feld, #Feld) stehen nicht als Text");
    z.push("im Rahmen und lassen sich so nicht prüfen. Wenn InDesign trotz");
    z.push("grünem Ergebnis meckert, liegt es mit hoher Wahrscheinlichkeit");
    z.push("an einem Bild-, Barcode- oder QR-Rahmen – oder daran, dass ein");
    z.push("Feld durch einen früheren Import einen anderen Feldtyp hat.");
    z.push("");
    z.push("Gegenprobe: Feldliste oben mit dem Bedienfeld vergleichen und");
    z.push("alle Grafikrahmen im Layout einzeln anklicken.");

    alert(z.join("\n"));
}

platzhalterCheck();
