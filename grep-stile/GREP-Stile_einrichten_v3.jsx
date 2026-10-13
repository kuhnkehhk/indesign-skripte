/*
    GREP-Stile einrichten  –  schlanke Fassung
    ==================================================================
    Legt Zeichenformate für Schriftsysteme an und hängt sie als GREP-Stile
    an ausgewählte Absatzformate.

    Danach wählt das Absatzformat die Schrift selbst: Koreanisch bekommt
    Malgun Gothic, Arabisch Adobe Arabic, der Rest bleibt bei der
    Hausschrift – ohne dass ein Rahmen angefasst wird.

    SCHRIFTAUSWAHL
    Die Schriftnamen stehen als Text im Dialog und lassen sich direkt
    tippen. Über die Schaltfläche "..." öffnet sich eine Auswahlliste
    aller installierten Schriften, mit Suchfeld.

    Die Schriften werden dabei ERST BEIM ERSTEN KLICK gelesen und danach
    behalten. Grund: Bei einer Creative-Cloud-Installation mit über tausend
    Schriften dauert das Einlesen spürbar. Würde es beim Start passieren,
    sähe das Skript aus, als täte es nichts.

    Ist eine getippte Schrift nicht installiert, legt InDesign das
    Zeichenformat trotzdem an und markiert die Schrift als fehlend – dann
    nachinstallieren oder im Zeichenformat austauschen.

    BERICHT
    Nach dem Durchlauf entsteht neben dem Dokument die Datei
    "grep-stile-bericht.txt" (bei ungespeichertem Dokument auf dem
    Schreibtisch). Am Bildschirm erscheint nur eine kurze Zusammenfassung.

    VORHANDENE ZEICHENFORMATE AKTUALISIEREN
    Voreingestellt bleiben bestehende Zeichenformate unangetastet. Wer eine
    Schrift austauschen will – etwa Malgun Gothic gegen Source Han Sans –,
    hakt "Vorhandene Zeichenformate aktualisieren" an. Dann wird die Schrift
    in JEDEM betroffenen Zeichenformat gesetzt, dokumentweit und unabhängig
    davon, welche Absatzformate links ausgewählt sind.

    Der Bericht nennt jede Änderung mit alter und neuer Schrift.

    SICHERHEIT
    - Vorhandene Zeichenformate werden nur angefasst, wenn das Häkchen sitzt
    - Ein GREP-Stil mit demselben Ausdruck wird nicht doppelt angelegt
    - Alles in einem Schritt: ein Strg+Z macht es rückgängig

    Heike Kuhnke / 25.09.2026  ·  Fassung 1.2 – Zeichenformate aktualisierbar
*/

// Auf true setzen, wenn geprüft werden soll, ob das Skript überhaupt startet:
var ZEIGE_STARTMELDUNG = false;

(function () {
try {

    if (ZEIGE_STARTMELDUNG) alert("Skript gestartet.");

    if (app.documents.length === 0) { alert("Kein Dokument geöffnet."); return; }
    var doc = app.activeDocument;

    // ---------- Schriftsysteme ----------
    var SYS = [
        ["Griechisch",          "Schrift Griechisch",  "Arial",          "[\\x{0370}-\\x{03FF}\\x{1F00}-\\x{1FFF}]+"],
        ["Kyrillisch",          "Schrift Kyrillisch",  "Arial",          "[\\x{0400}-\\x{04FF}]+"],
        ["Hebräisch",           "Schrift Hebraeisch",  "Adobe Hebrew",   "[\\x{0590}-\\x{05FF}]+"],
        ["Arabisch",            "Schrift Arabisch",    "Adobe Arabic",   "[\\x{0600}-\\x{06FF}\\x{FB50}-\\x{FEFF}]+"],
        ["Kana (Japanisch)",    "Schrift Japanisch",   "Yu Gothic",      "[\\x{3040}-\\x{30FF}]+"],
        ["CJK-Ideogramme",      "Schrift CJK",         "Yu Gothic",      "[\\x{4E00}-\\x{9FFF}\\x{3400}-\\x{4DBF}]+"],
        ["Hangul (Koreanisch)", "Schrift Koreanisch",  "Malgun Gothic",  "[\\x{AC00}-\\x{D7A3}\\x{1100}-\\x{11FF}]+"],
        ["Thai",                "Schrift Thai",        "Leelawadee UI",  "[\\x{0E00}-\\x{0E7F}]+"],
        ["Devanagari",          "Schrift Devanagari",  "Nirmala UI",     "[\\x{0900}-\\x{097F}]+"]
    ];

    // ---------- Absatzformate sammeln ----------
    var formate = [], namen = [];
    var keineId = null;
    try { keineId = doc.paragraphStyles[0].id; } catch (e0) {}

    var alle = doc.allParagraphStyles;
    for (var i = 0; i < alle.length; i++) {
        var nm;
        try { nm = String(alle[i].name); } catch (e1) { continue; }
        try { if (keineId !== null && alle[i].id === keineId) continue; } catch (e2) {}
        formate.push(alle[i]);
        namen.push(nm);
    }
    if (formate.length === 0) { alert("Kein Absatzformat gefunden."); return; }

    // ---------- Schriftauswahl, erst auf Anforderung ----------
    var familienCache = null;

    function familienHolen() {
        if (familienCache) return familienCache;
        var roh = [];
        try {
            roh = app.fonts.everyItem().fontFamily;           // ein einziger Aufruf
            if (!(roh instanceof Array)) roh = [roh];
        } catch (eA) {
            try {
                var ff = app.fonts;
                for (var q = 0; q < ff.length; q++) {
                    try { roh.push(String(ff[q].fontFamily)); } catch (eB) {}
                }
            } catch (eC) {}
        }
        var gesehen = {}, raus = [];
        for (var r = 0; r < roh.length; r++) {
            var fam = String(roh[r]);
            if (fam && !gesehen[fam]) { gesehen[fam] = true; raus.push(fam); }
        }
        raus.sort();
        familienCache = raus;
        return familienCache;
    }

    function schriftWaehlen(vorgabe) {
        var fam = familienHolen();
        if (!fam.length) { alert("Es konnten keine Schriften gelesen werden."); return null; }

        var d = new Window("dialog", "Schrift wählen");
        d.orientation = "column";
        d.alignChildren = "fill";
        d.margins = 12;
        d.spacing = 8;

        var gs = d.add("group");
        gs.add("statictext", undefined, "Suchen:");
        var suche = gs.add("edittext", undefined, "");
        suche.preferredSize.width = 260;

        var lb = d.add("listbox", undefined, []);
        lb.preferredSize = [320, 300];

        var info = d.add("statictext", undefined, "");

        var MAX = 300;
        function fuellen(filter) {
            lb.removeAll();
            var f = String(filter).toLowerCase();
            var gezeigt = 0, gesamt = 0;
            for (var i = 0; i < fam.length; i++) {
                if (f && fam[i].toLowerCase().indexOf(f) < 0) continue;
                gesamt++;
                if (gezeigt < MAX) { lb.add("item", fam[i]); gezeigt++; }
            }
            info.text = gesamt + " Treffer" + (gesamt > MAX ? ", die ersten " + MAX + " gezeigt" : "");
            // Vorgabe vorauswählen
            for (var j = 0; j < lb.items.length; j++) {
                if (String(lb.items[j].text) === String(vorgabe)) { lb.selection = j; break; }
            }
        }
        fuellen("");
        suche.onChanging = function () { fuellen(suche.text); };
        lb.onDoubleClick = function () { d.close(1); };

        var gf = d.add("group");
        gf.alignment = "right";
        gf.add("button", undefined, "Abbrechen", { name: "cancel" });
        gf.add("button", undefined, "Übernehmen", { name: "ok" });

        if (d.show() !== 1) return null;
        if (!lb.selection) return null;
        return String(lb.selection.text);
    }

    // ---------- Dialog ----------
    var w = new Window("dialog", "GREP-Stile einrichten");
    w.orientation = "column";
    w.alignChildren = "fill";
    w.margins = 14;
    w.spacing = 10;

    w.add("statictext", undefined, "Absatzformate  (" + formate.length + " gefunden, Mehrfachauswahl)");
    var liste = w.add("listbox", undefined, namen, { multiselect: true });
    liste.preferredSize = [420, 150];

    var gKnopf = w.add("group");
    var bAlle  = gKnopf.add("button", undefined, "Alle");
    var bKeine = gKnopf.add("button", undefined, "Keine");
    bAlle.onClick = function () {
        var idx = []; for (var k = 0; k < namen.length; k++) idx.push(k);
        liste.selection = idx;
    };
    bKeine.onClick = function () { liste.selection = null; };

    w.add("statictext", undefined,
        "Schriftsysteme  –  Schriftname tippen oder über \"...\" auswählen");
    var p = w.add("panel");
    p.alignChildren = "left";
    p.margins = 10;
    p.spacing = 4;

    var zeilen = [];
    for (var s = 0; s < SYS.length; s++) {
        var g = p.add("group");
        g.spacing = 8;
        var cb = g.add("checkbox", undefined, SYS[s][0]);
        cb.preferredSize.width = 160;
        cb.value = true;
        var et = g.add("edittext", undefined, SYS[s][2]);
        et.preferredSize.width = 200;
        var bw = g.add("button", undefined, "...");
        bw.preferredSize.width = 34;
        bw.helpTip = "Schrift aus der Liste wählen. Beim ersten Klick werden die Schriften gelesen, das dauert einen Moment.";
        (function (feld) {
            bw.onClick = function () {
                var gewaehlt = schriftWaehlen(feld.text);
                if (gewaehlt) feld.text = gewaehlt;
            };
        })(et);
        zeilen.push({ cb: cb, et: et, stil: SYS[s][1], grep: SYS[s][3], titel: SYS[s][0] });
    }

    var pAkt = w.add("panel");
    pAkt.alignChildren = "left"; pAkt.margins = 10; pAkt.spacing = 3;
    var cbAkt = pAkt.add("checkbox", undefined,
        "Vorhandene Zeichenformate mit der gewählten Schrift aktualisieren");
    cbAkt.value = false;
    var hAkt = pAkt.add("statictext", undefined,
        "Wirkt dokumentweit – unabhängig davon, welche Absatzformate links ausgewählt sind.\n" +
        "Ohne Häkchen bleiben bestehende Zeichenformate unverändert.",
        { multiline: true });
    hAkt.characters = 74;

    var fuss = w.add("group");
    fuss.alignment = "right";
    fuss.add("button", undefined, "Abbrechen", { name: "cancel" });
    fuss.add("button", undefined, "Anwenden",  { name: "ok" });

    if (w.show() !== 1) return;

    // ---------- Auswahl ----------
    var zielFormate = [];
    if (liste.selection) {
        var sel = (liste.selection instanceof Array) ? liste.selection : [liste.selection];
        for (var a = 0; a < sel.length; a++) zielFormate.push(formate[sel[a].index]);
    }
    if (zielFormate.length === 0) { alert("Kein Absatzformat ausgewählt."); return; }

    var zielSysteme = [];
    for (var z = 0; z < zeilen.length; z++) {
        if (!zeilen[z].cb.value) continue;
        var schrift = String(zeilen[z].et.text).replace(/^\s+|\s+$/g, "");
        if (!schrift) continue;
        zielSysteme.push({ stil: zeilen[z].stil, grep: zeilen[z].grep,
                           titel: zeilen[z].titel, schrift: schrift });
    }
    if (zielSysteme.length === 0) { alert("Kein Schriftsystem ausgewählt."); return; }

    // ---------- Arbeiten ----------
    var aktualisieren = cbAkt.value;
    var neuStil = [], altStil = [], aktStil = [], neuGrep = [], skipGrep = [], fehler = [];

    app.doScript(function () {

        for (var k = 0; k < zielSysteme.length; k++) {
            var name = zielSysteme[k].stil;
            var cs = doc.characterStyles.itemByName(name);
            if (cs.isValid) {
                if (aktualisieren) {
                    var alteSchrift = "unbekannt";
                    try { alteSchrift = String(cs.appliedFont.fontFamily); }
                    catch (eA1) { try { alteSchrift = String(cs.appliedFont); } catch (eA2) {} }
                    if (alteSchrift === zielSysteme[k].schrift) {
                        altStil.push(name + "  (schon " + alteSchrift + ")");
                    } else {
                        try {
                            cs.appliedFont = zielSysteme[k].schrift;
                            aktStil.push(name + ":  " + alteSchrift + "  ->  " + zielSysteme[k].schrift);
                        } catch (eU) {
                            fehler.push(name + ": Schrift \"" + zielSysteme[k].schrift +
                                        "\" nicht gesetzt (" + eU.message + ")");
                            altStil.push(name + "  (unverändert, Schrift nicht setzbar)");
                        }
                    }
                } else {
                    altStil.push(name);
                }
                zielSysteme[k].obj = cs;
            } else {
                try {
                    cs = doc.characterStyles.add({ name: name });
                    try { cs.appliedFont = zielSysteme[k].schrift; }
                    catch (eF) { fehler.push(name + ": Schrift \"" + zielSysteme[k].schrift +
                                             "\" nicht gesetzt (" + eF.message + ")"); }
                    neuStil.push(name + "  ->  " + zielSysteme[k].schrift);
                    zielSysteme[k].obj = cs;
                } catch (eC) {
                    fehler.push("Zeichenformat " + name + ": " + eC.message);
                    zielSysteme[k].obj = null;
                }
            }
        }

        for (var f = 0; f < zielFormate.length; f++) {
            var ps = zielFormate[f];
            var psName = String(ps.name);
            var da = [];
            try {
                var ng = ps.nestedGrepStyles;
                for (var n = 0; n < ng.length; n++) {
                    try { da.push(String(ng[n].grepExpression)); } catch (e3) {}
                }
            } catch (e4) {}

            for (var m = 0; m < zielSysteme.length; m++) {
                if (!zielSysteme[m].obj) continue;
                var vorhanden = false;
                for (var d = 0; d < da.length; d++) if (da[d] === zielSysteme[m].grep) vorhanden = true;
                if (vorhanden) { skipGrep.push(psName + " / " + zielSysteme[m].titel); continue; }
                try {
                    ps.nestedGrepStyles.add({
                        appliedCharacterStyle: zielSysteme[m].obj,
                        grepExpression: zielSysteme[m].grep
                    });
                    neuGrep.push(psName + " / " + zielSysteme[m].titel);
                } catch (e5) {
                    fehler.push(psName + " / " + zielSysteme[m].titel + ": " + e5.message);
                }
            }
        }

    }, ScriptLanguage.JAVASCRIPT, [], UndoModes.ENTIRE_SCRIPT, "GREP-Stile einrichten");

    // ---------- Bericht zusammenstellen ----------
    var b = [];
    b.push("GREP-STILE EINRICHTEN – BERICHT");
    b.push("Dokument:  " + doc.name);
    try { b.push("InDesign:  " + app.version); } catch (eV) {}
    b.push("Erstellt:  " + new Date().toString());
    b.push("");
    b.push("Bearbeitete Absatzformate (" + zielFormate.length + "):");
    for (var bf = 0; bf < zielFormate.length; bf++) {
        var bn = "(unbekannt)";
        try { bn = String(zielFormate[bf].name); } catch (eB) {}
        b.push("   " + bn);
    }
    b.push("");
    b.push("Verwendete Schriftsysteme (" + zielSysteme.length + "):");
    for (var bs = 0; bs < zielSysteme.length; bs++) {
        b.push("   " + zielSysteme[bs].titel + "  ->  " + zielSysteme[bs].schrift +
               "   [Zeichenformat: " + zielSysteme[bs].stil + "]");
    }
    b.push("");
    b.push("==========================================================");
    b.push("");

    function block(titel, arr) {
        if (!arr.length) return;
        b.push(titel + " (" + arr.length + "):");
        for (var q = 0; q < arr.length; q++) b.push("   " + arr[q]);
        b.push("");
    }
    block("Neu angelegte Zeichenformate", neuStil);
    block("Zeichenformate AKTUALISIERT", aktStil);
    block("Zeichenformate schon vorhanden, nicht angefasst", altStil);
    block("Neu angefügte GREP-Stile", neuGrep);
    block("GREP-Stile übersprungen, weil schon vorhanden", skipGrep);
    block("FEHLER", fehler);

    b.push("==========================================================");
    b.push("");
    b.push("Verwendete GREP-Ausdrücke:");
    for (var bg = 0; bg < zielSysteme.length; bg++) {
        b.push("   " + zielSysteme[bg].titel);
        b.push("      " + zielSysteme[bg].grep);
    }
    b.push("");
    b.push("Rückgängig machen: einmal Strg+Z bzw. Cmd+Z.");
    b.push("");
    b.push("Fehlt eine Schrift, meldet InDesign sie als fehlend.");
    b.push("Dann im Zeichenformat eine vorhandene Schrift zuweisen.");

    // ---------- Bericht als Datei ablegen ----------
    var ziel = null, gespeichert = false;
    try {
        var ordner = null;
        try { if (doc.saved && doc.filePath) ordner = doc.filePath; } catch (eO) {}
        if (!ordner) ordner = Folder.desktop;
        ziel = new File(ordner + "/grep-stile-bericht.txt");
        ziel.encoding = "UTF-8";
        if (ziel.open("w")) { ziel.write(b.join("\n")); ziel.close(); gespeichert = true; }
    } catch (eS) {}

    // ---------- kurze Meldung am Bildschirm ----------
    var kurz = [];
    kurz.push("FERTIG");
    kurz.push("");
    kurz.push("Absatzformate bearbeitet:   " + zielFormate.length);
    kurz.push("Schriftsysteme:             " + zielSysteme.length);
    kurz.push("");
    kurz.push("Neue Zeichenformate:        " + neuStil.length);
    kurz.push("Aktualisiert:              " + aktStil.length +
              (aktualisieren ? "" : "   (Häkchen war nicht gesetzt)"));
    kurz.push("Schon vorhanden:           " + altStil.length);
    kurz.push("Neue GREP-Stile:            " + neuGrep.length);
    kurz.push("Übersprungen:               " + skipGrep.length);
    if (fehler.length) kurz.push("FEHLER:                     " + fehler.length);
    kurz.push("");
    kurz.push("Rückgängig: einmal Strg+Z bzw. Cmd+Z.");
    kurz.push("");
    kurz.push(gespeichert
        ? ("Vollständiger Bericht:\n" + ziel.fsName)
        : "Der Bericht konnte nicht gespeichert werden.");

    alert(kurz.join("\n"));
    if (!gespeichert) { try { $.writeln(b.join("\n")); } catch (eW) {} }

} catch (FEHLER) {
    alert("Das Skript ist abgebrochen.\n\n" +
          "Meldung: " + FEHLER.message + "\n" +
          "Zeile:   " + FEHLER.line + "\n\n" +
          "Bitte diesen Text weitergeben.");
}
})();
