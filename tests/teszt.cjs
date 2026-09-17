/**
 * A számolások tesztje.
 *
 * A böngészőnek szánt fájlokat ugyanúgy, LEFUTTATVA töltjük be, ahogy a lap is
 * teszi – így a teszt pontosan azt a kódot méri, ami a felhasználónál fut.
 *
 * Futtatás:  node tests/teszt.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

['beolvaso.js', 'elemzes.js', 'munkaigeny.js'].forEach(function (f) {
    eval(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'));
});

const B = globalThis.CegesBeolvaso;
const E = globalThis.CegesElemzes;
const M = globalThis.CegesMunkaigeny;

let hiba = 0;

function egyenlo(mit, kapott, vart) {
    if (kapott !== vart) {
        console.error('HIBA – ' + mit + ': kapott ' + JSON.stringify(kapott) + ', várt ' + JSON.stringify(vart));
        hiba++;
    }
}

function igaz(mit, allitas) {
    if (!allitas) {
        console.error('HIBA – ' + mit);
        hiba++;
    }
}

/**
 * Dátum HELYI nap szerint.
 *
 * Nem toISOString(): az UTC-re vált, és a helyi éjfél nyáron (UTC+2) az előző
 * napra csúszna vissza – a teszt hamisan bukna el.
 */
function napStr(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// --- beolvasás ---------------------------------------------------------------

const CSV = [
    'Üzleti év;Számlázási dátum;Vevőkód;Vevőnév;Megye;Cikkszám;Terméknév;Cikkcsoport;Értékesített mennyiség;Mértékegység;Nettó árbevétel;Pénznemkód;Fedezet/árrés Ft;Üzletkötőkód',
    '2025/2026;2026.05.10;V1;"Nagy Gazda Kft";HU-CSONG;C1;Lucerna vetőmag;LUCERNA;1 200;KG;8 000 000;HUF;1 440 000;LM',
    '2025/2026;2026.05.20;V1;"Nagy Gazda Kft";CSONGRÁD;C2;Őszi búza;ŐSZI BÚZA;800;KG;2 000 000;HUF;300 000;LM',
    '2025/2026;2026.09.01;V2;Kis Tanya Bt;BEKES;C1;Lucerna vetőmag;LUCERNA;50;ZS;180 000;HUF;20 000;TF',
    '2024/2025;2025.05.12;V3;Mentendő Major Kft;HU-BÉKÉS;C1;Lucerna vetőmag;LUCERNA;900;KG;7 000 000;HUF;1 200 000;TF',
    '2025/2026;2026.05.12;V3;Mentendő Major Kft;HU-BÉKÉS;C1;Lucerna vetőmag;LUCERNA;100;KG;900 000;HUF;150 000;TF',
].join('\n');

const beolvasott = B.csvBol(CSV);

egyenlo('beolvasott sorok', beolvasott.sorok.length, 5);
egyenlo('hiányzó oszlop nincs', B.hianyzoOszlopok(beolvasott.fejlec).length, 0);
egyenlo('dátum átalakítva', beolvasott.sorok[0].datum, '2026-05-10');
egyenlo('szám szóközzel', beolvasott.sorok[0].osszeg, 8000000);
egyenlo('idézőjeles mező', beolvasott.sorok[0].vevo, 'Nagy Gazda Kft');
egyenlo('HU- előtag levágva', beolvasott.sorok[0].megye, 'CSONGRÁD');
egyenlo('rövidítés feloldva', beolvasott.sorok[2].megye, 'BÉKÉS');
egyenlo('ékezet nélküli fejléc is jó', B.tomorit('Nettó árbevétel'), 'nettoarbevetel');
egyenlo('Excel-sorszám dátum', B.datum('45000'), '2023-03-15');

igaz('hiányzó oszlopot jelez', B.hianyzoOszlopok(['Üzleti év', 'Megye']).indexOf('Vevőnév') !== -1);

const SOROK = beolvasott.sorok;

// --- piac (belföld / export) -------------------------------------------------

{
    const fejlec = 'Üzleti év;Számlázási dátum;Vevőnév;Megye;Terméknév;Cikkcsoport;Értékesített mennyiség;Mértékegység;Nettó árbevétel;Pénznemkód;Fedezet/árrés Ft;Üzletkötőkód';
    const csv = [
        fejlec,
        '2025/2026;2026.05.10;Belföldi Kft;BÉKÉS;Lucerna;LUCERNA;100;KG;1 000 000;HUF;100 000;LM',
        '2025/2026;2026.05.11;Exportos Kft;BÉKÉS;Lucerna;LUCERNA;100;KG;2 000 000;EUR;200 000;LM',
    ].join('\n');
    const b = B.csvBol(csv);

    egyenlo('pénznem beolvasva', b.sorok[1].penznem, 'EUR');
    egyenlo('export szűrő', E.szur(b.sorok, { piac: 'export' }).length, 1);
    egyenlo('belföld szűrő', E.szur(b.sorok, { piac: 'hazai' }).length, 1);
    egyenlo('szűrő nélkül mind', E.szur(b.sorok, {}).length, 2);
    // Az EUR-os számla összege is forintban van – nem váltunk át.
    egyenlo('az export összege forintban marad', E.ertekesites(E.szur(b.sorok, { piac: 'export' })).ossz.netto, 2000000);
}

// --- üzleti évek havi lefutása ----------------------------------------------

{
    const e = E.evHavi(SOROK);
    egyenlo('két üzleti év', e.evek.join(','), '2024/2025,2025/2026');
    egyenlo('12 hónap címkéje', e.cimkek.length, 12);
    // A legkorábbi adat 2025. május, tehát a sor májussal kezdődik.
    egyenlo('az üzleti év a legkorábbi hónappal indul', e.cimkek[0], 'máj');
    egyenlo('minden évnek 12 hónapja van', e.adat['2025/2026'].length, 12);

    const osszes = e.evek.reduce(function (a, ev) {
        return a + e.adat[ev].reduce(function (x, y) { return x + y; }, 0);
    }, 0);
    egyenlo('a havi bontás összege a teljes árbevétel', osszes, E.ertekesites(SOROK).ossz.netto);
}

// --- értékesítés -------------------------------------------------------------

{
    const e = E.ertekesites(SOROK);
    egyenlo('vevők száma', e.ossz.vevo, 3);
    egyenlo('nettó összesen', e.ossz.netto, 18080000);
    // A zsákos sor mennyisége NEM adódik hozzá a kg-hoz.
    egyenlo('csak a kg-os sorok', e.ossz.kg, 1200 + 800 + 900 + 100);

    const bekes = e.megyek.filter(function (m) { return m.megye === 'BÉKÉS'; })[0];
    igaz('Békés egy sorban van (a két alak összeolvadt)', !!bekes);
    egyenlo('Békés forgalma', bekes.netto, 180000 + 7000000 + 900000);
}

// --- szűrés ------------------------------------------------------------------

{
    egyenlo('év szűrő', E.szur(SOROK, { ev: '2024/2025' }).length, 1);
    egyenlo('megye szűrő', E.szur(SOROK, { megye: 'CSONGRÁD' }).length, 2);
    egyenlo('keresés vevőnévre', E.szur(SOROK, { q: 'mentendő' }).length, 2);
    egyenlo('cikkcsoport szűrő', E.szur(SOROK, { cikkcsoport: 'ŐSZI BÚZA' }).length, 1);

    const v = E.valaszthato(SOROK);
    egyenlo('választható megyék', v.megyek.join(','), 'BÉKÉS,CSONGRÁD');
    egyenlo('választható évek', v.evek.join(','), '2024/2025,2025/2026');
}

// --- vevőelemzés -------------------------------------------------------------

{
    const v = E.vevok(SOROK);
    egyenlo('vevőnként összevonva', v.length, 3);
    egyenlo('a legnagyobb elöl', v[0].vevo, 'Nagy Gazda Kft');
    egyenlo('két sor összeadva', v[0].netto, 10000000);
    egyenlo('két külön nap = két alkalom', v[0].alkalmak, 2);
    egyenlo('cikkcsoportok', v[0].csoportLista.length, 2);
}

// --- besorolás ---------------------------------------------------------------

{
    const b = E.besorolas(SOROK, {}, { platinaFt: 5000000, kozel: 70 });
    egyenlo('bázisév az utolsó', b.ev, '2025/2026');
    egyenlo('10 M = platinalistás', b.besorolasok['Nagy Gazda Kft'], 'platina');
    egyenlo('tavaly 7 M, most 0,9 M = mentendő', b.besorolasok['Mentendő Major Kft'], 'mentendo');
    egyenlo('180 e = mikro', b.besorolasok['Kis Tanya Bt'], 'mikro');
    egyenlo('platina darab', b.szamlalo.platina, 1);
    egyenlo('mentendő darab', b.szamlalo.mentendo, 1);

    // Átírt szint: 500 e-nél a mentendő már platinalistás lesz.
    const b2 = E.besorolas(SOROK, {}, { platinaFt: 500000, kozel: 70 });
    egyenlo('átírt szinttel platina', b2.besorolasok['Mentendő Major Kft'], 'platina');

    // Potenciális: a szint 70%-a fölött, de sosem érte el.
    const b3 = E.besorolas(SOROK, {}, { platinaFt: 250000, kozel: 70 });
    egyenlo('180 e a 250 e 72%-a = potenciális', b3.besorolasok['Kis Tanya Bt'], 'potencialis');
}

// --- előrejelzés -------------------------------------------------------------

{
    const p = E.elorejelzes(SOROK, 0);
    igaz('van előrejelzés', p.van);
    egyenlo('12 hónap', p.honapok.length, 12);
    // Az utolsó adatos hónap 2026-09, tehát a következő hónap 2026-10.
    egyenlo('első előrejelzett hónap', p.honapok[0].kulcs, '2026-10');
    // A zsákos sor nem számít bele, a kg-os májusiak igen: a 2027-05 a 2026-05 bázisa.
    // 2026 májusában 1200 kg lucerna + 800 kg őszi búza + 100 kg lucerna fogyott.
    const majus = p.honapok.filter(function (h) { return h.kulcs === '2027-05'; })[0];
    egyenlo('2027 májusának bázisa', majus.bazisKulcs, '2026-05');
    egyenlo('májusi mennyiség', p.ossz['2027-05'], 1200 + 800 + 100);

    const p2 = E.elorejelzes(SOROK, 10);
    egyenlo('+10% korrekció', p2.ossz['2027-05'], Math.round(1200 * 1.1) + Math.round(800 * 1.1) + Math.round(100 * 1.1));
}

// --- tervező -----------------------------------------------------------------

{
    const t = E.tervezo(SOROK, { hivasNap: 30, latogatasNap: 14, pareto: 70 }, '2026-09-17');
    igaz('van terv', t.van);
    egyenlo('vevők', t.osszegzes.vevo, 3);

    // A 05.10 és 05.20 vásárlás 10 napra van egymástól: EGY alkalom.
    const nagy = t.sorok.filter(function (s) { return s.vevo === 'Nagy Gazda Kft'; });
    egyenlo('a közeli vásárlások egy alkalom', nagy.length, 1);

    // Hívás a következő évforduló (2027-05-10) előtt 30 nappal.
    egyenlo('hívás napja', napStr(nagy[0].hivas), '2027-04-10');
    igaz('a legnagyobb vevőt látogatjuk is', nagy[0].latogatas !== null);
    egyenlo('látogatás napja', napStr(nagy[0].latogatas), '2027-04-26');

    const kicsi = t.sorok.filter(function (s) { return s.vevo === 'Kis Tanya Bt'; })[0];
    egyenlo('a kis vevőt csak hívjuk', kicsi.latogatas, null);
}

// --- időzítés: fajonkénti és soronkénti felülírás, keret, hétvége ------------

{
    const t = E.tervezo(SOROK, {}, '2026-09-17');
    const lista = E.idozit(t, {}, {}, {}, '2026-09-17');

    egyenlo('minden megkeresés bekerül', lista.filter(function (s) { return s.hivasBe; }).length, lista.length);

    const nagy = lista.filter(function (s) { return s.vevo === 'Nagy Gazda Kft'; })[0];
    igaz('a nagy vevőt látogatjuk is', nagy.latogatasBe);
    egyenlo('a fő cikkcsoport dönti el a csoportot', nagy.faj, 'LUCERNA');

    lista.forEach(function (s) {
        igaz('hívás nem hétvégére esik (' + s.vevo + ')', s.hivasDatum.getDay() !== 0 && s.hivasDatum.getDay() !== 6);
    });

    const kicsi = lista.filter(function (s) { return s.vevo === 'Kis Tanya Bt'; })[0];
    igaz('a kis vevőt alapból nem látogatjuk', !kicsi.latogatasBe);
}

// Fajonkénti nap: 0 nappal az évforduló előtt → későbbi dátum, mint 30 nappal.
{
    const t = E.tervezo(SOROK, {}, '2026-09-17');
    const alap = E.idozit(t, {}, {}, {}, '2026-09-17').filter(function (s) { return s.faj === 'LUCERNA'; })[0];
    const kesobb = E.idozit(t, {}, { LUCERNA: { hivas: 0 } }, {}, '2026-09-17').filter(function (s) { return s.faj === 'LUCERNA'; })[0];

    egyenlo('a faj nap-beállítása érvényesül', kesobb.hivasNap, 0);
    igaz('0 nappal később van, mint 30 nappal', kesobb.hivasDatum > alap.hivasDatum);
    // A „saját érték” jelölés a SORÉ: különben nem lehetne megkülönböztetni az
    // egyedileg átírt sort attól, amelyik csak a faj beállítását örökli. A faj
    // saját jelölést a csoport fejlécében kap.
    igaz('a sor nem számít egyedileg átírtnak', !kesobb.hivasSajat);
}

// Soronkénti kikapcsolás és kézi dátum.
{
    const t = E.tervezo(SOROK, {}, '2026-09-17');
    const elso = E.idozit(t, {}, {}, {}, '2026-09-17')[0];

    const egy = {};
    egy[elso.kulcs] = { hivasBe: false, latogatasDatum: '2027-03-01' };
    const ujra = E.idozit(t, {}, {}, egy, '2026-09-17').filter(function (s) { return s.kulcs === elso.kulcs; })[0];

    igaz('a hívás kikapcsolható', !ujra.hivasBe);
    igaz('a kézi dátum saját értékként jelenik meg', ujra.latogatasSajat);
    igaz('a kézi dátum érvényesül', napStr(ujra.latogatasDatum) >= '2027-03-01');
}

// Napi keret: egy napra egy hívás – a többi a következő munkanapra csúszik.
{
    const t = E.tervezo(SOROK, {}, '2026-09-17');
    const lista = E.idozit(t, { hivasMax: 1 }, {}, {}, '2026-09-17');
    const napok = {};
    lista.filter(function (s) { return s.hivasBe; }).forEach(function (s) {
        const k = napStr(s.hivasDatum);
        napok[k] = (napok[k] || 0) + 1;
    });
    const tulsok = Object.keys(napok).filter(function (k) { return napok[k] > 1; });
    egyenlo('egy napra legfeljebb egy hívás', tulsok.length, 0);
}

// Csoportosítás cikkcsoportonként.
{
    const t = E.tervezo(SOROK, {}, '2026-09-17');
    const csoportok = E.csoportosit(E.idozit(t, {}, {}, {}, '2026-09-17'));
    igaz('van csoport', csoportok.length > 0);
    const ossz = csoportok.reduce(function (a, c) { return a + c.sorok.length; }, 0);
    egyenlo('minden sor bekerül valamelyik csoportba', ossz, E.idozit(t, {}, {}, {}, '2026-09-17').length);
}

// --- megyenapok --------------------------------------------------------------

{
    const t = E.tervezo(SOROK, {}, '2026-09-17');
    const alap = E.idozit(t, {}, {}, {}, '2026-09-17');

    // Békés megye a HÉTFŐI nap: a békési látogatások hétfőre kerülnek.
    const b = { megyeNapBe: true, megyeNapok: { 1: ['BÉKÉS'] } };
    const megyes = E.idozit(t, b, {}, {}, '2026-09-17');

    megyes.filter(function (s) { return s.megye === 'BÉKÉS' && s.latogatasBe; }).forEach(function (s) {
        egyenlo('a békési látogatás hétfőre kerül (' + s.vevo + ')', s.latogatasDatum.getDay(), 1);
        igaz('meg is jelöljük', s.latogatasMegyenap === true);
    });

    // A hívás alapból marad a helyén; csak ha kérjük, megy a megye napjára.
    const csakLat = megyes.filter(function (s) { return s.megye === 'BÉKÉS'; })[0];
    const alapSor = alap.filter(function (s) { return s.kulcs === csakLat.kulcs; })[0];
    egyenlo('a hívás nem mozdul', napStr(csakLat.hivasDatum), napStr(alapSor.hivasDatum));

    const hivassalIs = E.idozit(t, { megyeNapBe: true, megyeNapHivas: true, megyeNapok: { 1: ['BÉKÉS'] } }, {}, {}, '2026-09-17');
    hivassalIs.filter(function (s) { return s.megye === 'BÉKÉS'; }).forEach(function (s) {
        egyenlo('kérésre a hívás is hétfőre kerül', s.hivasDatum.getDay(), 1);
    });

    // Megye nélküli nap: akinek a megyéje nincs kijelölve, marad a helyén.
    const csongradi = megyes.filter(function (s) { return s.megye === 'CSONGRÁD'; })[0];
    const csongradiAlap = alap.filter(function (s) { return s.kulcs === csongradi.kulcs; })[0];
    egyenlo('nap nélküli megye marad', napStr(csongradi.latogatasDatum), napStr(csongradiAlap.latogatasDatum));

    // A megyelista forgalom szerint jön.
    const lista = E.megyek(alap);
    igaz('van megyelista', lista.length > 0);
    igaz('csökkenő sorrend', lista.every(function (m, i) { return i === 0 || lista[i - 1].db >= m.db; }));
}

// --- naptár feltöltése -------------------------------------------------------

{
    const t = E.tervezo(SOROK, {}, '2026-09-17');
    const lista = E.idozit(t, {}, {}, {}, '2026-09-17');

    egyenlo('célszám nélkül nincs feltöltés', E.feltolt(lista, SOROK, {}, '2026-09-17').length, 0);

    // Napi 3 hívás célszámmal a szabad helyekre jelöltek kerülnek.
    const elso = lista.filter(function (s) { return s.hivasBe; })
        .sort(function (a, b) { return a.hivasDatum - b.hivasDatum; })[0];
    const tol = napStr(elso.hivasDatum);
    const ig = napStr(new Date(elso.hivasDatum.getFullYear(), elso.hivasDatum.getMonth(), elso.hivasDatum.getDate() + 10));

    const jeloltek = E.feltolt(lista, SOROK, { napiHivas: 3, tol: tol, ig: ig }, '2026-09-17');
    igaz('lettek jelöltek', jeloltek.length > 0);

    jeloltek.forEach(function (j) {
        igaz('a jelölt nem hétvégére kerül', j.datum.getDay() !== 0 && j.datum.getDay() !== 6);
        igaz('a jelöltnek van indoklása', String(j.ok).indexOf('feltöltés') === 0);
        igaz('a jelölt valódi vevő', ['Nagy Gazda Kft', 'Kis Tanya Bt', 'Mentendő Major Kft'].indexOf(j.vevo) !== -1);
    });

    // Ugyanazt a vevőt nem tesszük be kétszer – sem összesen, sem egy napon
    // belül. (Aki több cikkcsoportból vett, az többször került a listába.)
    const nevek = jeloltek.map(function (j) { return j.vevo; });
    egyenlo('egy vevő csak egyszer jelölt', nevek.length, new Set(nevek).size);

    const naponta = {};
    jeloltek.forEach(function (j) {
        const k = napStr(j.datum);
        naponta[k] = naponta[k] || [];
        naponta[k].push(j.vevo);
    });
    Object.keys(naponta).forEach(function (k) {
        egyenlo('egy napon nincs ismétlődő jelölt (' + k + ')', naponta[k].length, new Set(naponta[k]).size);
    });
}

// --- naptár és éves nézet ----------------------------------------------------

{
    const t = E.tervezo(SOROK, {}, '2026-09-17');
    const lista = E.idozit(t, {}, {}, {}, '2026-09-17');

    const naptar = E.naptarAdat(lista);
    const napokDb = Object.keys(naptar.napok).reduce(function (a, k) {
        return a + naptar.napok[k].hivas.length + naptar.napok[k].latogatas.length;
    }, 0);
    const varhato = lista.filter(function (s) { return s.hivasBe; }).length
        + lista.filter(function (s) { return s.latogatasBe; }).length;
    egyenlo('minden bekapcsolt tétel bekerül a naptárba', napokDb, varhato);
    igaz('a hónapok rendezve jönnek', naptar.honapok.join(',') === naptar.honapok.slice().sort().join(','));

    // A kikapcsolt tétel a naptárban sem foglal helyet.
    const egy = {};
    egy[lista[0].kulcs] = { hivasBe: false, latogatasBe: false };
    const szukitett = E.naptarAdat(E.idozit(t, {}, {}, egy, '2026-09-17'));
    const ujDb = Object.keys(szukitett.napok).reduce(function (a, k) {
        return a + szukitett.napok[k].hivas.length + szukitett.napok[k].latogatas.length;
    }, 0);
    igaz('a kikapcsolt tétel kimarad a naptárból', ujDb < napokDb);

    const eves = E.evesAdat(lista);
    igaz('van éves sor', eves.sorok.length > 0);
    const evesDb = eves.honapok.reduce(function (a, h) { return a + eves.ossz[h].hivas + eves.ossz[h].latogatas; }, 0);
    egyenlo('az éves nézet ugyanannyi tételt számol', evesDb, varhato);
    const soroszzeg = eves.sorok.reduce(function (a, s) { return a + s.ossz.hivas + s.ossz.latogatas; }, 0);
    egyenlo('a sorok összege megegyezik a havi összeggel', soroszzeg, evesDb);
}

// --- munkaigény (a lapon használt bemenettel) --------------------------------

{
    const t = E.tervezo(SOROK, {}, '2026-09-17');
    const adat = E.munkaigenyAdat(SOROK, { cel: 20000000, bazisFt: 0, tol: '2026-10-01', ig: '2026-12-31' }, t, '2026-09-17');

    egyenlo('a motor a vevőket kapja', adat.vevok.length, 3);
    egyenlo('ami már a listán van', adat.tervben.partner.hivas, t.osszegzes.alkalom);

    const e = M.szamol(adat, {});
    egyenlo('munkanapok', e.napok, 66);
    igaz('kell vevő a célhoz', e.mind.vevo > 0);
    igaz('kell hívás a célhoz', e.mind.hiv > 0);
}

if (hiba > 0) {
    console.error(hiba + ' hibás eset.');
    process.exit(1);
}
console.log('OK – minden eset rendben.');
