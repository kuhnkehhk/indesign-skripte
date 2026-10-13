/*
    Tests: GREP-Stile einrichten
    ==================================================================
    Lauf:  node test-grep.js
    Prüft die Fassung, die in SKRIPT steht.
*/
const A = require('./indesign-attrappe');
const SKRIPT = process.env.SKRIPT || '../grep-stile/GREP-Stile_einrichten_v5.jsx';

const KYR = '[\\x{0400}-\\x{04FF}]+';
const ARA = '[\\x{0600}-\\x{06FF}\\x{FB50}-\\x{FEFF}]+';

function bau(opt) {
    opt = opt || {};
    const u = A.umgebung({
        zeichenformate: opt.zeichenformate || [['Schrift Kyrillisch', 'Arial']],
        absatzformate: ['Name'],
        dialog: {
            haken: Object.assign({
                'Vorhandene Zeichenformate': !!opt.aktualisieren,
                'Vorhandene GREP-Stile':     opt.grepKorrigieren !== false,
                '^Kyrillisch':               true,
                '^Arabisch':                 !!opt.arabisch
            }, opt.haken || {}),
            felder: { '.': opt.schrift || 'Source Han Sans' }
        }
    });
    // Alle übrigen Schriftsystem-Häkchen aus
    const altVor = u.dialog.vor;
    u.dialog.vor = (REG) => {
        REG.forEach(c => {
            if (c.type === 'checkbox' &&
                !/Vorhandene|^Kyrillisch|^Arabisch/.test(c.text)) c.value = false;
        });
        if (altVor) return altVor(REG);
    };
    if (opt.vorbereiten) opt.vorbereiten(u);
    return u;
}

function grepListe(u) {
    return u.absatzformate[0]._grep.map(g => ({
        a: g.grepExpression.slice(0, 12),
        f: g.appliedCharacterStyle ? g.appliedCharacterStyle.name : '[Ohne]'
    }));
}

console.log('GREP-Stile einrichten  –  ' + SKRIPT + '\n');

// ---------- 1. Neu anlegen ----------
console.log('Neue GREP-Stile bekommen ihr Zeichenformat');
{
    const u = bau({});
    A.laufen(SKRIPT, u);
    const l = grepListe(u);
    A.pruefe('ein GREP-Stil angelegt', l.length, 1);
    A.pruefe('Zeichenformat gesetzt (nicht [Ohne])', l[0] && l[0].f, 'Schrift Kyrillisch');
}

// ---------- 2. Zeichenformat aktualisieren ----------
console.log('\nVorhandene Zeichenformate aktualisieren');
{
    const u = bau({ aktualisieren: true, schrift: 'Source Han Sans' });
    A.laufen(SKRIPT, u);
    A.pruefe('Schrift wurde getauscht',
             String(u.zeichenformate[0].appliedFont), 'Source Han Sans');
}
{
    const u = bau({ aktualisieren: false, schrift: 'Source Han Sans' });
    A.laufen(SKRIPT, u);
    A.pruefe('ohne Häkchen unverändert',
             String(u.zeichenformate[0].appliedFont), 'Arial');
}
{
    const u = bau({ aktualisieren: true, schrift: 'FEHLT Sans' });
    A.laufen(SKRIPT, u);
    A.pruefe('nicht setzbare Schrift lässt das Format unberührt',
             String(u.zeichenformate[0].appliedFont), 'Arial');
}

// ---------- 3. Vorhandene GREP-Stile korrigieren ----------
console.log('\nVorhandene GREP-Stile prüfen und korrigieren');
{
    const u = bau({
        grepKorrigieren: true, arabisch: true,
        zeichenformate: [['Schrift Kyrillisch', 'Arial'], ['Schrift Arabisch', 'Adobe Arabic']],
        vorbereiten: (uu) => {
            const ps = uu.absatzformate[0];
            ps.nestedGrepStyles.add({ grepExpression: KYR });            // ohne Format
            const x = ps.nestedGrepStyles.add({ grepExpression: ARA });
            x.appliedCharacterStyle = 'Falsches Format';                  // falsches Format
        }
    });
    A.laufen(SKRIPT, u);
    const l = grepListe(u);
    A.pruefe('[Ohne] wurde ersetzt', l[0] && l[0].f, 'Schrift Kyrillisch');
    A.pruefe('falsches Format wurde ersetzt', l[1] && l[1].f, 'Schrift Arabisch');
    A.pruefe('keine Dubletten angelegt', l.length, 2);
}
{
    const u = bau({
        grepKorrigieren: false,
        vorbereiten: (uu) => { uu.absatzformate[0].nestedGrepStyles.add({ grepExpression: KYR }); }
    });
    A.laufen(SKRIPT, u);
    const l = grepListe(u);
    A.pruefe('ohne Häkchen bleibt [Ohne] stehen', l[0] && l[0].f, '[Ohne]');
    A.pruefe('und es wird nichts danebengelegt', l.length, 1);
}

// ---------- 3b. Schriftname lesbar machen ----------
console.log('\nSchriftname wird sauber gelesen, auch wenn keine gesetzt ist');
{
    const u = bau({ aktualisieren: true, schrift: 'Source Han Sans',
                    zeichenformate: [['Schrift Kyrillisch', null]] });
    A.laufen(SKRIPT, u);
    const txt = u.meldungen.join('\n') + '\n' + u.berichte.map(b => b.text).join('\n');
    A.pruefe('kein "undefined" in Meldung oder Bericht', /undefined/.test(txt), false);
    A.pruefe('Schrift trotzdem gesetzt',
             String(u.zeichenformate[0].appliedFont), 'Source Han Sans');
}

// ---------- 4. Zweiter Lauf ändert nichts ----------
console.log('\nZweiter Lauf ist folgenlos');
{
    const u = bau({ grepKorrigieren: true });
    A.laufen(SKRIPT, u);
    const nach1 = grepListe(u).length;
    A.laufen(SKRIPT, u);
    A.pruefe('Anzahl bleibt gleich', grepListe(u).length, nach1);
}

process.exit(A.bilanz() ? 0 : 1);
