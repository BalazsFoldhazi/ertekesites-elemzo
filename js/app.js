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
        szuro: { ev: '', megye: '', uzletkoto: '', cikkcsoport: '', q: '' },
        nezet: 'ertekesites',
        korrekcio: 0,
        besorolas: { platinaFt: 5000000, kozel: 70, szuro: '' },
        terv: { cel: 300000000, tol: '', ig: '' },
        tervB: { hivasNap: 30, latogatasNap: 14, pareto: 70 },
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
    }

    function ment() {
        try {
            localStorage.setItem(TAR, JSON.stringify({
                sorok: A.sorok, forras: A.forras, szuro: A.szuro, besorolas: A.besorolas,
                terv: A.terv, tervB: A.tervB, mi: A.mi, korrekcio: A.korrekcio,
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
            ['szuro', 'besorolas', 'terv', 'tervB', 'mi'].forEach(function (k) {
                if (t[k] && typeof t[k] === 'object') A[k] = Object.assign(A[k], t[k]);
            });
            A.korrekcio = Number(t.korrekcio) || 0;
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
        var v = E.valaszthato(A.sorok);
        legordulo($('fEv'), v.evek, A.szuro.ev);
        legordulo($('fMegye'), v.megyek, A.szuro.megye);
        legordulo($('fUzletkoto'), v.uzletkotok, A.szuro.uzletkoto);
        legordulo($('fCikkcsoport'), v.cikkcsoportok, A.szuro.cikkcsoport);
        $('fKereses').value = A.szuro.q;
    }

    function szurt() { return E.szur(A.sorok, A.szuro); }

    // --- 1. Értékesítés ----------------------------------------------------

    function rajzolErtekesites(sorok) {
        var e = E.ertekesites(sorok);

        var mutatok = $('ertMutatok');
        mutatok.textContent = '';
        [
            ['Sorok', szam(e.ossz.sor)],
            ['Vevők', szam(e.ossz.vevo)],
            ['Nettó árbevétel', szam(e.ossz.netto / 1e6, 1) + ' M Ft'],
            ['Fedezet', szam(e.ossz.fedezet / 1e6, 1) + ' M Ft'],
            ['Mennyiség (kg-os sorok)', szam(e.ossz.kg) + ' kg'],
        ].forEach(function (m) {
            var d = el('div', 'mutato');
            d.append(el('div', 'cimke', m[0]), el('div', 'ertek', m[1]));
            mutatok.append(d);
        });

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
        $('platinaFt').value = A.besorolas.platinaFt;
        $('kozel').value = A.besorolas.kozel;

        var bes = E.besorolas(A.sorok, A.szuro, A.besorolas);

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

        tabla($('vevoTabla'),
            ['Vevő', 'Mit vásárolt', { szoveg: 'Mennyiség', szam: true }, { szoveg: 'Nettó', szam: true },
                { szoveg: 'Fedezet', szam: true }, { szoveg: 'Alkalom', szam: true }, 'Utolsó vásárlás'],
            lista.slice(0, LISTA_MAX).map(function (v) {
                var b = bes.besorolasok[v.vevo];
                var alapFt = bes.alapFt[v.vevo];
                var arres = v.netto > 0 ? szam(v.fedezet / v.netto * 100, 1) + '%' : '';
                var mit = v.csoportLista.slice(0, 4).map(function (c) {
                    return c.csoport + ' · ' + szam(c.kg) + ' kg · ' + rovidFt(c.netto) + ' Ft';
                }).join('\n');

                return {
                    cellak: [
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
                        { szoveg: szam(v.fedezet) + ' Ft', alcim: arres, szam: true },
                        { szoveg: szam(v.alkalmak), szam: true },
                        { szoveg: datumCimke(v.utolso), alcim: 'első: ' + datumCimke(v.elso) },
                    ],
                };
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

    function rajzolTerv(sorok) {
        $('hivasNap').value = A.tervB.hivasNap;
        $('latogatasNap').value = A.tervB.latogatasNap;
        $('pareto').value = A.tervB.pareto;

        var t = E.tervezo(sorok, A.tervB, maStr());
        var o = t.osszegzes;
        $('tervOsszegzes').textContent = szam(o.vevo) + ' vevő · ' + szam(o.alkalom) + ' megkeresés · '
            + szam(o.latogatas) + ' látogatás · a forgalom felső ' + A.tervB.pareto + '%-át ' + szam(o.nagyVevo) + ' vevő adja';

        tabla($('tervTabla'),
            ['Hívás', 'Látogatás', 'Vevő', 'Tavaly ekkor ezt vette', { szoveg: 'Akkori érték', szam: true }],
            t.sorok.slice(0, LISTA_MAX).map(function (s) {
                return {
                    cellak: [
                        datumCimke(s.hivas),
                        s.latogatas ? '★ ' + datumCimke(s.latogatas) : '—',
                        { szoveg: s.vevo, alcim: [s.megye || '—', s.uzletkoto].filter(Boolean).join(' · ') + ' · éves forgalma ' + szam(s.evesFt) + ' Ft' },
                        { szoveg: s.termekek.slice(0, 3).join(', '), alcim: datumCimke(s.alkalomDatum) },
                        { szoveg: szam(s.ft) + ' Ft', alcim: s.kg > 0 ? szam(s.kg) + ' kg' : '', szam: true },
                    ],
                };
            }));

        $('tervTobb').textContent = t.sorok.length > LISTA_MAX
            ? 'A lista az első ' + szam(LISTA_MAX) + ' megkeresést mutatja a ' + szam(t.sorok.length) + '-ból – szűkíts a szűrőkkel.'
            : '';
    }

    // --- nézetváltás és indulás -------------------------------------------

    function rajzol() {
        var sorok = szurt();
        ['ertekesites', 'elorejelzes', 'vevok', 'tervezo'].forEach(function (n) {
            $('nezet' + n.charAt(0).toUpperCase() + n.slice(1)).hidden = A.nezet !== n;
        });
        document.querySelectorAll('.ful').forEach(function (g) {
            g.classList.toggle('aktiv', g.dataset.nezet === A.nezet);
        });

        if (A.nezet === 'ertekesites') rajzolErtekesites(sorok);
        if (A.nezet === 'elorejelzes') rajzolElorejelzes(sorok);
        if (A.nezet === 'vevok') rajzolVevok(sorok);
        if (A.nezet === 'tervezo') { rajzolMunkaigeny(); rajzolTerv(sorok); }
    }

    function indul() {
        var van = A.sorok.length > 0;
        $('szuroSav').hidden = !van;
        $('fulek').hidden = !van;
        $('torolGomb').hidden = !van;
        if (!van) {
            ['Ertekesites', 'Elorejelzes', 'Vevok', 'Tervezo'].forEach(function (n) { $('nezet' + n).hidden = true; });
            return;
        }
        szurokFeltolt();
        $('celFt').value = A.terv.cel;
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

        $('peldaGomb').addEventListener('click', peldaAdat);
        $('torolGomb').addEventListener('click', function () {
            A.sorok = [];
            A.forras = '';
            try { localStorage.removeItem(TAR); } catch (e) { /* nem baj */ }
            allapot('Az adat törölve ebből a böngészőből.');
            indul();
        });

        document.querySelectorAll('.ful').forEach(function (g) {
            g.addEventListener('click', function () { A.nezet = g.dataset.nezet; rajzol(); });
        });

        [['fEv', 'ev'], ['fMegye', 'megye'], ['fUzletkoto', 'uzletkoto'], ['fCikkcsoport', 'cikkcsoport']].forEach(function (p) {
            $(p[0]).addEventListener('change', function () { A.szuro[p[1]] = this.value; ment(); rajzol(); });
        });
        $('fKereses').addEventListener('input', function () { A.szuro.q = this.value; ment(); rajzol(); });
        $('szuroTorol').addEventListener('click', function () {
            A.szuro = { ev: '', megye: '', uzletkoto: '', cikkcsoport: '', q: '' };
            ment();
            szurokFeltolt();
            rajzol();
        });

        $('korrekcio').addEventListener('change', function () { A.korrekcio = Number(this.value) || 0; ment(); rajzol(); });

        ['platinaFt', 'kozel'].forEach(function (k) {
            $(k).addEventListener('input', function () {
                A.besorolas[k] = Number(this.value) || 0;
                ment();
                rajzolVevok(szurt());
            });
        });
        $('besorolasSzuro').addEventListener('change', function () { A.besorolas.szuro = this.value; ment(); rajzolVevok(szurt()); });

        ['hivasNap', 'latogatasNap', 'pareto'].forEach(function (k) {
            $(k).addEventListener('input', function () {
                A.tervB[k] = Number(this.value) || 0;
                ment();
                rajzolTerv(szurt());
                rajzolMunkaigeny();
            });
        });

        $('celFt').addEventListener('input', function () { A.terv.cel = Number(this.value) || 0; ment(); rajzolMunkaigeny(); });
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
