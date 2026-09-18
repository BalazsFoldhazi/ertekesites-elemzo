/**
 * Értékesítés-elemző – a felület.
 *
 * Betölti a fájlt (CSV vagy XLSX), szűr, és kirajzolja a négy nézetet. Minden
 * itt, a böngészőben történik: a fájl nem megy sehova.
 */
(function () {
    'use strict';

    var B = window.CegesBeolvaso;
    var E = window.CegesElemzes;
    var M = window.CegesMunkaigeny;
    var TAR = 'ceges_elemzo_v1';
    var LISTA_MAX = 300;

    var A = {
        sorok: [],
        forras: '',
        szuro: { ev: '', megye: '', uzletkoto: '', cikkcsoport: '', piac: '', q: '' },
        // Betöltéskor eldöntött kezelés: mínuszos sorok és euróban jelölt tételek.
        dontes: { negativ: 'valtozatlan', eur: 'marad', arfolyam: 0, fedezet: 'igen' },
        nezet: 'ertekesites',
        korrekcio: 0,
        besorolas: { platinaFt: 5000000, kozel: 70, szuro: '' },
        terv: { cel: 300000000, tol: '', ig: '' },
        tervB: { hivasNap: 30, latogatasNap: 14, pareto: 70, hivasMax: 15, latogatasMax: 3 },
        // Fajonkénti nap-eltolás és soronkénti kézi módosítás (nap, dátum, ki-be).
        tervCsoport: {},
        tervEgyeni: {},
        tervSzuro: { q: '', csakLatogatando: false },
        tervCsoportosit: true,
        tervNezet: 'lista',
        naptarHonap: null,
        // Értékesítési terv (terméktervező): bázis és a ráhangolt százalékok.
        tervTerv: {
            bazisEv: '', bazisTol: 1, bazisIg: 12,
            mennySzaz: 0, arSzaz: 0,
            tetelek: {}, csoportok: {},
            csakFajok: false, beemelve: false,
        },
        // Éves rács: sorok, kártyák és az egyszerre látszó hónapok száma.
        evesSorMod: 'megye',
        evesKartya: 'faj',
        evesHonapDb: 12,
        evesTol: null,
        // Megyenapok: melyik hétköznap melyik megyékbe megyünk.
        megyeNap: { be: false, hivas: true, napok: {} },
        // Naptár feltöltése: napi célszám és a kiosztott jelöltek.
        feltoltes: { napiHivas: 0, tol: '', ig: '' },
        jeloltek: [],
        mi: { hatarok: {}, meretArany: { partner: {}, piaci: {} }, atlag: { partner: {}, piaci: {} }, napi: {}, partnerArany: null },
    };

    // --- segédek -----------------------------------------------------------

    function $(id) { return document.getElementById(id); }

    function el(tag, osztaly, szoveg) {
        var e = document.createElement(tag);
        if (osztaly) e.className = osztaly;
        if (szoveg !== undefined && szoveg !== null) e.textContent = szoveg;
        return e;
    }

    function szam(n, t) {
        t = t || 0;
        return new Intl.NumberFormat('hu-HU', { minimumFractionDigits: t, maximumFractionDigits: t }).format(Number(n) || 0);
    }

    function rovidFt(n) {
        n = Number(n) || 0;
        return n >= 1e6 ? szam(n / 1e6, 1) + ' M' : (n >= 1e4 ? szam(n / 1e3) + ' e' : szam(n));
    }

    function szamBe(v) {
        var s = String(v).replace(/[\s ]/g, '').replace(',', '.');
        if (s === '') return null;
        var n = Number(s);
        return isFinite(n) ? n : null;
    }

    function datumCimke(d) {
        if (!d) return '—';
        var x = typeof d === 'string' ? d.split('-') : null;
        if (x) return x[0] + '. ' + x[1] + '. ' + x[2] + '.';
        return d.getFullYear() + '. ' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '. '
            + (d.getDate() < 10 ? '0' : '') + d.getDate() + '.';
    }

    function maStr() {
        var d = new Date();
        return d.getFullYear() + '-' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-' + (d.getDate() < 10 ? '0' : '') + d.getDate();
    }

    /** Tábla felépítése: fejléc + sorok. A cella lehet szöveg vagy {sz:…, alcim:…}. */
    function tabla(cel, fejlec, sorok) {
        cel.textContent = '';
        if (fejlec && fejlec.length) {
            var thead = el('thead');
            var tr = el('tr');
            fejlec.forEach(function (f) {
                var szoveg = typeof f === 'string' ? f : f.szoveg;
                var th = el('th', (typeof f === 'object' && f.szam) ? 'szam' : '', szoveg);
                tr.append(th);
            });
            thead.append(tr);
            cel.append(thead);
        }
        var tbody = el('tbody');
        (sorok || []).forEach(function (s) {
            var cellak = s.cellak || s;
            var tr2 = el('tr', s.osztaly || '');
            cellak.forEach(function (c) {
                if (c && c.nodeType === 1) { tr2.append(c); return; }
                var o = (c && typeof c === 'object') ? c : { szoveg: c };
                var td = el('td', (o.szam ? 'szam' : '') + (o.tobbsoros ? ' tobbsoros' : ''), o.szoveg === undefined ? c : o.szoveg);
                if (o.alcim) td.append(el('span', 'alcim', o.alcim));
                if (o.jelveny) {
                    td.append(document.createElement('br'));
                    td.append(el('span', 'jelveny ' + o.jelveny.tipus, o.jelveny.szoveg));
                }
                tr2.append(td);
            });
            tbody.append(tr2);
        });
        cel.append(tbody);
    }

    // --- betöltés ----------------------------------------------------------

    function allapot(szoveg, hiba) {
        var e = $('allapot');
        e.textContent = szoveg;
        e.className = 'allapot' + (hiba ? ' hiba' : '');
        e.hidden = !szoveg;
    }

    function betolt(sorok, forras) {
        A.sorok = sorok;
        A.forras = forras;
        ment();
        indul();
        // Ha van adat, a betöltő összecsukódik – egy kattintással kinyitható.
        $('betoltoDoboz').open = !sorok.length;
    }

    /** A becsukott betöltő fejléce: mi van betöltve. */
    function betoltoFejlec() {
        var s = $('betoltoOsszegzes');
        if (!A.sorok.length) {
            s.textContent = 'Adat betöltése';
            return;
        }
        s.textContent = '';
        s.append(el('strong', '', szam(A.sorok.length) + ' sor'));
        s.append(document.createTextNode(
            (A.forras ? ' · ' + A.forras : '') + ' — kattints ide másik fájl betöltéséhez'));
    }

    function ment() {
        try {
            localStorage.setItem(TAR, JSON.stringify({
                sorok: A.sorok, forras: A.forras, szuro: A.szuro, besorolas: A.besorolas,
                terv: A.terv, tervB: A.tervB, mi: A.mi, korrekcio: A.korrekcio,
                dontes: A.dontes,
                tervCsoport: A.tervCsoport, tervEgyeni: A.tervEgyeni, tervSzuro: A.tervSzuro,
                tervCsoportosit: A.tervCsoportosit, tervNezet: A.tervNezet, naptarHonap: A.naptarHonap,
                evesSorMod: A.evesSorMod, evesKartya: A.evesKartya, evesHonapDb: A.evesHonapDb, evesTol: A.evesTol,
                tervTerv: A.tervTerv,
                nezet: A.nezet, megyeNap: A.megyeNap, feltoltes: A.feltoltes, jeloltek: A.jeloltek,
            }));
        } catch (e) {
            // Tele a tár vagy privát ablak: a lap ettől még működik, csak nem emlékszik.
        }
    }

    function visszatolt() {
        try {
            var t = JSON.parse(localStorage.getItem(TAR) || 'null');
            if (!t || !Array.isArray(t.sorok) || !t.sorok.length) return false;
            A.sorok = t.sorok;
            A.forras = t.forras || '';
            ['szuro', 'besorolas', 'terv', 'tervB', 'mi', 'tervCsoport', 'tervEgyeni', 'tervSzuro',
                'megyeNap', 'feltoltes', 'dontes', 'tervTerv'].forEach(function (k) {
                if (t[k] && typeof t[k] === 'object') A[k] = Object.assign(A[k], t[k]);
            });
            if (Array.isArray(t.jeloltek)) A.jeloltek = t.jeloltek;
            A.korrekcio = Number(t.korrekcio) || 0;
            if (t.tervCsoportosit !== undefined) A.tervCsoportosit = !!t.tervCsoportosit;
            if (t.nezet) A.nezet = t.nezet;
            if (t.tervNezet) A.tervNezet = t.tervNezet;
            if (t.naptarHonap) A.naptarHonap = t.naptarHonap;
            if (t.evesSorMod) A.evesSorMod = t.evesSorMod;
            if (t.evesKartya) A.evesKartya = t.evesKartya;
            if (t.evesHonapDb) A.evesHonapDb = Number(t.evesHonapDb) || 12;
            if (t.evesTol) A.evesTol = t.evesTol;
            return true;
        } catch (e) { return false; }
    }

    function fajlBe(fajl) {
        if (!fajl) return;
        var nev = fajl.name || '';
        var kiterjesztes = nev.toLowerCase().split('.').pop();
        allapot('Beolvasás: ' + nev + ' …');

        if (kiterjesztes === 'csv' || kiterjesztes === 'txt') {
            var olvaso = new FileReader();
            olvaso.onload = function () {
                var eredmeny = B.csvBol(String(olvaso.result));
                kesz(eredmeny, nev);
            };
            olvaso.onerror = function () { allapot('A fájlt nem sikerült beolvasni.', true); };
            olvaso.readAsText(fajl, 'UTF-8');
            return;
        }

        xlsxKonyvtar(function () {
            var olvaso2 = new FileReader();
            olvaso2.onload = function () {
                try {
                    var konyv = window.XLSX.read(new Uint8Array(olvaso2.result), { type: 'array', cellDates: true });
                    var lap = konyv.Sheets[konyv.SheetNames[0]];
                    var nyers = window.XLSX.utils.sheet_to_json(lap, { defval: null });
                    var eredmeny = B.sorokbol(nyers);
                    eredmeny.fejlec = Object.keys(nyers[0] || {});
                    kesz(eredmeny, nev);
                } catch (e) {
                    allapot('Az Excel-fájlt nem sikerült értelmezni. Mentsd el CSV-ben, és úgy töltsd be.', true);
                }
            };
            olvaso2.readAsArrayBuffer(fajl);
        }, function () {
            allapot('Az Excel-olvasó nem töltődött be (nincs internet?). Mentsd el a táblázatot CSV-ben – az internet nélkül is megy.', true);
        });
    }

    /** Az Excel-olvasót csak akkor töltjük le, ha tényleg xlsx jön. */
    function xlsxKonyvtar(kesz2, hiba) {
        if (window.XLSX) { kesz2(); return; }
        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
        s.onload = kesz2;
        s.onerror = hiba;
        document.head.appendChild(s);
    }

    function kesz(eredmeny, nev) {
        var hianyzo = B.hianyzoOszlopok(eredmeny.fejlec || []);
        if (hianyzo.length) {
            allapot('Ebből a fájlból hiányzik: ' + hianyzo.join(', ') + '. Ellenőrizd, hogy a megfelelő exportot töltötted-e be.', true);
            return;
        }
        if (!eredmeny.sorok.length) {
            allapot('A fájlban nem találtam értelmezhető sort.', true);
            return;
        }
        betolt(eredmeny.sorok, nev);
        allapot(szam(eredmeny.sorok.length) + ' sor beolvasva'
            + (eredmeny.kihagyott ? ' · ' + szam(eredmeny.kihagyott) + ' sor kihagyva (üres)' : '')
            + ' · forrás: ' + nev);
    }

    /** Kitalált példaadat – hogy üres kézzel is látszódjon, mit tud a lap. */
    function peldaAdat() {
        var sorok = [];
        var vevok = [
            ['Aranykalász Mezőgazdasági Zrt', 'BÉKÉS', 'LM', 21000000, 9000000],
            ['Napsugár Agrár Kft', 'CSONGRÁD', 'KER', 8200000, 2400000],
            ['Tiszamenti Gazda Kft', 'SZOLNOK', 'TF', 6400000, 7300000],
            ['Hármashatár Major Bt', 'BÉKÉS', 'LM', 4300000, 900000],
            ['Zöldmező Farm Kft', 'HEVES', 'KER', 3600000, 3100000],
            // Tavaly nagy volt, most kicsi – ő a „mentendő platina”.
            ['Pusztaszéli Tanya Kft', 'NÓGRÁD', 'TF', 1250000, 6500000],
            ['Kisparcella Gazdaság', 'CSONGRÁD', 'LM', 420000, 380000],
            ['Határszél Mezőgazdasági Bt', 'SZOLNOK', 'KER', 180000, 210000],
        ];
        var csoportok = [
            ['LUCERNA', 'Lucerna vetőmag', 'KG'],
            ['ŐSZI BÚZA', 'Őszi búza vetőmag', 'KG'],
            ['NAPRAFORGÓ', 'Napraforgó hibrid', 'KG'],
            ['ZÖLDTRÁGYA', 'Zöldtrágya keverék', 'KG'],
        ];
        var i = 0;

        vevok.forEach(function (v) {
            [['2025/2026', 2026, v[3]], ['2024/2025', 2025, v[4]]].forEach(function (ev) {
                var marad = ev[2];
                var db = 2 + (i % 3);
                for (var k = 0; k < db; k++) {
                    var cs = csoportok[(i + k) % csoportok.length];
                    var resz = k === db - 1 ? marad : Math.round(ev[2] / db);
                    marad -= resz;
                    if (resz <= 0) continue;
                    var honap = [3, 5, 8, 9, 10][(i + k) % 5];
                    sorok.push({
                        uzleti_ev: ev[0],
                        datum: ev[1] + '-' + (honap < 10 ? '0' : '') + honap + '-1' + ((i + k) % 8),
                        vevo_kod: 'V' + (1000 + i),
                        vevo: v[0],
                        megye: v[1],
                        cikkszam: 'C' + (100 + ((i + k) % 9)),
                        termek: cs[1],
                        faj: cs[0],
                        mennyiseg: Math.round(resz / 900),
                        egyseg: cs[2],
                        osszeg: resz,
                        fedezet: Math.round(resz * 0.18),
                        uzletkoto: v[2],
                    });
                }
                i++;
            });
        });

        // Egy jóváírás (mínuszos) és egy exportszámla – hogy a betöltés utáni
        // kérdések a példán is látszódjanak.
        sorok.push({
            uzleti_ev: '2025/2026', datum: '2026-06-12', vevo_kod: 'V1001', vevo: 'Napsugár Agrár Kft',
            megye: 'CSONGRÁD', cikkszam: 'C101', termek: 'Lucerna vetőmag', faj: 'LUCERNA',
            mennyiseg: -300, egyseg: 'KG', osszeg: -450000, fedezet: -81000, uzletkoto: 'KER', penznem: 'HUF',
        });
        sorok.push({
            uzleti_ev: '2025/2026', datum: '2026-04-08', vevo_kod: 'V1007', vevo: 'Határszél Mezőgazdasági Bt',
            megye: 'SZOLNOK', cikkszam: 'C104', termek: 'Napraforgó hibrid', faj: 'NAPRAFORGÓ',
            mennyiseg: 120, egyseg: 'KG', osszeg: 320000, fedezet: 57600, uzletkoto: 'KER', penznem: 'EUR',
        });

        betolt(sorok, 'példaadat (kitalált nevek)');
        allapot(szam(sorok.length) + ' példasor betöltve. Ezek KITALÁLT nevek és számok – a saját fájlod betöltésével felülírod.');
    }

    // --- szűrők ------------------------------------------------------------

    function legordulo(mezo, ertekek, ertek) {
        mezo.textContent = '';
        mezo.append(new Option('összes', ''));
        ertekek.forEach(function (e) { mezo.append(new Option(e, e)); });
        mezo.value = ertek || '';
    }

    function szurokFeltolt() {
        var v = E.valaszthato(adatSorok());
        legordulo($('fEv'), v.evek, A.szuro.ev);
        legordulo($('fMegye'), v.megyek, A.szuro.megye);
        legordulo($('fUzletkoto'), v.uzletkotok, A.szuro.uzletkoto);
        legordulo($('fCikkcsoport'), v.cikkcsoportok, A.szuro.cikkcsoport);
        $('fPiac').value = A.szuro.piac;
        $('fKereses').value = A.szuro.q;
    }

    /** A számoláshoz használt sorok: a betöltéskori döntésekkel együtt. */
    function adatSorok() { return E.dontesAlkalmaz(A.sorok, A.dontes); }

    function szurt() { return E.szur(adatSorok(), A.szuro); }

    // --- 1. Értékesítés ----------------------------------------------------

    var diagramok = {};
    var RACS = 'rgba(255, 255, 255, .07)';
    var SZIN = ['#3fa76a', '#7bc99a', '#d9a441', '#6ba3d6', '#c98b7b', '#9c8bd6', '#4fb8a8', '#d67ba3'];

    /** A diagram-könyvtárat csak akkor töltjük le, amikor tényleg kell. */
    function chartKesz(kesz) {
        if (window.Chart) { kesz(); return; }

        chartKesz.varo = chartKesz.varo || [];
        chartKesz.varo.push(kesz);
        if (chartKesz.tolt) return;
        chartKesz.tolt = true;

        var s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.5.1';
        s.onload = function () { chartKesz.varo.forEach(function (f) { f(); }); chartKesz.varo = []; };
        s.onerror = function () {
            $('diagramUzenet').textContent = 'A diagramok könyvtára nem töltődött be (nincs internet?) – '
                + 'a mutatók és a táblázatok ettől még működnek.';
        };
        document.head.appendChild(s);
    }

    function ujDiagram(id, cfg) {
        if (diagramok[id]) diagramok[id].destroy();
        var v = document.getElementById(id);
        if (!v) return;
        diagramok[id] = new window.Chart(v.getContext('2d'), cfg);
    }

    /** Vízszintes oszlopdiagram – a hosszú nevek így olvashatók. */
    function oszlop(id, cimkek, ertekek, egyseg, szinFuggveny) {
        ujDiagram(id, {
            type: 'bar',
            data: {
                labels: cimkek,
                datasets: [{
                    data: ertekek,
                    backgroundColor: ertekek.map(szinFuggveny || function () { return SZIN[0]; }),
                    borderWidth: 0,
                }],
            },
            options: {
                indexAxis: 'y',
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (c) { return szam(c.parsed.x, egyseg === '%' ? 1 : 1) + ' ' + egyseg; },
                        },
                    },
                },
                scales: {
                    x: { grid: { color: RACS }, ticks: { callback: function (v) { return szam(v, 0) + ' ' + egyseg; } } },
                    y: { grid: { display: false } },
                },
            },
        });
    }

    function rajzolDiagramok(sorok, e) {
        chartKesz(function () {
            var C = window.Chart;
            C.defaults.font.family = getComputedStyle(document.body).fontFamily;
            C.defaults.font.size = 11.5;
            C.defaults.color = 'rgba(233, 240, 232, .62)';
            C.defaults.animation = false;
            C.defaults.maintainAspectRatio = false;
            C.defaults.responsive = true;

            // 1) Üzleti évek havi lefutása
            var h = E.evHavi(sorok);
            ujDiagram('cEv', {
                type: 'line',
                data: {
                    labels: h.cimkek,
                    datasets: h.evek.map(function (ev, i) {
                        return {
                            label: ev,
                            data: h.adat[ev].map(function (v) { return Math.round(v / 1e6 * 10) / 10; }),
                            borderColor: SZIN[i % SZIN.length],
                            backgroundColor: SZIN[i % SZIN.length],
                            borderWidth: 2, tension: .3, pointRadius: 2,
                        };
                    }),
                },
                options: {
                    plugins: {
                        legend: { position: 'bottom', labels: { boxWidth: 12, usePointStyle: true } },
                        tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + szam(c.parsed.y, 1) + ' M Ft'; } } },
                    },
                    scales: {
                        y: { grid: { color: RACS }, ticks: { callback: function (v) { return szam(v, 0) + ' M'; } } },
                        x: { grid: { display: false } },
                    },
                },
            });

            // 2) Legnagyobb cikkcsoportok
            var cs = e.csoportok.slice(0, 12);
            oszlop('cCsoport', cs.map(function (x) { return x.csoport; }),
                cs.map(function (x) { return Math.round(x.netto / 1e6 * 10) / 10; }), 'M Ft');

            // 3) Megyék részesedése
            var m = e.megyek.slice(0, 8);
            var egyeb = e.megyek.slice(8).reduce(function (a, x) { return a + x.netto; }, 0);
            var mCimkek = m.map(function (x) { return x.megye; });
            var mErtekek = m.map(function (x) { return Math.round(x.netto / 1e6 * 10) / 10; });
            if (egyeb > 0) { mCimkek.push('egyéb'); mErtekek.push(Math.round(egyeb / 1e6 * 10) / 10); }
            ujDiagram('cMegye', {
                type: 'doughnut',
                data: { labels: mCimkek, datasets: [{ data: mErtekek, backgroundColor: SZIN, borderWidth: 0 }] },
                options: {
                    cutout: '52%',
                    plugins: {
                        legend: { position: 'right', labels: { boxWidth: 12, usePointStyle: true } },
                        tooltip: { callbacks: { label: function (c) { return c.label + ': ' + szam(c.parsed, 1) + ' M Ft'; } } },
                    },
                },
            });

            // 4) Üzletkötők árbevétele
            var uk = e.uzletkotok.slice(0, 12);
            oszlop('cUk', uk.map(function (x) { return x.uzletkoto; }),
                uk.map(function (x) { return Math.round(x.netto / 1e6 * 10) / 10; }), 'M Ft');

            // 5) Fedezeti hányad cikkcsoportonként – csak ha kéred, és van hozzá adat.
            var fkartya = $('kartyaFedezet');
            if (fkartya) fkartya.hidden = !fedezetKell();
            if (fedezetKell()) {
                var fh = e.csoportok.slice(0, 12).map(function (x) {
                    return { csoport: x.csoport, mp: x.netto !== 0 ? x.fedezet / x.netto * 100 : 0 };
                }).sort(function (a, b) { return b.mp - a.mp; });
                oszlop('cFedezet', fh.map(function (x) { return x.csoport; }),
                    fh.map(function (x) { return Math.round(x.mp * 10) / 10; }), '%',
                    function (v) { return v < 0 ? '#d98080' : SZIN[0]; });
            }

            // 6) Legnagyobb vevők (a mínuszos tétel itt is látszik, ha van)
            var vv = E.vevok(sorok).slice(0, 12);
            oszlop('cVevo', vv.map(function (x) { return x.vevo; }),
                vv.map(function (x) { return Math.round(x.netto / 1e6 * 10) / 10; }), 'M Ft',
                function (v) { return v < 0 ? '#d98080' : SZIN[0]; });
        });
    }

    function rajzolErtekesites(sorok) {
        var e = E.ertekesites(sorok);
        var hanyad = e.ossz.netto !== 0 ? e.ossz.fedezet / e.ossz.netto * 100 : 0;

        var mutatok = $('ertMutatok');
        mutatok.textContent = '';

        var lista = [['Nettó árbevétel', szam(e.ossz.netto / 1e6, 1) + ' M Ft', szam(e.ossz.sor) + ' számlatétel']];
        if (fedezetKell()) {
            lista.push(['Fedezet', szam(e.ossz.fedezet / 1e6, 1) + ' M Ft', 'az exportból, nem számolt']);
            lista.push(['Fedezeti hányad', szam(hanyad, 1) + ' %', 'a nettó árbevételre vetítve']);
        }
        lista.push(['Értékesített mennyiség', szam(e.ossz.kg) + ' kg', 'csak a kilóban mért tételek']);
        lista.push(['Vásárló vevő', szam(e.ossz.vevo), 'a szűrt időszakban']);

        lista.forEach(function (m) {
            var d = el('div', 'mutato');
            d.append(el('div', 'cimke', m[0]), el('div', 'ertek', m[1]), el('div', 'alcim', m[2]));
            mutatok.append(d);
        });

        rajzolDiagramok(sorok, e);

        var ukNevek = e.uzletkotok.map(function (u) { return u.uzletkoto; });
        var fejlec = ['Megye'].concat(ukNevek.map(function (u) { return { szoveg: u, szam: true }; }))
            .concat([{ szoveg: 'Összesen', szam: true }]);

        var sorokKi = e.megyek.map(function (m) {
            return {
                cellak: [m.megye].concat(ukNevek.map(function (u) {
                    return { szoveg: m.uzletkoto[u] ? rovidFt(m.uzletkoto[u]) + ' Ft' : '–', szam: true };
                })).concat([{ szoveg: rovidFt(m.netto) + ' Ft', szam: true }]),
            };
        });
        sorokKi.push({
            osztaly: 'osszesen',
            cellak: ['Összesen'].concat(e.uzletkotok.map(function (u) {
                return { szoveg: rovidFt(u.netto) + ' Ft', szam: true };
            })).concat([{ szoveg: rovidFt(e.ossz.netto) + ' Ft', szam: true }]),
        });
        tabla($('ertPivot'), fejlec, sorokKi);

        tabla($('ertCsoport'),
            ['Cikkcsoport', { szoveg: 'Mennyiség', szam: true }, { szoveg: 'Nettó', szam: true }, { szoveg: 'Fedezet', szam: true }],
            e.csoportok.map(function (c) {
                return [c.csoport, { szoveg: szam(c.kg) + ' kg', szam: true },
                    { szoveg: rovidFt(c.netto) + ' Ft', szam: true }, { szoveg: rovidFt(c.fedezet) + ' Ft', szam: true }];
            }));

        tabla($('ertEv'),
            ['Üzleti év', { szoveg: 'Üzletkötő', szam: true }, { szoveg: 'Vevő', szam: true },
                { szoveg: 'Mennyiség', szam: true }, { szoveg: 'Nettó', szam: true }],
            e.evek.map(function (v) {
                return [v.ev, { szoveg: szam(v.uzletkoto), szam: true }, { szoveg: szam(v.vevo), szam: true },
                    { szoveg: szam(v.kg) + ' kg', szam: true }, { szoveg: rovidFt(v.netto) + ' Ft', szam: true }];
            }));
    }

    // --- 2. Előrejelzés ----------------------------------------------------

    function rajzolElorejelzes(sorok) {
        var p = E.elorejelzes(sorok, A.korrekcio);
        $('korrekcio').value = String(A.korrekcio);

        if (!p.van) {
            $('eloBazis').textContent = 'Ehhez a szűréshez nincs kg-ban mért eladás, amiből előre lehetne jelezni.';
            tabla($('eloTabla'), [], []);
            return;
        }

        $('eloBazis').textContent = 'Bázis: ' + p.bazis.tol + ' – ' + p.bazis.ig
            + ' · előrejelzett mennyiség összesen: ' + szam(p.osszMind) + ' kg'
            + (p.korrekcio ? ' (korrekció: ' + (p.korrekcio > 0 ? '+' : '') + p.korrekcio + ' %)' : '');

        var fejlec = ['Cikkcsoport'].concat(p.honapok.map(function (h) { return { szoveg: h.cimke, szam: true }; }))
            .concat([{ szoveg: 'Összesen', szam: true }]);

        var sorokKi = p.sorok.map(function (s) {
            return {
                cellak: [s.csoport].concat(p.honapok.map(function (h) {
                    return { szoveg: s.ertekek[h.kulcs] ? szam(s.ertekek[h.kulcs]) : '–', szam: true };
                })).concat([{ szoveg: szam(s.ossz) + ' kg', szam: true }]),
            };
        });
        sorokKi.push({
            osztaly: 'osszesen',
            cellak: ['Összesen'].concat(p.honapok.map(function (h) {
                return { szoveg: szam(p.ossz[h.kulcs]), szam: true };
            })).concat([{ szoveg: szam(p.osszMind) + ' kg', szam: true }]),
        });

        tabla($('eloTabla'), fejlec, sorokKi);
    }

    // --- 3. Vevőelemzés ----------------------------------------------------

    var BESOROLAS_CIMKE = {
        platina: 'Platinalistás',
        mentendo: 'Mentendő platina',
        potencialis: 'Potenciális platina',
        mikro: 'Mikro vevő',
    };

    function rajzolVevok(sorok) {
        if ($('platinaFt') !== document.activeElement) $('platinaFt').value = szam(A.besorolas.platinaFt);
        $('kozel').value = A.besorolas.kozel;

        var bes = E.besorolas(adatSorok(), A.szuro, A.besorolas);

        var szuroMezo = $('besorolasSzuro');
        szuroMezo.textContent = '';
        szuroMezo.append(new Option('összes', ''));
        Object.keys(BESOROLAS_CIMKE).forEach(function (k) {
            szuroMezo.append(new Option(BESOROLAS_CIMKE[k] + ' (' + szam(bes.szamlalo[k]) + ')', k));
        });
        szuroMezo.value = A.besorolas.szuro;

        var platinaCsoport = bes.szamlalo.platina + bes.szamlalo.mentendo + bes.szamlalo.potencialis;
        $('besorolasOsszegzes').textContent =
            'Platinalistás: ' + szam(platinaCsoport) + ' vevő (platinalistás ' + szam(bes.szamlalo.platina)
            + ' · mentendő ' + szam(bes.szamlalo.mentendo) + ' · potenciális ' + szam(bes.szamlalo.potencialis) + ')'
            + '  ·  Mikro vevő: ' + szam(bes.szamlalo.mikro) + ' vevő'
            + '  ·  a besorolás alapja: ' + (bes.ev || '—')
            + ' (platina szint ' + szam(bes.beallitas.platinaFt) + ' Ft, közel: ' + szam(bes.beallitas.kozel) + '%)';

        var lista = E.vevok(sorok).filter(function (v) {
            return !A.besorolas.szuro || bes.besorolasok[v.vevo] === A.besorolas.szuro;
        });

        var fejlecek = ['Vevő', 'Mit vásárolt', { szoveg: 'Mennyiség', szam: true }, { szoveg: 'Nettó', szam: true }];
        if (fedezetKell()) fejlecek.push({ szoveg: 'Fedezet', szam: true });
        fejlecek.push({ szoveg: 'Alkalom', szam: true }, 'Utolsó vásárlás');

        tabla($('vevoTabla'), fejlecek,
            lista.slice(0, LISTA_MAX).map(function (v) {
                var b = bes.besorolasok[v.vevo];
                var alapFt = bes.alapFt[v.vevo];
                var arres = v.netto !== 0 ? szam(v.fedezet / v.netto * 100, 1) + '%' : '';
                var mit = v.csoportLista.slice(0, 4).map(function (c) {
                    return c.csoport + ' · ' + szam(c.kg) + ' kg · ' + rovidFt(c.netto) + ' Ft';
                }).join('\n');

                var cellak = [
                    {
                        szoveg: v.vevo,
                        alcim: [v.megye || '—', v.uzletkoto].filter(Boolean).join(' · ')
                            + (alapFt !== undefined && Math.round(alapFt) !== Math.round(v.netto)
                                ? ' · ' + bes.ev + ': ' + szam(alapFt) + ' Ft' : ''),
                        jelveny: b ? { tipus: b, szoveg: BESOROLAS_CIMKE[b] } : null,
                    },
                    { szoveg: mit + (v.csoportLista.length > 4 ? '\n+' + (v.csoportLista.length - 4) + ' további' : ''), tobbsoros: true },
                    { szoveg: szam(v.kg) + ' kg', szam: true },
                    { szoveg: szam(v.netto) + ' Ft', szam: true },
                ];

                if (fedezetKell()) cellak.push({ szoveg: szam(v.fedezet) + ' Ft', alcim: arres, szam: true });
                cellak.push({ szoveg: szam(v.alkalmak), szam: true });
                cellak.push({ szoveg: datumCimke(v.utolso), alcim: 'első: ' + datumCimke(v.elso) });

                return { cellak: cellak };
            }));

        $('vevoTobb').textContent = lista.length > LISTA_MAX
            ? 'A lista az első ' + szam(LISTA_MAX) + ' vevőt mutatja a ' + szam(lista.length) + '-ból – szűkíts a szűrőkkel.'
            : '';
    }

    // --- 4. Tervező --------------------------------------------------------

    var MERET_CIM = {
        nagy: ['🏢 Nagy vevők', 'csak személyes látogatásból lesz üzlet'],
        kozepes: ['🏡 Közepesek – családi gazdaságok', 'a látogatási keret maradékát töltik ki, a többiek telefonon'],
        kicsi: ['☎️ Kicsik', 'csak telefon, kérésre árajánlat'],
    };
    var ARANY_CIM = {
        latKonv: 'Látogatásból vásárlás',
        hivLat: 'Hívásból látogatás (időpont)',
        hivVasarlas: 'Hívásból vásárlás (telefonon)',
        hivAjanlat: 'Hívásból árajánlat-kérés',
        ajanlatNyer: 'Ajánlatból vásárlás',
    };
    var SZEG_CIM = { partner: 'Meglévő vevők', piaci: 'Új vevők' };

    /** Egy beírható cella a munkaigény-táblában. */
    function miMezo(ertek, alap, tizedes, szeles, beallit) {
        var i = el('input', szeles ? 'szeles' : '');
        i.type = 'text';
        i.inputMode = 'decimal';
        i.value = (ertek === null || ertek === undefined) ? '' : szam(ertek, tizedes);
        i.placeholder = (alap === null || alap === undefined) ? '' : szam(alap, tizedes);
        i.addEventListener('input', function () {
            beallit(i.value.trim() === '' ? null : szamBe(i.value));
            ment();
            rajzolMunkaigeny();
        });
        var td = el('td', 'szam');
        td.append(i);
        return td;
    }

    function rajzolMunkaigeny() {
        var sorok = szurt();
        var terv = {
            cel: Number(A.terv.cel) || 0,
            bazisFt: 0,
            tol: A.terv.tol || null,
            ig: A.terv.ig || null,
        };
        var tervEredmeny = E.tervezo(sorok, A.tervB, maStr());
        var adat = E.munkaigenyAdat(sorok, terv, tervEredmeny, maStr());
        var e = M.szamol(adat, A.mi);
        var T = e.beallitas;

        if ($('celFt') !== document.activeElement) $('celFt').value = szam(A.terv.cel);

        $('miNagyFt').value = szam(T.hatarok.nagyFt);
        $('miKicsiFt').value = szam(T.hatarok.kicsiFt);
        M.SZEG.forEach(function (sz) {
            $('miNapiLat' + (sz === 'partner' ? 'Partner' : 'Piaci')).value = T.napi[sz].lat || '';
            $('miNapiHiv' + (sz === 'partner' ? 'Partner' : 'Piaci')).value = T.napi[sz].hiv || '';
        });

        var sorokKi = [];
        var ertek = function (v) { return { szoveg: v, szam: true }; };

        sorokKi.push({
            cellak: [
                { szoveg: 'A cél megosztása', alcim: 'üresen: a meglévő vevők hozzák a bázist, a növekedés az újaktól jön' },
                miMezo(A.mi.partnerArany, e.alapArany, 1, false, function (v) {
                    A.mi.partnerArany = v === null ? null : Math.max(0, Math.min(100, v));
                }),
                ertek(szam(100 - e.arany, 1) + ' %'),
                ertek('100 %'),
            ],
        });
        sorokKi.push({
            cellak: ['Cél (Ft)',
                ertek(rovidFt(e.celSzeg.partner) + ' Ft' + (e.kezi ? '' : ' · bázis')),
                ertek(rovidFt(e.celSzeg.piaci) + ' Ft' + (e.kezi ? '' : ' · növekedés')),
                ertek(rovidFt(e.cel) + ' Ft')],
        });

        M.MERETEK.forEach(function (m) {
            var fej = el('td');
            fej.colSpan = 4;
            fej.append(el('b', '', MERET_CIM[m][0]),
                el('span', 'alcim', MERET_CIM[m][1] + ' · a bázisban ' + szam(e.bazis[m].db) + ' vevő, ' + rovidFt(e.bazis[m].ft) + ' Ft'));
            sorokKi.push({ osztaly: 'fejsor', cellak: [fej] });

            sorokKi.push({
                cellak: [{ szoveg: 'A céljából', alcim: 'üresen: a bázis vevőinek arányában' }]
                    .concat(M.SZEG.map(function (sz) {
                        return miMezo(A.mi.meretArany[sz][m], e.alapResz[m], 1, false, function (v) {
                            A.mi.meretArany[sz][m] = v === null ? null : Math.max(0, Math.min(100, v));
                        });
                    })).concat([ertek('')]),
            });
            sorokKi.push({
                cellak: ['Cél (Ft)'].concat(M.SZEG.map(function (sz) {
                    return ertek(rovidFt(e.E[sz][m].cel) + ' Ft');
                })).concat([ertek(rovidFt(e.E.partner[m].cel + e.E.piaci[m].cel) + ' Ft')]),
            });
            sorokKi.push({
                cellak: [{ szoveg: 'Átlagos vásárlás (Ft / vevő)', alcim: 'üresen: a bázisból' }]
                    .concat(M.SZEG.map(function (sz) {
                        return miMezo(A.mi.atlag[sz][m], e.alapAtlag[m], 0, true, function (v) {
                            A.mi.atlag[sz][m] = (v === null || v <= 0) ? null : Math.round(v);
                        });
                    })).concat([ertek('')]),
            });
            sorokKi.push({
                cellak: ['Szükséges vevő'].concat(M.SZEG.map(function (sz) { return ertek(szam(e.E[sz][m].vevo)); }))
                    .concat([ertek(szam(e.E.partner[m].vevo + e.E.piaci[m].vevo))]),
            });
            if (m === 'kozepes') {
                sorokKi.push({
                    cellak: ['ebből látogatással · telefonon'].concat(M.SZEG.map(function (sz) {
                        return ertek(szam(e.E[sz][m].viaLat) + ' · ' + szam(e.E[sz][m].telefonos));
                    })).concat([ertek('')]),
                });
            }
            M.ARANY_MEZOK[m].forEach(function (k) {
                sorokKi.push({
                    cellak: [ARANY_CIM[k]].concat(M.SZEG.map(function (sz) {
                        return miMezo((A.mi[m] && A.mi[m][k]) ? A.mi[m][k][sz] : null, M.ALAP_ARANY[m][k][sz], 1, false, function (v) {
                            A.mi[m] = A.mi[m] || {};
                            A.mi[m][k] = A.mi[m][k] || {};
                            A.mi[m][k][sz] = v;
                        });
                    })).concat([ertek('')]),
                });
            });
            if (m !== 'kicsi') {
                sorokKi.push({
                    cellak: ['🚗 Szükséges látogatás'].concat(M.SZEG.map(function (sz) { return ertek(szam(e.E[sz][m].lat)); }))
                        .concat([ertek(szam(e.E.partner[m].lat + e.E.piaci[m].lat))]),
                });
            } else {
                sorokKi.push({
                    cellak: ['Szükséges árajánlat'].concat(M.SZEG.map(function (sz) { return ertek(szam(e.E[sz][m].ajanlat)); }))
                        .concat([ertek(szam(e.E.partner[m].ajanlat + e.E.piaci[m].ajanlat))]),
                });
            }
            sorokKi.push({
                cellak: ['📞 Szükséges hívás'].concat(M.SZEG.map(function (sz) { return ertek(szam(e.E[sz][m].hiv)); }))
                    .concat([ertek(szam(e.E.partner[m].hiv + e.E.piaci[m].hiv))]),
            });
        });

        var osszFej = el('td');
        osszFej.colSpan = 4;
        osszFej.append(el('b', '', 'Összesen'), el('span', 'alcim', 'a három méret együtt'));
        sorokKi.push({ osztaly: 'fejsor', cellak: [osszFej] });

        [['vevo', 'Szükséges vevő'], ['hiv', '📞 Szükséges hívás'], ['lat', '🚗 Szükséges látogatás'], ['ajanlat', 'Szükséges árajánlat']]
            .forEach(function (p) {
                sorokKi.push({
                    osztaly: p[0] === 'vevo' ? 'osszesen' : '',
                    cellak: [p[1]].concat(M.SZEG.map(function (sz) { return ertek(szam(e.ossz[sz][p[0]])); }))
                        .concat([ertek(szam(e.mind[p[0]]))]),
                });
            });

        var parban = function (h, l) { return '📞 ' + szam(h) + ' · 🚗 ' + szam(l); };
        sorokKi.push({
            cellak: [{ szoveg: 'Már a tervben', alcim: 'a lenti hívás- és látogatáslista' }]
                .concat(M.SZEG.map(function (sz) { return ertek(parban(e.tervben[sz].hivas, e.tervben[sz].latogatas)); }))
                .concat([ertek(parban(e.tervben.partner.hivas + e.tervben.piaci.hivas, e.tervben.partner.latogatas + e.tervben.piaci.latogatas))]),
        });
        sorokKi.push({
            cellak: ['Hiányzik még']
                .concat(M.SZEG.map(function (sz) { return ertek(parban(e.hiany[sz].hivas, e.hiany[sz].latogatas)); }))
                .concat([ertek(parban(e.hiany.partner.hivas + e.hiany.piaci.hivas, e.hiany.partner.latogatas + e.hiany.piaci.latogatas))]),
        });
        sorokKi.push({
            cellak: [{ szoveg: 'Naponta kell', alcim: 'az időszak ' + szam(e.napok) + ' hátralévő munkanapjára' }]
                .concat(M.SZEG.map(function (sz) {
                    return ertek(e.napok > 0 ? '📞 ' + szam(e.ossz[sz].hiv / e.napok, 1) + ' · 🚗 ' + szam(e.ossz[sz].lat / e.napok, 1) : '–');
                }))
                .concat([ertek(e.napi ? '📞 ' + szam(e.napi.hivas, 1) + ' · 🚗 ' + szam(e.napi.latogatas, 1) : '–')]),
        });

        tabla($('miTabla'),
            [''].concat(M.SZEG.map(function (sz) { return { szoveg: SZEG_CIM[sz], szam: true }; }))
                .concat([{ szoveg: 'Összesen', szam: true }]),
            sorokKi);

        $('miFigyelem').textContent = e.figyelem;

        var napiOssz = e.napi ? '📞 ' + szam(e.napi.hivas, 1) + ' · 🚗 ' + szam(e.napi.latogatas, 1) : '–';
        $('miKovetkeztetes').textContent = !e.cel
            ? 'Add meg a bevételi célt, és megmutatom, mennyi munka kell hozzá.'
            : (e.hianyzoCelszam
                ? 'Az időszak ' + szam(e.napok) + ' munkanapjára naponta ' + napiOssz + ' kell. Állíts be napi célszámot fent, és kiderül, belefér-e.'
                : (e.belefer
                    ? '✅ Belefér: a beállított napi célszámokkal ' + szam(e.napKell) + ' munkanap kell, az időszakban ' + szam(e.napok) + ' van.'
                    : '⚠️ Nem fér bele: a beállított napi célszámokkal ' + szam(e.napKell) + ' munkanap kellene, de az időszakban csak ' + szam(e.napok) + ' van.'));
    }

    /** Dátum HELYI nap szerint (a date mezők ezt várják). */
    function napStr(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    /** Egy sor kézi módosításai. */
    function egyeni(kulcs) {
        A.tervEgyeni[kulcs] = A.tervEgyeni[kulcs] || {};
        return A.tervEgyeni[kulcs];
    }

    function ujraTerv() {
        ment();
        rajzolTerv(szurt());
        rajzolMunkaigeny();
    }

    /** Nap-mező (hány nappal az évforduló előtt) egy sorhoz vagy egy fajhoz. */
    function napMezo(ertek, sajat, beallit) {
        var i = el('input', sajat ? 'sajat' : '');
        i.type = 'number';
        i.min = '0';
        i.max = '365';
        i.value = ertek;
        i.addEventListener('change', function () {
            beallit(this.value.trim() === '' ? null : Math.max(0, Math.min(365, Number(this.value) || 0)));
            ujraTerv();
        });
        return i;
    }

    /** Dátum-mező: ide konkrét napot lehet írni, az felülír mindent. */
    function datumMezo(d, s, mit) {
        var i = el('input', [s[mit + 'Sajat'] ? 'sajat' : '', s[mit + 'Kesve'] ? 'kesve' : '', s[mit + 'Csuszott'] ? 'csuszott' : ''].filter(Boolean).join(' '));
        i.type = 'date';
        i.value = napStr(d);
        i.title = (s[mit + 'Kesve'] ? 'Késve: az ideális nap már elmúlt. ' : '')
            + (s[mit + 'Csuszott'] ? 'A napi keret miatt későbbre került. ' : '')
            + 'Évforduló: ' + datumCimke(napStr(s.evfordulo));
        i.addEventListener('change', function () {
            egyeni(s.kulcs)[mit + 'Datum'] = this.value || null;
            ujraTerv();
        });
        return i;
    }

    function pipa(be, cim, beallit) {
        var i = el('input');
        i.type = 'checkbox';
        i.checked = be;
        i.title = cim;
        i.addEventListener('change', function () { beallit(this.checked); ujraTerv(); });
        return i;
    }

    function tervSor(s, rang) {
        var tr = el('tr', s.hivasBe || s.latogatasBe ? '' : 'ki');

        var c1 = el('td');
        c1.append(pipa(s.hivasBe, 'Hívás be/ki', function (v) { egyeni(s.kulcs).hivasBe = v; }));
        tr.append(c1);

        var r = rang[s.vevo] || { hely: 0, resz: 0 };
        var c2 = el('td');
        c2.append(el('span', '', s.vevo));
        c2.append(el('span', 'alcim', [s.megye || '—', s.uzletkoto].filter(Boolean).join(' · ')
            + ' · #' + r.hely + ' · éves ' + rovidFt(s.evesFt) + ' Ft · ' + szam(r.resz, 1) + '%'));
        tr.append(c2);

        var c3 = el('td', 'tobbsoros');
        c3.append(el('span', '', s.termekek.slice(0, 3).join(', ')));
        c3.append(el('span', 'alcim', datumCimke(s.alkalomDatum)));
        tr.append(c3);

        var c4 = el('td', 'szam');
        c4.append(el('span', '', szam(s.ft) + ' Ft'));
        if (s.kg > 0) c4.append(el('span', 'alcim', szam(s.kg) + ' kg'));
        tr.append(c4);

        var c5 = el('td', 'nap');
        c5.append(napMezo(s.hivasNap, s.hivasSajat, function (v) {
            egyeni(s.kulcs).hivas = v;
            egyeni(s.kulcs).hivasDatum = null;
        }));
        tr.append(c5);

        var c6 = el('td', 'datum');
        c6.append(datumMezo(s.hivasDatum, s, 'hivas'));
        tr.append(c6);

        var c7 = el('td');
        c7.append(pipa(s.latogatasBe, 'Látogatás be/ki', function (v) { egyeni(s.kulcs).latogatasBe = v; }));
        tr.append(c7);

        var c8 = el('td', 'nap');
        c8.append(napMezo(s.latogatasNap, s.latogatasSajat, function (v) {
            egyeni(s.kulcs).latogatas = v;
            egyeni(s.kulcs).latogatasDatum = null;
        }));
        tr.append(c8);

        var c9 = el('td', 'datum');
        if (s.latogatasBe) c9.append(datumMezo(s.latogatasDatum, s, 'latogatas'));
        else c9.append(el('span', 'halvany', '—'));
        tr.append(c9);

        return tr;
    }

    var HETKOZNAPOK = ['Hétfő', 'Kedd', 'Szerda', 'Csütörtök', 'Péntek'];

    /** Megyenapok: melyik hétköznap melyik megyékbe megyünk. */
    function rajzolMegyeNapok(lista) {
        $('megyeNapBe').checked = A.megyeNap.be;
        $('megyeNapHivas').checked = A.megyeNap.hivas;

        var racs = $('megyeNapRacs');
        racs.textContent = '';
        racs.hidden = !A.megyeNap.be;

        if (!A.megyeNap.be) {
            $('megyeNapInfo').textContent = 'Bekapcsolva megadhatod, melyik hétköznap melyik megyékbe mész: '
                + 'a látogatások – és ha kéred, a hívások – a hetükön belül a megyéjük napjára kerülnek.';
            return;
        }

        var megyeLista = E.megyek(lista);
        HETKOZNAPOK.forEach(function (nev, i) {
            var n = i + 1;
            var oszlop = el('div', 'megyenap');
            oszlop.append(el('b', '', nev));

            megyeLista.forEach(function (m) {
                var be = (A.megyeNap.napok[n] || []).indexOf(m.megye) !== -1;
                var g = el('button', be ? 'aktiv' : '', m.megye + ' · ' + m.db);
                g.type = 'button';
                g.title = nev + ': ' + m.megye + (be ? ' – kattintásra kiveszi' : ' – kattintásra hozzáadja');
                g.addEventListener('click', function () {
                    var jelenlegi = (A.megyeNap.napok[n] || []).slice();
                    var hol = jelenlegi.indexOf(m.megye);
                    if (hol === -1) jelenlegi.push(m.megye); else jelenlegi.splice(hol, 1);
                    if (jelenlegi.length) A.megyeNap.napok[n] = jelenlegi; else delete A.megyeNap.napok[n];
                    ujraTerv();
                });
                oszlop.append(g);
            });

            racs.append(oszlop);
        });

        var kiosztott = {};
        Object.keys(A.megyeNap.napok).forEach(function (n) {
            (A.megyeNap.napok[n] || []).forEach(function (m) { kiosztott[m] = true; });
        });
        var nelkul = megyeLista.filter(function (m) { return !kiosztott[m.megye]; }).map(function (m) { return m.megye; });

        $('megyeNapInfo').textContent = !Object.keys(A.megyeNap.napok).length
            ? 'Még egy megye sincs kijelölve: kattints a napok alatt a megyékre – aznap oda mész, és oda rendeződnek a látogatások.'
            : (nelkul.length ? 'Nap nélküli megye – ezek a látogatások az eredeti napjukon maradnak: ' + nelkul.join(', ')
                : 'Minden megyének van napja.');
    }

    function rajzolFeltoltes() {
        $('napiHivasCel').value = A.feltoltes.napiHivas || '';
        $('feltoltesTol').value = A.feltoltes.tol;
        $('feltoltesIg').value = A.feltoltes.ig;

        $('feltoltesInfo').textContent = A.jeloltek.length
            ? szam(A.jeloltek.length) + ' jelölt a naptárban (a „Jelöltek törlése” kiveszi őket).'
            : 'Adj meg napi célszámot és időszakot, majd nyomd meg a Feltöltést.';
    }

    var HETNAPOK = ['H', 'K', 'Sze', 'Cs', 'P', 'Szo', 'V'];
    var HONAPNEV = ['január', 'február', 'március', 'április', 'május', 'június',
        'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];

    /** Egy tétel a naptárban: a nyilakkal egy nappal arrébb tehető. */
    function naptarTetel(s, mit) {
        var t = el('div', 'tetel');
        t.append(el('span', '', mit === 'hivas' ? '📞' : '🚗'));

        var nev = el('span', 'nev', s.vevo);
        nev.title = s.vevo + (s.megye ? ' · ' + s.megye : '') + ' · ' + s.faj;
        t.append(nev);

        [['◀', -1, 'Egy nappal korábbra'], ['▶', 1, 'Egy nappal későbbre']].forEach(function (p) {
            var g = el('button', '', p[0]);
            g.type = 'button';
            g.title = p[2] + ' (hétvégét kihagyja)';
            g.addEventListener('click', function () {
                var d = s[mit + 'Datum'];
                var uj = new Date(d.getFullYear(), d.getMonth(), d.getDate() + p[1]);
                egyeni(s.kulcs)[mit + 'Datum'] = napStr(uj);
                ujraTerv();
            });
            t.append(g);
        });

        return t;
    }

    /** Feltöltésből származó jelölt a naptárban – kivehető. */
    function jeloltTetel(j) {
        var t = el('div', 'tetel jelolt');
        t.append(el('span', '', '📞'));

        var nev = el('span', 'nev', j.vevo);
        nev.title = j.vevo + ' · ' + j.ok;
        t.append(nev);

        var g = el('button', '', '✕');
        g.type = 'button';
        g.title = 'Jelölt kivétele';
        g.addEventListener('click', function () {
            A.jeloltek = A.jeloltek.filter(function (x) { return x.kulcs !== j.kulcs; });
            ujraTerv();
        });
        t.append(g);

        return t;
    }

    function rajzolNaptar(lista) {
        var adat = E.naptarAdat(lista);

        var jeloltNapok = {};
        A.jeloltek.forEach(function (j) {
            jeloltNapok[j.datum] = jeloltNapok[j.datum] || [];
            jeloltNapok[j.datum].push(j);
        });

        // Induláskor az első olyan hónap, amelyikben van tétel; utána szabadon
        // lapozható – üres hónapot is meg lehet nézni.
        if (!A.naptarHonap) A.naptarHonap = adat.honapok[0] || maStr().slice(0, 7);
        var ev = Number(A.naptarHonap.slice(0, 4));
        var ho = Number(A.naptarHonap.slice(5, 7));
        $('naptarCim').textContent = ev + '. ' + HONAPNEV[ho - 1];

        var racs = $('naptarRacs');
        racs.textContent = '';
        HETNAPOK.forEach(function (n) { racs.append(el('div', 'fejnap', n)); });

        // A rács hétfővel kezdődik, ezért az 1-je elé betesszük az előző napokat.
        var elseje = new Date(ev, ho - 1, 1);
        var kezdet = new Date(ev, ho - 1, 1 - ((elseje.getDay() + 6) % 7));
        var ma = maStr();

        for (var i = 0; i < 42; i++) {
            var d = new Date(kezdet.getFullYear(), kezdet.getMonth(), kezdet.getDate() + i);
            var k = napStr(d);
            var n = adat.napok[k] || { hivas: [], latogatas: [] };
            var jeloltNap = jeloltNapok[k] || [];
            var hivasDb = n.hivas.length + jeloltNap.length;

            var oszt = 'nap';
            if (d.getMonth() !== ho - 1) oszt += ' mas-honap';
            if (d.getDay() === 0 || d.getDay() === 6) oszt += ' hetvege';
            if (k === ma) oszt += ' ma';
            if ((A.tervB.hivasMax > 0 && hivasDb > A.tervB.hivasMax)
                || (A.tervB.latogatasMax > 0 && n.latogatas.length > A.tervB.latogatasMax)) oszt += ' tulcsordul';

            var cella = el('div', oszt);
            var fej = el('div', 'fej');
            fej.append(el('span', '', String(d.getDate())));
            if (hivasDb || n.latogatas.length) {
                fej.append(el('span', '', '📞 ' + hivasDb + ' · 🚗 ' + n.latogatas.length));
            }
            cella.append(fej);

            // Látogatás elöl: az köti le a napot, a hívás rugalmasabb.
            var mutat = 0;
            n.latogatas.slice(0, 3).forEach(function (s) { cella.append(naptarTetel(s, 'latogatas')); mutat++; });
            n.hivas.slice(0, Math.max(0, 5 - mutat)).forEach(function (s) { cella.append(naptarTetel(s, 'hivas')); mutat++; });

            // A feltöltés jelöltjei a nap végén, külön jelöléssel.
            jeloltNap.slice(0, Math.max(0, 6 - mutat)).forEach(function (j) { cella.append(jeloltTetel(j)); mutat++; });

            var maradt = hivasDb + n.latogatas.length - mutat;
            if (maradt > 0) cella.append(el('div', 'tobb', '+' + maradt + ' további'));

            racs.append(cella);
        }
    }

    var HONAP_ROVID = ['jan', 'feb', 'márc', 'ápr', 'máj', 'jún', 'júl', 'aug', 'szept', 'okt', 'nov', 'dec'];

    /** Stabil szín a cikkcsoport nevéből: ugyanaz a faj mindig ugyanolyan. */
    function evesSzin(faj) {
        var h = 0;
        String(faj || '').split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 360; });
        return { hatter: 'hsl(' + h + ' 42% 24%)', keret: 'hsl(' + h + ' 42% 38%)', szoveg: 'hsl(' + h + ' 55% 86%)' };
    }

    function honapCimke(kulcs) {
        var ho = Number(kulcs.slice(5, 7));
        return HONAP_ROVID[ho - 1] + ' ' + kulcs.slice(0, 4);
    }

    /** Egy kártya a rácsban: darabszám, név, és a hívás/látogatás bontás. */
    function evesKartya(k) {
        var sz = evesSzin(k.faj);
        var e = el('span', 'evkartya');
        e.style.background = sz.hatter;
        e.style.borderColor = sz.keret;
        e.style.color = sz.szoveg;
        e.title = k.cimke + ' · ' + k.db + ' megkeresés (📞 ' + k.hivas + ' · 🚗 ' + k.latogatas + ')';

        e.append(el('span', 'db', String(k.db)));
        e.append(document.createTextNode(k.cimke));
        if (k.latogatas > 0) e.append(el('span', 'jel', '🚗 ' + k.latogatas));

        return e;
    }

    function rajzolEves(lista) {
        document.querySelectorAll('[data-evessor]').forEach(function (g) {
            g.classList.toggle('aktiv', g.dataset.evessor === A.evesSorMod);
        });
        document.querySelectorAll('[data-eveskartya]').forEach(function (g) {
            g.classList.toggle('aktiv', g.dataset.eveskartya === A.evesKartya);
        });
        document.querySelectorAll('[data-eveshonap]').forEach(function (g) {
            g.classList.toggle('aktiv', Number(g.dataset.eveshonap) === A.evesHonapDb);
        });

        if (!A.evesTol) A.evesTol = maStr().slice(0, 7);
        var honapok = E.evesHonapok(A.evesTol, A.evesHonapDb);
        var r = E.evesRacs(lista, { sorMod: A.evesSorMod, kartya: A.evesKartya, honapok: honapok });
        var maiHonap = maStr().slice(0, 7);

        var tb = $('evesTabla');
        tb.textContent = '';

        var thead = el('thead');
        var fejsor = el('tr');
        var elso = el('th', 'sorfej', A.evesSorMod === 'faj' ? 'Cikkcsoport'
            : (A.evesSorMod === 'megye' ? 'Megye' : 'Cikkcsoport › megye'));
        fejsor.append(elso);

        honapok.forEach(function (h) {
            var th = el('th', h === maiHonap ? 'mai' : '');
            th.append(el('span', '', honapCimke(h)));
            var o = r.honapOssz[h];
            th.append(el('span', 'alcim', '📞 ' + o.hivas + ' · 🚗 ' + o.latogatas));
            fejsor.append(th);
        });
        thead.append(fejsor);

        var tbody = el('tbody');
        r.sorok.forEach(function (sor) {
            var tr = el('tr');
            var fej = el('td', 'sorfej');
            fej.append(el('b', '', sor.cimke));
            fej.append(el('span', 'alcim', '📞 ' + sor.hivas + ' · 🚗 ' + sor.latogatas));
            tr.append(fej);

            honapok.forEach(function (h) {
                var td = el('td', 'cella' + (h === maiHonap ? ' mai' : ''));
                (sor.kartyak[h] || []).forEach(function (k) { td.append(evesKartya(k)); });
                tr.append(td);
            });

            tbody.append(tr);
        });

        tb.append(thead, tbody);

        $('evesUres').textContent = r.sorok.length ? ''
            : 'Ebben az időszakban nincs tervezett megkeresés – lapozz a ‹ › gombokkal, vagy válassz hosszabb időszakot.';
    }

    function rajzolTerv(sorok) {
        ['hivasNap', 'latogatasNap', 'pareto', 'hivasMax', 'latogatasMax'].forEach(function (k) { $(k).value = A.tervB[k]; });
        $('tervKereses').value = A.tervSzuro.q;
        $('csakLatogatando').checked = A.tervSzuro.csakLatogatando;

        var t = E.tervezo(sorok, A.tervB, maStr());
        var b = Object.assign({}, A.tervB, {
            megyeNapBe: A.megyeNap.be,
            megyeNapHivas: A.megyeNap.hivas,
            megyeNapok: A.megyeNap.napok,
        });
        var lista = E.idozit(t, b, A.tervCsoport, A.tervEgyeni, maStr());
        rajzolMegyeNapok(lista);
        rajzolFeltoltes();

        // Rangsor: hányadik a vevő az éves forgalma szerint, és mekkora a részesedése.
        var vevoFt = {};
        lista.forEach(function (s) { vevoFt[s.vevo] = s.evesFt; });
        var nevek = Object.keys(vevoFt).sort(function (a, b) { return vevoFt[b] - vevoFt[a]; });
        var osszFt = nevek.reduce(function (a, k) { return a + vevoFt[k]; }, 0);
        var rang = {};
        nevek.forEach(function (k, i) { rang[k] = { hely: i + 1, resz: osszFt > 0 ? vevoFt[k] / osszFt * 100 : 0 }; });

        var q = (A.tervSzuro.q || '').toLowerCase();
        var szurtLista = lista.filter(function (s) {
            if (A.tervSzuro.csakLatogatando && !s.latogatasBe) return false;
            if (!q) return true;
            return (s.vevo + ' ' + (s.megye || '') + ' ' + (s.uzletkoto || '')).toLowerCase().indexOf(q) !== -1;
        });

        var hivasDb = szurtLista.filter(function (s) { return s.hivasBe; }).length;
        var latDb = szurtLista.filter(function (s) { return s.latogatasBe; }).length;
        $('tervOsszegzes').textContent = szam(nevek.length) + ' vevő · ' + szam(szurtLista.length) + ' megkeresés · '
            + szam(hivasDb) + ' hívás · ' + szam(latDb) + ' látogatás'
            + ' · a forgalom felső ' + A.tervB.pareto + '%-át ' + szam(t.osszegzes.nagyVevo) + ' vevő adja'
            + (A.tervB.hivasMax > 0 ? ' · napi keret: ' + A.tervB.hivasMax + ' hívás' : '')
            + (A.tervB.latogatasMax > 0 ? ' · ' + A.tervB.latogatasMax + ' látogatás' : '');

        $('tervLista').hidden = A.tervNezet !== 'lista';
        $('tervNaptar').hidden = A.tervNezet !== 'naptar';
        $('tervEves').hidden = A.tervNezet !== 'eves';
        $('naptarLep').hidden = A.tervNezet !== 'naptar';
        document.querySelectorAll('[data-tervnezet]').forEach(function (g) {
            g.classList.toggle('aktiv', g.dataset.tervnezet === A.tervNezet);
        });

        if (A.tervNezet === 'naptar') { rajzolNaptar(szurtLista); return; }
        if (A.tervNezet === 'eves') { rajzolEves(szurtLista); return; }

        var tb = $('tervTabla');
        tb.textContent = '';
        var thead = el('thead');
        var fejsor = el('tr');
        ['📞', 'Vevő', 'Tavaly ekkor ezt vette', { szoveg: 'Akkori érték', szam: true },
            'Hívás · nap', 'Hívás · dátum', '🚗', 'Látogatás · nap', 'Látogatás · dátum'].forEach(function (f) {
            fejsor.append(el('th', (typeof f === 'object' && f.szam) ? 'szam' : '', typeof f === 'string' ? f : f.szoveg));
        });
        thead.append(fejsor);
        var tbody = el('tbody');
        tb.append(thead, tbody);

        var maradt = LISTA_MAX;

        if (A.tervCsoportosit) {
            E.csoportosit(szurtLista).forEach(function (cs) {
                if (maradt <= 0) return;
                var tr = el('tr', 'fajsor');
                var td = el('td');
                td.colSpan = 4;
                td.append(el('span', 'fajnev', cs.faj));
                td.append(el('span', 'alcim', szam(cs.sorok.length) + ' alkalom · 📞 ' + szam(cs.hivas) + ' · 🚗 ' + szam(cs.latogatas)
                    + ' · ' + rovidFt(cs.ft) + ' Ft'));
                tr.append(td);

                // Fajszintű nap-beállítás: egy szezonban egy fajjal dolgozik az ember.
                var fajB = A.tervCsoport[cs.faj] || {};
                var hn = el('td', 'nap');
                hn.append(napMezo(fajB.hivas !== undefined && fajB.hivas !== null ? fajB.hivas : A.tervB.hivasNap,
                    fajB.hivas !== undefined && fajB.hivas !== null, function (v) {
                        A.tervCsoport[cs.faj] = A.tervCsoport[cs.faj] || {};
                        A.tervCsoport[cs.faj].hivas = v;
                    }));
                tr.append(hn, el('td', '', 'a fajnál'));

                tr.append(el('td'));
                var ln = el('td', 'nap');
                ln.append(napMezo(fajB.latogatas !== undefined && fajB.latogatas !== null ? fajB.latogatas : A.tervB.latogatasNap,
                    fajB.latogatas !== undefined && fajB.latogatas !== null, function (v) {
                        A.tervCsoport[cs.faj] = A.tervCsoport[cs.faj] || {};
                        A.tervCsoport[cs.faj].latogatas = v;
                    }));
                tr.append(ln, el('td', '', 'a fajnál'));
                tbody.append(tr);

                cs.sorok.slice(0, maradt).forEach(function (s) { tbody.append(tervSor(s, rang)); });
                maradt -= cs.sorok.length;
            });
        } else {
            szurtLista.slice(0, LISTA_MAX).forEach(function (s) { tbody.append(tervSor(s, rang)); });
            maradt -= szurtLista.length;
        }

        $('tervTobb').textContent = szurtLista.length > LISTA_MAX
            ? 'A lista az első ' + szam(LISTA_MAX) + ' megkeresést mutatja a ' + szam(szurtLista.length) + '-ból – szűkíts a keresővel vagy a szűrőkkel.'
            : '';
    }

    // --- 5. Értékesítési terv (terméktervező) ------------------------------

    /** A bázis sorai: a kiválasztott üzleti év megadott hónapjai. */
    function tervBazisSorok() {
        var t = A.tervTerv;
        return adatSorok().filter(function (s) {
            if (t.bazisEv && s.uzleti_ev !== t.bazisEv) return false;
            if (!s.datum) return false;
            var ho = Number(s.datum.slice(5, 7));
            return ho >= t.bazisTol && ho <= t.bazisIg;
        });
    }

    /** Százalék-mező: a beírt érték azonnal újraszámol. */
    function szazMezo(ertek, beallit) {
        var i = el('input');
        i.type = 'text';
        i.inputMode = 'decimal';
        i.style.width = '5rem';
        i.value = szam(ertek, 1);
        i.addEventListener('change', function () {
            beallit(this.value.trim() === '' ? null : szamBe(this.value));
            ment();
            rajzolTermekTerv();
        });
        return i;
    }

    function rajzolTermekTerv() {
        var t = A.tervTerv;
        var evek = E.valaszthato(adatSorok()).evek;

        // Üzleti év: alapból a legutolsó.
        if (!t.bazisEv && evek.length) t.bazisEv = evek[evek.length - 1];
        var evMezo = $('tervBazisEv');
        evMezo.textContent = '';
        evek.forEach(function (e) { evMezo.append(new Option(e, e)); });
        evMezo.value = t.bazisEv;

        [['tervBazisTol', 'bazisTol'], ['tervBazisIg', 'bazisIg']].forEach(function (p) {
            var m = $(p[0]);
            m.textContent = '';
            HONAPNEV.forEach(function (nev, i) { m.append(new Option(nev, String(i + 1))); });
            m.value = String(t[p[1]]);
        });

        $('tervVezerlok').hidden = !t.beemelve;

        if (!t.beemelve) {
            $('tervMutatok').textContent = '';
            $('tervTermekUres').textContent = 'Válaszd ki a bázis időszakát, és nyomd meg a „Bázis beemelése" gombot.';
            return;
        }

        var bazis = tervBazisSorok();
        if (!bazis.length) {
            $('tervMutatok').textContent = '';
            $('tervTermekTabla').textContent = '';
            $('tervTermekUres').textContent = 'Ebben az időszakban nincs eladás – válassz másik üzleti évet vagy hónapokat.';
            return;
        }
        $('tervTermekUres').textContent = '';

        var r = E.termekTerv(bazis, t);
        var o = r.ossz;

        $('tervMennySzaz').value = szam(t.mennySzaz, 1);
        $('tervArSzaz').value = szam(t.arSzaz, 1);

        var mutatok = $('tervMutatok');
        mutatok.textContent = '';
        [
            ['Bázis · ' + t.bazisEv, szam(o.bazisFt / 1e6, 1) + ' M Ft', szam(o.bazisKg) + ' kg'],
            ['Terv', szam(o.tervFt / 1e6, 1) + ' M Ft', szam(Math.round(o.tervKg)) + ' kg'],
            ['Változás', (o.valtozasFt >= 0 ? '+' : '') + szam(o.valtozasFt / 1e6, 1) + ' M Ft',
                (o.valtozasSzaz >= 0 ? '+' : '') + szam(o.valtozasSzaz, 1) + '% · mennyiség '
                + (o.mennySzaz >= 0 ? '+' : '') + szam(o.mennySzaz, 1) + '%'],
            ['Tételek', szam(o.db), r.csoportok.length + ' cikkcsoport'],
        ].forEach(function (m) {
            var d = el('div', 'mutato');
            d.append(el('div', 'cimke', m[0]), el('div', 'ertek', m[1]), el('div', 'alcim', m[2]));
            mutatok.append(d);
        });

        // Tábla
        var tb = $('tervTermekTabla');
        tb.textContent = '';

        var thead = el('thead');
        var fejsor = el('tr');
        ['Termék', { s: 'Bázis' }, { s: 'Bázis Ft' }, { s: 'Terv' }, { s: '±%' }, { s: 'Terv Ft' }]
            .forEach(function (c) {
                var szoveg = typeof c === 'string' ? c : c.s;
                fejsor.append(el('th', typeof c === 'object' ? 'szam' : '', szoveg));
            });
        thead.append(fejsor);

        var tbody = el('tbody');
        var ertek = function (v, alcim) {
            var td = el('td', 'szam');
            td.append(el('span', '', v));
            if (alcim) td.append(el('span', 'alcim', alcim));
            return td;
        };

        r.csoportok.forEach(function (cs) {
            var sz = evesSzin(cs.faj);
            var tr = el('tr', 'fajsor');

            var nev = el('td');
            var pont = el('span', '', '● ');
            pont.style.color = sz.keret;
            nev.append(pont, el('b', '', cs.faj), el('span', 'alcim', cs.db + ' termék'));
            tr.append(nev);

            tr.append(ertek(szam(cs.bazisKg) + ' kg'));
            tr.append(ertek(szam(cs.bazisFt) + ' Ft'));
            tr.append(ertek(szam(Math.round(cs.tervKg)) + ' kg'));

            var szazTd = el('td', 'szam');
            szazTd.append(szazMezo(cs.mennySzaz, function (v) {
                A.tervTerv.csoportok[cs.faj] = A.tervTerv.csoportok[cs.faj] || {};
                A.tervTerv.csoportok[cs.faj].mennySzaz = v;
                // A csoport átírása felülírja a benne lévő termékek kézi értékeit.
                cs.sorok.forEach(function (s) { delete A.tervTerv.tetelek[s.termek]; });
            }));
            tr.append(szazTd);

            tr.append(ertek(szam(Math.round(cs.tervFt)) + ' Ft',
                (cs.valtozasFt >= 0 ? '+' : '') + rovidFt(cs.valtozasFt) + ' Ft'));
            tbody.append(tr);

            if (t.csakFajok) return;

            cs.sorok.forEach(function (s) {
                var sortr = el('tr');

                var td1 = el('td');
                td1.append(el('span', '', s.termek));
                td1.append(el('span', 'alcim', s.bazisKg !== 0
                    ? szam(Math.round(s.egysegar)) + ' Ft/kg'
                    : (s.egyebMenny ? szam(s.egyebMenny) + ' ' + (s.egyseg || 'egyéb') : 'nincs mennyiség')));
                sortr.append(td1);

                sortr.append(ertek(s.bazisKg !== 0 ? szam(s.bazisKg) + ' kg'
                    : (s.egyebMenny ? szam(s.egyebMenny) + ' ' + (s.egyseg || '') : '–')));
                sortr.append(ertek(szam(s.bazisFt) + ' Ft'));

                // Tervmennyiség kézzel átírható.
                var mtd = el('td', 'szam');
                var mi = el('input');
                mi.type = 'text';
                mi.inputMode = 'decimal';
                mi.style.width = '7rem';
                mi.value = s.bazisKg !== 0 ? szam(Math.round(s.tervKg)) : '';
                mi.disabled = s.bazisKg === 0;
                if (s.kezi) mi.classList.add('sajat');
                mi.addEventListener('change', function () {
                    A.tervTerv.tetelek[s.termek] = A.tervTerv.tetelek[s.termek] || {};
                    A.tervTerv.tetelek[s.termek].menny = this.value.trim() === '' ? null : szamBe(this.value);
                    ment();
                    rajzolTermekTerv();
                });
                mtd.append(mi);
                sortr.append(mtd);

                var std = el('td', 'szam');
                std.append(szazMezo(s.mennySzaz, function (v) {
                    A.tervTerv.tetelek[s.termek] = A.tervTerv.tetelek[s.termek] || {};
                    A.tervTerv.tetelek[s.termek].mennySzaz = v;
                    A.tervTerv.tetelek[s.termek].menny = null;
                }));
                sortr.append(std);

                sortr.append(ertek(szam(Math.round(s.tervFt)) + ' Ft',
                    (s.valtozasFt >= 0 ? '+' : '') + rovidFt(s.valtozasFt) + ' Ft'));

                tbody.append(sortr);
            });
        });

        tb.append(thead, tbody);
    }

    // --- nézetváltás és indulás -------------------------------------------

    function rajzol() {
        var sorok = szurt();
        ['ertekesites', 'elorejelzes', 'vevok', 'tervezo', 'terv'].forEach(function (n) {
            $('nezet' + n.charAt(0).toUpperCase() + n.slice(1)).hidden = A.nezet !== n;
        });
        // Csak a FŐ fülek – a tervezőn belüli Lista/Naptár/Éves gombok is „ful”
        // osztályúak, azokat a saját jelölőjük választja ki.
        document.querySelectorAll('.ful[data-nezet]').forEach(function (g) {
            g.classList.toggle('aktiv', g.dataset.nezet === A.nezet);
        });

        if (A.nezet === 'ertekesites') rajzolErtekesites(sorok);
        if (A.nezet === 'elorejelzes') rajzolElorejelzes(sorok);
        if (A.nezet === 'vevok') rajzolVevok(sorok);
        if (A.nezet === 'tervezo') { rajzolMunkaigeny(); rajzolTerv(sorok); }
        if (A.nezet === 'terv') rajzolTermekTerv();
    }

    /** Az átvizsgálás eredménye és a kérdések – csak ha van miről dönteni. */
    function rajzolDontes() {
        var doboz = $('dontesDoboz');
        if (!A.sorok.length) { doboz.hidden = true; return; }

        var a = E.atvizsgalas(A.sorok);
        doboz.hidden = a.negativDb === 0 && a.eurDb === 0 && a.fedezetDb === 0;

        $('dontesOsszegzes').textContent = szam(a.sor) + ' sor beolvasva'
            + (a.elso ? ' · ' + datumCimke(a.elso) + ' – ' + datumCimke(a.utolso) : '')
            + ' · ezekről érdemes dönteni, mielőtt számolunk:';

        $('dontesNegativ').hidden = a.negativDb === 0;
        if (a.negativDb) {
            $('dontesNegativInfo').textContent = szam(a.negativDb) + ' sor mínuszos, összesen '
                + szam(a.negativFt) + ' Ft. Ezek jellemzően másképp kiegyenlített tételek, nem hibák.';
        }

        $('dontesEur').hidden = a.eurDb === 0;
        if (a.eurDb) {
            $('dontesEurInfo').textContent = szam(a.eurDb) + ' sor euróban jelölt (exportszámla), a fájlban szereplő '
                + 'összegük együtt ' + szam(a.eurFt) + '.';
        }

        $('dontesFedezet').hidden = a.fedezetDb === 0;
        if (a.fedezetDb) {
            $('dontesFedezetInfo').textContent = szam(a.fedezetDb) + ' sorban van fedezet/árrés adat, összesen '
                + szam(a.fedezetFt) + ' Ft. Ez az exportból jön, nem számolt érték.';
        }

        document.querySelectorAll('input[name="dNegativ"]').forEach(function (r) { r.checked = r.value === A.dontes.negativ; });
        document.querySelectorAll('input[name="dEur"]').forEach(function (r) { r.checked = r.value === A.dontes.eur; });
        document.querySelectorAll('input[name="dFedezet"]').forEach(function (r) { r.checked = r.value === A.dontes.fedezet; });
        $('arfolyam').value = A.dontes.arfolyam ? szam(A.dontes.arfolyam, 2) : '';
    }

    /** Számoljunk-e a fedezettel? (Csak ha van ilyen oszlop, és kérted.) */
    function fedezetKell() {
        return A.dontes.fedezet !== 'nem' && E.atvizsgalas(A.sorok).fedezetDb > 0;
    }

    /** Egy mondatban, mi lett a döntés – hogy később is látszódjon. */
    function dontesUzenet() {
        var r = [];
        r.push(A.dontes.negativ === 'kihagy' ? 'a mínuszos sorokat kihagyjuk'
            : (A.dontes.negativ === 'pozitiv' ? 'a mínuszos sorokat pozitívra állítjuk'
                : 'a mínuszos sorok változatlanok (levonódnak)'));
        r.push(A.dontes.eur === 'valt'
            ? 'az euróban jelölt sorokat ' + szam(A.dontes.arfolyam, 2) + ' Ft/EUR árfolyamon átváltjuk'
            : 'az euróban jelölt sorokat nem váltjuk át');
        r.push(fedezetKell() ? 'a fedezettel is számolunk' : 'a fedezetet nem vesszük figyelembe');

        return 'Beállítva: ' + r.join(' · ') + '.';
    }

    function indul() {
        var van = A.sorok.length > 0;
        betoltoFejlec();
        rajzolDontes();
        $('szuroSav').hidden = !van;
        $('fulek').hidden = !van;
        $('torolGomb').hidden = !van;
        if (!van) {
            ['Ertekesites', 'Elorejelzes', 'Vevok', 'Tervezo'].forEach(function (n) { $('nezet' + n).hidden = true; });
            return;
        }
        szurokFeltolt();
        $('celFt').value = szam(A.terv.cel);
        $('tervTol').value = A.terv.tol;
        $('tervIg').value = A.terv.ig;
        rajzol();
    }

    // --- események ---------------------------------------------------------

    function esemenyek() {
        $('fajl').addEventListener('change', function () { fajlBe(this.files[0]); });

        var doboz = $('dobozBetolt');
        ['dragenter', 'dragover'].forEach(function (n) {
            doboz.addEventListener(n, function (ev) { ev.preventDefault(); doboz.classList.add('rajta'); });
        });
        ['dragleave', 'drop'].forEach(function (n) {
            doboz.addEventListener(n, function (ev) { ev.preventDefault(); doboz.classList.remove('rajta'); });
        });
        doboz.addEventListener('drop', function (ev) {
            if (ev.dataTransfer && ev.dataTransfer.files.length) fajlBe(ev.dataTransfer.files[0]);
        });

        $('dontesAlkalmaz').addEventListener('click', function () {
            var n = document.querySelector('input[name="dNegativ"]:checked');
            var e2 = document.querySelector('input[name="dEur"]:checked');
            var f2 = document.querySelector('input[name="dFedezet"]:checked');
            A.dontes.negativ = n ? n.value : 'valtozatlan';
            A.dontes.eur = e2 ? e2.value : 'marad';
            A.dontes.fedezet = f2 ? f2.value : 'igen';
            A.dontes.arfolyam = szamBe($('arfolyam').value) || 0;

            if (A.dontes.eur === 'valt' && !(A.dontes.arfolyam > 0)) {
                allapot('Az átváltáshoz adj meg egy árfolyamot (Ft/EUR).', true);
                return;
            }

            ment();
            indul();
            allapot(dontesUzenet());
        });

        $('peldaGomb').addEventListener('click', peldaAdat);
        $('torolGomb').addEventListener('click', function () {
            A.sorok = [];
            A.forras = '';
            try { localStorage.removeItem(TAR); } catch (e) { /* nem baj */ }
            allapot('Az adat törölve ebből a böngészőből.');
            indul();
        });

        document.querySelectorAll('.ful[data-nezet]').forEach(function (g) {
            g.addEventListener('click', function () { A.nezet = g.dataset.nezet; ment(); rajzol(); });
        });

        [['fEv', 'ev'], ['fMegye', 'megye'], ['fUzletkoto', 'uzletkoto'], ['fCikkcsoport', 'cikkcsoport'],
            ['fPiac', 'piac']].forEach(function (p) {
            $(p[0]).addEventListener('change', function () { A.szuro[p[1]] = this.value; ment(); rajzol(); });
        });
        $('fKereses').addEventListener('input', function () { A.szuro.q = this.value; ment(); rajzol(); });
        $('szuroTorol').addEventListener('click', function () {
            A.szuro = { ev: '', megye: '', uzletkoto: '', cikkcsoport: '', piac: '', q: '' };
            ment();
            szurokFeltolt();
            rajzol();
        });

        $('korrekcio').addEventListener('change', function () { A.korrekcio = Number(this.value) || 0; ment(); rajzol(); });

        // A Ft-mező tagolt (300 000 000), ezért nem minden leütésre számolunk:
        // különben újraformázás közben elugrana a kurzor.
        $('platinaFt').addEventListener('change', function () {
            A.besorolas.platinaFt = szamBe(this.value) || 0;
            ment();
            rajzolVevok(szurt());
        });
        $('kozel').addEventListener('input', function () {
            A.besorolas.kozel = Number(this.value) || 0;
            ment();
            rajzolVevok(szurt());
        });

        document.querySelectorAll('[data-platinaszaz]').forEach(function (g) {
            g.addEventListener('click', function () {
                var p = Number(g.dataset.platinaszaz) || 0;
                A.besorolas.platinaFt = Math.max(0, Math.round(A.besorolas.platinaFt * (1 + p / 100)));
                ment();
                rajzolVevok(szurt());
            });
        });
        $('besorolasSzuro').addEventListener('change', function () { A.besorolas.szuro = this.value; ment(); rajzolVevok(szurt()); });

        // A lista újrarajzolása elveszi a fókuszt, ezért ezek „change”-re
        // futnak, nem minden leütésre.
        ['hivasNap', 'latogatasNap', 'pareto', 'hivasMax', 'latogatasMax'].forEach(function (k) {
            $(k).addEventListener('change', function () {
                A.tervB[k] = Number(this.value) || 0;
                ujraTerv();
            });
        });

        $('tervKereses').addEventListener('input', function () {
            A.tervSzuro.q = this.value;
            ment();
            rajzolTerv(szurt());
        });
        $('csakLatogatando').addEventListener('change', function () {
            A.tervSzuro.csakLatogatando = this.checked;
            ment();
            rajzolTerv(szurt());
        });
        $('tervCsoportGomb').addEventListener('click', function () {
            A.tervCsoportosit = !A.tervCsoportosit;
            ment();
            rajzolTerv(szurt());
        });
        $('tervAlap').addEventListener('click', function () {
            A.tervEgyeni = {};
            A.tervCsoport = {};
            ujraTerv();
        });

        document.querySelectorAll('[data-tervnezet]').forEach(function (g) {
            g.addEventListener('click', function () {
                A.tervNezet = g.dataset.tervnezet;
                ment();
                rajzolTerv(szurt());
            });
        });

        $('megyeNapBe').addEventListener('change', function () { A.megyeNap.be = this.checked; ujraTerv(); });
        $('megyeNapHivas').addEventListener('change', function () { A.megyeNap.hivas = this.checked; ujraTerv(); });

        [['napiHivasCel', 'napiHivas'], ['feltoltesTol', 'tol'], ['feltoltesIg', 'ig']].forEach(function (p) {
            $(p[0]).addEventListener('change', function () {
                A.feltoltes[p[1]] = p[1] === 'napiHivas' ? (Number(this.value) || 0) : this.value;
                ment();
            });
        });

        $('feltoltesGomb').addEventListener('click', function () {
            var sorok = szurt();
            var t = E.tervezo(sorok, A.tervB, maStr());
            var b = Object.assign({}, A.tervB, {
                megyeNapBe: A.megyeNap.be, megyeNapHivas: A.megyeNap.hivas, megyeNapok: A.megyeNap.napok,
            });
            var lista = E.idozit(t, b, A.tervCsoport, A.tervEgyeni, maStr());
            var uj = E.feltolt(lista, sorok, A.feltoltes, maStr());

            // A dátumot szövegként tartjuk: a böngésző tárából visszatöltve a
            // Date objektum úgyis szöveggé válna.
            A.jeloltek = uj.map(function (j) {
                return { kulcs: j.kulcs, vevo: j.vevo, faj: j.faj, evesFt: j.evesFt, datum: napStr(j.datum), ok: j.ok };
            });
            A.tervNezet = 'naptar';
            ujraTerv();

            if (!A.jeloltek.length) {
                $('feltoltesInfo').textContent = A.feltoltes.napiHivas
                    ? 'Ebben az időszakban nem találtam szabad helyet vagy betervezhető vevőt. Próbálj nagyobb célszámot vagy hosszabb időszakot.'
                    : 'Előbb add meg, naponta hány hívás legyen.';
            }
        });

        $('feltoltesTorol').addEventListener('click', function () { A.jeloltek = []; ujraTerv(); });

        // Értékesítési terv (terméktervező)
        [['tervBazisEv', 'bazisEv'], ['tervBazisTol', 'bazisTol'], ['tervBazisIg', 'bazisIg']].forEach(function (p) {
            $(p[0]).addEventListener('change', function () {
                A.tervTerv[p[1]] = p[1] === 'bazisEv' ? this.value : (Number(this.value) || 1);
                ment();
                rajzolTermekTerv();
            });
        });

        $('tervBeemel').addEventListener('click', function () {
            A.tervTerv.beemelve = true;
            ment();
            rajzolTermekTerv();
        });

        [['tervMennySzaz', 'mennySzaz'], ['tervArSzaz', 'arSzaz']].forEach(function (p) {
            $(p[0]).addEventListener('change', function () {
                A.tervTerv[p[1]] = szamBe(this.value) || 0;
                ment();
                rajzolTermekTerv();
            });
        });

        // A ± gombok a MOSTANI százalékhoz adnak hozzá.
        [['data-tmenny', 'mennySzaz'], ['data-tar', 'arSzaz']].forEach(function (p) {
            document.querySelectorAll('[' + p[0] + ']').forEach(function (g) {
                g.addEventListener('click', function () {
                    A.tervTerv[p[1]] = Math.round((A.tervTerv[p[1]] + Number(g.getAttribute(p[0]))) * 10) / 10;
                    ment();
                    rajzolTermekTerv();
                });
            });
        });

        $('tervVissza').addEventListener('click', function () {
            A.tervTerv.mennySzaz = 0;
            A.tervTerv.arSzaz = 0;
            A.tervTerv.tetelek = {};
            A.tervTerv.csoportok = {};
            ment();
            rajzolTermekTerv();
        });

        $('tervCsakFajok').addEventListener('click', function () {
            A.tervTerv.csakFajok = !A.tervTerv.csakFajok;
            ment();
            rajzolTermekTerv();
        });

        // A terv összege lesz a munkaigény célja – így a két lap összeér.
        $('tervCelbe').addEventListener('click', function () {
            var r = E.termekTerv(tervBazisSorok(), A.tervTerv);
            A.terv.cel = Math.round(r.ossz.tervFt);
            ment();
            $('tervCelbeUzenet').textContent = 'A munkaigény célja most ' + szam(A.terv.cel)
                + ' Ft — nézd meg a Hívás- és látogatásterv lapon.';
        });

        // Éves rács vezérlői
        [['data-evessor', 'evesSorMod'], ['data-eveskartya', 'evesKartya']].forEach(function (p) {
            document.querySelectorAll('[' + p[0] + ']').forEach(function (g) {
                g.addEventListener('click', function () {
                    A[p[1]] = g.getAttribute(p[0]);
                    ment();
                    rajzolTerv(szurt());
                });
            });
        });
        document.querySelectorAll('[data-eveshonap]').forEach(function (g) {
            g.addEventListener('click', function () {
                A.evesHonapDb = Number(g.dataset.eveshonap) || 12;
                ment();
                rajzolTerv(szurt());
            });
        });

        // Léptetés: annyit ugrunk, amennyi épp látszik.
        [['evesElozo', -1], ['evesKovetkezo', 1]].forEach(function (p) {
            $(p[0]).addEventListener('click', function () {
                var ev = Number(A.evesTol.slice(0, 4));
                var ho = Number(A.evesTol.slice(5, 7)) - 1 + p[1] * A.evesHonapDb;
                var d = new Date(ev, ho, 1);
                A.evesTol = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
                ment();
                rajzolTerv(szurt());
            });
        });
        $('evesMa').addEventListener('click', function () {
            A.evesTol = maStr().slice(0, 7);
            ment();
            rajzolTerv(szurt());
        });

        // Naptár-lapozás hónapról hónapra (üres hónap is megnézhető).
        [['naptarElozo', -1], ['naptarKovetkezo', 1]].forEach(function (p) {
            $(p[0]).addEventListener('click', function () {
                var ev = Number(A.naptarHonap.slice(0, 4));
                var ho = Number(A.naptarHonap.slice(5, 7)) - 1 + p[1];
                var d = new Date(ev, ho, 1);
                A.naptarHonap = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
                ment();
                rajzolTerv(szurt());
            });
        });

        $('celFt').addEventListener('change', function () { A.terv.cel = szamBe(this.value) || 0; ment(); rajzolMunkaigeny(); });

        // ± százalék: a célt egy kattintással feljebb-lejjebb lehet vinni.
        document.querySelectorAll('[data-celszaz]').forEach(function (g) {
            g.addEventListener('click', function () {
                var p = Number(g.dataset.celszaz) || 0;
                A.terv.cel = Math.max(0, Math.round(A.terv.cel * (1 + p / 100)));
                ment();
                rajzolMunkaigeny();
            });
        });
        $('tervTol').addEventListener('change', function () { A.terv.tol = this.value; ment(); rajzolMunkaigeny(); });
        $('tervIg').addEventListener('change', function () { A.terv.ig = this.value; ment(); rajzolMunkaigeny(); });

        [['miNagyFt', 'nagyFt'], ['miKicsiFt', 'kicsiFt']].forEach(function (p) {
            $(p[0]).addEventListener('input', function () {
                A.mi.hatarok[p[1]] = this.value.trim() === '' ? null : szamBe(this.value);
                ment();
                rajzolMunkaigeny();
            });
        });
        [['miNapiLatPartner', 'partnerLat'], ['miNapiLatPiaci', 'piaciLat'],
            ['miNapiHivPartner', 'partnerHiv'], ['miNapiHivPiaci', 'piaciHiv']].forEach(function (p) {
            $(p[0]).addEventListener('input', function () {
                A.mi.napi[p[1]] = this.value.trim() === '' ? null : szamBe(this.value);
                ment();
                rajzolMunkaigeny();
            });
        });
        $('miAlap').addEventListener('click', function () {
            A.mi = { hatarok: {}, meretArany: { partner: {}, piaci: {} }, atlag: { partner: {}, piaci: {} }, napi: {}, partnerArany: null };
            ment();
            rajzolMunkaigeny();
        });
    }

    esemenyek();
    if (visszatolt()) {
        allapot(szam(A.sorok.length) + ' sor a böngésző emlékezetéből' + (A.forras ? ' · forrás: ' + A.forras : ''));
    }
    indul();
})();
