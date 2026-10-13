/*
    Alle Tests nacheinander
    ==================================================================
    Lauf:  node alle.js
    Rückgabewert 0 = alles grün, 1 = mindestens ein Test fehlgeschlagen.
*/
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const tests = fs.readdirSync(__dirname)
    .filter(n => /^test-.*\.js$/.test(n))
    .sort();

let fehler = 0;
for (const t of tests) {
    console.log('\n' + '='.repeat(60));
    console.log(t);
    console.log('='.repeat(60));
    try {
        const aus = execFileSync(process.execPath, [path.join(__dirname, t)], { encoding: 'utf8' });
        process.stdout.write(aus);
    } catch (e) {
        if (e.stdout) process.stdout.write(e.stdout);
        if (e.stderr) process.stderr.write(e.stderr);
        fehler++;
    }
}

console.log('\n' + '='.repeat(60));
console.log(fehler === 0
    ? 'Alle Testdateien grün.'
    : fehler + ' Testdatei(en) mit Fehlern.');
process.exit(fehler === 0 ? 0 : 1);
