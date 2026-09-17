/**
 * Az elemzések – ugyanaz a logika, ami a CRM-ben szerveroldalon fut, csak itt a
 * böngészőben, a betöltött fájl sorain.
 *
 *  - ertekesites : megye × üzletkötő kimutatás, cikkcsoportok, üzleti évek
 *  - vevok       : vevőnkénti összegzés (mit és mennyit vásárolt)
 *  - besorolas   : platinalistás (platinalistás · mentendő · potenciális) és mikro vevő
 *  - elorejelzes : cikkcsoportonként, kg-ban, hónapról hónapra 12 hónapra
 *  - tervezo     : hívás- és látogatásterv a vásárlás évfordulója előtt
 */
(function (glob) {
    'use strict';

    var TOMEG = 'KG';

    /** Ennyi napon belüli vásárlások EGY alkalomnak számítanak. */
    var ALKALOM_RES = 30;

    function ures(v) { return v === null || v === undefined || String(v).trim() === ''; }
    function kg(sor) { return String(sor.egyseg || '').toUpperCase() === TOMEG ? (Number(sor.mennyiseg) || 0) : 0; }
    function ft(sor) { return Number(sor.osszeg) || 0; }
    function csoportNev(sor) { return ures(sor.faj) ? '(nincs cikkcsoport)' : String(sor.faj).trim(); }
    function nap(s) { var r = String(s).split('-'); return new Date(Number(r[0]), Number(r[1]) - 1, Number(r[2])); }
    function honapKulcs(s) { return String(s).slice(0, 7); }

    /** A lap szűrői: üzleti év, megye, üzletkötő, cikkcsoport, keresés. */
    function szur(sorok, szuro) {
        var sz = szuro || {};
        var q = (sz.q || '').trim().toLowerCase();

        return (sorok || []).filter(function (s) {
            if (sz.ev && s.uzleti_ev !== sz.ev) return false;
            if (sz.megye && s.megye !== sz.megye) return false;
            if (sz.uzletkoto && s.uzletkoto !== sz.uzletkoto) return false;
            if (sz.cikkcsoport && csoportNev(s) !== sz.cikkcsoport) return false;
            if (q) {
                var nev = String(s.vevo || '').toLowerCase();
                var kod = String(s.vevo_kod || '').toLowerCase();
                if (nev.indexOf(q) === -1 && kod.indexOf(q) === -1) return false;
            }
            return true;
        });
    }

    /** A szűrők legördülőinek tartalma. */
    function valaszthato(sorok) {
        var gy = { evek: {}, megyek: {}, uzletkotok: {}, cikkcsoportok: {} };
        (sorok || []).forEach(function (s) {
            if (!ures(s.uzleti_ev)) gy.evek[s.uzleti_ev] = true;
            if (!ures(s.megye)) gy.megyek[s.megye] = true;
            if (!ures(s.uzletkoto)) gy.uzletkotok[s.uzletkoto] = true;
            gy.cikkcsoportok[csoportNev(s)] = true;
        });
        var rendez = function (o) { return Object.keys(o).sort(function (a, b) { return a.localeCompare(b, 'hu'); }); };

        return {
            evek: rendez(gy.evek),
            megyek: rendez(gy.megyek),
            uzletkotok: rendez(gy.uzletkotok),
            cikkcsoportok: rendez(gy.cikkcsoportok),
        };
    }

    /** Összesítés + megye × üzletkötő kimutatás + cikkcsoport és üzleti év bontás. */
    function ertekesites(sorok) {
        var ossz = { netto: 0, fedezet: 0, kg: 0, vevo: 0, sor: (sorok || []).length };
        var vevok = {};
        var megyeSor = {};
        var uzletkotok = {};
        var csoportok = {};
        var evek = {};

        (sorok || []).forEach(function (s) {
            var e = ft(s), f = Number(s.fedezet) || 0, m = kg(s);
            ossz.netto += e; ossz.fedezet += f; ossz.kg += m;
            vevok[s.vevo] = true;

            var megye = ures(s.megye) ? '(nincs megye)' : s.megye;
            var uk = ures(s.uzletkoto) ? '(nincs üzletkötő)' : s.uzletkoto;
            uzletkotok[uk] = (uzletkotok[uk] || 0) + e;

            megyeSor[megye] = megyeSor[megye] || { megye: megye, netto: 0, kg: 0, uzletkoto: {} };
            megyeSor[megye].netto += e;
            megyeSor[megye].kg += m;
            megyeSor[megye].uzletkoto[uk] = (megyeSor[megye].uzletkoto[uk] || 0) + e;

            var cs = csoportNev(s);
            csoportok[cs] = csoportok[cs] || { csoport: cs, netto: 0, kg: 0, fedezet: 0 };
            csoportok[cs].netto += e; csoportok[cs].kg += m; csoportok[cs].fedezet += f;

            if (!ures(s.uzleti_ev)) {
                evek[s.uzleti_ev] = evek[s.uzleti_ev] || { ev: s.uzleti_ev, netto: 0, kg: 0, vevo: {}, uzletkoto: {} };
                evek[s.uzleti_ev].netto += e;
                evek[s.uzleti_ev].kg += m;
                evek[s.uzleti_ev].vevo[s.vevo] = true;
                if (!ures(s.uzletkoto)) evek[s.uzleti_ev].uzletkoto[s.uzletkoto] = true;
            }
        });

        ossz.vevo = Object.keys(vevok).length;

        var csokkeno = function (a, b) { return b.netto - a.netto; };
        var megyek = Object.keys(megyeSor).map(function (k) { return megyeSor[k]; }).sort(csokkeno);
        var ukLista = Object.keys(uzletkotok).map(function (k) { return { uzletkoto: k, netto: uzletkotok[k] }; }).sort(csokkeno);

        return {
            ossz: ossz,
            megyek: megyek,
            uzletkotok: ukLista,
            csoportok: Object.keys(csoportok).map(function (k) { return csoportok[k]; }).sort(csokkeno),
            evek: Object.keys(evek).sort().map(function (k) {
                var e = evek[k];
                return { ev: e.ev, netto: e.netto, kg: e.kg, vevo: Object.keys(e.vevo).length, uzletkoto: Object.keys(e.uzletkoto).length };
            }),
        };
    }

    /** Vevőnként: forgalom, fedezet, alkalmak, első/utolsó vásárlás, cikkcsoportok. */
    function vevok(sorok) {
        var gy = {};

        (sorok || []).forEach(function (s) {
            var nev = String(s.vevo || '').trim();
            if (nev === '') return;

            gy[nev] = gy[nev] || {
                vevo: nev, netto: 0, fedezet: 0, kg: 0, sorok: 0,
                napok: {}, elso: null, utolso: null,
                megye: null, uzletkoto: null, csoportok: {}, evek: {},
            };
            var v = gy[nev];
            v.netto += ft(s);
            v.fedezet += Number(s.fedezet) || 0;
            v.kg += kg(s);
            v.sorok++;
            if (s.datum) {
                v.napok[s.datum] = true;
                if (v.elso === null || s.datum < v.elso) v.elso = s.datum;
                if (v.utolso === null || s.datum > v.utolso) v.utolso = s.datum;
            }
            if (!v.megye && !ures(s.megye)) v.megye = s.megye;
            if (!v.uzletkoto && !ures(s.uzletkoto)) v.uzletkoto = s.uzletkoto;

            var cs = csoportNev(s);
            v.csoportok[cs] = v.csoportok[cs] || { csoport: cs, netto: 0, kg: 0 };
            v.csoportok[cs].netto += ft(s);
            v.csoportok[cs].kg += kg(s);

            if (!ures(s.uzleti_ev)) v.evek[s.uzleti_ev] = (v.evek[s.uzleti_ev] || 0) + ft(s);
        });

        return Object.keys(gy).map(function (k) {
            var v = gy[k];
            v.alkalmak = Object.keys(v.napok).length;
            v.csoportLista = Object.keys(v.csoportok).map(function (c) { return v.csoportok[c]; })
                .sort(function (a, b) { return b.netto - a.netto; });
            return v;
        }).sort(function (a, b) { return b.netto - a.netto; });
    }

    /**
     * Besorolás árbevétel szerint.
     *
     * A platina szint ÉVES árbevétel, ezért a besorolás mindig egy üzleti évre
     * néz: a kiválasztottra, vagy ha nincs, a legutolsóra. A „valaha elérte”
     * viszont a teljes múltat vizsgálja – ebből lesz a mentendő.
     */
    function besorolas(mindenSor, szuro, beallitas) {
        var b = {
            platinaFt: Number(beallitas && beallitas.platinaFt) > 0 ? Number(beallitas.platinaFt) : 5000000,
            kozel: Number(beallitas && beallitas.kozel) > 0 ? Math.min(100, Number(beallitas.kozel)) : 70,
        };

        // Az év-szűrő nélküli vevőkör: ebből jön a „valaha elérte”.
        var evNelkul = szur(mindenSor, Object.assign({}, szuro, { ev: '' }));

        var bazisEv = (szuro && szuro.ev) ? szuro.ev : '';
        if (!bazisEv) {
            evNelkul.forEach(function (s) { if (!ures(s.uzleti_ev) && s.uzleti_ev > bazisEv) bazisEv = s.uzleti_ev; });
        }

        var most = {};
        var valaha = {};
        evNelkul.forEach(function (s) {
            var nev = String(s.vevo || '').trim();
            if (nev === '') return;
            if (s.uzleti_ev === bazisEv) most[nev] = (most[nev] || 0) + ft(s);
            if (!ures(s.uzleti_ev)) {
                valaha[nev] = valaha[nev] || {};
                valaha[nev][s.uzleti_ev] = (valaha[nev][s.uzleti_ev] || 0) + ft(s);
            }
        });

        var besorolasok = {};
        var szamlalo = { platina: 0, mentendo: 0, potencialis: 0, mikro: 0 };

        Object.keys(most).forEach(function (nev) {
            var mostFt = most[nev];
            var evei = valaha[nev] || {};
            var csucs = Object.keys(evei).reduce(function (a, e) { return Math.max(a, evei[e]); }, 0);

            var kulcs;
            if (mostFt >= b.platinaFt) kulcs = 'platina';
            else if (csucs >= b.platinaFt) kulcs = 'mentendo';
            else kulcs = mostFt >= b.platinaFt * b.kozel / 100 ? 'potencialis' : 'mikro';

            besorolasok[nev] = kulcs;
            szamlalo[kulcs]++;
        });

        return { besorolasok: besorolasok, szamlalo: szamlalo, ev: bazisEv, alapFt: most, beallitas: b };
    }

    /**
     * Vásárlási előrejelzés: cikkcsoportonként, kg-ban, a következő 12 hónapra.
     *
     * A bázis az utolsó adatos hónappal záruló 12 hónap AZONOS naptári hónapja –
     * a vetőmag szezonális, egy éves átlag elmosná a szezont. Több évre azért
     * nem átlagolunk, mert a korábbi üzleti évek a cégnek csak egy részét
     * mutatják (kevesebb üzletkötő), és az előrejelzés a töredékére esne.
     */
    function elorejelzes(sorok, korrekcio) {
        var HONAPOK = 12;
        var szorzo = 1 + (Number(korrekcio) || 0) / 100;

        var utolso = null;
        (sorok || []).forEach(function (s) { if (s.datum && (utolso === null || s.datum > utolso)) utolso = s.datum; });
        if (utolso === null) return { van: false, honapok: [], sorok: [], ossz: {}, osszMind: 0, bazis: null, korrekcio: Number(korrekcio) || 0 };

        var u = nap(utolso);
        var bazisTol = new Date(u.getFullYear(), u.getMonth() - 11, 1);
        var bazisIg = new Date(u.getFullYear(), u.getMonth() + 1, 0);

        var adat = {};
        (sorok || []).forEach(function (s) {
            if (!s.datum || kg(s) === 0) return;
            var d = nap(s.datum);
            if (d < bazisTol || d > bazisIg) return;
            var cs = csoportNev(s);
            var k = honapKulcs(s.datum);
            adat[cs] = adat[cs] || {};
            adat[cs][k] = (adat[cs][k] || 0) + kg(s);
        });

        var honapok = [];
        var ossz = {};
        for (var i = 1; i <= HONAPOK; i++) {
            var h = new Date(u.getFullYear(), u.getMonth() + i, 1);
            var kulcs = h.getFullYear() + '-' + (h.getMonth() + 1 < 10 ? '0' : '') + (h.getMonth() + 1);
            var bazis = new Date(h.getFullYear() - 1, h.getMonth(), 1);
            honapok.push({
                kulcs: kulcs,
                cimke: h.getFullYear() + '. ' + (h.getMonth() + 1 < 10 ? '0' : '') + (h.getMonth() + 1) + '.',
                bazisKulcs: bazis.getFullYear() + '-' + (bazis.getMonth() + 1 < 10 ? '0' : '') + (bazis.getMonth() + 1),
            });
            ossz[kulcs] = 0;
        }

        var kiSorok = [];
        Object.keys(adat).forEach(function (cs) {
            var ertekek = {};
            var sorOssz = 0;
            var adatosHonap = 0;

            honapok.forEach(function (h) {
                var e = Math.round((adat[cs][h.bazisKulcs] || 0) * szorzo);
                ertekek[h.kulcs] = e;
                sorOssz += e;
                ossz[h.kulcs] += e;
                if (e > 0) adatosHonap++;
            });

            if (sorOssz > 0) kiSorok.push({ csoport: cs, ertekek: ertekek, ossz: sorOssz, adatosHonap: adatosHonap });
        });

        kiSorok.sort(function (a, b) { return b.ossz - a.ossz; });
        var osszMind = Object.keys(ossz).reduce(function (a, k) { return a + ossz[k]; }, 0);

        var honapNev = function (d) { return d.getFullYear() + '. ' + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '.'; };

        return {
            van: kiSorok.length > 0,
            honapok: honapok,
            sorok: kiSorok,
            ossz: ossz,
            osszMind: osszMind,
            bazis: { tol: honapNev(bazisTol), ig: honapNev(bazisIg) },
            korrekcio: Number(korrekcio) || 0,
        };
    }

    /**
     * Hívás- és látogatásterv: a tavalyi vásárlás ÉVFORDULÓJA előtt keressük meg
     * a vevőt. A 30 napon belüli vásárlások egy alkalomnak számítanak (aki egy
     * héten belül háromszor vett, azt egyszer kell felhívni), és a forgalom
     * felső P százalékát adó vevőket meg is látogatjuk (Pareto).
     */
    function tervezo(sorok, beallitas, ma) {
        var b = {
            hivasNap: Number(beallitas && beallitas.hivasNap >= 0 ? beallitas.hivasNap : 30),
            latogatasNap: Number(beallitas && beallitas.latogatasNap >= 0 ? beallitas.latogatasNap : 14),
            pareto: Number(beallitas && beallitas.pareto > 0 ? beallitas.pareto : 70),
        };
        var most = ma ? nap(ma) : new Date();
        most = new Date(most.getFullYear(), most.getMonth(), most.getDate());

        var gy = {};
        (sorok || []).slice().sort(function (a, c) { return String(a.datum).localeCompare(String(c.datum)); })
            .forEach(function (s) {
                var nev = String(s.vevo || '').trim();
                if (nev === '' || !s.datum) return;

                gy[nev] = gy[nev] || { vevo: nev, ft: 0, megye: null, uzletkoto: null, alkalmak: [] };
                var v = gy[nev];
                v.ft += ft(s);
                if (!v.megye && !ures(s.megye)) v.megye = s.megye;
                if (!v.uzletkoto && !ures(s.uzletkoto)) v.uzletkoto = s.uzletkoto;

                var akt = v.alkalmak.length ? v.alkalmak[v.alkalmak.length - 1] : null;
                var d = nap(s.datum);
                if (akt && Math.abs((d - nap(akt.ig)) / 86400000) <= ALKALOM_RES) {
                    akt.ig = s.datum;
                    akt.ft += ft(s);
                    akt.kg += kg(s);
                    akt.termekek[csoportNev(s)] = (akt.termekek[csoportNev(s)] || 0) + ft(s);
                } else {
                    var t = {};
                    t[csoportNev(s)] = ft(s);
                    v.alkalmak.push({ datum: s.datum, ig: s.datum, ft: ft(s), kg: kg(s), termekek: t });
                }
            });

        var lista = Object.keys(gy).map(function (k) { return gy[k]; });
        var osszes = lista.reduce(function (a, v) { return a + v.ft; }, 0);

        // Pareto: a legnagyobbaktól lefelé, amíg az együttes forgalmuk el nem éri a P%-ot.
        var nagyok = {};
        var hatar = osszes * b.pareto / 100;
        var gyult = 0;
        lista.slice().sort(function (a, c) { return c.ft - a.ft; }).forEach(function (v) {
            if (gyult >= hatar) return;
            nagyok[v.vevo] = true;
            gyult += v.ft;
        });

        var kiSorok = [];
        lista.forEach(function (v) {
            v.alkalmak.forEach(function (a) {
                // Az évforduló: a vásárlás napja egy évvel később; ha az már
                // elmúlt, a következő évit vesszük – a terv előre néz.
                var d = nap(a.datum);
                var evf = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate());
                while (evf < most) evf = new Date(evf.getFullYear() + 1, evf.getMonth(), evf.getDate());

                var eltol = function (d2, n) { return new Date(d2.getFullYear(), d2.getMonth(), d2.getDate() - n); };
                var latogatando = !!nagyok[v.vevo];

                kiSorok.push({
                    vevo: v.vevo,
                    megye: v.megye,
                    uzletkoto: v.uzletkoto,
                    evesFt: v.ft,
                    nagy: latogatando,
                    alkalomDatum: a.datum,
                    ft: a.ft,
                    kg: a.kg,
                    termekek: Object.keys(a.termekek).sort(function (x, y) { return a.termekek[y] - a.termekek[x]; }),
                    hivas: eltol(evf, b.hivasNap),
                    latogatas: latogatando ? eltol(evf, b.latogatasNap) : null,
                });
            });
        });

        kiSorok.sort(function (a, c) { return a.hivas - c.hivas; });

        return {
            van: kiSorok.length > 0,
            sorok: kiSorok,
            beallitas: b,
            osszegzes: {
                vevo: lista.length,
                nagyVevo: Object.keys(nagyok).length,
                alkalom: kiSorok.length,
                latogatas: kiSorok.filter(function (s) { return s.latogatas !== null; }).length,
            },
        };
    }

    /**
     * A terv IDŐZÍTÉSE: a nyers megkeresésekből konkrét napok lesznek.
     *
     * A sorrend, ahogy a nap eldől:
     *  1. soronkénti saját dátum (amit kézzel írtak be),
     *  2. soronkénti saját nap-eltolás,
     *  3. a cikkcsoport (faj) nap-eltolása,
     *  4. a globális beállítás.
     *
     * Utána: hétvégére nem tervezünk, a már elmúlt nap a legközelebbi munkanapra
     * kerül („késve”), és ha a napi keret betelt, a kisebb vevő a következő
     * munkanapra csúszik – a nagyobb marad elöl.
     */
    function idozit(terv, beallitas, csoportNapok, egyeni, ma) {
        var b = terv.beallitas;
        var hivasMax = Number(beallitas && beallitas.hivasMax) || 0;
        var latogatasMax = Number(beallitas && beallitas.latogatasMax) || 0;
        var most = nap(ma);
        var cs = csoportNapok || {};
        var eg = egyeni || {};

        function munkanap(d) {
            var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            while (x.getDay() === 0 || x.getDay() === 6) x = new Date(x.getFullYear(), x.getMonth(), x.getDate() + 1);
            return x;
        }
        function kovetkezo(d) { return munkanap(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)); }
        function kulcsa(s) { return s.vevo + '|' + s.alkalomDatum; }

        var sorok = (terv.sorok || []).map(function (s) {
            var kulcs = kulcsa(s);
            var e = eg[kulcs] || {};
            var faj = s.termekek.length ? s.termekek[0] : '(nincs cikkcsoport)';
            var fajNap = cs[faj] || {};

            // Az évfordulót visszaszámoljuk: a hívás dátuma + a hozzá tartozó nap.
            var evfordulo = new Date(s.hivas.getFullYear(), s.hivas.getMonth(), s.hivas.getDate() + b.hivasNap);

            var hivasNap = e.hivas !== undefined && e.hivas !== null ? e.hivas
                : (fajNap.hivas !== undefined && fajNap.hivas !== null ? fajNap.hivas : b.hivasNap);
            var latogatasNap = e.latogatas !== undefined && e.latogatas !== null ? e.latogatas
                : (fajNap.latogatas !== undefined && fajNap.latogatas !== null ? fajNap.latogatas : b.latogatasNap);

            var hivasSajat = !!e.hivasDatum || e.hivas !== undefined && e.hivas !== null;
            var hivasDatum = e.hivasDatum ? nap(e.hivasDatum)
                : new Date(evfordulo.getFullYear(), evfordulo.getMonth(), evfordulo.getDate() - hivasNap);

            var latogatasSajat = !!e.latogatasDatum || e.latogatas !== undefined && e.latogatas !== null;
            var latogatasDatum = e.latogatasDatum ? nap(e.latogatasDatum)
                : new Date(evfordulo.getFullYear(), evfordulo.getMonth(), evfordulo.getDate() - latogatasNap);

            return {
                kulcs: kulcs,
                vevo: s.vevo,
                megye: s.megye,
                uzletkoto: s.uzletkoto,
                evesFt: s.evesFt,
                nagy: s.nagy,
                faj: faj,
                termekek: s.termekek,
                alkalomDatum: s.alkalomDatum,
                ft: s.ft,
                kg: s.kg,
                evfordulo: evfordulo,
                hivasNap: hivasNap,
                latogatasNap: latogatasNap,
                hivasSajat: hivasSajat,
                latogatasSajat: latogatasSajat,
                // Alapból mindenkit hívunk; látogatni a nagyokat (Pareto) – ez felülírható.
                hivasBe: e.hivasBe !== undefined ? !!e.hivasBe : true,
                latogatasBe: e.latogatasBe !== undefined ? !!e.latogatasBe : !!s.nagy,
                hivasDatum: hivasDatum,
                latogatasDatum: latogatasDatum,
                hivasKesve: false,
                latogatasKesve: false,
                hivasCsuszott: false,
                latogatasCsuszott: false,
            };
        });

        // Hétvége és múlt: a legközelebbi munkanapra.
        sorok.forEach(function (s) {
            ['hivas', 'latogatas'].forEach(function (m) {
                var d = s[m + 'Datum'];
                if (!d) return;
                if (d < most) { s[m + 'Kesve'] = true; d = most; }
                s[m + 'Datum'] = munkanap(d);
            });
        });

        // Napi keret: a nagyobb vevő marad a napon, a kisebb csúszik.
        [['hivas', hivasMax], ['latogatas', latogatasMax]].forEach(function (p) {
            var mit = p[0];
            var keret = p[1];
            if (!(keret > 0)) return;

            var aktivak = sorok.filter(function (s) { return s[mit + 'Be']; })
                .sort(function (a, c) {
                    return (a[mit + 'Datum'] - c[mit + 'Datum']) || (c.evesFt - a.evesFt);
                });

            var napiDb = {};
            aktivak.forEach(function (s) {
                var d = s[mit + 'Datum'];
                var k = d.getTime();
                while ((napiDb[k] || 0) >= keret) {
                    d = kovetkezo(d);
                    k = d.getTime();
                    s[mit + 'Csuszott'] = true;
                }
                napiDb[k] = (napiDb[k] || 0) + 1;
                s[mit + 'Datum'] = d;
            });
        });

        return sorok;
    }

    /**
     * A lista cikkcsoportonként csoportosítva – a tervező így haladható végig:
     * egy szezonban egy fajjal foglalkozik az ember.
     */
    function csoportosit(sorok) {
        var gy = {};
        sorok.forEach(function (s) {
            gy[s.faj] = gy[s.faj] || { faj: s.faj, sorok: [], hivas: 0, latogatas: 0, ft: 0 };
            gy[s.faj].sorok.push(s);
            gy[s.faj].ft += s.ft;
            if (s.hivasBe) gy[s.faj].hivas++;
            if (s.latogatasBe) gy[s.faj].latogatas++;
        });

        return Object.keys(gy).map(function (k) { return gy[k]; })
            .sort(function (a, b) { return b.ft - a.ft; });
    }

    /** A munkaigény-motor bemenete: a bázis vevői és ami már a listán van. */
    function munkaigenyAdat(sorok, terv, tervezoEredmeny, ma) {
        var v = vevok(sorok).map(function (x) { return { nev: x.vevo, ft: x.netto }; });

        return {
            ma: ma,
            vevok: v,
            terv: terv || null,
            tervben: {
                partner: {
                    hivas: tervezoEredmeny ? tervezoEredmeny.osszegzes.alkalom : 0,
                    latogatas: tervezoEredmeny ? tervezoEredmeny.osszegzes.latogatas : 0,
                },
                piaci: { hivas: 0, latogatas: 0 },
            },
        };
    }

    glob.CegesElemzes = {
        szur: szur,
        valaszthato: valaszthato,
        ertekesites: ertekesites,
        vevok: vevok,
        besorolas: besorolas,
        elorejelzes: elorejelzes,
        tervezo: tervezo,
        idozit: idozit,
        csoportosit: csoportosit,
        munkaigenyAdat: munkaigenyAdat,
        ALKALOM_RES: ALKALOM_RES,
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
