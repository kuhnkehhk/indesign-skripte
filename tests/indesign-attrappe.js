/*
    InDesign-Attrappe für Node
    ==================================================================
    Bildet so viel vom InDesign-Objektmodell nach, dass die
    ExtendScript-Werkzeuge aus diesem Ordner ohne InDesign laufen.

    SIE BILDET AUCH DIE MACKEN NACH, nicht nur das Verhalten laut
    Dokumentation. Das ist der Zweck: Ein Test, der nur die heile Welt
    nachstellt, findet genau die Fehler nicht, die uns Zeit gekostet
    haben.

    Nachgebildete Macken:
      - nestedGrepStyles.add() ignoriert appliedCharacterStyle aus dem
        Eigenschaftsobjekt
      - File.open() erkennt ein BOM, setzt die Kodierung um und
        verschluckt das BOM
      - Dateisystem wahlweise mit oder ohne Beachtung der
        Groß-/Kleinschreibung

    Verwendung:
        const A = require('./indesign-attrappe');
        const umg = A.umgebung({ ... });
        A.laufen('../GREP-Stile_einrichten_v4.jsx', umg);

    Heike Kuhnke · kuhnke-owl.de
*/

const fs   = require('fs');
const path = require('path');

// ================= Dateisystem =================
function machFile(gross, berichte) {   // gross = true -> Groß/Klein wird beachtet
    function FileX(p) {
        const self = this;
        this.p = String(p).replace(/^file:\/\//, '');
        this.name     = path.basename(this.p);
        this.fsName   = this.p;
        this.fullName = this.p;

        Object.defineProperty(this, 'exists', { get: function () {
            try { return fs.statSync(self.p).isFile(); }
            catch (e) {
                if (gross) return false;
                try {
                    const d = path.dirname(self.p);
                    const b = path.basename(self.p).toLowerCase();
                    return fs.readdirSync(d).some(n => n.toLowerCase() === b);
                } catch (e2) { return false; }
            }
        }});
        Object.defineProperty(this, 'length', { get: function () {
            try { return fs.statSync(self.p).size; } catch (e) { return 0; }
        }});
        Object.defineProperty(this, 'parent', { get: function () {
            return new FileX(path.dirname(self.p));
        }});

        let buf = null, pos = 0, enc = null, modus = null, puffer = [];
        Object.defineProperty(this, 'encoding', {
            get: () => enc, set: v => { enc = v; }
        });

        this.open = function (m) {
            modus = m || 'r';
            if (modus === 'w') { puffer = []; return true; }
            try { buf = fs.readFileSync(self.p); } catch (e) { return false; }
            pos = 0;
            // MACKE: open() schnüffelt nach einem BOM und verschluckt es
            if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) { enc = 'UTF-16'; pos = 2; }
            else if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) { enc = 'UTF-8'; pos = 3; }
            return true;
        };
        this.seek    = function () {};
        this.execute = function () {};
        this.read = function (n) {
            if (enc === 'BINARY') {
                const b = buf.slice(pos, n ? Math.min(pos + n, buf.length) : buf.length);
                let s = '';
                for (let k = 0; k < b.length; k++) s += String.fromCharCode(b[k]);
                return s;
            }
            const e2 = enc === 'UTF-16' ? 'utf16le' : (enc === 'windows-1252' ? 'latin1' : 'utf8');
            const t = buf.slice(pos).toString(e2);
            return n ? t.slice(0, n) : t;
        };
        this.write = function (s) { puffer.push(s); };
        this.close = function () {
            if (modus !== 'w') return;
            const s = puffer.join('');
            if (berichte) berichte.push({ pfad: self.p, text: s });   // für die Tests
            let b;
            if (enc === 'BINARY') {
                b = Buffer.alloc(s.length);
                for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xFF;
            } else b = Buffer.from(s, 'utf8');
            fs.writeFileSync(self.p, b);
        };
    }
    FileX.openDialog = () => null;
    return FileX;
}

function machFolder(FileX) {
    function Folder(p) { this.p = p; }
    Folder.selectDialog = () => null;
    Folder.prototype.selectDlg = () => null;
    Object.defineProperty(Folder.prototype, 'exists', { get: function () {
        try { return fs.statSync(String(this.p).replace(/^file:\/\//, '')).isDirectory(); }
        catch (e) { return false; }
    }});
    Folder.prototype.getFiles = function () {
        const d = String(this.p).replace(/^file:\/\//, '');
        let es;
        try { es = fs.readdirSync(d); } catch (e) { return []; }
        return es.map(n => {
            const voll = path.join(d, n);
            let st; try { st = fs.statSync(voll); } catch (e) { return null; }
            return st.isDirectory() ? new Folder(voll) : new FileX(voll);
        }).filter(Boolean);
    };
    Folder.desktop = '/tmp';
    return Folder;
}

// ================= Formate =================
function Font(f) { this.fontFamily = f; this.toString = () => f; }

function Zeichenformat(name, schrift) {
    this.name = name; this.isValid = true;
    // MACKE: appliedFont liefert nicht immer ein Objekt mit fontFamily.
    // Mit schrift === null wird der Fall nachgestellt, in dem nur .name
    // da ist ("Arial\tRegular") – fontFamily ist dann undefined.
    let _f = schrift ? new Font(schrift) : { name: 'Minion Pro\tRegular' };
    Object.defineProperty(this, 'appliedFont', {
        get: () => _f,
        set: v => {
            if (String(v).indexOf('FEHLT') > -1) throw new Error('Schrift nicht verfügbar');
            _f = new Font(String(v));
        }
    });
}

function Sammlung(arr) {
    this.arr = arr; this.length = arr.length;
    this.itemByName = n => arr.find(x => x.name === n) || { isValid: false };
    this.add = o => { const c = new Zeichenformat(o.name, ''); arr.push(c); this.length = arr.length; return c; };
}

function GrepStil(ausdruck) {
    this.grepExpression = ausdruck;
    let _cs = null;
    Object.defineProperty(this, 'appliedCharacterStyle', {
        get: () => _cs,
        set: v => {
            if (v === null || v === undefined) return;
            _cs = (typeof v === 'string') ? { name: v } : v;
        }
    });
}

let PSID = 100;
function Absatzformat(n) {
    this.name = n; this.id = ++PSID;
    const g = [];
    const slg = {
        length: 0,
        add: function (o) {
            // MACKE: appliedCharacterStyle aus dem Eigenschaftsobjekt wird ignoriert
            const x = new GrepStil(o.grepExpression);
            g.push(x); slg.length = g.length; return x;
        }
    };
    for (let q = 0; q < 40; q++) {
        ((i) => Object.defineProperty(slg, i, { get: () => g[i] }))(q);
    }
    this.nestedGrepStyles = slg;
    this._grep = g;
}

// ================= Umgebung bauen =================
function umgebung(opt) {
    opt = opt || {};
    const berichte = [];
    const FileX  = machFile(!!opt.grossKleinBeachten, berichte);
    const Folder = machFolder(FileX);

    const zeichenformate = (opt.zeichenformate || []).map(z => new Zeichenformat(z[0], z[1]));
    const absatzformate  = (opt.absatzformate  || ['Name']).map(n => new Absatzformat(n));
    const keins = { id: 1, name: '[Kein Absatzformat]' };

    const meldungen = [];
    const u = {
        FileX, Folder, meldungen, berichte,
        zeichenformate, absatzformate,
        os: opt.os || 'Windows 10/64',
        dialog: opt.dialog || {},
        app: {
            documents: { length: 1 },
            version: opt.version || '21.6',
            name: 'Adobe InDesign',
            doScript: f => f(),
            activeDocument: {
                name: opt.dokument || 'test.indd',
                saved: !!opt.gespeichert,
                fullName: opt.dokumentPfad ? new FileX(opt.dokumentPfad) : null,
                characterStyles: new Sammlung(zeichenformate),
                allParagraphStyles: [keins].concat(absatzformate),
                paragraphStyles: [keins],
                dataMergeProperties: opt.dataMergeProperties || {},
                links: opt.links || []
            }
        }
    };
    return u;
}

// ================= Skript ausführen =================
function laufen(skriptPfad, u) {
    const voll = path.resolve(__dirname, skriptPfad);
    const src  = fs.readFileSync(voll, 'utf8').replace('#target indesign', '');

    global.$      = { os: u.os };
    global.alert  = t => u.meldungen.push(String(t));
    global.confirm = () => true;
    global.decodeURI = s => String(s);
    global.File   = u.FileX;
    global.Folder = u.Folder;
    global.app    = u.app;
    global.UndoModes      = { ENTIRE_SCRIPT: 1 };
    global.ScriptLanguage = { JAVASCRIPT: 1 };

    const REG = [];
    function Ctl(t, txt) {
        const self = this;
        this.type = t; this.text = txt || ''; this.value = false; this.enabled = true;
        this.preferredSize = {}; this.children = []; this.items = []; this.selection = null;
        this.alignChildren = ''; this.margins = 0; this.spacing = 0; this.alignment = '';
        this.characters = 0; this.indent = 0; this.helpTip = '';
        this.add = function (t2, un, tx, o) {
            if (t2 === 'item') {
                const it = { text: tx !== undefined ? tx : un, index: self.items.length,
                             subItems: Array.from({length: 8}, () => ({ text: '' })) };
                self.items.push(it); return it;
            }
            const c = new Ctl(t2, tx);
            if (t2 === 'listbox' && Array.isArray(tx))
                c.items = tx.map((n, i) => ({ text: n, index: i }));
            self.children.push(c); REG.push(c); return c;
        };
    }
    global.Window = function (kind, titel) {
        const self = this;
        this.children = []; this.text = titel; this.orientation = '';
        this.alignChildren = ''; this.margins = 0; this.spacing = 0;
        this.close = () => {};
        this.add = function (t, un, tx, o) {
            const c = new Ctl(t, tx);
            if (t === 'listbox' && Array.isArray(tx))
                c.items = tx.map((n, i) => ({ text: n, index: i }));
            self.children.push(c); REG.push(c); return c;
        };
        this.show = function () {
            const d = u.dialog;
            if (typeof d.vor === 'function') { const r = d.vor(REG, titel); if (r === 2) return 2; }
            REG.forEach(c => {
                if (c.type === 'listbox' && c.items.length && d.allesWaehlen !== false)
                    c.selection = c.items;
                if (c.type === 'checkbox' && d.haken)
                    for (const muster in d.haken)
                        if (new RegExp(muster).test(c.text)) c.value = d.haken[muster];
                if (c.type === 'radiobutton' && d.radio)
                    for (const muster in d.radio)
                        if (new RegExp(muster).test(c.text)) c.value = d.radio[muster];
                if (c.type === 'edittext' && d.felder)
                    for (const muster in d.felder)
                        if (new RegExp(muster).test(c.text)) c.text = d.felder[muster];
            });
            if (typeof d.nach === 'function') d.nach(REG, titel);
            return d.abbrechen ? 2 : 1;
        };
    };

    eval(src);
    return u;
}

// ================= Kleine Prüfhilfen =================
let gut = 0, schlecht = 0;
function pruefe(titel, ist, soll) {
    const ok = JSON.stringify(ist) === JSON.stringify(soll);
    if (ok) { gut++;      console.log('  ok    ' + titel); }
    else    { schlecht++; console.log('  FEHLT ' + titel + '\n          erwartet: ' + JSON.stringify(soll) +
                                      '\n          bekommen: ' + JSON.stringify(ist)); }
    return ok;
}
function bilanz() {
    console.log('\n' + gut + ' ok, ' + schlecht + ' fehlgeschlagen');
    return schlecht === 0;
}

module.exports = { umgebung, laufen, pruefe, bilanz, Zeichenformat, Absatzformat };
