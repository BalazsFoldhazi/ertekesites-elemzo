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

    /**
     * A betöltött fájl ÁTVIZSGÁLÁSA: mi az, amiről dönteni kell.
     *
     * Kétféle sor kíván döntést:
     *  - MÍNUSZOS összeg: ezek nem hibák – jellemzően másképp kiegyenlített
     *    tételek. Lehet őket kihagyni, vagy pozitívra fordítani.
     *  - EUR-os (exportszámla) sor: van, ahol az összeg már forintban áll (akkor
     *    nem szabad átváltani), és van, ahol tényleg euróban.
     */
    function atvizsgalas(sorok) {
        var ki = {
            sor: (sorok || []).length,
            negativDb: 0, negativFt: 0,
            eurDb: 0, eurFt: 0,
            fedezetDb: 0, fedezetFt: 0,
            elso: null, utolso: null,
        };

        (sorok || []).forEach(function (s) {
            var e = ft(s);
            if (e < 0) { ki.negativDb++; ki.negativFt += e; }
            if (String(s.penznem || '').toUpperCase() === 'EUR') { ki.eurDb++; ki.eurFt += e; }
            if (s.fedezet !== null && s.fedezet !== undefined) { ki.fedezetDb++; ki.fedezetFt += Number(s.fedezet) || 0; }
            if (s.datum) {
                if (ki.elso === null || s.datum < ki.elso) ki.elso = s.datum;
                if (ki.utolso === null || s.datum > ki.utolso) ki.utolso = s.datum;
            }
        });

        return ki;
    }

    /**
     * A betöltéskor hozott döntések alkalmazása.
     *
     * Az EREDETI sorokat nem írjuk át: minden számolás ezen a származtatott
     * listán fut, így a döntés bármikor megváltoztatható.
     *
     * @param dontes {negativ:'valtozatlan'|'kihagy'|'pozitiv', eur:'marad'|'valt', arfolyam:number}
     */
    function dontesAlkalmaz(sorok, dontes) {
        var d = dontes || {};
        var arfolyam = Number(d.arfolyam) > 0 ? Number(d.arfolyam) : 0;
        var valt = d.eur === 'valt' && arfolyam > 0;
        if (d.negativ !== 'kihagy' && d.negativ !== 'pozitiv' && !valt) return sorok || [];

        var ki = [];
        (sorok || []).forEach(function (s) {
            var e = ft(s);
            if (e < 0 && d.negativ === 'kihagy') return;

            // A fedezet együtt mozog az összeggel: különben a fedezeti hányad hazudna.
            var uj = s;
            if (e < 0 && d.negativ === 'pozitiv') {
                uj = Object.assign({}, uj, {
                    osszeg: -e,
                    mennyiseg: Math.abs(Number(uj.mennyiseg) || 0),
                    fedezet: -(Number(uj.fedezet) || 0),
                });
            }
            if (valt && String(s.penznem || '').toUpperCase() === 'EUR') {
                uj = Object.assign({}, uj, {
                    osszeg: (Number(uj.osszeg) || 0) * arfolyam,
                    fedezet: (Number(uj.fedezet) || 0) * arfolyam,
                    atvaltva: true,
                });
            }
            ki.push(uj);
        });

        return ki;
    }

    /** A lap szűrői: üzleti év, megye, üzletkötő, cikkcsoport, keresés. */
    function szur(sorok, szuro) {
        var sz = szuro || {};
        var q = (sz.q || '').trim().toLowerCase();

        return (sorok || []).filter(function (s) {
            if (sz.ev && s.uzleti_ev !== sz.ev) return false;
            if (sz.megye && s.megye !== sz.megye) return false;
            if (sz.uzletkoto && s.uzletkoto !== sz.uzletkoto) return false;
            if (sz.cikkcsoport && csoportNev(s) !== sz.cikkcsoport) return false;
            // Piac: az EUR-os számla az exportot jelöli (az összeg forintban van).
            if (sz.piac === 'export' && String(s.penznem || '').toUpperCase() !== 'EUR') return false;
            if (sz.piac === 'hazai' && String(s.penznem || '').toUpperCase() === 'EUR') return false;
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
        // A fedezet/árrés az exportból jön, nem számolt érték.
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

    var HONAP_ROVID = ['jan', 'feb', 'márc', 'ápr', 'máj', 'jún', 'júl', 'aug', 'szept', 'okt', 'nov', 'dec'];

    /**
     * Üzleti évek havi lefutása: minden üzleti év 12 hónapja egymás mellett.
     *
     * Az üzleti év nem januárban kezdődik, ezért a hónapokat a LEGKORÁBBI adat
     * hónapjától sorolom – így a görbék fedik egymást, és összevethetők.
     */
    function evHavi(sorok) {
        var legkorabbi = null;
        (sorok || []).forEach(function (s) {
            if (s.datum && (legkorabbi === null || s.datum < legkorabbi)) legkorabbi = s.datum;
        });
        if (legkorabbi === null) return { evek: [], adat: {}, cimkek: [], kezdoHonap: 1 };

        var kezdo = Number(legkorabbi.slice(5, 7));
        var adat = {};

        (sorok || []).forEach(function (s) {
            if (!s.datum || ures(s.uzleti_ev)) return;
            var ho = Number(s.datum.slice(5, 7));
            var i = (ho - kezdo + 12) % 12;
            adat[s.uzleti_ev] = adat[s.uzleti_ev] || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            adat[s.uzleti_ev][i] += ft(s);
        });

        var cimkek = [];
        for (var j = 0; j < 12; j++) cimkek.push(HONAP_ROVID[(kezdo - 1 + j) % 12]);

        return { evek: Object.keys(adat).sort(), adat: adat, cimkek: cimkek, kezdoHonap: kezdo };
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

        // MEGYENAPOK: ha meg van adva, melyik hétköznap melyik megyékbe megyünk,
        // a tétel a saját hetén belül a megyéje napjára kerül. A kézzel beírt
        // dátumot nem írjuk felül – az a te döntésed volt.
        if (beallitas && beallitas.megyeNapBe) {
            var megyeNapjai = {};
            Object.keys(beallitas.megyeNapok || {}).forEach(function (n) {
                (beallitas.megyeNapok[n] || []).forEach(function (m) {
                    megyeNapjai[m] = megyeNapjai[m] || [];
                    megyeNapjai[m].push(Number(n));
                });
            });

            var mozgatando = ['latogatas'].concat(beallitas.megyeNapHivas ? ['hivas'] : []);
            sorok.forEach(function (s) {
                var napjai = megyeNapjai[s.megye];
                if (!napjai || !napjai.length) return;

                mozgatando.forEach(function (mit) {
                    var d = s[mit + 'Datum'];
                    if (!d || s[mit + 'Sajat']) return;

                    var hetfo = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
                    var legjobb = null;
                    napjai.forEach(function (n) {
                        var cel = new Date(hetfo.getFullYear(), hetfo.getMonth(), hetfo.getDate() + (n - 1));
                        if (cel < most) cel = new Date(cel.getFullYear(), cel.getMonth(), cel.getDate() + 7);
                        if (legjobb === null || Math.abs(cel - d) < Math.abs(legjobb - d)) legjobb = cel;
                    });
                    if (legjobb) {
                        s[mit + 'Datum'] = legjobb;
                        s[mit + 'Megyenap'] = true;
                    }
                });
            });
        }

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

    /**
     * A megyék listája a megyenapokhoz, forgalom szerint csökkenően.
     *
     * @return {Array<{megye: string, db: number}>}
     */
    function megyek(lista) {
        var gy = {};
        (lista || []).forEach(function (s) {
            if (!s.megye) return;
            gy[s.megye] = (gy[s.megye] || 0) + 1;
        });

        return Object.keys(gy).map(function (m) { return { megye: m, db: gy[m] }; })
            .sort(function (a, b) { return b.db - a.db || a.megye.localeCompare(b.megye, 'hu'); });
    }

    /**
     * NAPTÁR FELTÖLTÉSE: a napi célszámig jelölteket teszünk a szabad helyre.
     *
     * Jelölt az, aki VETT MÁR az adott héten aktuális cikkcsoportból, de azon a
     * héten nincs betervezve. A nagyobb vevő megy előbb. Ez nem „új” vevő: a
     * saját vevőkörből hozzuk vissza azt, aki épp kimaradna.
     *
     * A hét „aktuális fajai” a már betervezett tételekből adódnak – ahogy a
     * szezon halad, úgy vált a lista is.
     */
    function feltolt(lista, sorok, beallitas, ma) {
        var celHivas = Math.max(0, Number(beallitas && beallitas.napiHivas) || 0);
        if (!celHivas) return [];

        var tol = beallitas.tol ? nap(beallitas.tol) : nap(ma);
        var ig = beallitas.ig ? nap(beallitas.ig) : new Date(tol.getFullYear(), tol.getMonth() + 3, tol.getDate());
        if (ig < tol) return [];

        // Ki mit vett valaha, és mekkora a forgalma.
        var fajVevoi = {};
        var vevoFt = {};
        (sorok || []).forEach(function (s) {
            var nev = String(s.vevo || '').trim();
            if (nev === '') return;
            var faj = csoportNev(s);
            vevoFt[nev] = (vevoFt[nev] || 0) + ft(s);
            fajVevoi[faj] = fajVevoi[faj] || {};
            fajVevoi[faj][nev] = true;
        });

        var hetKulcs = function (d) {
            var h = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
            return h.getFullYear() + '-' + h.getMonth() + '-' + h.getDate();
        };

        // Ki van már betervezve azon a héten, és melyik fajok aktuálisak akkor.
        var hetiVevo = {};
        var hetiFaj = {};
        var napiDb = {};
        (lista || []).forEach(function (s) {
            if (!s.hivasBe || !s.hivasDatum) return;
            var hk = hetKulcs(s.hivasDatum);
            hetiVevo[hk] = hetiVevo[hk] || {};
            hetiVevo[hk][s.vevo] = true;
            hetiFaj[hk] = hetiFaj[hk] || {};
            hetiFaj[hk][s.faj] = (hetiFaj[hk][s.faj] || 0) + 1;
            var nk = ymd(s.hivasDatum);
            napiDb[nk] = (napiDb[nk] || 0) + 1;
        });

        var jeloltek = [];
        var mar = {};

        for (var d = new Date(tol.getFullYear(), tol.getMonth(), tol.getDate()); d <= ig;
            d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
            if (d.getDay() === 0 || d.getDay() === 6) continue;

            var nk2 = ymd(d);
            var hiany = celHivas - (napiDb[nk2] || 0);
            if (hiany <= 0) continue;

            var hk2 = hetKulcs(d);
            var fajok = Object.keys(hetiFaj[hk2] || {})
                .sort(function (a, b) { return hetiFaj[hk2][b] - hetiFaj[hk2][a]; });
            if (!fajok.length) continue;

            // A hét fajaiból a legnagyobb, még be nem tervezett vevők.
            // Aki több cikkcsoportból is vett, az CSAK EGYSZER kerüljön a
            // listába – különben ugyanaz a vevő többször jönne ki egy napra.
            var sor = [];
            var latott = {};
            fajok.forEach(function (faj) {
                Object.keys(fajVevoi[faj] || {}).forEach(function (nev) {
                    if ((hetiVevo[hk2] || {})[nev] || mar[nev] || latott[nev]) return;
                    latott[nev] = true;
                    sor.push({ vevo: nev, faj: faj, ft: vevoFt[nev] || 0 });
                });
            });
            sor.sort(function (a, b) { return b.ft - a.ft; });

            sor.slice(0, hiany).forEach(function (j) {
                mar[j.vevo] = true;
                hetiVevo[hk2] = hetiVevo[hk2] || {};
                hetiVevo[hk2][j.vevo] = true;
                napiDb[nk2] = (napiDb[nk2] || 0) + 1;
                jeloltek.push({
                    kulcs: 'jelolt|' + j.vevo + '|' + nk2,
                    vevo: j.vevo,
                    faj: j.faj,
                    evesFt: j.ft,
                    datum: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
                    ok: 'feltöltés – vett már ' + j.faj + '-ból, de erre a hétre nem volt betervezve',
                });
            });
        }

        return jeloltek;
    }

    /** Helyi nap szerinti 'ÉÉÉÉ-HH-NN' (a naptár napjaihoz). */
    function ymd(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    /**
     * Naptár-adat: melyik napra melyik hívás és látogatás esik.
     *
     * Csak a bekapcsolt tételek kerülnek bele – amit a listán kivettél, az a
     * naptárban sem foglal helyet.
     */
    function naptarAdat(lista) {
        var napok = {};
        var tesz = function (kulcs, mit, s) {
            napok[kulcs] = napok[kulcs] || { hivas: [], latogatas: [] };
            napok[kulcs][mit].push(s);
        };

        (lista || []).forEach(function (s) {
            if (s.hivasBe && s.hivasDatum) tesz(ymd(s.hivasDatum), 'hivas', s);
            if (s.latogatasBe && s.latogatasDatum) tesz(ymd(s.latogatasDatum), 'latogatas', s);
        });

        var honapok = {};
        Object.keys(napok).forEach(function (k) { honapok[k.slice(0, 7)] = true; });

        return { napok: napok, honapok: Object.keys(honapok).sort() };
    }

    /**
     * Éves nézet: a munka szezonalitása – cikkcsoportonként, hónapról hónapra
     * hány hívás és látogatás esik. Így látszik, mikor jön a dömping.
     */
    function evesAdat(lista) {
        var honapok = {};
        var gy = {};

        var tesz = function (s, d, mit) {
            var h = ymd(d).slice(0, 7);
            honapok[h] = true;
            gy[s.faj] = gy[s.faj] || { faj: s.faj, honapok: {}, ossz: { hivas: 0, latogatas: 0 } };
            gy[s.faj].honapok[h] = gy[s.faj].honapok[h] || { hivas: 0, latogatas: 0 };
            gy[s.faj].honapok[h][mit]++;
            gy[s.faj].ossz[mit]++;
        };

        (lista || []).forEach(function (s) {
            if (s.hivasBe && s.hivasDatum) tesz(s, s.hivasDatum, 'hivas');
            if (s.latogatasBe && s.latogatasDatum) tesz(s, s.latogatasDatum, 'latogatas');
        });

        var honapLista = Object.keys(honapok).sort();
        var ossz = {};
        honapLista.forEach(function (h) { ossz[h] = { hivas: 0, latogatas: 0 }; });

        var sorok = Object.keys(gy).map(function (k) { return gy[k]; });
        sorok.forEach(function (sor) {
            honapLista.forEach(function (h) {
                var c = sor.honapok[h];
                if (!c) return;
                ossz[h].hivas += c.hivas;
                ossz[h].latogatas += c.latogatas;
            });
        });
        sorok.sort(function (a, b) {
            return (b.ossz.hivas + b.ossz.latogatas) - (a.ossz.hivas + a.ossz.latogatas);
        });

        return { honapok: honapLista, sorok: sorok, ossz: ossz };
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
        atvizsgalas: atvizsgalas,
        dontesAlkalmaz: dontesAlkalmaz,
        szur: szur,
        valaszthato: valaszthato,
        ertekesites: ertekesites,
        evHavi: evHavi,
        vevok: vevok,
        besorolas: besorolas,
        elorejelzes: elorejelzes,
        tervezo: tervezo,
        idozit: idozit,
        csoportosit: csoportosit,
        naptarAdat: naptarAdat,
        evesAdat: evesAdat,
        megyek: megyek,
        feltolt: feltolt,
        munkaigenyAdat: munkaigenyAdat,
        ALKALOM_RES: ALKALOM_RES,
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
