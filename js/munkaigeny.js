/**
 * Bevételi terv → munkaigény a céges (bemutató) adatkörre.
 *
 * Ugyanaz a gondolatmenet, mint a Tervek → Hívás- és látogatási terv lapon:
 * a célösszegből vevőszám lesz (átlagos vásárlás szerint), a vevőszámból pedig
 * látogatás, hívás és árajánlat — méret szerint más úton, két szegmensre külön:
 *
 *   MEGLÉVŐ VEVŐK (kulcs: partner) – ők hozzák a bázist
 *   ÚJ VEVŐK      (kulcs: piaci)   – tőlük jön a növekedés
 *
 *   NAGY:    csak személyes látogatásból lesz üzlet
 *   KÖZEPES: a látogatási keret maradékát töltik ki, a többiek telefonon
 *   KICSI:   csak telefon, kérésre árajánlat
 *
 * A méretet ITT csak a vásárolt forint dönti el: ebben az adatkörben nincs
 * hektár (a valódi tervezőben a gazdaságméret vagy a támogatási hektár is
 * beleszól).
 *
 * A számolás szándékosan KÜLÖN FÁJLBAN, tiszta függvényként van: így a
 * böngésző és a node (teszt) ugyanazt futtatja, és a GitHubra kitett,
 * szerver nélküli változatban is ugyanez a motor dolgozik.
 */
(function (glob) {
    'use strict';

    var SZEG = ['partner', 'piaci'];
    var MERETEK = ['nagy', 'kozepes', 'kicsi'];

    var ALAP_HATAR = { nagyFt: 3000000, kicsiFt: 500000 };
    var ALAP_ARANY = {
        nagy: { latKonv: { partner: 40, piaci: 20 }, hivLat: { partner: 60, piaci: 30 } },
        kozepes: { latKonv: { partner: 35, piaci: 15 }, hivLat: { partner: 50, piaci: 25 }, hivVasarlas: { partner: 10, piaci: 4 } },
        kicsi: { hivAjanlat: { partner: 30, piaci: 15 }, ajanlatNyer: { partner: 40, piaci: 20 } },
    };
    /** Melyik méretnél melyik arányokat kérdezzük. */
    var ARANY_MEZOK = {
        nagy: ['latKonv', 'hivLat'],
        kozepes: ['latKonv', 'hivLat', 'hivVasarlas'],
        kicsi: ['hivAjanlat', 'ajanlatNyer'],
    };

    /** Felfelé kerekítés, a lebegőpontos maradék nélkül (3/0.3 = 10, nem 11). */
    function felfele(x) { return Math.ceil(x - 1e-9); }

    function szamVagy(v, alap) {
        if (v === null || v === undefined || v === '') return alap;
        var n = Number(v);
        return isFinite(n) ? n : alap;
    }

    function datum(s) {
        var r = String(s).split('-').map(Number);
        return new Date(r[0], r[1] - 1, r[2]);
    }

    function napEltol(d, n) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
    }

    /**
     * A beállítás kiegészítése az alapértékekkel. Az üresen hagyott mező
     * (null) azt jelenti: „a bázisból” – nem azt, hogy nulla.
     */
    function beallitas(nyers) {
        var b = nyers || {};
        var h = b.hatarok || {};
        var ki = {
            partnerArany: b.partnerArany === null || b.partnerArany === undefined ? null : szamVagy(b.partnerArany, null),
            hatarok: {
                nagyFt: szamVagy(h.nagyFt, ALAP_HATAR.nagyFt) || ALAP_HATAR.nagyFt,
                kicsiFt: szamVagy(h.kicsiFt, ALAP_HATAR.kicsiFt) || ALAP_HATAR.kicsiFt,
            },
            meretArany: { partner: {}, piaci: {} },
            atlag: { partner: {}, piaci: {} },
            napi: {
                partner: { lat: Math.max(0, szamVagy((b.napi || {}).partnerLat, 0)), hiv: Math.max(0, szamVagy((b.napi || {}).partnerHiv, 0)) },
                piaci: { lat: Math.max(0, szamVagy((b.napi || {}).piaciLat, 0)), hiv: Math.max(0, szamVagy((b.napi || {}).piaciHiv, 0)) },
            },
        };
        SZEG.forEach(function (sz) {
            MERETEK.forEach(function (m) {
                var a = ((b.meretArany || {})[sz] || {})[m];
                var t = ((b.atlag || {})[sz] || {})[m];
                ki.meretArany[sz][m] = a === null || a === undefined || a === '' ? null : Math.max(0, Math.min(100, Number(a) || 0));
                ki.atlag[sz][m] = t === null || t === undefined || t === '' || Number(t) <= 0 ? null : Math.round(Number(t));
            });
        });
        MERETEK.forEach(function (m) {
            ki[m] = {};
            ARANY_MEZOK[m].forEach(function (k) {
                ki[m][k] = {};
                SZEG.forEach(function (sz) {
                    var v = ((b[m] || {})[k] || {})[sz];
                    ki[m][k][sz] = v === null || v === undefined || v === '' ? ALAP_ARANY[m][k][sz] : Math.max(0.1, Math.min(100, Number(v) || ALAP_ARANY[m][k][sz]));
                });
            });
        });
        return ki;
    }

    /** Méret a vásárolt forint alapján (hektár ebben az adatkörben nincs). */
    function meretBesorol(ft, hatarok) {
        if (!(ft > 0)) return 'kozepes';
        return ft >= hatarok.nagyFt ? 'nagy' : (ft >= hatarok.kicsiFt ? 'kozepes' : 'kicsi');
    }

    /**
     * @param adat {vevok:[{ft}], terv:{cel,bazisFt,tol,ig}, tervben:{partner:{hivas,latogatas},piaci:{…}}, ma:'YYYY-MM-DD'}
     * @param nyers a lapon átírt beállítás
     */
    function szamol(adat, nyers) {
        var T = beallitas(nyers);
        var H = T.hatarok;
        var terv = adat.terv || {};
        var cel = Math.max(0, Number(terv.cel) || 0);

        // A bázis vevői méret szerint: innen jön a méret-arány és az átlagos vásárlás.
        var bazis = { nagy: { ft: 0, db: 0 }, kozepes: { ft: 0, db: 0 }, kicsi: { ft: 0, db: 0 } };
        (adat.vevok || []).forEach(function (v) {
            var ft = Number(v.ft) || 0;
            var m = meretBesorol(ft, H);
            bazis[m].ft += ft;
            bazis[m].db++;
        });
        var bazisOssz = bazis.nagy.ft + bazis.kozepes.ft + bazis.kicsi.ft;

        // A cél megosztása: alapból a meglévő vevők hozzák a bázist, a növekedés az újaktól jön.
        var bazisFt = Number(terv.bazisFt) > 0 ? Number(terv.bazisFt) : bazisOssz;
        var alapPartnerFt = cel > 0 ? Math.min(cel, bazisFt) : 0;
        var alapArany = cel > 0 ? Math.round(alapPartnerFt / cel * 1000) / 10 : 100;
        var kezi = T.partnerArany !== null;
        var arany = kezi ? T.partnerArany : alapArany;
        var celSzeg = kezi
            ? { partner: cel * arany / 100, piaci: cel * (100 - arany) / 100 }
            : { partner: alapPartnerFt, piaci: Math.max(0, cel - alapPartnerFt) };

        // Az időszak hátralévő munkanapjai (ha nincs megadva, egy év mától).
        var ma = datum(adat.ma);
        var tol = terv.tol && datum(terv.tol) > ma ? datum(terv.tol) : ma;
        var ig = terv.ig ? datum(terv.ig) : napEltol(tol, 364);
        var napok = 0;
        for (var d = tol; d <= ig; d = napEltol(d, 1)) {
            if (d.getDay() !== 0 && d.getDay() !== 6) napok++;
        }

        var alapResz = {};
        var alapAtlag = {};
        var becsult = { nagy: H.nagyFt * 1.5, kozepes: (H.nagyFt + H.kicsiFt) / 2, kicsi: H.kicsiFt / 2 };
        MERETEK.forEach(function (m) {
            alapResz[m] = bazisOssz > 0 ? Math.round(bazis[m].ft / bazisOssz * 1000) / 10 : ({ nagy: 40, kozepes: 40, kicsi: 20 })[m];
            alapAtlag[m] = Math.round(bazis[m].db ? bazis[m].ft / bazis[m].db : becsult[m]);
        });

        // Méretenként a szükséges vevő, látogatás, hívás, ajánlat.
        var E = {};
        var reszOssz = { partner: 0, piaci: 0 };
        SZEG.forEach(function (sz) {
            E[sz] = {};
            MERETEK.forEach(function (m) {
                var resz = T.meretArany[sz][m] === null ? alapResz[m] : T.meretArany[sz][m];
                reszOssz[sz] += resz;
                var celFt = celSzeg[sz] * resz / 100;
                var atlag = T.atlag[sz][m] === null ? alapAtlag[m] : T.atlag[sz][m];
                E[sz][m] = {
                    resz: resz, atlag: atlag, alapAtlag: alapAtlag[m], kezi: T.atlag[sz][m] !== null,
                    cel: celFt, vevo: atlag > 0 ? felfele(celFt / atlag) : 0,
                    viaLat: 0, telefonos: 0, lat: 0, hiv: 0, ajanlat: 0,
                };
            });

            // Nagy: hívásból időpont, a látogatásból üzlet.
            var n = E[sz].nagy;
            n.lat = T.nagy.latKonv[sz] > 0 ? felfele(n.vevo / (T.nagy.latKonv[sz] / 100)) : 0;
            n.hiv = T.nagy.hivLat[sz] > 0 ? felfele(n.lat / (T.nagy.hivLat[sz] / 100)) : 0;

            // Közepes: a látogatási keret maradéka látogatással, a többi telefonon.
            var k = E[sz].kozepes;
            var latKonv = T.kozepes.latKonv[sz] / 100;
            var keret = T.napi[sz].lat > 0 ? T.napi[sz].lat * napok : Infinity;
            var maradek = Math.max(0, keret - n.lat);
            k.viaLat = latKonv > 0 ? Math.min(k.vevo, maradek === Infinity ? k.vevo : Math.floor(maradek * latKonv)) : 0;
            k.telefonos = k.vevo - k.viaLat;
            k.lat = latKonv > 0 ? felfele(k.viaLat / latKonv) : 0;
            k.hiv = (T.kozepes.hivLat[sz] > 0 ? felfele(k.lat / (T.kozepes.hivLat[sz] / 100)) : 0)
                + (T.kozepes.hivVasarlas[sz] > 0 ? felfele(k.telefonos / (T.kozepes.hivVasarlas[sz] / 100)) : 0);

            // Kicsi: hívás → árajánlat-kérés → üzlet.
            var c = E[sz].kicsi;
            c.ajanlat = T.kicsi.ajanlatNyer[sz] > 0 ? felfele(c.vevo / (T.kicsi.ajanlatNyer[sz] / 100)) : 0;
            c.hiv = T.kicsi.hivAjanlat[sz] > 0 ? felfele(c.ajanlat / (T.kicsi.hivAjanlat[sz] / 100)) : 0;
        });

        var ossz = { partner: { vevo: 0, hiv: 0, lat: 0, ajanlat: 0 }, piaci: { vevo: 0, hiv: 0, lat: 0, ajanlat: 0 } };
        SZEG.forEach(function (sz) {
            MERETEK.forEach(function (m) {
                ['vevo', 'hiv', 'lat', 'ajanlat'].forEach(function (x) { ossz[sz][x] += E[sz][m][x]; });
            });
        });
        var mind = {
            vevo: ossz.partner.vevo + ossz.piaci.vevo,
            hiv: ossz.partner.hiv + ossz.piaci.hiv,
            lat: ossz.partner.lat + ossz.piaci.lat,
            ajanlat: ossz.partner.ajanlat + ossz.piaci.ajanlat,
        };

        // Ami már a tervben van: a lap hívásai és látogatásai (mind meglévő vevő).
        var beTerv = adat.tervben || {};
        var tervben = {};
        SZEG.forEach(function (sz) {
            tervben[sz] = {
                hivas: Math.max(0, Number((beTerv[sz] || {}).hivas) || 0),
                latogatas: Math.max(0, Number((beTerv[sz] || {}).latogatas) || 0),
            };
        });

        // Hány munkanap kellene a beállított napi célszámokkal (a két kör párhuzamosan halad).
        var napKell = 0;
        var hianyzoCelszam = false;
        SZEG.forEach(function (sz) {
            [['hiv', 'hiv'], ['lat', 'lat']].forEach(function (p) {
                var x = p[0];
                if (ossz[sz][x] <= 0) return;
                if (!(T.napi[sz][x] > 0)) { hianyzoCelszam = true; return; }
                napKell = Math.max(napKell, Math.ceil(ossz[sz][x] / T.napi[sz][x]));
            });
        });

        var figyelem = SZEG.filter(function (sz) { return Math.abs(reszOssz[sz] - 100) > 0.5; })
            .map(function (sz) {
                return (sz === 'partner' ? 'A meglévő vevők' : 'Az új vevők') + ' méret szerinti részei '
                    + (Math.round(reszOssz[sz] * 10) / 10) + ' %-ot adnak ki 100 helyett.';
            }).join(' ');

        return {
            beallitas: T,
            cel: cel, arany: arany, alapArany: alapArany, kezi: kezi, celSzeg: celSzeg,
            bazis: bazis, bazisOssz: bazisOssz, bazisFt: bazisFt,
            alapResz: alapResz, alapAtlag: alapAtlag,
            napok: napok,
            idoszak: { tol: tol, ig: ig },
            E: E, ossz: ossz, mind: mind, tervben: tervben,
            hiany: {
                partner: { hivas: Math.max(0, ossz.partner.hiv - tervben.partner.hivas), latogatas: Math.max(0, ossz.partner.lat - tervben.partner.latogatas) },
                piaci: { hivas: Math.max(0, ossz.piaci.hiv - tervben.piaci.hivas), latogatas: Math.max(0, ossz.piaci.lat - tervben.piaci.latogatas) },
            },
            napi: napok > 0 ? { hivas: mind.hiv / napok, latogatas: mind.lat / napok } : null,
            napKell: napKell,
            hianyzoCelszam: hianyzoCelszam,
            belefer: napok > 0 && !hianyzoCelszam && napKell <= napok,
            figyelem: figyelem,
        };
    }

    var api = {
        szamol: szamol,
        beallitas: beallitas,
        meretBesorol: meretBesorol,
        SZEG: SZEG,
        MERETEK: MERETEK,
        ALAP_HATAR: ALAP_HATAR,
        ALAP_ARANY: ALAP_ARANY,
        ARANY_MEZOK: ARANY_MEZOK,
    };

    // Sima böngésző-szkript (a projekt .js fájljai ESM-ként töltődnének be, ezért
    // itt nincs export): a lap és a node-os teszt is így, lefuttatva használja.
    glob.CegesMunkaigeny = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
