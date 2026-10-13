/*
    GREP-Stile für Schriftsysteme
    ==================================================================
    Legt Zeichenformate für einzelne Schriftsysteme an und hängt sie als
    GREP-Stile an ausgewählte Absatzformate.

    Danach wählt das Absatzformat die Schrift selbst: Koreanisch bekommt
    Malgun Gothic, Arabisch Adobe Arabic, der Rest bleibt bei der
    Hausschrift – ohne dass ein Rahmen angefasst wird.

    Gedacht für die Datenzusammenführung mit internationalen Daten.

    SICHERHEIT
    - Vorhandene Zeichenformate werden NICHT überschrieben. Sie werden
      unverändert weiterverwendet.
    - Ein GREP-Stil mit demselben Ausdruck wird nicht doppelt angelegt.
    - Es werden keine Absatzformate erzeugt, nur bestehende ergänzt.

    Heike Kuhnke / 22.09.2026  ·  Fassung 1.3  (schnelles Einlesen, Fehlerbericht)
    AUSFÜHREN  Fenster > Hilfsprogramme > Skripte, Datei in "User" legen,
               doppelklicken.
*/

#target indesign

(function () {
  try {

    if (app.documents.length === 0) { alert("Kein Dokument geöffnet."); return; }
    var doc = app.activeDocument;

    // ============ Schriftsysteme ============
    // name, GREP-Ausdruck, Name des Zeichenformats, Kandidaten für die Schrift
    var SYSTEME = [
        { titel: "Griechisch",       grep: "[\\x{0370}-\\x{03FF}\\x{1F00}-\\x{1FFF}]+",
          stil: "Schrift Griechisch",
          kandidaten: ["Source Han Sans", "Noto Sans", "Arial", "Helvetica", "Times New Roman"] },

        { titel: "Kyrillisch",       grep: "[\\x{0400}-\\x{04FF}]+",
          stil: "Schrift Kyrillisch",
          kandidaten: ["Source Han Sans", "Noto Sans", "Arial", "Helvetica", "Times New Roman"] },

        { titel: "Hebräisch",        grep: "[\\x{0590}-\\x{05FF}]+",
          stil: "Schrift Hebraeisch",
          kandidaten: ["Adobe Hebrew", "Noto Sans Hebrew", "Arial", "Times New Roman"] },

        { titel: "Arabisch",         grep: "[\\x{0600}-\\x{06FF}\\x{FB50}-\\x{FEFF}]+",
          stil: "Schrift Arabisch",
          kandidaten: ["Adobe Arabic", "Noto Sans Arabic", "Arial", "Geeza Pro"] },

        { titel: "Kana (Japanisch)", grep: "[\\x{3040}-\\x{30FF}]+",
          stil: "Schrift Japanisch",
          kandidaten: ["Source Han Sans", "Yu Gothic", "Hiragino Sans", "MS Gothic", "Meiryo"] },

        { titel: "CJK-Ideogramme",   grep: "[\\x{4E00}-\\x{9FFF}\\x{3400}-\\x{4DBF}]+",
          stil: "Schrift CJK",
          kandidaten: ["Source Han Sans", "Yu Gothic", "Hiragino Sans", "MS Gothic", "SimSun"] },

        { titel: "Hangul (Koreanisch)", grep: "[\\x{AC00}-\\x{D7A3}\\x{1100}-\\x{11FF}]+",
          stil: "Schrift Koreanisch",
          kandidaten: ["Malgun Gothic", "Source Han Sans", "Apple SD Gothic Neo", "Batang"] },

        { titel: "Thai",             grep: "[\\x{0E00}-\\x{0E7F}]+",
          stil: "Schrift Thai",
          kandidaten: ["Noto Sans Thai", "Leelawadee UI", "Thonburi", "Angsana New"] },

        { titel: "Devanagari",       grep: "[\\x{0900}-\\x{097F}]+",
          stil: "Schrift Devanagari",
          kandidaten: ["Adobe Devanagari", "Noto Sans Devanagari", "Nirmala UI", "Kohinoor Devanagari"] }
    ];

    // ============ Hilfsfunktionen ============
    function enthaelt(a, w) { for (var i = 0; i < a.length; i++) if (a[i] === w) return true; return false; }

    // Alle installierten Schriftfamilien einsammeln.
    // WICHTIG: everyItem() holt alles in EINEM Aufruf. Die Schriften einzeln
    // abzufragen dauert bei einer Creative-Cloud-Installation mit über tausend
    // Schriften sehr lange – das Skript sieht dann aus, als täte es nichts.
    var familien = [];
    (function () {
        var roh = [];
        try {
            roh = app.fonts.everyItem().fontFamily;          // ein einziger Aufruf
            if (!(roh instanceof Array)) roh = [roh];
        } catch (e1) {
            try {                                            // Rückfallebene
                var f = app.fonts;
                for (var i = 0; i < f.length; i++) {
                    try { roh.push(String(f[i].fontFamily)); } catch (e2) {}
                }
            } catch (e3) {}
        }
        var gesehen = {};
        for (var r = 0; r < roh.length; r++) {
            var fam = String(roh[r]);
            if (fam && !gesehen[fam]) { gesehen[fam] = true; familien.push(fam); }
        }
        familien.sort();
    })();
    if (familien.length === 0) { alert("Keine Schriften gefunden."); return; }
    if (familien.length > 900) familien = familien.slice(0, 900);   // sehr große Menüs bremsen ScriptUI aus

    function ersterTreffer(kandidaten) {
        for (var i = 0; i < kandidaten.length; i++) {
            for (var j = 0; j < familien.length; j++) {
                if (familien[j] === kandidaten[i]) return j;
                // auch Teiltreffer, etwa "Source Han Sans JP"
                if (familien[j].indexOf(kandidaten[i]) === 0) return j;
            }
        }
        return -1;
    }

    // Absatzformate einsammeln.
    // WICHTIG: [Basisabsatzformat] bleibt drin – in vielen Vorlagen steckt der
    // gesamte Text darin. Nur "[Kein Absatzformat]" wird ausgeschlossen, daran
    // lässt sich nichts anhängen. Es ist immer der erste Eintrag der Sammlung.
    var absatzformate = [], absatznamen = [];
    (function () {
        var keineId = null;
        try { keineId = doc.paragraphStyles[0].id; } catch (e0) {}

        var alle = doc.allParagraphStyles;
        for (var i = 0; i < alle.length; i++) {
            var n = "";
            try { n = String(alle[i].name); } catch (e) { continue; }
            try { if (keineId !== null && alle[i].id === keineId) continue; } catch (e1) {}

            var pfad = n;
            try {
                var p = alle[i].parent;
                while (p && String(p.constructor.name) === "ParagraphStyleGroup") {
                    pfad = String(p.name) + " > " + pfad;
                    p = p.parent;
                }
            } catch (e2) {}
            absatzformate.push(alle[i]);
            absatznamen.push(pfad);
        }
    })();
    if (absatzformate.length === 0) {
        var roh = [];
        try {
            var t = doc.allParagraphStyles;
            for (var r = 0; r < t.length; r++) {
                var rn = "(nicht lesbar)";
                try { rn = String(t[r].name); } catch (eR) {}
                roh.push("   [" + r + "] " + rn);
            }
        } catch (eR2) { roh.push("   allParagraphStyles nicht lesbar: " + eR2.message); }
        alert("Es wurde kein verwendbares Absatzformat gefunden.\n\n" +
              "Was InDesign meldet (" + roh.length + " Einträge):\n" + roh.join("\n") +
              "\n\nBitte diesen Text weitergeben.");
        return;
    }

    // ============ Dialog ============
    var w = new Window("dialog", "GREP-Stile für Schriftsysteme");
    w.orientation = "column";
    w.alignChildren = "fill";
    w.margins = 16;
    w.spacing = 12;

    var kopf = w.add("statictext", undefined,
        "Wähle links die Absatzformate und rechts die Schriftsysteme.\n" +
        "Fehlende Zeichenformate werden angelegt, vorhandene bleiben unverändert.\n" +
        "Das [Basisabsatzformat] steht mit in der Liste – in vielen Vorlagen steckt der Text dort.",
        { multiline: true });
    kopf.preferredSize.height = 46;

    var mitte = w.add("group");
    mitte.orientation = "row";
    mitte.alignChildren = "fill";
    mitte.spacing = 14;

    // -- links: Absatzformate --
    var pLinks = mitte.add("panel", undefined,
        "Absatzformate  (" + absatzformate.length + " gefunden, Mehrfachauswahl)");
    pLinks.alignChildren = "fill";
    pLinks.margins = 12;
    var liste = pLinks.add("listbox", undefined, absatznamen, { multiselect: true });
    liste.preferredSize = [260, 300];
    var knopfgruppe = pLinks.add("group");
    var bAlle = knopfgruppe.add("button", undefined, "Alle");
    var bKeine = knopfgruppe.add("button", undefined, "Keine");
    bAlle.onClick = function () {
        var idx = []; for (var i = 0; i < absatznamen.length; i++) idx.push(i);
        liste.selection = idx;
    };
    bKeine.onClick = function () { liste.selection = null; };

    // -- rechts: Schriftsysteme --
    var pRechts = mitte.add("panel", undefined, "Schriftsysteme und Schrift");
    pRechts.alignChildren = "left";
    pRechts.margins = 12;
    pRechts.spacing = 6;

    var zeilen = [];
    for (var s = 0; s < SYSTEME.length; s++) {
        var g = pRechts.add("group");
        g.orientation = "row";
        g.spacing = 8;
        var cb = g.add("checkbox", undefined, SYSTEME[s].titel);
        cb.preferredSize.width = 150;
        var dd = g.add("dropdownlist", undefined, familien);
        dd.preferredSize.width = 230;
        // Hinweis: neun Menüs mit mehreren hundert Einträgen brauchen einen Moment.
        var treffer = ersterTreffer(SYSTEME[s].kandidaten);
        if (treffer >= 0) { dd.selection = treffer; cb.value = true; }
        else { dd.selection = 0; cb.value = false; }
        zeilen.push({ cb: cb, dd: dd, sys: SYSTEME[s], gefunden: treffer >= 0 });
    }

    var hinweis = pRechts.add("statictext", undefined,
        "Nicht angehakt = keine passende Schrift gefunden.\nDu kannst trotzdem eine auswählen.",
        { multiline: true });
    hinweis.preferredSize.height = 28;

    // -- unten --
    var unten = w.add("group");
    unten.alignment = "right";
    var bAbbruch = unten.add("button", undefined, "Abbrechen", { name: "cancel" });
    var bOk = unten.add("button", undefined, "Anwenden", { name: "ok" });

    if (w.show() !== 1) return;

    // ============ Auswahl auswerten ============
    var gewaehlteFormate = [];
    if (liste.selection) {
        var sel = (liste.selection instanceof Array) ? liste.selection : [liste.selection];
        for (var i = 0; i < sel.length; i++) gewaehlteFormate.push(absatzformate[sel[i].index]);
    }
    if (gewaehlteFormate.length === 0) { alert("Kein Absatzformat ausgewählt."); return; }

    var gewaehlteSysteme = [];
    for (var z = 0; z < zeilen.length; z++) {
        if (zeilen[z].cb.value) {
            gewaehlteSysteme.push({ sys: zeilen[z].sys, schrift: String(zeilen[z].dd.selection.text) });
        }
    }
    if (gewaehlteSysteme.length === 0) { alert("Kein Schriftsystem ausgewählt."); return; }

    // ============ Arbeiten ============
    var neueStile = [], vorhandeneStile = [], neueGreps = [], uebersprungen = [], fehler = [];

    app.doScript(function () {

        // --- 1. Zeichenformate sicherstellen ---
        for (var k = 0; k < gewaehlteSysteme.length; k++) {
            var name = gewaehlteSysteme[k].sys.stil;
            var cs = doc.characterStyles.itemByName(name);
            if (cs.isValid) {
                vorhandeneStile.push(name + "  (unverändert übernommen)");
                gewaehlteSysteme[k].stilObjekt = cs;
            } else {
                try {
                    cs = doc.characterStyles.add({ name: name });
                    cs.appliedFont = gewaehlteSysteme[k].schrift;
                    neueStile.push(name + "  ->  " + gewaehlteSysteme[k].schrift);
                    gewaehlteSysteme[k].stilObjekt = cs;
                } catch (e) {
                    fehler.push("Zeichenformat " + name + ": " + e.message);
                    gewaehlteSysteme[k].stilObjekt = null;
                }
            }
        }

        // --- 2. GREP-Stile anhängen ---
        for (var p = 0; p < gewaehlteFormate.length; p++) {
            var ps = gewaehlteFormate[p];
            var psName = String(ps.name);

            // vorhandene GREP-Ausdrücke dieses Absatzformats sammeln
            var vorhanden = [];
            try {
                var ng = ps.nestedGrepStyles;
                for (var n = 0; n < ng.length; n++) {
                    try { vorhanden.push(String(ng[n].grepExpression)); } catch (e1) {}
                }
            } catch (e2) {}

            for (var m = 0; m < gewaehlteSysteme.length; m++) {
                var eintrag = gewaehlteSysteme[m];
                if (!eintrag.stilObjekt) continue;
                var ausdruck = eintrag.sys.grep;

                if (enthaelt(vorhanden, ausdruck)) {
                    uebersprungen.push(psName + "  /  " + eintrag.sys.titel + "  (GREP-Stil war schon da)");
                    continue;
                }
                try {
                    ps.nestedGrepStyles.add({
                        appliedCharacterStyle: eintrag.stilObjekt,
                        grepExpression: ausdruck
                    });
                    neueGreps.push(psName + "  /  " + eintrag.sys.titel);
                } catch (e3) {
                    fehler.push(psName + " / " + eintrag.sys.titel + ": " + e3.message);
                }
            }
        }

    }, ScriptLanguage.JAVASCRIPT, [], UndoModes.ENTIRE_SCRIPT, "GREP-Stile für Schriftsysteme");

    // ============ Bericht ============
    var b = [];
    b.push("FERTIG");
    b.push("");
    b.push("Absatzformate bearbeitet: " + gewaehlteFormate.length);
    b.push("Schriftsysteme:           " + gewaehlteSysteme.length);
    b.push("");

    if (neueStile.length) {
        b.push("Neu angelegte Zeichenformate (" + neueStile.length + "):");
        for (var a1 = 0; a1 < neueStile.length; a1++) b.push("   " + neueStile[a1]);
        b.push("");
    }
    if (vorhandeneStile.length) {
        b.push("Bereits vorhanden, nicht angefasst (" + vorhandeneStile.length + "):");
        for (var a2 = 0; a2 < vorhandeneStile.length; a2++) b.push("   " + vorhandeneStile[a2]);
        b.push("");
    }
    if (neueGreps.length) {
        b.push("Neue GREP-Stile (" + neueGreps.length + "):");
        for (var a3 = 0; a3 < neueGreps.length; a3++) b.push("   " + neueGreps[a3]);
        b.push("");
    }
    if (uebersprungen.length) {
        b.push("Übersprungen, weil schon vorhanden (" + uebersprungen.length + "):");
        for (var a4 = 0; a4 < uebersprungen.length; a4++) b.push("   " + uebersprungen[a4]);
        b.push("");
    }
    if (fehler.length) {
        b.push("FEHLER (" + fehler.length + "):");
        for (var a5 = 0; a5 < fehler.length; a5++) b.push("   " + fehler[a5]);
        b.push("");
    }
    b.push("Rückgängig machen: einmal Strg+Z bzw. Cmd+Z.");

    alert(b.join("\n"));

  } catch (FEHLER) {
    alert("Das Skript ist abgebrochen.\n\n" +
          "Meldung: " + FEHLER.message + "\n" +
          "Zeile:   " + FEHLER.line + "\n" +
          "Datei:   " + FEHLER.fileName + "\n\n" +
          "Bitte diesen Text weitergeben.");
  }
})();
