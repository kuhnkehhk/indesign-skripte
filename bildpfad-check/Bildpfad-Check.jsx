/*
    Bildpfad-Check  v3.4
    ==================================================================
    Prüft ALLE Bildpfade einer Datenzusammenführungs-Datenquelle,
    BEVOR zusammengeführt wird – und nennt zu jedem fehlenden Bild
    den DATENSATZ und das FELD.

    Genau das verschweigt InDesign: Es zeigt eine Liste fehlender
    Dateien, sagt aber nicht, zu welchem Datensatz sie gehören. Und
    im zusammengeführten Dokument bleibt vom fehlenden Bild keine
    Spur – der Rahmen ist leer, ohne Verknüpfung, ohne Hinweis.

    WAS ES FINDET
    ------------------------------------------------------------------
    FEHLT          Datei ist nirgends auffindbar
    SCHREIBWEISE   Datei ist da, aber der Pfad ist so notiert,
                   dass InDesign ihn nicht auflöst
    GROSS/KLEIN    Datei ist da, aber anders geschrieben.
                   Windows verzeiht das, macOS nicht
    LEER           Bildfeld ohne Wert. InDesign lässt den Rahmen
                   stillschweigend leer
    ORDNER-UMLAUT  Absoluter Pfad mit Sonderzeichen im Ordnernamen

    WAS ES AUSGIBT
    ------------------------------------------------------------------
    1. Bericht als TXT neben der Datenquelle
    2. Auf Wunsch eine KORRIGIERTE KOPIE der Datenquelle.
       Die Originaldatei wird nie verändert.

    NUR LESEND am Dokument. Schreibt höchstens eine neue Datei
    neben die Datenquelle.

    AUSFÜHREN  Fenster > Hilfsprogramme > Skripte, Datei in den
               Ordner "User" legen, doppelklicken.

    Heike Kuhnke · kuhnke-owl.de · 22.09.2026
*/

#target indesign

(function haupt(vorgabePfad) {

    var VERSION  = "v3.4";
    var LIMIT    = 65536;     // Bytes für die Kodierungsprüfung
    var MAXTIEFE = 4;         // Ordnertiefe bei der Dateisuche
    var MAXDATEI = 20000;     // Notbremse bei der Dateisuche

    // ================= Hilfsfunktionen =================
    function trimme(s) { return String(s).replace(/^\s+|\s+$/g, ""); }

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

    function baue(felder, trenner) {
        var raus = [];
        for (var i = 0; i < felder.length; i++) {
            var w = String(felder[i]);
            if (w.indexOf(trenner) > -1 || w.indexOf('"') > -1 ||
                w.indexOf("\n") > -1 || w.indexOf("\r") > -1) {
                w = '"' + w.replace(/"/g, '""') + '"';
            }
            raus.push(w);
        }
        return raus.join(trenner);
    }

    // ---------- Kodierung aus den Bytes bestimmen ----------
    // Siehe Platzhalter-Check v2.6: File.open() schnüffelt selbst nach
    // einem BOM und verschluckt es. Deshalb erst öffnen, dann BINARY.
    function kodierungBestimmen(pfad) {
        var e = { groesse: 0, kodierung: "unbekannt", trenner: ",", sicherheit: "" };
        var f = new File(pfad);
        if (!f.exists) return e;
        var roh = "";
        try {
            e.groesse = f.length;
            if (!f.open("r")) return e;
            f.encoding = "BINARY";
            try { f.seek(0, 0); } catch (eS) {}
            roh = f.read(Math.min(f.length, LIMIT));
            f.close();
        } catch (eD) { try { f.close(); } catch (eD2) {} return e; }

        for (var pr = 0; pr < roh.length && pr < 4096; pr++)
            if (roh.charCodeAt(pr) > 255) { e.kodierung = "nicht bestimmbar"; return e; }

        function b(i) { return roh.charCodeAt(i) & 0xFF; }
        var n = roh.length;

        function nullMuster(versatz) {
            var t = 0, g = 0, grenze = Math.min(n, 2048);
            for (var p = versatz; p < grenze; p += 2) { g++; if (b(p) === 0) t++; }
            return g ? (t / g) : 0;
        }

        var verschluckt = (e.groesse <= LIMIT) ? (e.groesse - n) : -1;
        var bomImText = 0;

        if (verschluckt === 3) {
            e.kodierung = "UTF-8 mit BOM";
        } else if (verschluckt === 2) {
            e.kodierung = (nullMuster(0) > nullMuster(1)) ? "UTF-16 BE" : "UTF-16 LE";
        } else if (n >= 3 && b(0) === 0xEF && b(1) === 0xBB && b(2) === 0xBF) {
            e.kodierung = "UTF-8 mit BOM"; bomImText = 3;
        } else if (n >= 2 && b(0) === 0xFF && b(1) === 0xFE) {
            e.kodierung = "UTF-16 LE"; bomImText = 2;
        } else if (n >= 2 && b(0) === 0xFE && b(1) === 0xFF) {
            e.kodierung = "UTF-16 BE"; bomImText = 2;
        } else if (n >= 16 && nullMuster(1) > 0.6) {
            e.kodierung = "UTF-16 LE ohne BOM";
        } else if (n >= 16 && nullMuster(0) > 0.6) {
            e.kodierung = "UTF-16 BE ohne BOM";
        } else {
            var i = 0, mehrbyte = false, gueltig = true, hohe = false;
            while (i < n) {
                var c = b(i);
                if (c < 0x80) { i++; continue; }
                hohe = true;
                var fo = 0;
                if ((c & 0xE0) === 0xC0) fo = 1;
                else if ((c & 0xF0) === 0xE0) fo = 2;
                else if ((c & 0xF8) === 0xF0) fo = 3;
                else { gueltig = false; break; }
                if (i + fo >= n) break;
                for (var k = 1; k <= fo; k++) if ((b(i + k) & 0xC0) !== 0x80) { gueltig = false; break; }
                if (!gueltig) break;
                mehrbyte = true; i += fo + 1;
            }
            if (!hohe)                      e.kodierung = "reines ASCII";
            else if (gueltig && mehrbyte)   e.kodierung = "UTF-8 ohne BOM";
            else                            e.kodierung = "ANSI / Windows-1252";
        }

        // Trennzeichen aus der Kopfzeile
        var breit = (e.kodierung.indexOf("UTF-16") === 0);
        var schritt = breit ? 2 : 1, kopf = [], fertig = false;
        for (var t2 = bomImText; t2 < n; t2 += schritt) {
            var z = b(t2);
            if (z === 10) { fertig = true; break; }
            if (z !== 13) kopf.push(z);
        }
        var za = { 44: 0, 59: 0, 9: 0 }, inQ = false;
        for (var q = 0; q < kopf.length; q++) {
            if (kopf[q] === 34) { inQ = !inQ; continue; }
            if (!inQ && za[kopf[q]] !== undefined) za[kopf[q]]++;
        }
        var best = 44, bestN = za[44];
        if (za[59] > bestN) { bestN = za[59]; best = 59; }
        if (za[9]  > bestN) { bestN = za[9];  best = 9;  }
        e.trenner = (best === 9 ? "\t" : (best === 44 ? "," : ";"));
        return e;
    }

    // ---------- Datenquelle vollständig einlesen ----------
    function quelleLesen(pfad) {
        var info = kodierungBestimmen(pfad);
        var esEnc = null;
        if (info.kodierung.indexOf("UTF-16") === 0)      esEnc = "UTF-16";
        else if (info.kodierung.indexOf("UTF-8") === 0)  esEnc = "UTF-8";
        else if (info.kodierung.indexOf("ANSI") === 0)   esEnc = "windows-1252";

        var f = new File(pfad), text = "";
        try {
            if (esEnc) f.encoding = esEnc;
            if (!f.open("r")) return null;
            text = f.read();
            f.close();
        } catch (eL) { try { f.close(); } catch (eL2) {} return null; }

        text = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        var roh = text.split("\n");
        var zeilen = [];
        for (var i = 0; i < roh.length; i++) if (trimme(roh[i]) !== "") zeilen.push(roh[i]);
        if (zeilen.length === 0) return null;

        return {
            kodierung: info.kodierung,
            trenner:   info.trenner,
            kopf:      zerlege(zeilen[0], info.trenner),
            saetze:    zeilen.slice(1),
            rohKopf:   zeilen[0]
        };
    }

    // ---------- Pfade ----------
    function istAbsolut(p) {
        return /^[A-Za-z]:[\\\/]/.test(p) || p.charAt(0) === "/" || p.charAt(0) === "~" ||
               p.substring(0, 2) === "\\\\";
    }
    function schraegNorm(p) { return String(p).replace(/\\/g, "/"); }

    // "a/b/../c" zu "a/c" zusammenfalten. Ohne das vergleicht relativMachen
    // Zeichenketten, die denselben Ort meinen, und liefert Unsinn wie "./../".
    function normPfad(p) {
        var s = schraegNorm(p);
        var vorn = "";
        if (/^[A-Za-z]:\//.test(s)) { vorn = s.substring(0, 3); s = s.substring(3); }
        else if (s.charAt(0) === "/") { vorn = "/"; s = s.substring(1); }
        var teile = s.split("/"), raus = [];
        for (var i = 0; i < teile.length; i++) {
            var t = teile[i];
            if (t === "" || t === ".") continue;
            if (t === "..") {
                if (raus.length > 0 && raus[raus.length - 1] !== "..") raus.pop();
                else if (vorn === "") raus.push("..");
                continue;
            }
            raus.push(t);
        }
        return vorn + raus.join("/");
    }

    function aufloesen(wert, basisOrdner) {
        var roh = schraegNorm(trimme(wert));
        var p = roh, punkt = false, aufwaerts = (roh.substring(0, 3) === "../");
        if (p.substring(0, 2) === "./") { p = p.substring(2); punkt = true; }
        if (istAbsolut(p))
            return { pfad: normPfad(p), relativ: false, punkt: punkt, aufwaerts: aufwaerts };
        return { pfad: normPfad(basisOrdner + "/" + p), relativ: true,
                 punkt: punkt, aufwaerts: aufwaerts };
    }

    function dateiDa(p) {
        try { var f = new File(p); return f.exists; } catch (e) { return false; }
    }

    // Ordnerbaum einmal einlesen: Basisname (klein) -> Liste echter Pfade
    function baumLesen(startOrdner) {
        var karte = {}, norm = {}, stamm = {}, anzahl = 0;
        function eintragen(kar, schluessel, pfad) {
            if (!schluessel) return;
            if (!kar[schluessel]) kar[schluessel] = [];
            for (var d = 0; d < kar[schluessel].length; d++) if (kar[schluessel][d] === pfad) return;
            kar[schluessel].push(pfad);
        }
        function rein(ordner, tiefe) {
            if (tiefe > MAXTIEFE || anzahl > MAXDATEI) return;
            var eintraege;
            try { eintraege = ordner.getFiles(); } catch (e) { return; }
            for (var i = 0; i < eintraege.length; i++) {
                var el = eintraege[i];
                if (el instanceof Folder) { rein(el, tiefe + 1); continue; }
                anzahl++;
                if (anzahl > MAXDATEI) return;
                var name = decodeURI(el.name), voll = decodeURI(el.fsName);
                eintragen(karte, name.toLowerCase(), voll);
                var nk = normKeys(name);
                for (var a = 0; a < nk.length; a++) eintragen(norm, nk[a], voll);
                var sk = normKeys(ohneEndung(name));
                for (var b2 = 0; b2 < sk.length; b2++) eintragen(stamm, sk[b2], voll);
            }
        }
        try { rein(new Folder(startOrdner), 0); } catch (e) {}
        return { karte: karte, norm: norm, stamm: stamm, anzahl: anzahl };
    }

    // Stufenweise suchen: exakt -> normalisiert -> nur der Stamm
    function suchen(baum, basisName) {
        var t = baum.karte[String(basisName).toLowerCase()];
        if (t && t.length) return { treffer: t, stufe: "exakt" };

        var raus = [], nk = normKeys(basisName), i, j;
        for (i = 0; i < nk.length; i++) {
            var tn = baum.norm[nk[i]];
            if (tn) for (j = 0; j < tn.length; j++) raus.push(tn[j]);
        }
        if (raus.length) return { treffer: eindeutig(raus), stufe: "normalisiert" };

        var sk = normKeys(ohneEndung(basisName));
        for (i = 0; i < sk.length; i++) {
            var ts = baum.stamm[sk[i]];
            if (ts) for (j = 0; j < ts.length; j++) raus.push(ts[j]);
        }
        if (raus.length) return { treffer: eindeutig(raus), stufe: "stamm" };

        // Letzte Stufe: Anfang stimmt, bis zu 2 Zeichen Unterschied.
        // Fängt den Zeichensalat-Fall ab: "kova?.png" zu "kovac.png".
        var ziel = sk[0];
        if (ziel && ziel.length >= 4) {
            for (var schl in baum.stamm) {
                if (!baum.stamm.hasOwnProperty(schl)) continue;
                var kurz = (schl.length < ziel.length) ? schl : ziel;
                var lang = (schl.length < ziel.length) ? ziel : schl;
                if (lang.length - kurz.length > 2) continue;
                if (lang.substring(0, kurz.length) !== kurz) continue;
                var tp = baum.stamm[schl];
                for (var p3 = 0; p3 < tp.length; p3++) raus.push(tp[p3]);
            }
        }
        if (raus.length) return { treffer: eindeutig(raus), stufe: "unsicher" };

        return { treffer: [], stufe: "nichts" };
    }

    // Kandidaten bewerten – der Ordner, auf den der Pfad zeigt, wiegt am schwersten
    var BILDENDUNGEN = ".png.jpg.jpeg.tif.tiff.psd.pdf.eps.ai.svg.";
    function besterTreffer(treffer, notierterPfad, basisOrdner) {
        if (treffer.length <= 1) return { sieger: treffer[0] || null, eindeutig: treffer.length === 1 };
        var zielOrdner = schraegNorm(notierterPfad);
        zielOrdner = zielOrdner.substring(0, zielOrdner.lastIndexOf("/")).toLowerCase();
        var notEndung = endungVon(notierterPfad);
        var punkte = [];
        for (var i = 0; i < treffer.length; i++) {
            var p = schraegNorm(treffer[i]);
            var ordner = p.substring(0, p.lastIndexOf("/")).toLowerCase();
            var end = endungVon(p);
            var wert = 0;
            if (ordner === zielOrdner) wert += 100;
            if (notEndung && end === notEndung) wert += 20;
            if (BILDENDUNGEN.indexOf(end + ".") > -1) wert += 5;
            if (end === ".svg") wert -= 3;               // meist die Quelldatei, nicht das Bild
            var tiefe = p.substring(basisOrdner.length).split("/").length;
            wert -= tiefe;
            punkte.push({ pfad: treffer[i], wert: wert });
        }
        punkte.sort(function (a, b) { return b.wert - a.wert; });
        return {
            sieger: punkte[0].pfad,
            eindeutig: (punkte.length < 2) || (punkte[0].wert > punkte[1].wert),
            sortiert: punkte
        };
    }
    function eindeutig(a) {
        var raus = [];
        for (var i = 0; i < a.length; i++) {
            var drin = false;
            for (var k = 0; k < raus.length; k++) if (raus[k] === a[i]) drin = true;
            if (!drin) raus.push(a[i]);
        }
        return raus;
    }

    // Worin genau unterscheiden sich notierter und echter Name?
    function unterschied(notiert, echt) {
        var eN = endungVon(notiert), eE = endungVon(echt);
        if (eN === "" && eE !== "")  return "die Endung fehlt – die Datei heißt \"" + echt + "\"";
        if (eN !== eE)               return "Endung ist \"" + eN + "\", die Datei ist \"" + eE + "\"";
        if (notiert.toLowerCase() === echt.toLowerCase()) return "nur Groß-/Kleinschreibung – auf macOS ein Abbruch";
        if (notiert.replace(/\s/g, "") === echt.replace(/\s/g, "")) return "überzähliges Leerzeichen im Namen";
        if (hatSonderzeichen(notiert) || hatSonderzeichen(echt))
            return "Sonderzeichen unterschiedlich geschrieben – notiert \"" + notiert + "\", Datei \"" + echt + "\"";
        return "Name weicht ab – notiert \"" + notiert + "\", Datei \"" + echt + "\"";
    }

    // Relative Notation gegen den Basisordner bauen
    function relativMachen(zielFsName, basisFsName) {
        var ziel  = schraegNorm(zielFsName);
        var basis = schraegNorm(basisFsName);
        if (ziel.toLowerCase().indexOf(basis.toLowerCase() + "/") !== 0) return null;
        return "./" + ziel.substring(basis.length + 1);
    }

    function hatSonderzeichen(s) { return /[^\x20-\x7E]/.test(String(s)); }

    // ---------- Schreibweise der anderen Plattform erkennen ----------
    // Nötig, weil schraegNorm() intern jeden "\" zu "/" macht. Ohne diese
    // Prüfung würde das Skript auf macOS einen Windows-Pfad auflösen und
    // "in Ordnung" melden – InDesign tut das dort aber nicht.
    function fremdeSchreibweise(w) {
        var t = trimme(w);
        if (t === "") return null;
        if (WIN) {
            if (/^\/(Volumes|Users|Applications|Library)\//.test(t))
                return "POSIX-Pfad (macOS-Schreibweise) – auf Windows nicht auflösbar";
            if (/^[A-Za-z]:\//.test(t))
                return "absoluter Pfad mit \"/\" – auf Windows ist \"\\\" nötig";
            if (t.substring(0, 3) === "../")
                return "\"../\" mit Schrägstrich – auf Windows ist \"..\\\" nötig";
        } else {
            if (/^[A-Za-z]:[\\\/]/.test(t))
                return "Windows-Laufwerkspfad (C:\\...) – auf macOS nicht auflösbar";
            if (t.indexOf("\\") > -1)
                return "Backslash – Windows-Schreibweise, auf macOS nicht auflösbar";
        }
        return null;
    }

    // Ist der Wert auf BEIDEN Plattformen gültig?
    function plattformSicher(w) {
        var t = trimme(w);
        return (t.substring(0, 2) === "./" && t.indexOf("\\") < 0);
    }

    // ---------- Pfad in Ordner und Namen zerlegen und wieder zusammensetzen ----------
    function zerteile(p) {
        var s = schraegNorm(p), i = s.lastIndexOf("/");
        if (i < 0) return { ordner: "", name: String(p) };
        return { ordner: String(p).substring(0, i), name: String(p).substring(i + 1) };
    }
    function pfadFuegen(ordner, name) {
        if (ordner === "" || ordner === null) return name;
        var o = String(ordner);
        var letzte = o.charAt(o.length - 1);
        if (letzte === "/" || letzte === "\\") o = o.substring(0, o.length - 1);
        var trenn = (o.indexOf("\\") > -1) ? "\\" : "/";
        return o + trenn + name;
    }

    // ---------- Namen vergleichbar machen ----------
    // Damit "oberländer.png" auch "oberlaender.png" findet, "gross .png"
    // auch "gross.png" und "kovač.png" auch "kovac.png".
    var DIAK = {};
    (function () {
        var paare = ["àáâãåāăą:a", "çćčĉ:c", "ďđ:d", "èéêëēĕėęě:e", "ĝğġģ:g",
                     "ĥħ:h", "ìíîïĩīĭįı:i", "ĵ:j", "ķ:k", "ĺļľłŀ:l", "ñńņňŉ:n",
                     "òóôõøōŏő:o", "ŕŗř:r", "śŝşš:s", "ţťŧ:t", "ùúûũūŭůűų:u",
                     "ŵ:w", "ýÿŷ:y", "źżž:z"];
        for (var i = 0; i < paare.length; i++) {
            var teil = paare[i].split(":");
            for (var k = 0; k < teil[0].length; k++) DIAK[teil[0].charAt(k)] = teil[1];
        }
    })();

    function normVariante(s, umlautLang) {
        var t = String(s).toLowerCase(), raus = "";
        for (var i = 0; i < t.length; i++) {
            var c = t.charAt(i);
            if (c === "ä") raus += umlautLang ? "ae" : "a";
            else if (c === "ö") raus += umlautLang ? "oe" : "o";
            else if (c === "ü") raus += umlautLang ? "ue" : "u";
            else if (c === "ß") raus += "ss";
            else if (DIAK[c]) raus += DIAK[c];
            else raus += c;
        }
        return raus.replace(/[^a-z0-9.]/g, "");
    }
    function normKeys(s) {
        var a = normVariante(s, true), b = normVariante(s, false);
        return (a === b) ? [a] : [a, b];
    }
    function ohneEndung(n) { var p = String(n).lastIndexOf("."); return p > 0 ? String(n).substring(0, p) : String(n); }
    function endungVon(n)  { var p = String(n).lastIndexOf("."); return p > 0 ? String(n).substring(p).toLowerCase() : ""; }

    // ---------- Bytes schreiben ----------
    function alsUTF16LE(s) {
        var a = [String.fromCharCode(0xFF), String.fromCharCode(0xFE)];
        for (var i = 0; i < s.length; i++) {
            var c = s.charCodeAt(i);
            a.push(String.fromCharCode(c & 0xFF), String.fromCharCode((c >> 8) & 0xFF));
        }
        return a.join("");
    }
    function alsUTF8(s, mitBom) {
        var a = [];
        if (mitBom) a.push(String.fromCharCode(0xEF), String.fromCharCode(0xBB), String.fromCharCode(0xBF));
        for (var i = 0; i < s.length; i++) {
            var c = s.charCodeAt(i);
            if (c < 0x80) a.push(String.fromCharCode(c));
            else if (c < 0x800) {
                a.push(String.fromCharCode(0xC0 | (c >> 6)), String.fromCharCode(0x80 | (c & 0x3F)));
            } else {
                a.push(String.fromCharCode(0xE0 | (c >> 12)),
                       String.fromCharCode(0x80 | ((c >> 6) & 0x3F)),
                       String.fromCharCode(0x80 | (c & 0x3F)));
            }
        }
        return a.join("");
    }
    function alsAnsi(s) {
        var a = [], verlust = false;
        for (var i = 0; i < s.length; i++) {
            var c = s.charCodeAt(i);
            if (c > 255) { a.push("?"); verlust = true; }
            else a.push(String.fromCharCode(c));
        }
        return { text: a.join(""), verlust: verlust };
    }

    function byteSchreiben(datei, inhalt) {
        try {
            if (!datei.open("w")) return false;
            datei.encoding = "BINARY";
            datei.write(inhalt);
            datei.close();
            return true;
        } catch (e) { try { datei.close(); } catch (e2) {} return false; }
    }

    // ================= Start =================
    if (app.documents.length === 0) { alert("Kein Dokument geöffnet."); return; }
    var doc = app.activeDocument;

    // ---------- Datenquelle finden ----------
    var quellPfad = null, herkunft = "";

    // Beim Wechseln im Dialog kommt der Pfad von dort und hat Vorrang
    if (vorgabePfad) {
        quellPfad = vorgabePfad;
        herkunft  = "von dir gewählt";
    }
    try {
        var s = doc.dataMergeProperties.dataMergeSource;
        if (s && s.fullName) { quellPfad = decodeURI(s.fullName.fsName); herkunft = "aus dem Dokument"; }
    } catch (eA) {}
    // ---------- Kandidaten aus der Verknüpfungspalette ----------
    // WICHTIG: Nach einem Wechsel der Datenquelle steht die ALTE oft noch
    // in der Palette. Die erste passende Verknüpfung zu nehmen, liefert
    // dann die falsche Datei. Deshalb werden alle bewertet.
    var kandidaten = [];
    if (!quellPfad) {
        try {
            var lk = doc.links;
            for (var i = 0; i < lk.length; i++) {
                var nm = String(lk[i].name).toLowerCase();
                if (!/\.(csv|txt|tsv)$/.test(nm)) continue;
                var pf = decodeURI(lk[i].filePath);
                var drin = false;
                for (var d2 = 0; d2 < kandidaten.length; d2++)
                    if (kandidaten[d2].pfad === pf) drin = true;
                if (!drin) kandidaten.push({ pfad: pf, punkte: 0, kopf: "" });
            }
        } catch (eB) {}
    }

    // Feldnamen aus dem Bedienfeld holen – daran erkennt man die richtige Datei
    var feldNamen = [];
    try {
        var dmf = doc.dataMergeProperties.dataMergeFields;
        for (var fz2 = 0; fz2 < dmf.length; fz2++) {
            var fn2 = trimme(String(dmf[fz2].fieldName)).replace(/^[@#]/, "");
            if (fn2 !== "") feldNamen.push(fn2.toLowerCase());
        }
    } catch (eF2) {}

    if (kandidaten.length === 1) {
        quellPfad = kandidaten[0].pfad;
        herkunft = "aus der Verknüpfungspalette";
    } else if (kandidaten.length > 1) {
        // Kopfzeile jedes Kandidaten gegen die Feldliste halten
        for (var kk2 = 0; kk2 < kandidaten.length; kk2++) {
            var qv = quelleLesen(kandidaten[kk2].pfad);
            if (!qv) { kandidaten[kk2].punkte = -999; continue; }
            var treffer2 = 0, fremd2 = 0;
            for (var sp2 = 0; sp2 < qv.kopf.length; sp2++) {
                var kn = trimme(qv.kopf[sp2]).replace(/^[@#]/, "").replace(/^﻿/, "").toLowerCase();
                if (kn === "") continue;
                var gef2 = false;
                for (var fi2 = 0; fi2 < feldNamen.length; fi2++) if (feldNamen[fi2] === kn) gef2 = true;
                if (gef2) treffer2++; else fremd2++;
            }
            kandidaten[kk2].punkte = treffer2 - fremd2;
            kandidaten[kk2].kopf   = treffer2 + " von " + qv.kopf.length + " Feldern passen";
        }
        kandidaten.sort(function (a, b) { return b.punkte - a.punkte; });
        quellPfad = kandidaten[0].pfad;
        herkunft  = "aus der Verknüpfungspalette – " + kandidaten.length +
                    " Kandidaten, gewählt: " + kandidaten[0].kopf;
        if (feldNamen.length === 0)
            herkunft = "aus der Verknüpfungspalette – " + kandidaten.length +
                       " Kandidaten, Feldliste nicht lesbar, erste genommen";

        // Mehrere Kandidaten heißt fast immer: eine alte Verknüpfung hängt noch.
        // Das darf das Skript nicht still entscheiden.
        var wDlg = new Window("dialog", "Welche Datenquelle?");
        wDlg.alignChildren = "fill"; wDlg.margins = 14; wDlg.spacing = 8;
        var wT = wDlg.add("statictext", undefined,
            "Im Dokument hängen " + kandidaten.length + " Datenquellen-Verknüpfungen.\n" +
            "Nach einem Wechsel bleibt die alte oft stehen. Welche gilt?",
            { multiline: true });
        wT.characters = 78;
        var wL = wDlg.add("listbox", undefined, [], {
            numberOfColumns: 3, showHeaders: true,
            columnTitles: ["Passung", "Datei", "Ordner"],
            columnWidths: [150, 200, 260]
        });
        wL.preferredSize = [620, 110];
        for (var wk = 0; wk < kandidaten.length; wk++) {
            var zt2 = zerteile(kandidaten[wk].pfad);
            var wi = wL.add("item", kandidaten[wk].kopf || "nicht lesbar");
            wi.subItems[0].text = zt2.name;
            wi.subItems[1].text = zt2.ordner;
        }
        wL.selection = 0;
        var wB = wDlg.add("group"); wB.alignment = "right";
        wB.add("button", undefined, "Abbrechen", { name: "cancel" });
        wB.add("button", undefined, "Diese nehmen", { name: "ok" });
        if (wDlg.show() !== 1) { alert("Abgebrochen."); return; }
        var wS = wL.selection ? wL.selection.index : 0;
        quellPfad = kandidaten[wS].pfad;
        herkunft  = "von dir gewählt aus " + kandidaten.length +
                    " Verknüpfungen (" + (kandidaten[wS].kopf || "Passung unbekannt") + ")";
    }
    if (!quellPfad) {
        var gewaehlt = File.openDialog("Datenquelle wählen (CSV oder TXT)");
        if (!gewaehlt) { alert("Abgebrochen."); return; }
        quellPfad = decodeURI(gewaehlt.fsName);
        herkunft = "von Hand gewählt";
    }

    var quellDatei   = new File(quellPfad);
    var basisOrdner  = decodeURI(quellDatei.parent.fsName);   // Ordner der DATENQUELLE
    var basisFuerURI = quellDatei.parent.fullName;

    // ---------- Bezugspunkt für relative Pfade ----------
    // BEFUND 22.09.2026, am eigenen Rechner belegt:
    // "./" bezieht sich auf den Ordner der DATENQUELLE.
    //
    // Nachweis: slowenisch/INT_komma_UTF16.csv mit "./bilder/..." – die
    // Bilder liegen eine Ebene höher beim Dokument. InDesign 21.6 findet
    // sie NICHT. Liegt die CSV dagegen neben den Bildern, klappt es.
    //
    // (Eine frühere Fassung dieses Skripts nahm das Gegenteil an. Falsch.)
    var basen = [{ pfad: basisOrdner, uri: basisFuerURI, name: "Datenquelle" }];

    // Der Ordner des Dokuments und die Ebene darüber sind KEIN Bezugspunkt –
    // aber Bilder liegen oft dort. Deshalb werden sie mitdurchsucht, damit
    // das Skript sagen kann: "die Datei ist da, nur woanders".
    var dokOrdner = null, dokFuerURI = null;
    try {
        if (doc.saved && doc.fullName) {
            dokOrdner  = decodeURI(doc.fullName.parent.fsName);
            dokFuerURI = doc.fullName.parent.fullName;
        }
    } catch (eDok) {}

    var suchWurzeln = [basisFuerURI];
    function wurzelDazu(u) {
        if (!u) return;
        for (var i = 0; i < suchWurzeln.length; i++)
            if (String(suchWurzeln[i]).toLowerCase() === String(u).toLowerCase()) return;
        suchWurzeln.push(u);
    }
    wurzelDazu(dokFuerURI);
    // Der Elternordner der Datenquelle wird NICHT mitdurchsucht.
    // Liegt die CSV nahe der Laufwerkswurzel, wäre das halbe Platte.

    var q = quelleLesen(quellPfad);
    if (!q) { alert("Die Datenquelle ließ sich nicht lesen:\n" + quellPfad); return; }

    // ---------- Bildfelder aus der Kopfzeile ----------
    var bildSpalten = [];
    for (var k = 0; k < q.kopf.length; k++) {
        var roh = trimme(q.kopf[k]).replace(/^﻿/, "");
        if (roh.charAt(0) === "@") bildSpalten.push({ index: k, name: trimme(roh.substring(1)) });
    }

    var L = [];
    function z(t) { L.push(t === undefined ? "" : String(t)); }
    function titel(t) { z(""); z("=========================================================="); z(t); z("=========================================================="); z(""); }

    z("BILDPFAD-CHECK  " + VERSION);
    z("Dokument:    " + doc.name);
    try { z("InDesign:    " + app.version + "  (" + app.name + ")"); } catch (eV) {}
    try { z("System:      " + $.os); } catch (eO) {}
    z("Erstellt:    " + new Date());
    z("");
    z("Datenquelle: " + quellPfad);
    z("             (" + herkunft + ")");
    if (kandidaten.length > 1) {
        z("");
        z("   Weitere Verknüpfungen im Dokument – vermutlich Reste");
        z("   eines Datenquellen-Wechsels:");
        for (var kx = 0; kx < kandidaten.length; kx++) {
            if (kandidaten[kx].pfad === quellPfad) continue;
            z("      " + kandidaten[kx].pfad + "   (" + (kandidaten[kx].kopf || "nicht lesbar") + ")");
        }
    }
    z("");
    z("Plattform:   " + (WIN ? "Windows" : "macOS") + " – die Pfadregeln unterscheiden sich!");
    if (WIN) {
        z("   Windows:  \"./ordner/\" ok  ·  \"..\\ordner\\\" ok  ·  \"C:\\...\\\" ok");
        z("             \"../ordner/\" scheitert  ·  \"C:/...\" scheitert");
    } else {
        z("   macOS:    \"./ordner/\" ok  ·  POSIX \"/Volumes/...\" ok");
        z("             Backslash und \"C:\\...\" scheitern");
    }
    z("   Auf BEIDEN Plattformen gültig ist nur \"./ordner/datei.png\".");
    z("");
    z("Bezugspunkt für \"./\":  " + basisOrdner);
    z("   Das ist der Ordner der DATENQUELLE – nicht der des Dokuments.");
    if (dokOrdner && schraegNorm(dokOrdner).toLowerCase() !== schraegNorm(basisOrdner).toLowerCase()) {
        z("");
        z("   ACHTUNG: Dokument und Datenquelle liegen in VERSCHIEDENEN Ordnern.");
        z("   Dokument:  " + dokOrdner);
        z("   Ein \"./bilder/x.png\" meint damit " + basisOrdner + "\\bilder,");
        z("   nicht den bilder-Ordner beim Dokument. Das ist die häufigste");
        z("   Ursache für \"die Bilder sind doch da\".");
    }
    z("");
    z("Durchsuchte Ordner (nur zum Wiederfinden, nicht als Bezugspunkt):");
    for (var bz = 0; bz < suchWurzeln.length; bz++)
        z("   " + decodeURI(String(suchWurzeln[bz])));
    z("Kodierung:   " + q.kodierung);
    z("Trennzeichen:" + (q.trenner === "\t" ? " Tabulator" : " \"" + q.trenner + "\""));
    z("Datensätze:  " + q.saetze.length);
    z("Bildfelder:  " + (bildSpalten.length === 0 ? "keine" : bildSpalten.length));

    if (bildSpalten.length === 0) {
        titel("KEINE BILDFELDER");
        z("In der Kopfzeile steht kein Feldname mit @ davor.");
        z("");
        z("Ohne @ behandelt die Datenzusammenführung den Wert als Text –");
        z("der Dateipfad landet als Zeichenkette im Rahmen, kein Bild.");
        z("Das ist der häufigste Grund, warum \"die Bilder nicht kommen\".");
        alert("Keine Bildfelder in der Kopfzeile.\n\nFehlt das @ vor dem Feldnamen?");
    }

    // ---------- Ordnerbaum für die Suche ----------
    // Über ALLE Bezugspunkte, sonst findet das Skript Bilder nicht,
    // die neben dem Dokument statt neben der Datenquelle liegen.
    var baum = baumLesen(suchWurzeln[0]);
    for (var bb = 1; bb < suchWurzeln.length; bb++) {
        var weiter = baumLesen(suchWurzeln[bb]);
        baum.anzahl += weiter.anzahl;
        var teile3 = ["karte", "norm", "stamm"];
        for (var t3 = 0; t3 < teile3.length; t3++) {
            var von = weiter[teile3[t3]], nach = baum[teile3[t3]];
            for (var s7 in von) {
                if (!von.hasOwnProperty(s7)) continue;
                if (!nach[s7]) { nach[s7] = von[s7]; continue; }
                for (var v7 = 0; v7 < von[s7].length; v7++) {
                    var drin7 = false;
                    for (var n7 = 0; n7 < nach[s7].length; n7++)
                        if (nach[s7][n7] === von[s7][v7]) drin7 = true;
                    if (!drin7) nach[s7].push(von[s7][v7]);
                }
            }
        }
    }

    // Pfad eines gefundenen Bildes in die Schreibweise bringen,
    // die in die Datenquelle gehört. Relativ wird gegen JEDEN Bezugspunkt
    // versucht – Dokument zuerst, weil InDesign so rechnet.
    var WIN = ($.os.indexOf("Windows") > -1);
    function ausgabePfad(vollPfad) {
        var rel = relativMachen(vollPfad, basisOrdner);
        if (rel) return rel;
        return WIN ? schraegNorm(vollPfad).replace(/\//g, "\\") : vollPfad;
    }

    // "..\"-Schreibweise für Bilder oberhalb des Datenquellen-Ordners.
    // BELEGT 22.09.2026, Windows / InDesign 21.6:
    //    ../bilder/x.png   funktioniert NICHT
    //    ..\bilder\x.png   funktioniert
    // Auf macOS ungeprüft – dort wird "/" gesetzt.
    function aufwaertsPfad(vollPfad) {
        var ziel  = normPfad(vollPfad);
        var basis = normPfad(basisOrdner);
        var hoch  = 0;
        while (basis.length > 3) {
            var schnitt = basis.lastIndexOf("/");
            if (schnitt < 0) break;
            basis = basis.substring(0, schnitt);
            hoch++;
            if (ziel.toLowerCase().indexOf(basis.toLowerCase() + "/") === 0) {
                var rest = ziel.substring(basis.length + 1);
                var auf = "";
                for (var h = 0; h < hoch; h++) auf += "../";
                var fertig = auf + rest;
                return WIN ? fertig.replace(/\//g, "\\") : fertig;
            }
            if (hoch > 8) break;
        }
        return null;
    }

    // Relativen Wert gegen alle Bezugspunkte auflösen
    function aufloesenMehr(wert) {
        var erste = null;
        for (var i = 0; i < basen.length; i++) {
            var a = aufloesen(wert, basen[i].pfad);
            a.basis = basen[i];
            if (!erste) erste = a;
            if (!a.relativ) return a;              // absolut: Bezugspunkt egal
            if (dateiDa(a.pfad)) { a.gefunden = true; return a; }
        }
        erste.gefunden = false;
        return erste;
    }

    // ---------- Prüfen ----------
    var probleme = [], leere = [], okAnzahl = 0, zellen = [];

    for (var r = 0; r < q.saetze.length; r++) {
        var werte = zerlege(q.saetze[r], q.trenner);
        for (var bs = 0; bs < bildSpalten.length; bs++) {
            var sp   = bildSpalten[bs];
            var wert = (werte[sp.index] === undefined) ? "" : trimme(werte[sp.index]);
            var satz = r + 1;

            if (wert === "") {
                leere.push({ satz: satz, feld: sp.name });
                continue;
            }

            var auf = aufloesenMehr(wert);

            // 1. So wie notiert vorhanden?
            var daDirekt = dateiDa(auf.pfad);

            // 2. Notation prüfen – auch wenn die Datei da ist
            var notiz = [];
            // Zuerst: Schreibweise der anderen Plattform? Das schlägt alles andere.
            var fremd = fremdeSchreibweise(wert);
            if (fremd) notiz.push(fremd);

            if (auf.aufwaerts) {
                // "..\bilder\x.png" ist auf Windows gültig – belegt 22.09.2026.
                // Die Schrägstrich-Fassung fängt fremdeSchreibweise() ab.
            } else if (auf.relativ && !auf.punkt)
                notiz.push("relativer Pfad ohne \"./\" – InDesign löst ihn nicht auf");
            // (Die Schrägstrich-Regel für absolute Windows-Pfade steckt
            //  bereits in fremdeSchreibweise – nicht doppelt melden.)
            if (!auf.relativ && hatSonderzeichen(wert))
                notiz.push("Sonderzeichen im absoluten Pfad – bricht auf Windows die Auflösung");

            var zerlegt   = zerteile(wert);
            var basisName = zerlegt.name;

            // Jede Bildzelle wird mitgeschrieben – auch die fehlerfreien.
            // Nur so lässt sich später der Ordner für ALLE vereinheitlichen.
            var zelle = {
                zeile: r, spalte: sp.index, satz: satz, feld: sp.name, wert: wert,
                ordnerAlt: zerlegt.ordner, nameAlt: basisName,
                ordnerNeu: null, ordnerAuf: null, ordnerStd: null, nameNeu: null, art: "ok", klasse: 0,
                ueber: null, wertManuell: null, grund: []
            };
            zellen.push(zelle);

            // Auch bei auflösendem Pfad: heißt die Datei wirklich so?
            if (daDirekt && notiz.length === 0) {
                // Den ECHTEN Namen aus dem Ordnerbaum holen, nicht aus dem
                // File-Objekt: Windows gibt dort zurück, wonach gefragt wurde,
                // nicht, wie die Datei wirklich heißt.
                if (auf.relativ && auf.basis)
                    zelle.grund = ["aufgelöst gegen den Ordner der " + auf.basis.name];
                var echtName = "", echtPfad = auf.pfad;
                var liste = baum.karte[basisName.toLowerCase()];
                if (liste) {
                    var zielO = schraegNorm(auf.pfad).toLowerCase();
                    for (var lz = 0; lz < liste.length; lz++)
                        if (schraegNorm(liste[lz]).toLowerCase() === zielO) {
                            echtName = decodeURI(new File(liste[lz]).name);
                            echtPfad = liste[lz];
                            break;
                        }
                }
                var zerlegtG = zerteile(ausgabePfad(echtPfad));

                // WICHTIG: Bei einem fehlerfreien Wert wird NICHTS vorgeschlagen.
                // ordnerNeu/nameNeu steuern die Korrektur – sie hier zu setzen
                // hieße, einen funktionierenden Pfad umzuschreiben.
                // Nur für die Vorbelegung des Standardordners merken.
                zelle.ordnerStd = zerlegtG.ordner;

                if (echtName && echtName !== basisName) {
                    zelle.ordnerNeu = zerlegtG.ordner;
                    zelle.nameNeu   = echtName;
                    zelle.art = "GROSS/KLEIN";
                    // Klasse 2: Der Name weicht ab. Auf Windows löst der Pfad
                    // trotzdem auf – dort ist es eine Portabilitätswarnung,
                    // auf macOS ein Abbruch. Nie automatisch korrigieren.
                    zelle.klasse = 2;
                    zelle.grund = [unterschied(basisName, echtName),
                                      WIN
                                   ? "Auf Windows löst der Pfad trotzdem auf. Auf macOS bricht es ab."
                                   : "Auf macOS bricht die Zusammenführung damit ab."];
                    var vG = pfadFuegen(zelle.ordnerNeu, zelle.nameNeu);
                    probleme.push({
                        satz: satz, feld: sp.name, wert: wert, spalte: sp.index,
                        art: "GROSS/KLEIN",
                        grund: zelle.grund,
                        vorschlag: (vG !== wert) ? vG : null, gefunden: []
                    });
                    continue;
                }
                okAnzahl++; continue;
            }

            // 3. Datei stufenweise suchen
            var fund = daDirekt ? { treffer: [auf.pfad], stufe: "exakt" } : suchen(baum, basisName);
            var treffer = fund.treffer;

            var eintrag = {
                satz: satz, feld: sp.name, wert: wert, spalte: sp.index,
                art: "", grund: [], vorschlag: null, gefunden: treffer
            };

            var wahl = besterTreffer(treffer, auf.pfad, basisOrdner);

            if (daDirekt) {
                // KLASSE 1: Die Datei liegt genau dort, wohin der Pfad zeigt.
                // Nur die Schreibweise stimmt nicht. Kein Raten.
                eintrag.art = "SCHREIBWEISE";
                eintrag.grund = notiz;
                zelle.klasse = 1;
                // Aber: heißt die Datei dort wirklich so? Dann bleibt es
                // Klasse 1. Sonst steckt zusätzlich eine Namensannahme drin.
                var lD = baum.karte[basisName.toLowerCase()];
                if (lD) {
                    var zD = schraegNorm(auf.pfad).toLowerCase();
                    for (var ld = 0; ld < lD.length; ld++)
                        if (schraegNorm(lD[ld]).toLowerCase() === zD) {
                            var nD = decodeURI(new File(lD[ld]).name);
                            if (nD !== basisName) {
                                zelle.klasse = 2;
                                eintrag.art = "NAME";
                                eintrag.grund.push(unterschied(basisName, nD));
                            }
                            break;
                        }
                }
            } else if (treffer.length === 0) {
                // KLASSE 3: nichts Passendes im Ordnerbaum.
                eintrag.art = "FEHLT";
                zelle.klasse = 3;
                eintrag.grund.push("\"" + basisName + "\" ist im Ordnerbaum nicht auffindbar –");
                eintrag.grund.push("auch nicht unter abweichender Schreibweise oder Endung");
            } else if (!wahl.eindeutig) {
                eintrag.art = "MEHRDEUTIG";
                zelle.klasse = 2;
                eintrag.grund.push("Es passen " + treffer.length + " Dateien gleich gut" +
                                   (fund.stufe === "exakt" ? "" : " (nur ähnlich geschrieben)"));
                eintrag.grund.push("Das Skript rät hier nicht – das entscheidest du.");
            } else {
                // KLASSE 2: irgendwo gefunden, aber nicht dort, wohin der
                // korrigierte Pfad zeigt – oder unter anderem Namen.
                zelle.klasse = 2;
                var echterName = decodeURI(new File(wahl.sieger).name);
                if (fund.stufe === "exakt") {
                    eintrag.art = "SCHREIBWEISE";
                    for (var g = 0; g < notiz.length; g++) eintrag.grund.push(notiz[g]);
                    if (eintrag.grund.length === 0)
                        eintrag.grund.push("Der Pfad zeigt woanders hin – die Datei liegt anderswo");
                } else if (fund.stufe === "unsicher") {
                    eintrag.art = "VERMUTUNG";
                    eintrag.grund.push("Kein sauberer Treffer. Ähnlichster Name: \"" + echterName + "\"");
                    eintrag.grund.push("Typisch für Zeichensalat durch falsche Kodierung. Bitte prüfen.");
                } else {
                    eintrag.art = (echterName.toLowerCase() === basisName.toLowerCase())
                                  ? "GROSS/KLEIN" : "NAME";
                    eintrag.grund.push(unterschied(basisName, echterName));
                    for (var g2 = 0; g2 < notiz.length; g2++) eintrag.grund.push(notiz[g2]);
                }
                if (treffer.length > 1)
                    eintrag.grund.push("(" + treffer.length + " Kandidaten, gewählt wurde der im passenden Ordner)");
            }

            // 4. Vorschlag bauen – getrennt nach Ordner und Dateiname
            zelle.art   = eintrag.art;
            zelle.grund = eintrag.grund;
            var zielPfad = daDirekt ? auf.pfad : (wahl.eindeutig ? wahl.sieger : null);
            if (zielPfad) {
                var ausg = ausgabePfad(zielPfad), zt = zerteile(ausg);
                zelle.ordnerNeu = zt.ordner;
                zelle.nameNeu   = zt.name;
                var aufw = aufwaertsPfad(zielPfad);
                if (aufw) zelle.ordnerAuf = zerteile(aufw).ordner;
                eintrag.vorschlag = (ausg !== wert) ? ausg : null;
                if (zelle.ordnerAuf !== null && ausg.substring(0, 2) !== "./" &&
                    aufw !== trimme(wert)) {
                    eintrag.grund.push("liegt außerhalb des Datenquellen-Ordners – " +
                                       "relativ wäre das \"" + aufw + "\"");
                }
                if (ausg.indexOf("/") !== 0 && ausg.substring(0, 2) !== "./" && hatSonderzeichen(ausg))
                    eintrag.grund.push("Achtung: Sonderzeichen im Zielpfad – besser das Bild in einen Ordner ohne Umlaute legen");
            }

            probleme.push(eintrag);
        }
    }

    // ---------- Bericht ----------
    // ---------- Die drei Klassen zählen ----------
    var k1 = [], k2 = [], k3 = [];
    for (var kz = 0; kz < zellen.length; kz++) {
        if (zellen[kz].klasse === 1) k1.push(zellen[kz]);
        else if (zellen[kz].klasse === 2) k2.push(zellen[kz]);
        else if (zellen[kz].klasse === 3) k3.push(zellen[kz]);
    }

    titel("ERGEBNIS");

    z(zellen.length + " Bildwerte · " + probleme.length + " lösen nicht auf");
    z("");
    z("   " + k1.length + "  NUR SCHREIBWEISE");
    z("        Die Datei liegt genau dort, wohin der Pfad zeigt.");
    z("        Nur die Notation stimmt nicht. Kein Raten.");
    z("        >>> Diese " + k1.length + " repariert das Werkzeug mit einem Klick.");
    z("");
    z("   " + k2.length + "  GEFUNDEN, ABER ANDERS");
    z("        Anderer Ordner oder anderer Name. Das Skript macht einen");
    z("        Vorschlag, trifft aber eine Annahme. Du entscheidest.");
    z("");
    z("   " + k3.length + "  NIRGENDS");
    z("        Nichts Passendes im Ordnerbaum. Da hilft kein Werkzeug –");
    z("        jemand muss ein Bild liefern.");
    z("");

    var geprueft = q.saetze.length * bildSpalten.length;
    z("Geprüfte Bildwerte: " + geprueft);
    z("   in Ordnung:      " + okAnzahl);
    z("   mit Problem:     " + probleme.length);
    z("   leere Felder:    " + leere.length);
    z("Dateien im Ordnerbaum durchsucht: " + baum.anzahl +
      (baum.anzahl >= MAXDATEI ? "   (Notbremse erreicht!)" : ""));

    if (probleme.length === 0 && leere.length === 0) {
        z("");
        z("Alle Bildpfade lösen auf. Nichts zu tun.");
    }

    // ---------- Portabilität ----------
    var gebunden = [];
    for (var pb = 0; pb < zellen.length; pb++)
        if (zellen[pb].wert !== "" && !plattformSicher(zellen[pb].wert))
            gebunden.push(zellen[pb].satz);
    z("");
    if (gebunden.length === 0) {
        z("Plattformfest: alle Werte stehen als \"./ordner/datei\" da.");
        z("Diese Datenquelle läuft auf Windows wie auf macOS.");
    } else {
        z("PLATTFORMGEBUNDEN: " + gebunden.length + " von " + zellen.length +
          " Werten sind an " + (WIN ? "Windows" : "macOS") + " gebunden.");
        z("Auf der anderen Plattform lösen sie nicht auf.");
        z("Betroffen: Satz " + gebunden.slice(0, 20).join(", ") +
          (gebunden.length > 20 ? " ..." : ""));
        z("Plattformfest wäre nur \"./ordner/datei.png\" – also die Bilder");
        z("neben die Datenquelle legen.");
    }

    if (probleme.length > 0) {
        titel("PROBLEME – NACH KLASSE");
        // Nach Klasse sortieren, damit das Reparierbare oben steht
        var reihe = [];
        for (var kk3 = 1; kk3 <= 3; kk3++)
            for (var p3 = 0; p3 < probleme.length; p3++) {
                var kl3 = 2;
                for (var z3 = 0; z3 < zellen.length; z3++)
                    if (zellen[z3].zeile === probleme[p3].satz - 1 &&
                        zellen[z3].spalte === probleme[p3].spalte) { kl3 = zellen[z3].klasse; break; }
                if (kl3 === kk3) { probleme[p3].klasse = kk3; reihe.push(probleme[p3]); }
            }
        probleme = reihe;

        var letzteKlasse = 0;
        for (var p = 0; p < probleme.length; p++) {
            var e2 = probleme[p];
            if (e2.klasse !== letzteKlasse) {
                letzteKlasse = e2.klasse;
                z("------------------------------------------------------");
                z(e2.klasse === 1 ? "KLASSE 1 – nur Schreibweise, garantiert reparierbar"
                  : e2.klasse === 2 ? "KLASSE 2 – gefunden, aber anders. Du entscheidest."
                  : "KLASSE 3 – nirgends auffindbar. Muss beschafft werden.");
                z("------------------------------------------------------");
                z("");
            }
            z(e2.art + "   Datensatz " + e2.satz + "   Feld \"" + e2.feld + "\"");
            z("   notiert:    " + e2.wert);
            for (var gr = 0; gr < e2.grund.length; gr++) z("   Grund:      " + e2.grund[gr]);
            if (e2.vorschlag) z("   Vorschlag:  " + e2.vorschlag);
            if (e2.art === "MEHRDEUTIG" || e2.art === "VERMUTUNG") {
                for (var mg = 0; mg < e2.gefunden.length && mg < 8; mg++)
                    z("     Kandidat: " + e2.gefunden[mg]);
                if (e2.gefunden.length > 8) z("     ... und " + (e2.gefunden.length - 8) + " weitere");
            }
            z("");
        }
    }

    if (leere.length > 0) {
        titel("LEERE BILDFELDER");
        z("InDesign lässt den Rahmen still leer. Kein Fehler, keine Meldung.");
        z("Wenn das gewollt ist: alles gut. Wenn nicht, fehlt hier Inhalt.");
        z("");
        var zeile = "";
        for (var le = 0; le < leere.length; le++) {
            zeile += "Satz " + leere[le].satz + " (" + leere[le].feld + ")   ";
            if ((le + 1) % 5 === 0) { z("   " + zeile); zeile = ""; }
        }
        if (zeile !== "") z("   " + zeile);
    }

    titel("WIE DU DEN BERICHT LIEST");
    z("FEHLT          Die Datei ist nirgends im Ordnerbaum. Da hilft nur:");
    z("               Bild beschaffen oder den Datensatz streichen.");
    z("");
    z("SCHREIBWEISE   Die Datei ist da. Nur die Notation des PFADES stimmt nicht.");
    z("               Häufigster Fall: das \"./\" fehlt. \"bilder/foto.jpg\"");
    z("               löst InDesign nicht auf, \"./bilder/foto.jpg\" schon.");
    z("               Bei absoluten Windows-Pfaden muss \"\\\" stehen, nicht \"/\".");
    z("");
    z("NAME           Die Datei ist da, heißt aber anders: fehlende Endung,");
    z("               falsche Endung, überzähliges Leerzeichen, Umlaut anders");
    z("               geschrieben. Das Skript nennt den Unterschied genau.");
    z("");
    z("GROSS/KLEIN    Nur die Groß-/Kleinschreibung weicht ab. Windows verzeiht");
    z("               das, macOS nicht. Wer auf beiden Rechnern arbeitet,");
    z("               sollte es hier trotzdem angleichen.");
    z("");
    z("MEHRDEUTIG     Der Dateiname kommt mehrfach vor. Das Skript rät nicht,");
    z("               welche gemeint ist – das musst du entscheiden.");
    z("");
    z("LEER           Bildfeld ohne Wert. Der Rahmen bleibt leer, lautlos.");
    z("");
    z("PLATTFORM      Der Pfad ist in der Schreibweise der ANDEREN Plattform");
    z("               notiert. Achtung: Das Skript löst ihn trotzdem auf, weil");
    z("               es intern jeden Backslash zu einem Schrägstrich macht –");
    z("               InDesign tut das nicht. Ohne diese Prüfung stünde hier");
    z("               \"in Ordnung\", und beim Zusammenführen fehlte das Bild.");
    z("");
    z("WARUM DAS VORHER ZÄHLT");
    z("Im zusammengeführten Dokument bleibt vom fehlenden Bild keine Spur.");
    z("Der Rahmen ist leer, ohne Verknüpfung. Die Verknüpfungspalette zeigt");
    z("nichts an, weil dort nichts eingetragen wurde. Der Fehler ist dann");
    z("nur noch durch Nachzählen zu finden.");

    // ---------- Bericht schreiben ----------
    var berichtDatei = new File(basisFuerURI + "/bildpfad-bericht.txt");
    try {
        berichtDatei.encoding = "UTF-8";
        berichtDatei.open("w");
        berichtDatei.write(L.join("\n"));
        berichtDatei.close();
    } catch (eB2) { try { berichtDatei.close(); } catch (eB3) {} }

    // ================= Korrigierte Kopie =================

    // Welcher Wert käme bei diesen Einstellungen heraus?
    //
    // Drei Ebenen, von innen nach außen:
    //   1. die Regeln oben im Dialog  (erledigen die Masse)
    //   2. Übernehmen/Überspringen pro Zeile  (erledigen die Ausnahmen)
    //   3. ein von Hand eingetragener Wert  (hat immer Vorrang)
    function bauWert(zelle, opt, erzwinge) {
        var ordner = zelle.ordnerAlt;
        if (opt.ordnerModus === "std" && opt.stdOrdner !== "") {
            ordner = opt.stdOrdner;
        } else if (opt.ordnerModus === "fix" && zelle.ordnerNeu !== null) {
            ordner = (opt.aufwaerts && zelle.ordnerAuf !== null)
                     ? zelle.ordnerAuf : zelle.ordnerNeu;
        }

        var name = zelle.nameAlt;
        if (zelle.nameNeu && (erzwinge || (opt.nameAn && opt.arten[zelle.art] === true)))
            name = zelle.nameNeu;

        return pfadFuegen(ordner, name);
    }
    function neuerWert(zelle, opt) {
        if (zelle.wert === "") return null;
        if (zelle.ueber === false) return null;                 // ausdrücklich übersprungen
        var v = (zelle.wertManuell !== null && zelle.wertManuell !== undefined)
                ? zelle.wertManuell
                : bauWert(zelle, opt, zelle.ueber === true);
        return (v === zelle.wert) ? null : v;
    }
    function zaehleAenderungen(opt) {
        var n2 = 0;
        for (var i = 0; i < zellen.length; i++) if (neuerWert(zellen[i], opt) !== null) n2++;
        return n2;
    }

    // Häufigsten gefundenen Ordner als Vorgabe nehmen
    var stdVorgabe = "";
    (function () {
        var tally = {}, best = -1;
        for (var i = 0; i < zellen.length; i++) {
            var o = zellen[i].ordnerNeu;
            if (o === null || o === "") o = zellen[i].ordnerStd;
            if (o === null || o === "") continue;
            tally[o] = (tally[o] || 0) + 1;
            if (tally[o] > best) { best = tally[o]; stdVorgabe = o; }
        }
    })();

    // ---------- Korrigierte Kopie schreiben ----------
    // Einmal geschrieben, von beiden Wegen genutzt: dem vollen Befund-Dialog
    // und dem kleinen Umstell-Dialog für fehlerfreie Datenquellen.
    var dateiName  = decodeURI(quellDatei.name);
    var punktPos   = dateiName.lastIndexOf(".");
    var dateiStamm = (punktPos > 0) ? dateiName.substring(0, punktPos) : dateiName;
    var dateiEnd   = (punktPos > 0) ? dateiName.substring(punktPos) : ".csv";
    dateiStamm = dateiStamm.replace(/(_korrigiert)(_?\d+)?$/, "");

    function freierName() {
        var v = dateiStamm + "_korrigiert" + dateiEnd, n2 = 2;
        while (v === dateiName || new File(basisFuerURI + "/" + v).exists) {
            v = dateiStamm + "_korrigiert" + n2 + dateiEnd;
            if (++n2 > 99) break;
        }
        return v;
    }

    function kopieSchreiben(opt, zielName) {
        zielName = trimme(zielName || "");
        if (zielName === "") zielName = freierName();
        if (zielName === dateiName) {
            zielName = dateiStamm + "_korrigiert_neu" + dateiEnd;
            alert("Der Name war identisch mit der Datenquelle.\n" +
                  "Ich schreibe stattdessen:\n" + zielName, "Bildpfad-Check");
        }

        var korrekturen = {}, korrekturZahl = 0, cz;
        for (cz = 0; cz < zellen.length; cz++) {
            var nw = neuerWert(zellen[cz], opt);
            if (nw !== null) { korrekturen[zellen[cz].zeile + "|" + zellen[cz].spalte] = nw; korrekturZahl++; }
        }
        if (korrekturZahl === 0) return "\n\nEs hätte sich nichts geändert – keine Kopie geschrieben.";

        var neu = [q.rohKopf];
        for (var rr = 0; rr < q.saetze.length; rr++) {
            var w2 = zerlege(q.saetze[rr], q.trenner), geaendert = false;
            for (var cc = 0; cc < q.kopf.length; cc++) {
                var schl2 = rr + "|" + cc;
                if (korrekturen[schl2] !== undefined) { w2[cc] = korrekturen[schl2]; geaendert = true; }
            }
            neu.push(geaendert ? baue(w2, q.trenner) : q.saetze[rr]);
        }
        var textNeu = neu.join("\r\n") + "\r\n";
        var zielDatei = new File(basisFuerURI + "/" + zielName);

        var inhalt, hinweis = "";
        if (q.kodierung.indexOf("UTF-16") === 0) {
            inhalt = alsUTF16LE(textNeu); hinweis = "UTF-16 LE mit BOM";
        } else if (q.kodierung === "UTF-8 mit BOM") {
            inhalt = alsUTF8(textNeu, true); hinweis = "UTF-8 mit BOM";
        } else if (q.kodierung === "UTF-8 ohne BOM") {
            inhalt = alsUTF8(textNeu, false); hinweis = "UTF-8 ohne BOM";
        } else {
            var an = alsAnsi(textNeu);
            inhalt = an.text;
            hinweis = "ANSI" + (an.verlust ? "  – ACHTUNG: Zeichen gingen verloren, besser UTF-16" : "");
        }

        if (!byteSchreiben(zielDatei, inhalt))
            return "\n\nDie Kopie ließ sich nicht schreiben – Ordner schreibgeschützt?";

        z("");
        titel("KORRIGIERTE KOPIE");
        z("Datei:              " + decodeURI(zielDatei.name) + "   (" + hinweis + ")");
        z("Geänderte Werte:    " + korrekturZahl);
        z("Ordner:             " + (opt.ordnerModus === "std"
            ? ("alle auf \"" + opt.stdOrdner + "\"")
            : (opt.ordnerModus === "aus" ? "nicht angefasst" : "nur korrigiert, wo falsch")));
        z("Dateinamen:         " + (opt.nameAn
            ? ("NAME:" + (opt.arten["NAME"] ? "ja" : "nein") +
               "  GROSS/KLEIN:" + (opt.arten["GROSS/KLEIN"] ? "ja" : "nein") +
               "  VERMUTUNG:" + (opt.arten["VERMUTUNG"] ? "ja" : "nein"))
            : "nicht angefasst"));
        z("");
        for (var pz = 0; pz < zellen.length; pz++) {
            var nw2 = neuerWert(zellen[pz], opt);
            if (nw2 === null) continue;
            z("   Satz " + zellen[pz].satz + "  (" + zellen[pz].feld + ")");
            z("      alt:  " + zellen[pz].wert);
            z("      neu:  " + nw2);
        }
        try {
            berichtDatei.encoding = "UTF-8";
            berichtDatei.open("w");
            berichtDatei.write(L.join("\n"));
            berichtDatei.close();
        } catch (eB4) { try { berichtDatei.close(); } catch (eB5) {} }

        return "\n\nKorrigierte Kopie geschrieben:\n" +
               decodeURI(zielDatei.name) + "  (" + hinweis + ")\n" +
               korrekturZahl + " Wert(e) geändert. Original unverändert.\n" +
               "Zum Prüfen neu verknüpfen.";
    }

    var kopieMeldung = "", dialogGezeigt = false;
    var machbar = 0;
    for (var mz = 0; mz < zellen.length; mz++) if (zellen[mz].nameNeu || zellen[mz].ordnerNeu !== null) machbar++;

    // Der Dialog erscheint, sobald es etwas zu SEHEN gibt – nicht erst,
    // wenn es etwas zu korrigieren gibt. Erst der Befund, dann die Entscheidung.
    if (bildSpalten.length > 0 && (probleme.length > 0 || machbar > 0)) {
        dialogGezeigt = true;
        var opt = {
            ordnerModus: "fix", stdOrdner: stdVorgabe, aufwaerts: false,
            nameAn: true,
            nameAn: false,
            arten: { "NAME": false, "GROSS/KLEIN": false, "VERMUTUNG": false, "SCHREIBWEISE": true, "ok": true }
        };

        // Version im Titel: sonst prüft man minutenlang eine alte Kopie
        // aus dem InDesign-Skriptordner und wundert sich.
        var dlg = new Window("dialog", "Bildpfad-Check " + VERSION + " – Befund");
        dlg.alignChildren = "fill";
        dlg.margins = 12;
        dlg.spacing = 6;

        // ---------- ZUERST: was ist überhaupt falsch? ----------
        var neuerQuellPfad = null;

        var gQ = dlg.add("group"); gQ.alignChildren = "center"; gQ.spacing = 8;
        var kopfQ = gQ.add("statictext", undefined,
            "Datenquelle:  " + decodeURI(quellDatei.name) + "   (" + herkunft + ")");
        kopfQ.characters = 74;
        var bWechsel = gQ.add("button", undefined, "Stimmt nicht – andere wählen …");
        bWechsel.preferredSize.width = 190;
        bWechsel.onClick = function () {
            var f3 = File.openDialog("Die wirklich verknüpfte Datenquelle wählen");
            if (!f3) return;
            neuerQuellPfad = decodeURI(f3.fsName);
            dlg.close(2);              // nichts schreiben, gleich neu prüfen
        };

        var hQ = dlg.add("statictext", undefined,
            "Ein Bericht über die falsche Datei ist in sich stimmig und wertlos. " +
            "Steht oben nicht die Datei aus dem Bedienfeld, hier wechseln.",
            { multiline: true });
        hQ.characters = 96;

        var kopf2 = dlg.add("statictext", undefined,
            zellen.length + " Bildwerte · " + probleme.length + " lösen nicht auf" +
            (leere.length > 0 ? ("  ·  " + leere.length + " Feld(er) leer") : "") +
            "  ·  " + baum.anzahl + " Dateien durchsucht",
            { multiline: true });
        kopf2.characters = 96;

        var kopf2b = dlg.add("statictext", undefined,
            "   " + k1.length + " nur Schreibweise – ein Klick, garantiert" +
            "      " + k2.length + " gefunden, aber anders – du entscheidest" +
            "      " + k3.length + " nirgends – muss beschafft werden",
            { multiline: true });
        kopf2b.characters = 96;

        var gL = dlg.add("panel", undefined, "Alle Bildwerte");
        gL.alignChildren = "fill"; gL.margins = 10; gL.spacing = 5;

        var liste = gL.add("listbox", undefined, [], {
            numberOfColumns: 6, showHeaders: true,
            columnTitles: ["", "Satz", "Feld", "Klasse · Problem", "notiert", "wird zu"],
            columnWidths: [26, 40, 80, 126, 194, 190]
        });
        liste.preferredSize = [690, 150];

        // ALLE Bildwerte zeigen, nicht nur die auffälligen. Sonst behauptet der
        // Dialog Änderungen, die in der Liste nicht auftauchen – und niemand
        // kann nachsehen, was da passiert.
        var zeigen = [];
        for (var kls = 1; kls <= 3; kls++)
            for (var zl = 0; zl < zellen.length; zl++)
                if (zellen[zl].klasse === kls && zellen[zl].wert !== "" && zeigen.length < 300)
                    zeigen.push(zellen[zl]);
        for (var zo = 0; zo < zellen.length; zo++)
            if (zellen[zo].klasse === 0 && zellen[zo].wert !== "" && zeigen.length < 300)
                zeigen.push(zellen[zo]);

        for (var zz = 0; zz < zeigen.length; zz++) {
            var zg = zeigen[zz];
            var it = liste.add("item", "");
            it.subItems[0].text = String(zg.satz);
            it.subItems[1].text = zg.feld;
            it.subItems[2].text = (zg.klasse === 0) ? "– ok –" : (zg.klasse + " · " + zg.art);
            it.subItems[3].text = zg.wert;
            it.subItems[4].text = "";
        }
        var restHinweis = gL.add("statictext", undefined, "");
        restHinweis.characters = 96;

        var grundText = gL.add("statictext", undefined,
            "Zeile anklicken – hier steht, warum. Doppelklick schaltet um.   " +
            "(✓ übernehmen  – überspringen  * von Hand  leer = nach Regel)",
            { multiline: true });
        grundText.characters = 96;
        grundText.preferredSize.height = 28;

        // --- Abarbeiten: eine Zeile, eine Entscheidung ---
        var gZ2 = gL.add("group"); gZ2.alignChildren = "center";
        gZ2.add("statictext", undefined, "Diese Zeile:");
        var fZeile = gZ2.add("edittext", undefined, ""); fZeile.characters = 40;
        var bJa   = gZ2.add("button", undefined, "Übernehmen");
        var bNein = gZ2.add("button", undefined, "Überspringen");
        var bReg  = gZ2.add("button", undefined, "Nach Regel");
        bJa.preferredSize.width = bNein.preferredSize.width = bReg.preferredSize.width = 104;

        function markeVon(zg3) {
            if (zg3.ueber === false) return "–";
            if (zg3.wertManuell !== null) return "*";
            if (zg3.ueber === true) return "✓";
            return "";
        }
        function zeileZeigen() {
            var s2 = liste.selection;
            bJa.enabled = bNein.enabled = bReg.enabled = fZeile.enabled = !!s2;
            if (!s2) {
                grundText.text = "Zeile anklicken – hier steht, warum. Doppelklick schaltet um.   " +
                                 "(✓ übernehmen  – überspringen  * von Hand  leer = nach Regel)";
                fZeile.text = "";
                return;
            }
            var zg2 = zeigen[s2.index];
            var t = [];
            for (var gi = 0; gi < (zg2.grund || []).length; gi++) t.push(zg2.grund[gi]);
            grundText.text = "Satz " + zg2.satz + ":  " + (t.length ? t.join("  ·  ") : "(kein weiterer Hinweis)");
            var nw3 = neuerWert(zg2, opt);
            fZeile.text = (nw3 === null) ? zg2.wert : nw3;
        }

        // ---------- DANN: optional korrigieren ----------
        // Beide Regelblöcke nebeneinander – sonst wird der Dialog höher
        // als der Bildschirm.
        var gRegeln = dlg.add("group");
        gRegeln.alignChildren = ["fill", "top"]; gRegeln.spacing = 8;

        // --- Ordner ---
        var gO = gRegeln.add("panel", undefined, "Pfad-Schreibweise  (Klasse 1)");
        gO.alignChildren = "left"; gO.margins = 10; gO.spacing = 4;
        var rbFix = gO.add("radiobutton", undefined, "nur korrigieren, wo er falsch ist");
        var rbStd = gO.add("radiobutton", undefined, "alle in ein Standardverzeichnis:");
        var rO = gO.add("group"); rO.alignChildren = "center"; rO.indent = 18; rO.spacing = 4;
        var fO = rO.add("edittext", undefined, stdVorgabe); fO.characters = 30;
        var bO = rO.add("button", undefined, "...", { name: "browse" }); bO.preferredSize.width = 30;
        var rbAus = gO.add("radiobutton", undefined, "gar nicht anfassen");
        rbFix.value = true;
        var cbAuf = gO.add("checkbox", undefined,
            WIN ? "außerhalb: Aufwärtspfad statt absolutem Pfad"
                : "außerhalb: \"../\" statt absolutem Pfad (auf macOS ungeprüft)");
        cbAuf.value = false;
        var hO = gO.add("statictext", undefined,
            "\"./ordner\" ist relativ zum Ordner der DATENQUELLE.\nAb der nächsten Ebene braucht Windows Backslash.",
            { multiline: true });
        hO.characters = 40;

        // --- Dateinamen ---
        var gN = gRegeln.add("panel", undefined, "Dateinamen  (Klasse 2 – Annahmen)");
        gN.alignChildren = "left"; gN.margins = 10; gN.spacing = 4;
        var cbN = gN.add("checkbox", undefined, "Dateinamen korrigieren"); cbN.value = false;
        var cbN1 = gN.add("checkbox", undefined, "Endung, Leerzeichen, Umlaute  (NAME)"); cbN1.value = false;
        var cbN2 = gN.add("checkbox", undefined, "Groß-/Kleinschreibung  (GROSS/KLEIN)"); cbN2.value = false;
        var cbN3 = gN.add("checkbox", undefined, "Vermutungen  (VERMUTUNG)"); cbN3.value = false;
        cbN1.indent = 16; cbN2.indent = 16; cbN3.indent = 16;
        gN.add("statictext", undefined, " ");

        // --- Zieldatei ---
        var vorschlagName = freierName();

        var gZ = dlg.add("group"); gZ.alignChildren = "center"; gZ.spacing = 6;
        gZ.add("statictext", undefined, "Kopie speichern als:");
        var fZ = gZ.add("edittext", undefined, vorschlagName); fZ.characters = 40;
        gZ.add("statictext", undefined, "(im Ordner der Datenquelle)");

        var vorschau = dlg.add("statictext", undefined, ""); vorschau.characters = 90;

        function lesen() {
            opt.ordnerModus = rbStd.value ? "std" : (rbAus.value ? "aus" : "fix");
            opt.stdOrdner   = trimme(fO.text);
            opt.aufwaerts   = cbAuf.value;
            opt.nameAn    = cbN.value;
            opt.arten["NAME"]        = cbN1.value;
            opt.arten["GROSS/KLEIN"] = cbN2.value;
            opt.arten["VERMUTUNG"]   = cbN3.value;
            return opt;
        }
        function frischen() {
            lesen();
            fO.enabled = bO.enabled = rbStd.value;
            cbAuf.enabled = rbFix.value;
            cbN1.enabled = cbN2.enabled = cbN3.enabled = cbN.value;

            // Spalte "wird zu" mitziehen, damit die Liste zeigt, was wirklich passiert
            var stillGeaendert = 0;
            for (var fz = 0; fz < zeigen.length; fz++) {
                var nwz = neuerWert(zeigen[fz], opt);
                liste.items[fz].text = markeVon(zeigen[fz]);
                liste.items[fz].subItems[4].text = (nwz === null) ? "– unverändert –" : nwz;
            }
            for (var oz = 0; oz < zellen.length; oz++)
                if (zellen[oz].art === "ok" && neuerWert(zellen[oz], opt) !== null) stillGeaendert++;

            restHinweis.text =
                (probleme.length > zeigen.length
                    ? ("Nur die ersten " + zeigen.length + " von " + probleme.length + " gezeigt – alle stehen im Bericht.  ")
                    : "") +
                (stillGeaendert > 0
                    ? ("ACHTUNG: " + stillGeaendert + " Werte OHNE Befund würden sich ebenfalls ändern – " +
                       "in der Spalte \"wird zu\" nachsehen.")
                    : "");

            var wieviel = zaehleAenderungen(opt);
            vorschau.text = (wieviel === 0)
                ? "Es würde sich nichts ändern – keine Kopie nötig."
                : (wieviel + " von " + zellen.length + " Bildwerten ändern sich.");
            try { bOK.enabled = (wieviel > 0); } catch (eOK) {}
        }
        rbFix.onClick = rbStd.onClick = rbAus.onClick = cbAuf.onClick = frischen;
        cbN.onClick = cbN1.onClick = cbN2.onClick = cbN3.onClick = frischen;
        fO.onChanging = frischen;

        liste.onChange = zeileZeigen;
        liste.onDoubleClick = function () {
            var s3 = liste.selection; if (!s3) return;
            var zg4 = zeigen[s3.index];
            zg4.wertManuell = null;
            zg4.ueber = (zg4.ueber === false) ? true : false;   // umschalten
            frischen(); zeileZeigen();
        };
        bJa.onClick = function () {
            var s4 = liste.selection; if (!s4) return;
            var zg5 = zeigen[s4.index], eingabe = trimme(fZeile.text);
            zg5.ueber = true;
            // Nur merken, wenn von Hand abgewichen wurde
            zg5.wertManuell = (eingabe !== "" && eingabe !== bauWert(zg5, opt, true)) ? eingabe : null;
            frischen();
            if (s4.index + 1 < zeigen.length) liste.selection = s4.index + 1;
            zeileZeigen();
        };
        bNein.onClick = function () {
            var s5 = liste.selection; if (!s5) return;
            zeigen[s5.index].ueber = false;
            zeigen[s5.index].wertManuell = null;
            frischen();
            if (s5.index + 1 < zeigen.length) liste.selection = s5.index + 1;
            zeileZeigen();
        };
        bReg.onClick = function () {
            var s6 = liste.selection; if (!s6) return;
            zeigen[s6.index].ueber = null;
            zeigen[s6.index].wertManuell = null;
            frischen(); zeileZeigen();
        };
        bO.onClick = function () {
            // Dort anfangen, wo der aktuelle Eintrag hinzeigt – sonst beim
            // Dokument. Nicht irgendwo im Dateisystem.
            var start = null;
            try {
                var jetzt = trimme(fO.text);
                if (jetzt !== "") {
                    var aufs = aufloesenMehr(jetzt + "/x");
                    var kand = new Folder(zerteile(aufs.pfad).ordner);
                    if (kand.exists) start = kand;
                }
            } catch (eS1) {}
            if (!start) { try { start = new Folder(basen[0].uri); } catch (eS2) {} }

            var ord = null;
            try { if (start) ord = start.selectDlg("Ordner mit den Bildern wählen"); } catch (eS3) {}
            if (!ord) { try { ord = Folder.selectDialog("Ordner mit den Bildern wählen"); } catch (eS4) {} }
            if (!ord) return;

            var voll = decodeURI(ord.fsName);
            var rel  = null;
            for (var bi = 0; bi < basen.length && !rel; bi++)
                rel = relativMachen(voll + "/x", basen[bi].pfad);
            fO.text = rel ? zerteile(rel).ordner : (WIN ? schraegNorm(voll).replace(/\//g, "\\") : voll);
            frischen();
        };

        var gB = dlg.add("group");
        var bBericht = gB.add("button", undefined, "Vollständigen Bericht öffnen");
        var fueller = gB.add("group"); fueller.alignment = ["fill", "center"];
        gB.add("button", undefined, "Nur ansehen, nichts schreiben", { name: "cancel" });
        var bOK = gB.add("button", undefined, "Korrigierte Kopie schreiben", { name: "ok" });

        bBericht.onClick = function () {
            try { berichtDatei.execute(); } catch (eEx) { alert("Bericht liegt hier:\n" + decodeURI(berichtDatei.fsName)); }
        };

        frischen();
        zeileZeigen();

        var antwort = dlg.show();

        // Datenquelle gewechselt? Alles noch einmal, mit der richtigen Datei.
        if (neuerQuellPfad) { haupt(neuerQuellPfad); return; }

        if (antwort === 1) {
            lesen();
            kopieMeldung = kopieSchreiben(opt, trimme(fZ.text));
        }
    }

    // ================= Sauberer Fall: nur umstellen =================
    // Kein Befund heißt nicht "nichts zu tun". Eine funktionierende
    // Datenquelle kann trotzdem plattformgebunden sein – dann will man sie
    // bewusst umstellen. Dafür ein kleiner Dialog statt des großen.
    if (bildSpalten.length > 0 && probleme.length === 0 && zellen.length > 0 && !dialogGezeigt) {
        dialogGezeigt = true;

        // Wo liegen die Bilder wirklich? Und wie hieße das plattformfest?
        var istOrdner = null, uneinig = false;
        for (var so = 0; so < zellen.length; so++) {
            var oS = zellen[so].ordnerStd;
            if (oS === null) continue;
            if (istOrdner === null) istOrdner = oS;
            else if (istOrdner !== oS) uneinig = true;
        }

        // Vorschlag: plattformfest, also "./ordner" relativ zur Datenquelle.
        // Zeigt der aktuelle Ordner schon so aus, ist nichts zu tun.
        var vorschlagOrdner = "./bilder";
        if (istOrdner !== null && !uneinig) {
            if (istOrdner.substring(0, 2) === "./" && istOrdner.indexOf("\\") < 0) {
                vorschlagOrdner = istOrdner;                 // schon plattformfest
            } else {
                var tS = schraegNorm(istOrdner).split("/");
                var letzterS = tS[tS.length - 1];
                if (letzterS !== "" && letzterS.indexOf(":") < 0) vorschlagOrdner = "./" + letzterS;
            }
        }

        var schonFest = true;
        for (var pf = 0; pf < zellen.length; pf++)
            if (zellen[pf].wert !== "" && !plattformSicher(zellen[pf].wert)) schonFest = false;

        var uDlg = new Window("dialog", "Bildpfad-Check " + VERSION + " – umstellen");
        uDlg.alignChildren = "fill"; uDlg.margins = 14; uDlg.spacing = 7;

        var uK = uDlg.add("statictext", undefined,
            "Alle " + zellen.length + " Bildpfade lösen auf. Es ist nichts kaputt." +
            (schonFest
             ? "  Sie sind auch plattformfest notiert."
             : "  Sie sind aber an " + (WIN ? "Windows" : "macOS") + " gebunden."),
            { multiline: true });
        uK.characters = 84;

        var uH = uDlg.add("statictext", undefined,
            "Plattformfest ist nur \"./ordner/datei\" – das setzt voraus, dass die " +
            "Bilder neben der Datenquelle liegen. Hier lässt sich der Bildordner " +
            "für alle Verweise auf einmal umstellen.", { multiline: true });
        uH.characters = 84; uH.preferredSize.height = 42;

        var uP = uDlg.add("panel", undefined, "Bildordner für alle Bildverweise");
        uP.alignChildren = "fill"; uP.margins = 10; uP.spacing = 5;
        var uR = uP.add("group"); uR.alignChildren = "center"; uR.spacing = 6;
        var uF = uR.add("edittext", undefined, vorschlagOrdner); uF.characters = 46;
        var uB = uR.add("button", undefined, "..."); uB.preferredSize.width = 30;
        var uV = uP.add("statictext", undefined, ""); uV.characters = 84;

        var uW = uDlg.add("statictext", undefined,
            "Das Skript schreibt nur die Datenquelle um. Die Bilddateien " +
            "verschiebt es NICHT – das musst du selbst tun.", { multiline: true });
        uW.characters = 84;

        var uZ = uDlg.add("group"); uZ.alignChildren = "center"; uZ.spacing = 6;
        uZ.add("statictext", undefined, "Kopie speichern als:");
        var uN = uZ.add("edittext", undefined, freierName()); uN.characters = 38;

        function uFrisch() {
            var ord = trimme(uF.text);
            var opt2 = { ordnerModus: "std", stdOrdner: ord, aufwaerts: false,
                         nameAn: false, arten: {} };
            var n3 = 0;
            for (var uz = 0; uz < zellen.length; uz++) if (neuerWert(zellen[uz], opt2) !== null) n3++;
            uV.text = (n3 === 0)
                ? "Es würde sich nichts ändern – die Pfade stehen bereits so da."
                : (n3 + " von " + zellen.length + " Verweisen werden auf \"" + ord + "/…\" umgestellt.");
            try { uOK.enabled = (n3 > 0 && ord !== ""); } catch (eU) {}
            return opt2;
        }
        uF.onChanging = uFrisch;
        uB.onClick = function () {
            var st = null;
            try { st = new Folder(basisFuerURI); } catch (eU1) {}
            var ord2 = null;
            try { if (st) ord2 = st.selectDlg("Ordner mit den Bildern wählen"); } catch (eU2) {}
            if (!ord2) { try { ord2 = Folder.selectDialog("Ordner mit den Bildern wählen"); } catch (eU3) {} }
            if (!ord2) return;
            var vollU = decodeURI(ord2.fsName);
            var relU = relativMachen(vollU + "/x", basisOrdner);
            uF.text = relU ? zerteile(relU).ordner
                           : (WIN ? schraegNorm(vollU).replace(/\//g, "\\") : vollU);
            uFrisch();
        };

        var uG = uDlg.add("group");
        var uBer = uG.add("button", undefined, "Bericht öffnen");
        uG.add("group").alignment = ["fill", "center"];
        uG.add("button", undefined, "Schließen", { name: "cancel" });
        var uOK = uG.add("button", undefined, "Umstellen und Kopie schreiben", { name: "ok" });
        uOK.preferredSize.width = 220;
        uBer.onClick = function () {
            try { berichtDatei.execute(); }
            catch (eU4) { alert("Bericht liegt hier:\n" + decodeURI(berichtDatei.fsName)); }
        };

        var optU = uFrisch();
        if (uDlg.show() === 1) {
            optU = uFrisch();
            kopieMeldung = kopieSchreiben(optU, uN.text);
        }
    }

    // ---------- Abschluss ----------
    // Kein Wiederholen dessen, was im Dialog schon stand. Nur eine Meldung,
    // wenn tatsächlich etwas geschrieben wurde – oder wenn gar kein Dialog kam.
    if (kopieMeldung !== "") {
        alert(trimme(kopieMeldung), "Bildpfad-Check " + VERSION);
    } else if (!dialogGezeigt) {
        alert("BILDPFAD-CHECK " + VERSION + "\n\n" +
              "Datenquelle:   " + decodeURI(quellDatei.name) + "\n" +
              "Bildfelder:    " + bildSpalten.length + "\n" +
              "Datensätze:    " + q.saetze.length + "\n" +
              "Kodierung:     " + q.kodierung + "\n\n" +
              "In Ordnung:    " + okAnzahl + "\n" +
              "Mit Problem:   " + probleme.length + "\n" +
              "Leere Felder:  " + leere.length + "\n\n" +
              "Bericht: bildpfad-bericht.txt\n" + decodeURI(basisOrdner),
              "Bildpfad-Check " + VERSION);
    }

})();
