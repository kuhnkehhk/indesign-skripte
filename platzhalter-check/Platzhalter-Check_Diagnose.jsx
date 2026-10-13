/*
    Platzhalter-Check – DIAGNOSE-FASSUNG
    ==================================================================
    Aufbauend auf dem Skript von Michael Han (UserVoice, 19.01.2025).
    Erweitert am 21.09.2026 für die Testreihe Datenzusammenführung.

    WAS SIE ZUSÄTZLICH KANN

    1. Unterscheidet Musterseite / Inhaltsseite / Montagefläche
    2. Listet alle Grafikrahmen auf und markiert leere – das sind die
       Kandidaten für Bild-, QR- und Barcode-Platzhalter
    3. Fragt die InDesign-API der laufenden Version ab und protokolliert,
       welche Datenzusammenführungs-Eigenschaften es tatsächlich gibt
    4. Schreibt alles in eine Textdatei neben das Dokument

    WARUM ABSCHNITT 4 (API-BEFUND) DRIN IST
    Bild- und QR-Platzhalter stehen nicht als Text im Rahmen. Ob und wie
    InDesign sie über Skripting zugänglich macht, unterscheidet sich je
    nach Version. Statt zu raten, liest dieses Skript per Reflection aus,
    was vorhanden ist. Der Bericht zeigt es – daraus lässt sich dann eine
    passgenaue Prüfung bauen.

    NUR LESEND. Ändert nichts am Dokument.

    AUSFÜHREN  Fenster > Hilfsprogramme > Skripte, Datei in den Ordner
               "User" legen, doppelklicken.
*/

#target indesign

(function () {

    // ---------- Hilfsfunktionen (ExtendScript, kein ES5) ----------
    function enthaelt(arr, wert) {
        for (var i = 0; i < arr.length; i++) if (arr[i] === wert) return true;
        return false;
    }
    function trimme(s) { return String(s).replace(/^\s+|\s+$/g, ""); }
    function klasse(o) { try { return o.constructor.name; } catch (e) { return "?"; } }

    // Eigenschaftsnamen eines Objekts auslesen (Reflection)
    function eigenschaften(o) {
        var raus = [];
        try {
            var pr = o.reflect.properties;
            for (var i = 0; i < pr.length; i++) {
                var n = String(pr[i].name);
                if (n !== "__proto__" && n !== "reflect" && n !== "properties") raus.push(n);
            }
        } catch (e) { raus.push("(nicht lesbar: " + e.message + ")"); }
        raus.sort();
        return raus;
    }

    // Eigenschaften, deren Name auf Datenzusammenführung hindeutet
    function dataMergeEigenschaften(o) {
        var alle = eigenschaften(o), raus = [];
        for (var i = 0; i < alle.length; i++) {
            var n = alle[i].toLowerCase();
            if (n.indexOf("datamerge") > -1 || n.indexOf("placeholder") > -1) raus.push(alle[i]);
        }
        return raus;
    }

    // Wo sitzt ein Seitenobjekt?
    function ortVon(item) {
        var seite = "";
        try {
            var pp = item.parentPage;
            if (pp !== null && pp !== undefined) seite = String(pp.name);
        } catch (e) {}

        var p = item, schutz = 0;
        while (p && schutz++ < 60) {
            var k = klasse(p);
            if (k === "MasterSpread") {
                var mn = "";
                try { mn = String(p.namePrefix) + "-" + String(p.baseName); } catch (e2) {}
                return "MUSTERSEITE " + mn + (seite ? " / " + seite : "");
            }
            if (k === "Spread")   return seite ? ("Seite " + seite) : "Montagefläche";
            if (k === "Document") break;
            try { p = p.parent; } catch (e3) { break; }
        }
        return seite ? ("Seite " + seite) : "unbekannt";
    }

    // ---------- Start ----------
    if (app.documents.length === 0) { alert("Kein Dokument geöffnet."); return; }
    var doc = app.activeDocument;

    var L = [];
    function z(s) { L.push(s === undefined ? "" : String(s)); }
    function titel(s) { z(""); z("=========================================================="); z(s); z("=========================================================="); z(""); }

    z("PLATZHALTER-CHECK – DIAGNOSE");
    z("Dokument:  " + doc.name);
    try { z("InDesign:  " + app.version + "  (" + app.name + ")"); } catch (e) {}
    try { z("System:    " + $.os); } catch (e) {}
    z("Erstellt:  " + new Date().toString());

    // ---------- 1. Felder der Datenquelle ----------
    titel("1. FELDER DER DATENQUELLE");

    var felder = [], feldObjekte = [];
    var hatQuelle = false;
    try {
        if (doc.dataMergeProperties && doc.dataMergeProperties.dataMergeFields.length > 0) {
            hatQuelle = true;
            var mf = doc.dataMergeProperties.dataMergeFields;
            for (var i = 0; i < mf.length; i++) {
                feldObjekte.push(mf[i]);
                felder.push(trimme(mf[i].fieldName));
            }
        }
    } catch (e) { z("Feldliste nicht lesbar: " + e.message); }

    if (!hatQuelle) {
        z("Keine Datenquelle verknüpft oder keine Felder vorhanden.");
    } else {
        try { z("Datenquelle: " + doc.dataMergeProperties.dataMergeSource.filePath); } catch (e) {}
        z("Anzahl Felder: " + felder.length);
        z("");
        for (var f = 0; f < felder.length; f++) {
            var zusatz = "";
            // Feldtyp mitnehmen, falls die Version so etwas anbietet
            try {
                var props = eigenschaften(feldObjekte[f]);
                for (var q = 0; q < props.length; q++) {
                    var pn = props[q].toLowerCase();
                    if (pn.indexOf("type") > -1 || pn.indexOf("kind") > -1) {
                        try { zusatz += "  " + props[q] + "=" + feldObjekte[f][props[q]]; } catch (e4) {}
                    }
                }
            } catch (e5) {}
            z("   " + felder[f] + zusatz);
        }
    }

    // ---------- 2. Textplatzhalter im Layout ----------
    titel("2. TEXTPLATZHALTER IM LAYOUT");

    var seitenobjekte = [];
    try { var ap = doc.allPageItems; for (var a = 0; a < ap.length; a++) seitenobjekte.push(ap[a]); }
    catch (e) { var tf = doc.textFrames; for (var b = 0; b < tf.length; b++) seitenobjekte.push(tf[b]); }

    var textrahmen = [], grafikrahmen = [], sonstige = [];
    for (var s1 = 0; s1 < seitenobjekte.length; s1++) {
        var k1 = klasse(seitenobjekte[s1]);
        if (k1 === "TextFrame") textrahmen.push(seitenobjekte[s1]);
        else if (k1 === "Rectangle" || k1 === "Oval" || k1 === "Polygon" || k1 === "GraphicLine")
            grafikrahmen.push(seitenobjekte[s1]);
        else sonstige.push(seitenobjekte[s1]);
    }

    z("Seitenobjekte gesamt: " + seitenobjekte.length +
      "   (Textrahmen: " + textrahmen.length +
      ", Grafikrahmen: " + grafikrahmen.length +
      ", andere: " + sonstige.length + ")");
    z("Musterseiten und Gruppen sind eingeschlossen.");
    z("");

    var verwendet = [], verwaist = [];
    var muster = /<<([^>]+)>>/g;

    for (var t = 0; t < textrahmen.length; t++) {
        var inhalt = "";
        try { inhalt = String(textrahmen[t].contents); } catch (e6) { continue; }
        var ort = ortVon(textrahmen[t]);
        muster.lastIndex = 0;
        var m;
        while ((m = muster.exec(inhalt)) !== null) {
            var name = trimme(m[1]);
            if (hatQuelle && !enthaelt(felder, name)) {
                verwaist.push("<<" + name + ">>   " + ort + "   >>> KEIN FELD IN DER QUELLE");
            } else {
                if (!enthaelt(verwendet, name)) verwendet.push(name);
                z("   <<" + name + ">>   " + ort);
            }
        }
    }
    if (verwaist.length > 0) {
        z("");
        z("--- PROBLEM ---");
        for (var v = 0; v < verwaist.length; v++) z("   " + verwaist[v]);
    } else {
        z("");
        z("Kein verwaister Textplatzhalter gefunden.");
    }

    if (hatQuelle) {
        z("");
        z("--- Felder, die in KEINEM Textrahmen vorkommen ---");
        var offen = 0;
        for (var g = 0; g < felder.length; g++) {
            if (!enthaelt(verwendet, felder[g])) { z("   " + felder[g]); offen++; }
        }
        if (offen === 0) z("   (keine)");
        z("");
        z("Hinweis: Felder in dieser Liste sind nicht zwangsläufig unbenutzt –");
        z("Bild-, QR- und Barcode-Felder sitzen in Grafikrahmen, nicht im Text.");
        z("Vergleiche sie mit Abschnitt 3.");
    }

    // ---------- 3. Grafikrahmen ----------
    titel("3. GRAFIKRAHMEN – Kandidaten für Bild-, QR- und Barcode-Platzhalter");

    z("Ein Bild- oder QR-Platzhalter ist im Vorlagedokument ein LEERER Grafikrahmen.");
    z("Leere Rahmen sind daher die Verdächtigen.");
    z("");

    if (grafikrahmen.length === 0) {
        z("Keine Grafikrahmen im Dokument.");
    } else {
        for (var r = 0; r < grafikrahmen.length; r++) {
            var gr = grafikrahmen[r];
            var leer = true, inhaltInfo = "";
            try {
                if (gr.graphics.length > 0) {
                    leer = false;
                    try { inhaltInfo = " -> " + gr.graphics[0].itemLink.name; }
                    catch (e7) { inhaltInfo = " -> Grafik ohne Verknüpfung"; }
                }
            } catch (e8) {}

            // alles auslesen, was nach Datenzusammenführung aussieht
            var dm = dataMergeEigenschaften(gr);
            var dmInfo = "";
            for (var d = 0; d < dm.length; d++) {
                var wert = "";
                try { wert = String(gr[dm[d]]); } catch (e9) { wert = "(nicht lesbar)"; }
                dmInfo += "   [" + dm[d] + " = " + wert + "]";
            }

            z("   " + (leer ? "LEER  " : "gefüllt") + "   " + ortVon(gr) +
              "   Name: " + (function () { try { return gr.name || "(ohne)"; } catch (e10) { return "(ohne)"; } })() +
              inhaltInfo + dmInfo);
        }
    }

    // ---------- 4. API-Befund ----------
    titel("4. API-BEFUND DIESER INDESIGN-VERSION");

    z("Diese Liste zeigt, welche Eigenschaften das Skripting hier anbietet.");
    z("Daraus lässt sich eine direkte Prüfung der Bild- und QR-Platzhalter bauen.");
    z("");

    z("--- dataMergeProperties ---");
    try {
        var dmp = eigenschaften(doc.dataMergeProperties);
        for (var x1 = 0; x1 < dmp.length; x1++) z("   " + dmp[x1]);
    } catch (e11) { z("   nicht lesbar: " + e11.message); }

    z("");
    z("--- ein DataMergeField-Objekt ---");
    if (feldObjekte.length > 0) {
        var fp = eigenschaften(feldObjekte[0]);
        for (var x2 = 0; x2 < fp.length; x2++) {
            var w = "";
            try { w = String(feldObjekte[0][fp[x2]]); } catch (e12) { w = "(nicht lesbar)"; }
            if (w.length > 60) w = w.substring(0, 60) + "…";
            z("   " + fp[x2] + " = " + w);
        }
    } else { z("   (kein Feld vorhanden)"); }

    z("");
    z("--- Datenzusammenführungs-Eigenschaften am Dokument ---");
    var dmd = dataMergeEigenschaften(doc);
    if (dmd.length === 0) z("   (keine gefunden)");
    for (var x3 = 0; x3 < dmd.length; x3++) z("   " + dmd[x3]);

    z("");
    z("--- Datenzusammenführungs-Eigenschaften an einem Grafikrahmen ---");
    if (grafikrahmen.length > 0) {
        var gdm = dataMergeEigenschaften(grafikrahmen[0]);
        if (gdm.length === 0) z("   (keine gefunden – Bildplatzhalter sind hier nicht direkt abfragbar)");
        for (var x4 = 0; x4 < gdm.length; x4++) z("   " + gdm[x4]);
    } else { z("   (kein Grafikrahmen vorhanden)"); }

    z("");
    z("--- Datenzusammenführungs-Eigenschaften an einem Textrahmen ---");
    if (textrahmen.length > 0) {
        var tdm = dataMergeEigenschaften(textrahmen[0]);
        if (tdm.length === 0) z("   (keine gefunden)");
        for (var x5 = 0; x5 < tdm.length; x5++) z("   " + tdm[x5]);
    }

    z("");
    z("--- bekannte Klassennamen im Dokument ---");
    var klassen = [];
    for (var x6 = 0; x6 < seitenobjekte.length; x6++) {
        var kn = klasse(seitenobjekte[x6]);
        if (!enthaelt(klassen, kn)) klassen.push(kn);
    }
    klassen.sort();
    z("   " + klassen.join(", "));

    // ---------- 5. Deutung ----------
    titel("5. WIE DU DEN BERICHT LIEST");

    z("Abschnitt 2 findet alles, was als Text im Layout steht – auch auf");
    z("Musterseiten und in Gruppen. Ein Eintrag mit >>> ist die Ursache für");
    z("die Meldung 'Mindestens ein Datenplatzhalter wurde nicht gefunden'.");
    z("");
    z("Abschnitt 3 listet die Grafikrahmen. Ein LEERER Rahmen ist im");
    z("Vorlagedokument normal – das ist der Bild- oder QR-Platzhalter.");
    z("Zähle sie gegen die Felder aus Abschnitt 1, die in keinem Textrahmen");
    z("vorkommen. Passt die Zahl nicht, fehlt eine Zuordnung.");
    z("");
    z("Abschnitt 4 ist für die Weiterentwicklung gedacht. Zeigt er eine");
    z("Eigenschaft mit 'dataMerge' oder 'placeholder' an einem Grafikrahmen,");
    z("lässt sich die Bildprüfung direkt bauen statt über die Leer-Heuristik.");
    z("");
    z("BEKANNTE GRENZE: Stimmt ein Feldname, aber der Feldtyp passt nicht");
    z("(Beispiel: Textplatzhalter auf einem Feld, das durch einen früheren");
    z("Import zum QR-Feld wurde), meldet dieses Skript nichts – InDesign");
    z("aber schon. In dem Fall hilft nur eine frische Dokumentkopie.");

    // ---------- Ausgabe ----------
    var text = L.join("\n");
    var ziel = null, gespeichert = false;
    try {
        var ordner = (doc.saved && doc.filePath) ? doc.filePath : Folder.desktop;
        ziel = new File(ordner + "/platzhalter-bericht.txt");
        ziel.encoding = "UTF-8";
        if (ziel.open("w")) { ziel.write(text); ziel.close(); gespeichert = true; }
    } catch (e13) {}

    var kurz = "PLATZHALTER-CHECK\n\n" +
        "Felder in der Quelle: " + felder.length + "\n" +
        "Textrahmen geprüft:   " + textrahmen.length + "\n" +
        "Grafikrahmen:         " + grafikrahmen.length + "\n" +
        "Verwaiste Platzhalter: " + verwaist.length + "\n\n" +
        (verwaist.length > 0 ? (verwaist.join("\n") + "\n\n") : "Keine verwaisten Textplatzhalter.\n\n") +
        (gespeichert ? ("Vollständiger Bericht gespeichert:\n" + ziel.fsName)
                     : "Bericht konnte nicht gespeichert werden – siehe Konsole.");
    alert(kurz);
    if (!gespeichert) $.writeln(text);

})();
