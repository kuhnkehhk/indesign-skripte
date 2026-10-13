/*
    Platzhalter-Check  v2.6
    ==================================================================
    Prüft Datenzusammenführungs-Platzhalter gegen die Datenquelle –
    inklusive FELDTYP.

    Aufbauend auf dem Skript von Michael Han (UserVoice, 19.01.2025).
    Erweitert 21.09.2026.

    WAS ES FINDET
    ------------------------------------------------------------------
    VERWAIST      Platzhalter nennt ein Feld, das es nicht gibt
    PHANTOMFELD   Feld steht im Bedienfeld, aber nicht in der Datenquelle.
                  Klassiker: doppelter Spaltenname in der Kopfzeile, InDesign
                  macht aus dem zweiten "Abteilung" ein "Abteilung1". Dieser
                  Name existiert nur in InDesign – beim Zusammenführen findet
                  sich dazu kein Wert.
    FALSCHER TYP  Name stimmt, Typ nicht – zum Beispiel ein
                  Textplatzhalter <<Ausweisnummer>> auf einem Feld,
                  das in der Quelle ein QR-Feld ist (#Ausweisnummer).
                  InDesign verweigert die Vorschau und nennt den
                  Grund nicht.

    WOHER DER FELDTYP KOMMT
    ------------------------------------------------------------------
    Primär aus dem DOM: DataMergeField.fieldType liefert Werte wie
    QRCODE_FIELD. Verifiziert unter InDesign 21.4.1.4 / Windows.

    Ersatzweise aus der Kopfzeile der CSV, falls die Version kein
    fieldType anbietet:
        @Feld = Bildfeld,  #Feld = QR-Feld,  sonst Textfeld

    DIE DATENQUELLE WIRD IN VIER STUFEN GESUCHT
    ------------------------------------------------------------------
    1. aus dem Dokument (dataMergeSource), falls die Version das anbietet
    2. aus der VERKNÜPFUNGSPALETTE – dort steht die CSV als Verknüpfung.
       Das ist der zuverlässigste Weg, weil er den echten Pfad liefert
    3. automatische Suche im Dokumentordner und eine Ebene darunter
    4. Dateidialog. Abbrechen überspringt nur die Phantomfeld-Prüfung

    NUR LESEND. Ändert weder Dokument noch Datenquelle.

    AUSFÜHREN  Fenster > Hilfsprogramme > Skripte, Datei in den Ordner
               "User" legen, doppelklicken.
*/

#target indesign

(function () {

    // ================= Hilfsfunktionen =================
    function enthaelt(a, w) { for (var i = 0; i < a.length; i++) if (a[i] === w) return true; return false; }
    function trimme(s) { return String(s).replace(/^\s+|\s+$/g, ""); }
    function klasse(o) { try { return o.constructor.name; } catch (e) { return "?"; } }

    function eigenschaften(o) {
        var r = [];
        try {
            var pr = o.reflect.properties;
            for (var i = 0; i < pr.length; i++) {
                var n = String(pr[i].name);
                if (n === "__proto__" || n === "reflect" || n === "properties") continue;
                if (!enthaelt(r, n)) r.push(n);          // Doubletten raus
            }
        } catch (e) {}
        r.sort(); return r;
    }
    function dmEigenschaften(o) {
        var a = eigenschaften(o), r = [];
        for (var i = 0; i < a.length; i++) {
            var n = a[i].toLowerCase();
            if (n.indexOf("datamerge") > -1 || n.indexOf("placeholder") > -1) r.push(a[i]);
        }
        return r;
    }

    // Feldtyp vereinheitlichen – unabhängig vom Wortlaut der Version
    function normTyp(roh) {
        var t = String(roh).toUpperCase();
        if (t.indexOf("QR") > -1) return "QR";
        if (t.indexOf("IMAGE") > -1 || t.indexOf("PICTURE") > -1 || t.indexOf("GRAPHIC") > -1) return "Bild";
        if (t.indexOf("TEXT") > -1) return "Text";
        return null;
    }

    function ortVon(item) {
        var seite = "";
        try { var pp = item.parentPage; if (pp) seite = String(pp.name); } catch (e) {}
        var p = item, schutz = 0;
        while (p && schutz++ < 60) {
            var k = klasse(p);
            if (k === "MasterSpread") {
                var mn = ""; try { mn = String(p.namePrefix) + "-" + String(p.baseName); } catch (e2) {}
                return "MUSTERSEITE " + mn + (seite ? " / " + seite : "");
            }
            if (k === "Spread") return seite ? ("Seite " + seite) : "Montagefläche";
            if (k === "Document") break;
            try { p = p.parent; } catch (e3) { break; }
        }
        return seite ? ("Seite " + seite) : "unbekannt";
    }

    function zerlege(zeile, trenner) {
        var raus = [], akt = "", inQ = false;
        for (var i = 0; i < zeile.length; i++) {
            var c = zeile.charAt(i);
            if (c === '"') {
                if (inQ && zeile.charAt(i + 1) === '"') { akt += '"'; i++; }
                else inQ = !inQ;
            } else if (c === trenner && !inQ) { raus.push(akt); akt = ""; }
            else akt += c;
        }
        raus.push(akt);
        return raus;
    }
    function typAusPraefix(roh) {
        var t = trimme(roh).replace(/^﻿/, "");
        var e = t.charAt(0);
        if (e === "@") return { typ: "Bild", name: trimme(t.substring(1)) };
        if (e === "#") return { typ: "QR",   name: trimme(t.substring(1)) };
        return { typ: "Text", name: t };
    }

    // ---- Datei byteweise ansehen: Kodierung, Trennzeichen, Zeilen ----
    var LIMIT = 65536;   // 64 KB reichen. Mehr macht die Prüfung nur langsam.

    function dateiAnalysieren(pfad) {
        var e = { ok:false, groesse:0, bom:"keines", kodierung:"unbekannt",
                  sicherheit:"", trenner:"unbekannt", zeilen:0, hinweis:"" };
        var f = new File(pfad);
        if (!f.exists) { e.hinweis = "Datei nicht gefunden."; return e; }
        var roh = "";
        try {
            e.groesse = f.length;
            if (!f.open("r")) { e.hinweis = "Datei ließ sich nicht öffnen."; return e; }
            // WICHTIG: erst öffnen, DANN auf BINARY stellen.
            // File.open() schnüffelt selbst nach einem BOM, setzt die Kodierung
            // danach um und verschluckt das BOM. Genau das hat die UTF-16-Datei
            // fälschlich als ANSI erscheinen lassen.
            f.encoding = "BINARY";
            try { f.seek(0, 0); } catch (eS) {}
            roh = f.read(Math.min(f.length, LIMIT));
            f.close();
        } catch (eD) { try { f.close(); } catch (eD2) {} e.hinweis = eD.message; return e; }
        e.ok = true;

        // Gegenprobe: bekamen wir wirklich Bytes?
        var erwartet = Math.min(e.groesse, LIMIT), dekodiert = false;
        if (roh.length > 0 && erwartet > 8 && roh.length < erwartet * 0.75) dekodiert = true;
        for (var pr2 = 0; pr2 < roh.length && pr2 < 4096; pr2++)
            if (roh.charCodeAt(pr2) > 255) { dekodiert = true; break; }
        if (dekodiert) {
            e.kodierung = "nicht bestimmbar";
            e.sicherheit = "";
            e.hinweis = "ExtendScript hat die Datei bereits dekodiert ausgeliefert – " +
                        "das passiert bei einem BOM. Die Kodierung lässt sich so nicht " +
                        "messen. Sehr wahrscheinlich UTF-16 oder UTF-8 mit BOM.";
            return e;
        }

        function b(i) { return roh.charCodeAt(i) & 0xFF; }
        var n = roh.length;

        // Anteil der Nullbytes an jeder zweiten Stelle – verrät UTF-16 ohne BOM
        function nullMuster(versatz) {
            var treffer = 0, gesamt = 0, grenze = Math.min(n, 2048);
            for (var p = versatz; p < grenze; p += 2) { gesamt++; if (b(p) === 0) treffer++; }
            return gesamt ? (treffer / gesamt) : 0;
        }

        // --- BOM, auch wenn ExtendScript es verschluckt hat ---
        // Trick: Wir kennen die echte Dateigröße. Fehlen genau 2 oder 3 Bytes,
        // hat File.open() ein BOM entfernt. Das ist eindeutig und braucht
        // kein seek – auf das man sich versionsübergreifend nicht verlassen kann.
        var verschluckt = -1;
        if (e.groesse <= LIMIT) verschluckt = e.groesse - n;
        var bomImText = 0;      // wie viele BOM-Bytes stehen noch in roh?

        if (verschluckt === 3) {
            e.bom = "UTF-8-BOM (EF BB BF) – von ExtendScript entfernt, zurückgerechnet";
            e.kodierung = "UTF-8 mit BOM"; e.sicherheit = "eindeutig";
        } else if (verschluckt === 2) {
            var le = nullMuster(1), be = nullMuster(0);
            e.bom = "UTF-16-BOM – von ExtendScript entfernt, zurückgerechnet";
            e.kodierung = (be > le) ? "UTF-16 BE" : "UTF-16 LE";
            e.sicherheit = "eindeutig";
        } else if (n >= 3 && b(0) === 0xEF && b(1) === 0xBB && b(2) === 0xBF) {
            e.bom = "UTF-8-BOM (EF BB BF)"; e.kodierung = "UTF-8 mit BOM"; e.sicherheit = "eindeutig";
            bomImText = 3;
        } else if (n >= 2 && b(0) === 0xFF && b(1) === 0xFE) {
            e.bom = "UTF-16-LE-BOM (FF FE)"; e.kodierung = "UTF-16 LE"; e.sicherheit = "eindeutig";
            bomImText = 2;
        } else if (n >= 2 && b(0) === 0xFE && b(1) === 0xFF) {
            e.bom = "UTF-16-BE-BOM (FE FF)"; e.kodierung = "UTF-16 BE"; e.sicherheit = "eindeutig";
            bomImText = 2;
        } else if (n >= 16 && nullMuster(1) > 0.6) {
            e.bom = "keines";
            e.kodierung = "UTF-16 LE ohne BOM";
            e.sicherheit = "wahrscheinlich (Nullbyte-Muster)";
            e.hinweis = "UTF-16 ohne BOM. Die Datenzusammenführung erkennt das nicht " +
                        "zuverlässig – mit BOM neu speichern.";
        } else if (n >= 16 && nullMuster(0) > 0.6) {
            e.bom = "keines";
            e.kodierung = "UTF-16 BE ohne BOM";
            e.sicherheit = "wahrscheinlich (Nullbyte-Muster)";
            e.hinweis = "UTF-16 ohne BOM. Die Datenzusammenführung erkennt das nicht " +
                        "zuverlässig – mit BOM neu speichern.";
        } else {
            // --- kein BOM: UTF-8-Bytemuster prüfen ---
            var i = 0, mehrbyte = false, gueltig = true, hoheBytes = false;
            while (i < n) {
                var c = b(i);
                if (c < 0x80) { i++; continue; }
                hoheBytes = true;
                var f2 = 0;
                if ((c & 0xE0) === 0xC0) f2 = 1;
                else if ((c & 0xF0) === 0xE0) f2 = 2;
                else if ((c & 0xF8) === 0xF0) f2 = 3;
                else { gueltig = false; break; }
                if (i + f2 >= n) break;
                var ok = true;
                for (var k = 1; k <= f2; k++) if ((b(i + k) & 0xC0) !== 0x80) ok = false;
                if (!ok) { gueltig = false; break; }
                mehrbyte = true; i += f2 + 1;
            }
            if (!hoheBytes) {
                e.kodierung = "reines ASCII"; e.sicherheit = "eindeutig";
                e.hinweis = "Keine Zeichen über 127. ANSI und UTF-8 sind hier identisch, das ist unproblematisch.";
            } else if (gueltig && mehrbyte) {
                e.kodierung = "UTF-8 ohne BOM"; e.sicherheit = "sehr wahrscheinlich";
            } else {
                e.kodierung = "ANSI / Windows-1252 (oder eine andere 8-Bit-Kodierung)";
                e.sicherheit = "wahrscheinlich";
            }
        }

        // --- Trennzeichen aus der ERSTEN Zeile, Zeilen durch Zählen ---
        // Kein Aufbau eines Gesamtstrings: das wäre bei 250.000 Zeichen
        // in ExtendScript minutenlang und sieht aus, als hinge das Skript.
        var breit   = (e.kodierung.indexOf("UTF-16") === 0);
        var schritt = breit ? 2 : 1;
        var start   = bomImText;   // nur überspringen, was wirklich noch dasteht

        var kopfZ = [], zeilen = 1, fertig = false;
        for (var t = start; t < n; t += schritt) {
            var z = b(t);
            if (z === 10) {
                zeilen++;
                fertig = true;                 // Kopfzeile ist zu Ende
                if (zeilen > 100000) break;    // Notbremse
                continue;
            }
            if (!fertig && z !== 13) kopfZ.push(z);
        }
        e.zeilen = (e.groesse > LIMIT) ? -1 : zeilen;

        var zaehler = { 44:0, 59:0, 9:0 }, inQ = false;   // , ; TAB
        for (var q = 0; q < kopfZ.length; q++) {
            var cz = kopfZ[q];
            if (cz === 34) { inQ = !inQ; continue; }
            if (!inQ && zaehler[cz] !== undefined) zaehler[cz]++;
        }
        var best = 0, bestN = 0;
        if (zaehler[44] > bestN) { bestN = zaehler[44]; best = 44; }
        if (zaehler[59] > bestN) { bestN = zaehler[59]; best = 59; }
        if (zaehler[9]  > bestN) { bestN = zaehler[9];  best = 9;  }
        if (bestN > 0) e.trenner = (best === 9 ? "Tabulator" : (best === 44 ? "Komma" : "Semikolon")) +
                                   "  (" + bestN + " im Kopf)";
        return e;
    }

    // ================= Start =================
    if (app.documents.length === 0) { alert("Kein Dokument geöffnet."); return; }
    var doc = app.activeDocument;

    var L = [];
    function z(s) { L.push(s === undefined ? "" : String(s)); }
    function titel(s) { z(""); z("=========================================================="); z(s); z("=========================================================="); z(""); }

    z("PLATZHALTER-CHECK  v2.6");
    z("Dokument:  " + doc.name);
    try { z("InDesign:  " + app.version + "  (" + app.name + ")"); } catch (e) {}
    try { z("System:    " + $.os); } catch (e) {}
    z("Erstellt:  " + new Date().toString());

    // ---------- Felder samt Typ aus dem DOM ----------
    titel("1. FELDER UND IHRE TYPEN");

    var felder = [], feldObjekte = [], typVonFeld = {}, rohTyp = {}, unbekannteTypen = [];
    var typquelle = "keine";

    try {
        if (doc.dataMergeProperties && doc.dataMergeProperties.dataMergeFields.length > 0) {
            var mf = doc.dataMergeProperties.dataMergeFields;
            for (var i = 0; i < mf.length; i++) {
                var nm = trimme(mf[i].fieldName);
                feldObjekte.push(mf[i]);
                felder.push(nm);
                var rt = null, nt = null;
                try { rt = mf[i].fieldType; nt = normTyp(rt); } catch (e4) {}
                if (nt) { typVonFeld[nm] = nt; rohTyp[nm] = String(rt); typquelle = "DOM (fieldType)"; }
            }
        }
    } catch (e5) { z("Feldliste nicht lesbar: " + e5.message); }

    if (felder.length === 0) { alert("Keine Datenquelle verknüpft."); return; }

    // ---------- Datenquelle suchen ----------
    // Der Pfad steht nicht in jeder Version im DOM. Deshalb: erst DOM,
    // dann die Ordner neben dem Dokument durchsuchen, zuletzt fragen.

    function kopfzeileLesen(datei) {
        var encs = ["UTF-8", "windows-1252", "ISO-8859-1", "UTF-16", "ASCII"];
        var trs  = [",", ";", "\t"];
        var best = null;
        for (var k = 0; k < encs.length; k++) {
            var zeile = "";
            try {
                datei.encoding = encs[k];
                if (!datei.open("r")) continue;
                zeile = String(datei.readln()); datei.close();
            } catch (eA) { try { datei.close(); } catch (eB) {} continue; }
            if (!zeile) continue;
            zeile = zeile.replace(/^\uFEFF/, "");
            for (var t = 0; t < trs.length; t++) {
                var teile = zerlege(zeile, trs[t]);
                if (teile.length < 2) continue;
                var namen = [], typen = {}, anzahl = {};
                for (var n = 0; n < teile.length; n++) {
                    var inf = typAusPraefix(teile[n]);
                    namen.push(inf.name);
                    typen[inf.name] = inf.typ;
                    anzahl[inf.name] = (anzahl[inf.name] || 0) + 1;
                }
                // Bewertung: erklärte Felder minus unbekannte Kopfnamen
                var erklaert = 0;
                for (var f = 0; f < felder.length; f++) {
                    var fn = felder[f];
                    if (anzahl[fn]) { erklaert++; continue; }
                    // Umbenennungsmuster: "Abteilung1" <- "Abteilung" kommt mehrfach vor
                    var basis = fn.replace(/\d+$/, "");
                    if (basis !== fn && anzahl[basis] && anzahl[basis] > 1) erklaert++;
                }
                var fremd = 0;
                for (var u = 0; u < namen.length; u++) if (!enthaelt(felder, namen[u])) fremd++;
                var punkte = erklaert - fremd;
                if (!best || punkte > best.punkte) {
                    best = { punkte: punkte, namen: namen, typen: typen, anzahl: anzahl,
                             kodierung: encs[k], trenner: (trs[t] === "\t" ? "Tabulator" : trs[t]) };
                }
            }
        }
        return best;
    }

    function sammleDateien(ordner, tiefe, liste) {
        if (liste.length > 250) return liste;
        var eintraege = [];
        try { eintraege = ordner.getFiles(); } catch (eC) { return liste; }
        for (var i2 = 0; i2 < eintraege.length; i2++) {
            var e = eintraege[i2];
            if (e instanceof Folder) { if (tiefe > 0) sammleDateien(e, tiefe - 1, liste); }
            else {
                var nn = String(e.name).toLowerCase();
                if (nn.length > 4) {
                    var endung = nn.substring(nn.length - 4);
                    if (endung === ".csv" || endung === ".txt" || endung === ".tsv") liste.push(e);
                }
            }
        }
        return liste;
    }

    var quellPfad = "", quellHinweis = "", kopf = null, zweitbester = -999;

    // (a) DOM
    var domKandidaten = [];
    try { domKandidaten.push(doc.dataMergeProperties.dataMergeSource); } catch (e6) {}
    try { domKandidaten.push(doc.dataMergeProperties.parent.dataMergeSource); } catch (e7) {}
    try { domKandidaten.push(doc.dataMergeProperties.dataMergePreferences.dataMergeSource); } catch (e8) {}
    for (var c = 0; c < domKandidaten.length; c++) {
        if (!domKandidaten[c]) continue;
        try {
            var kp = domKandidaten[c].filePath ? domKandidaten[c].filePath : domKandidaten[c];
            if (kp && String(kp).length > 3) { quellPfad = String(kp); quellHinweis = "aus dem Dokument"; break; }
        } catch (e9) {}
    }
    if (quellPfad) {
        var dfile = new File(quellPfad);
        if (dfile.exists) kopf = kopfzeileLesen(dfile);
        if (!kopf) quellPfad = "";
    }

    // (a2) Verknüpfungspalette – dort steht die Datenquelle als Link
    if (!quellPfad) {
        var linkKandidaten = [];
        try {
            var lks = doc.links;
            for (var li = 0; li < lks.length; li++) {
                var lp = "";
                try { lp = String(lks[li].filePath); } catch (eL1) { continue; }
                var low = lp.toLowerCase();
                if (low.length > 4) {
                    var en = low.substring(low.length - 4);
                    if (en === ".csv" || en === ".txt" || en === ".tsv") linkKandidaten.push(lp);
                }
            }
        } catch (eL2) {}

        var bestL = null, bestLK = null, bestLP = -999;
        for (var lk = 0; lk < linkKandidaten.length; lk++) {
            var lf = new File(linkKandidaten[lk]);
            if (!lf.exists) continue;
            var lkk = kopfzeileLesen(lf);
            if (lkk && lkk.punkte > bestLP) { bestLP = lkk.punkte; bestL = linkKandidaten[lk]; bestLK = lkk; }
        }
        if (bestL) {
            quellPfad = bestL; kopf = bestLK;
            quellHinweis = "aus der Verknüpfungspalette";
        }
    }

    // (b) Ordner neben dem Dokument durchsuchen
    if (!quellPfad && doc.saved && doc.filePath) {
        var dateien = sammleDateien(new Folder(doc.filePath), 1, []);
        var bestDatei = null, bestKopf = null, bestPunkte = -999;
        for (var d2 = 0; d2 < dateien.length; d2++) {
            var kk = kopfzeileLesen(dateien[d2]);
            if (!kk) continue;
            if (kk.punkte > bestPunkte) { zweitbester = bestPunkte; bestPunkte = kk.punkte; bestKopf = kk; bestDatei = dateien[d2]; }
            else if (kk.punkte > zweitbester) { zweitbester = kk.punkte; }
        }
        if (bestDatei && bestPunkte >= Math.ceil(felder.length * 0.6)) {
            quellPfad = String(bestDatei.fsName); kopf = bestKopf;
            quellHinweis = "automatisch gefunden (" + dateien.length + " Dateien geprüft, Bewertung " + bestPunkte + ")";
        }
    }

    // (c) nachfragen
    if (!quellPfad) {
        var gewaehlt = null;
        try { gewaehlt = File.openDialog("Datenquelle wählen (Abbrechen überspringt die Prüfung auf umbenannte Felder)"); } catch (e10) {}
        if (gewaehlt && gewaehlt.exists) {
            kopf = kopfzeileLesen(gewaehlt);
            if (kopf) { quellPfad = String(gewaehlt.fsName); quellHinweis = "von dir ausgewählt"; }
        }
    }

    var kopfGelesen = !!kopf;
    var kopfTypen = kopfGelesen ? kopf.typen : {};
    var kopfAnzahl = kopfGelesen ? kopf.anzahl : {};
    var kopfNamen = kopfGelesen ? kopf.namen : [];
    var kodierung = kopfGelesen ? kopf.kodierung : "";
    var trennzeichen = kopfGelesen ? kopf.trenner : "";

    // Ersatzweise Typen aus der Kopfzeile übernehmen
    if (typquelle === "keine" && kopfGelesen) {
        for (var f = 0; f < felder.length; f++) {
            if (kopfTypen[felder[f]]) typVonFeld[felder[f]] = kopfTypen[felder[f]];
        }
        typquelle = "CSV-Kopfzeile";
    }

    z("Typquelle: " + typquelle);
    if (quellPfad) {
        z("Datenquelle: " + quellPfad);
        z("   (" + quellHinweis + ")");
        z("Kopfzeile gelesen als: " + kodierung + ", Trennzeichen \"" + trennzeichen + "\"");
        if (zweitbester > -999 && (kopf.punkte - zweitbester) < 2) {
            z("   ACHTUNG: Eine zweite Datei passt fast genauso gut. Prüfe den Dateinamen oben");
            z("   gegen die Anzeige im Bedienfeld.");
        }
    } else {
        z("Keine Datenquelldatei gelesen.");
        z("Die Prüfung auf umbenannte Felder (Phantomfelder) konnte nicht stattfinden.");
    }
    z("");

    // Phantomfelder: im Bedienfeld vorhanden, in der Kopfzeile nicht
    var phantom = {}, phantomListe = [];
    if (kopfGelesen) {
        for (var ph = 0; ph < felder.length; ph++) {
            var pn = felder[ph];
            if (kopfAnzahl[pn]) continue;
            var basis = pn.replace(/\d+$/, "");
            var grund = (basis !== pn && kopfAnzahl[basis] && kopfAnzahl[basis] > 1)
                ? ("automatisch umbenannt – \"" + basis + "\" steht " + kopfAnzahl[basis] + "-mal in der Kopfzeile")
                : "steht nicht in der Kopfzeile der Datenquelle";
            phantom[pn] = grund;
            phantomListe.push(pn);
        }
    }


    for (var f2 = 0; f2 < felder.length; f2++) {
        var nam = felder[f2];
        var typ = typVonFeld[nam] || "?";
        var zusatz = rohTyp[nam] ? ("   (" + rohTyp[nam] + ")") : "";
        if (kopfGelesen && typVonFeld[nam] && kopfTypen[nam] && kopfTypen[nam] !== typVonFeld[nam]) {
            zusatz += "   >>> Kopfzeile sagt " + kopfTypen[nam] + ", DOM sagt " + typVonFeld[nam];
        }
        if (phantom[nam]) zusatz += "   >>> PHANTOMFELD: " + phantom[nam];
        while (typ.length < 5) typ += " ";
        z("   [" + typ + "]  " + nam + zusatz);
        if (typ === "?    " && rohTyp[nam]) unbekannteTypen.push(rohTyp[nam]);
    }

    if (unbekannteTypen.length > 0) {
        z("");
        z("   HINWEIS: Für " + unbekannteTypen.length + " Feld(er) ist der Typ unbekannt.");
        z("   Rohwerte: " + unbekannteTypen.join(", "));
        z("   Diese Werte müssen in der Funktion normTyp ergänzt werden,");
        z("   sonst bleibt die Typprüfung für sie wirkungslos.");
    }

    if (kopfGelesen && phantomListe.length > 0) {
        z("");
        z("   " + phantomListe.length + " Phantomfeld(er) gefunden: " + phantomListe.join(", "));
        z("   Diese Felder zeigt das Bedienfeld an, in der Datenquelle gibt es sie nicht.");
        z("   Solange sie im Layout nicht verwendet werden, stören sie nicht.");
    }

    var kodierungKurz = "";

    // ---------- 1b. Die Datenquelldatei selbst ----------
    if (quellPfad) {
        titel("1b. DIE DATENQUELLDATEI");

        var an;
        try { an = dateiAnalysieren(quellPfad); }
        catch (eAn) { an = { ok:false, hinweis:"Prüfung abgebrochen: " + eAn.message }; }
        z("Datei:        " + quellPfad);
        if (!an.ok) {
            z("Nicht lesbar: " + an.hinweis);
        } else {
            z("Größe:        " + an.groesse + " Bytes");
            z("BOM:          " + an.bom);
            z("Kodierung:    " + an.kodierung + "   (" + an.sicherheit + ")");
            z("Trennzeichen: " + an.trenner);
            z("Zeilen:       " + (an.zeilen < 0 ? "über 64 KB, nur angelesen" : an.zeilen));
            if (an.hinweis) { z(""); z(an.hinweis); }

            // Bewertung nach dem, was wir getestet haben
            z("");
            if (an.kodierung === "UTF-8 mit BOM") {
                z(">>> WARNUNG: UTF-8 mit BOM.");
                z("    Die Datenzusammenführung lehnt solche Dateien ab, mit der irreführenden");
                z("    Meldung, die Datei enthalte keine Datensätze.");
                z("    Lösung: als ANSI oder UTF-16 neu speichern.");
                z("    In Excel: Speichern unter > Unicode Text (*.txt).");
            } else if (an.kodierung === "UTF-8 ohne BOM") {
                z(">>> WARNUNG: UTF-8 ohne BOM.");
                z("    Die Datenzusammenführung kann UTF-8 nicht lesen – in den Importoptionen");
                z("    gibt es keine solche Einstellung. \"Unicode\" bedeutet dort UTF-16.");
                z("    Folge: Zeichensalat in den Feldern, und Bildpfade mit Sonderzeichen");
                z("    lösen nicht mehr auf.");
                z("    Lösung: als ANSI oder UTF-16 neu speichern.");
                z("    In Excel: Speichern unter > Unicode Text (*.txt).");
            } else if (an.kodierung.indexOf("ohne BOM") > -1 && an.kodierung.indexOf("UTF-16") === 0) {
                z(">>> WARNUNG: UTF-16 ohne BOM.");
                z("    Ohne BOM fehlt InDesign das Erkennungsmerkmal.");
                z("    Lösung: in Excel > Speichern unter > Unicode Text (*.txt)");
                z("    neu speichern, das setzt das BOM.");
            } else if (an.kodierung === "nicht bestimmbar") {
                z("Die Kodierung ließ sich hier nicht messen – siehe Hinweis oben.");
                z("Das ist kein Fehlerbefund, nur eine fehlende Angabe.");
            } else if (an.kodierung.indexOf("UTF-16") === 0) {
                z("UTF-16 mit BOM – wird von der Datenzusammenführung gelesen");
                z("und deckt alle Zeichen ab. Das ist der empfohlene Zustand.");
            } else if (an.kodierung.indexOf("ANSI") === 0) {
                z("ANSI – wird gelesen. Achtung: deckt nur westeuropäische Zeichen ab.");
                z("Für Slowenisch, Polnisch, Kyrillisch, Griechisch usw. ist UTF-16 nötig.");
            }
        }

        // Importoptionen
        z("");
        z("--- Importoptionen (Trennzeichen, Kodierung, Plattform) ---");
        z("Nicht auslesbar. InDesign merkt sich die im Verknüpfen-Dialog gewählten");
        z("Einstellungen nicht in einer Form, die das Skripting abfragen kann.");
        z("Die oben ermittelte Kodierung stammt deshalb aus der Datei selbst,");
        z("nicht aus dem Dialog. Das ist die verlässlichere Angabe.");
    }

    // ---------- Seitenobjekte ----------
    var objekte = [];
    try { var ap = doc.allPageItems; for (var a = 0; a < ap.length; a++) objekte.push(ap[a]); }
    catch (e13) { var tf0 = doc.textFrames; for (var b = 0; b < tf0.length; b++) objekte.push(tf0[b]); }

    var textrahmen = [], grafikrahmen = [];
    for (var s = 0; s < objekte.length; s++) {
        var kl = klasse(objekte[s]);
        if (kl === "TextFrame") textrahmen.push(objekte[s]);
        else if (kl === "Rectangle" || kl === "Oval" || kl === "Polygon" ||
                 kl === "Group" || kl === "PageItem" || kl === "SplineItem") grafikrahmen.push(objekte[s]);
    }

    // ---------- 2. Textplatzhalter ----------
    titel("2. TEXTPLATZHALTER IM LAYOUT");
    z("Textrahmen geprüft: " + textrahmen.length + "   (inkl. Musterseiten und Gruppen)");
    z("");

    var probleme = [], verwendet = [], muster = /<<([^>]+)>>/g;

    for (var t3 = 0; t3 < textrahmen.length; t3++) {
        var inhalt = "";
        try { inhalt = String(textrahmen[t3].contents); } catch (e14) { continue; }
        var ort = ortVon(textrahmen[t3]);
        muster.lastIndex = 0;
        var m;
        while ((m = muster.exec(inhalt)) !== null) {
            var name = trimme(m[1]);
            if (!enthaelt(verwendet, name)) verwendet.push(name);

            var bekannt = enthaelt(felder, name);
            var typ2 = typVonFeld[name] || null;

            if (!bekannt) {
                probleme.push("VERWAIST       <<" + name + ">>   " + ort +
                              "   – kein Feld dieses Namens in der Datenquelle");
            } else if (phantom[name]) {
                probleme.push("PHANTOMFELD    <<" + name + ">>   " + ort +
                              "\n                  " + phantom[name] +
                              "\n                  Das Feld steht im Bedienfeld, in der Datei gibt es" +
                              "\n                  keine Spalte dieses Namens. Beim Zusammenführen" +
                              "\n                  findet InDesign dazu keinen Wert." +
                              "\n                  Lösung: Spalte in der Datenquelle eindeutig benennen" +
                              "\n                  und neu verknüpfen – oder dieses Feld nicht verwenden.");
            } else if (typ2 && typ2 !== "Text") {
                probleme.push("FALSCHER TYP   <<" + name + ">>   " + ort +
                              "   – Textplatzhalter, aber das Feld ist ein " + typ2 + "-Feld" +
                              (rohTyp[name] ? (" (" + rohTyp[name] + ")") : "") +
                              "\n                  Lösung: diesen Platzhalter löschen und das Feld" +
                              "\n                  aus dem Bedienfeld in einen Grafikrahmen ziehen.");
            } else {
                z("   ok   <<" + name + ">>   " + ort + (typ2 ? ("   [" + typ2 + "]") : ""));
            }
        }
    }

    z("");
    if (probleme.length > 0) {
        z("--- PROBLEME ---"); z("");
        for (var p2 = 0; p2 < probleme.length; p2++) z("   " + probleme[p2]);
    } else {
        z("Keine Probleme bei den Textplatzhaltern.");
    }

    // ---------- 3. Bild- und QR-Felder ----------
    titel("3. BILD- UND QR-FELDER");

    var bildQr = [];
    for (var f3 = 0; f3 < felder.length; f3++) {
        var ty = typVonFeld[felder[f3]];
        if (ty === "Bild" || ty === "QR") bildQr.push(felder[f3]);
    }

    if (bildQr.length === 0) {
        z("Keine Bild- oder QR-Felder in der Datenquelle" +
          (typquelle === "keine" ? " (Typ konnte allerdings nicht ermittelt werden)." : "."));
    } else {
        for (var q = 0; q < bildQr.length; q++) {
            z("   [" + typVonFeld[bildQr[q]] + "]  " + bildQr[q] +
              (enthaelt(verwendet, bildQr[q]) ? "   >>> steht als TEXTplatzhalter im Layout – das ist der Fehler" : ""));
        }
    }

    z("");
    z("Grafik- und Sammelobjekte im Dokument: " + grafikrahmen.length);
    z("Ein LEERER Grafikrahmen ist in der Vorlage der Normalfall – das ist der Platzhalter.");
    z("");
    var leere = 0;
    for (var r = 0; r < grafikrahmen.length; r++) {
        var gr = grafikrahmen[r], leer = true, info = "";
        try {
            if (gr.graphics && gr.graphics.length > 0) {
                leer = false;
                try { info = " -> " + gr.graphics[0].itemLink.name; } catch (e15) { info = " -> Grafik ohne Verknüpfung"; }
            }
        } catch (e16) { leer = false; info = " -> (kein Grafikcontainer)"; }
        if (leer) leere++;
        var dm = dmEigenschaften(gr), dmInfo = "";
        for (var d = 0; d < dm.length; d++) {
            var w = ""; try { w = String(gr[dm[d]]); } catch (e17) { w = "(nicht lesbar)"; }
            dmInfo += "   [" + dm[d] + " = " + w + "]";
        }
        var nn = ""; try { nn = gr.name || "(ohne Namen)"; } catch (e18) { nn = "(ohne Namen)"; }
        z("   " + (leer ? "LEER    " : "gefüllt ") + klasse(gr) + "   " + ortVon(gr) + "   " + nn + info + dmInfo);
    }

    if (bildQr.length > 0) {
        z("");
        z("Abgleich: " + bildQr.length + " Bild-/QR-Feld(er), " + leere + " leere(r) Rahmen.");
        if (leere < bildQr.length)
            z("   >>> Weniger leere Rahmen als Felder – möglicherweise fehlt ein Platzhalter.");
    }

    // ---------- 4. Deutung ----------
    titel("4. WIE DU DEN BERICHT LIEST");

    z("VERWAIST      Der Platzhalter nennt ein Feld, das es in der Quelle nicht gibt.");
    z("              Meist Rest einer früheren Datenquelle.");
    z("");
    z("FALSCHER TYP  Der Name stimmt, der Typ nicht. Im Layout steht ein");
    z("              Textplatzhalter auf einem Bild- oder QR-Feld.");
    z("              InDesign verweigert die Vorschau und sagt nicht, warum.");
    z("");
    z("PHANTOMFELD   Das Feld steht im Bedienfeld, in der Datenquelle gibt es");
    z("              keine Spalte dieses Namens. Häufigster Fall: In der");
    z("              Kopfzeile kommt ein Name doppelt vor, InDesign hängt beim");
    z("              zweiten eine Ziffer an – aus \"Abteilung\" wird \"Abteilung1\".");
    z("              Der neue Name existiert nur in InDesign. Wird er im Layout");
    z("              verwendet, scheitert die Zusammenführung.");
    z("");
    z("Steht bei einem Feld [?] statt [Text], [Bild] oder [QR], kennt das Skript");
    z("den Feldtyp dieser InDesign-Version nicht. Der Rohwert steht in Klammern");
    z("dahinter und muss in der Funktion normTyp ergänzt werden.");

    // ---------- Ausgabe ----------
    var text = L.join("\n"), ziel = null, ok = false;
    try {
        var ordner = (doc.saved && doc.filePath) ? doc.filePath : Folder.desktop;
        ziel = new File(ordner + "/platzhalter-bericht.txt");
        ziel.encoding = "UTF-8";
        if (ziel.open("w")) { ziel.write(text); ziel.close(); ok = true; }
    } catch (e23) {}

    var kurz = "PLATZHALTER-CHECK v2.6\n\n" +
        "Felder:        " + felder.length + "   (Typquelle: " + typquelle + ")\n" +
        (kodierungKurz ? ("Kodierung:     " + kodierungKurz + "\n") : "") +
        "Textrahmen:    " + textrahmen.length + "\n" +
        "Grafikobjekte: " + grafikrahmen.length + "\n\n" +
        "Gefundene Probleme: " + probleme.length + "\n\n" +
        (probleme.length > 0 ? (probleme.join("\n\n") + "\n\n") : "Keine.\n\n") +
        (ok ? ("Vollständiger Bericht:\n" + ziel.fsName) : "Bericht konnte nicht gespeichert werden.");
    alert(kurz);
    if (!ok) $.writeln(text);

})();
