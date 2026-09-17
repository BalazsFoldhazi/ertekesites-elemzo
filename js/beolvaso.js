/**
 * Értékesítési export beolvasása a BÖNGÉSZŐBEN.
 *
 * A fájl nem megy sehova: nincs feltöltés, nincs kiszolgáló. A táblázatot a
 * böngésző olvassa be, és minden számolás itt, ezen a gépen fut.
 *
 * A fejléc, amit vár (a CRM-ben használt export):
 *   Üzleti év | Számlázási dátum | Vevőkód | Vevőnév | Megye | Cikkszám |
 *   Terméknév | Cikkcsoport | Értékesített mennyiség | Mértékegység |
 *   Nettó árbevétel | Pénznemkód | Fedezet/árrés Ft | Üzletkötőkód
 *
 * Három dolgot tesz helyre, ugyanúgy, ahogy a CRM betöltője:
 *  - a fejléc alakja mindegy („Nettó árbevétel”, „netto_arbevetel”, csupa nagybetű),
 *  - a megye kétféle alakban szerepel ugyanarra a megyére („HU-CSONG” és
 *    „CSONGRÁD”) – összevonja, különben minden kimutatásban kétszer jelenne meg,
 *  - a dátum lehet „2026.07.30” vagy Excel-sorszám.
 */
(function (glob) {
    'use strict';

    /** Csak a tömegben mért sorok adódnak össze (a zsák és a darab nem). */
    var TOMEG_EGYSEG = 'KG';

    /** A rövidített/prefixes megyenevek egységesítése. */
    var MEGYE_ALIAS = {
        'CSONG': 'CSONGRÁD',
        'CSONGRAD': 'CSONGRÁD',
        'BEKES': 'BÉKÉS',
        'NOGRAD': 'NÓGRÁD',
        'JASZ-NAGYKUN-SZOLNOK': 'SZOLNOK',
        'JÁSZ-NAGYKUN-SZOLNOK': 'SZOLNOK',
        'BAZ': 'BORSOD-ABAÚJ-ZEMPLÉN',
        'BP': 'BUDAPEST',
    };

    /** Ékezet és írásjelek nélküli, kisbetűs alak a fejléc-kulcsokhoz. */
    function tomorit(s) {
        return String(s === null || s === undefined ? '' : s)
            .trim().toLowerCase()
            .replace(/[áà]/g, 'a').replace(/é/g, 'e').replace(/[íì]/g, 'i')
            .replace(/[óöő]/g, 'o').replace(/[úüű]/g, 'u')
            .replace(/[^a-z0-9]/g, '');
    }

    /** Megye egységesítés: HU- előtag le, „megye” utótag le, rövidítés feloldva. */
    function megye(nyers) {
        var m = String(nyers === null || nyers === undefined ? '' : nyers).trim().toUpperCase();
        if (m === '') return null;
        m = m.replace(/^HU-/, '');
        m = m.replace(/\s+MEGYE$/, '').trim();
        return MEGYE_ALIAS[m] || m;
    }

    /** Szám: a szóköz (és a nem törő szóköz) elhagyva, a tizedesvessző pont lesz. */
    function szam(v) {
        if (v === null || v === undefined) return null;
        if (typeof v === 'number') return isFinite(v) ? v : null;
        var s = String(v).replace(/[\s ]/g, '').replace(',', '.');
        if (s === '') return null;
        var n = Number(s);
        return isFinite(n) ? n : null;
    }

    function ketJegy(n) { return (n < 10 ? '0' : '') + n; }

    /** Dátum → 'ÉÉÉÉ-HH-NN'. Kezeli a „2026.07.30” alakot és az Excel-sorszámot. */
    function datum(v) {
        if (v === null || v === undefined) return null;

        if (v instanceof Date && !isNaN(v)) {
            return v.getFullYear() + '-' + ketJegy(v.getMonth() + 1) + '-' + ketJegy(v.getDate());
        }

        var s = String(v).trim();
        if (s === '') return null;

        // Az Excel néha sorszámot ad (1900-as rendszer).
        if (/^\d+([.,]\d+)?$/.test(s) && Number(s.replace(',', '.')) > 20000) {
            var d = new Date(Math.round((Number(s.replace(',', '.')) - 25569) * 86400 * 1000));
            return d.getUTCFullYear() + '-' + ketJegy(d.getUTCMonth() + 1) + '-' + ketJegy(d.getUTCDate());
        }

        var r = s.replace(/\.$/, '').replace(/[./]/g, '-').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (r) return r[1] + '-' + ketJegy(Number(r[2])) + '-' + ketJegy(Number(r[3]));

        var p = new Date(s);
        return isNaN(p) ? null : p.getFullYear() + '-' + ketJegy(p.getMonth() + 1) + '-' + ketJegy(p.getDate());
    }

    function rovid(v, hossz) {
        var s = String(v === null || v === undefined ? '' : v).trim();
        return s === '' ? null : s.slice(0, hossz);
    }

    /**
     * Egy nyers sor (fejléc → érték) átfordítása.
     *
     * @return {object|null} null = nem értelmezhető sor
     */
    function sor(nyers) {
        var r = {};
        Object.keys(nyers).forEach(function (k) { r[tomorit(k)] = nyers[k]; });

        var vevo = String(r.vevonev === null || r.vevonev === undefined ? '' : r.vevonev).trim();
        var termek = String(r.termeknev === null || r.termeknev === undefined ? '' : r.termeknev).trim();
        if (vevo === '' && termek === '') return null;

        var nyersMegye = String(r.megye === null || r.megye === undefined ? '' : r.megye).trim();

        return {
            uzleti_ev: rovid(r.uzletiev, 20),
            datum: datum(r.szamlazasidatum),
            vevo_kod: rovid(r.vevokod, 60),
            vevo: (vevo !== '' ? vevo : '(névtelen vevő)').slice(0, 250),
            megye: megye(nyersMegye),
            cikkszam: rovid(r.cikkszam, 60),
            termek: (termek !== '' ? termek : '(névtelen termék)').slice(0, 300),
            // A cikkcsoport a kimutatások „faj” szintje.
            faj: rovid(r.cikkcsoport, 120),
            mennyiseg: szam(r.ertekesitettmennyiseg),
            egyseg: rovid(r.mertekegyseg, 20),
            osszeg: szam(r.nettoarbevetel),
            fedezet: szam(r.fedezetarresft),
            uzletkoto: rovid(r.uzletkotokod, 30),
            // A pénznemkód CSAK azt jelöli, hogy exportszámla: az árbevétel és a
            // fedezet ezeknél is forintban áll, tehát nem kell átváltani.
            penznem: rovid(r.penznemkod, 10),
        };
    }

    /**
     * Fejléces sorok (objektumok) → tiszta sorok.
     *
     * @return {{sorok: Array, beolvasott: number, kihagyott: number}}
     */
    function sorokbol(nyersSorok) {
        var sorok = [];
        var kihagyott = 0;

        (nyersSorok || []).forEach(function (ny) {
            var s = sor(ny);
            if (s === null) { kihagyott++; return; }
            sorok.push(s);
        });

        return { sorok: sorok, beolvasott: (nyersSorok || []).length, kihagyott: kihagyott };
    }

    /**
     * CSV szétbontása mezőkre – idézőjeles mezőkkel együtt.
     *
     * Az elválasztót az első sorból találjuk ki: a magyar Excel pontosvesszőt ír.
     */
    function csvTabla(szoveg) {
        var s = String(szoveg).replace(/^﻿/, '');   // BOM le
        var elsoSorVege = s.indexOf('\n');
        var elso = elsoSorVege === -1 ? s : s.slice(0, elsoSorVege);
        var pv = (elso.match(/;/g) || []).length;
        var v = (elso.match(/,/g) || []).length;
        var elvalaszto = pv > v ? ';' : ',';

        var sorok = [];
        var mezok = [];
        var mezo = '';
        var idezoben = false;

        for (var i = 0; i < s.length; i++) {
            var c = s[i];

            if (idezoben) {
                if (c === '"') {
                    if (s[i + 1] === '"') { mezo += '"'; i++; } else { idezoben = false; }
                } else {
                    mezo += c;
                }
                continue;
            }

            if (c === '"') { idezoben = true; continue; }
            if (c === elvalaszto) { mezok.push(mezo); mezo = ''; continue; }
            if (c === '\r') continue;
            if (c === '\n') { mezok.push(mezo); sorok.push(mezok); mezok = []; mezo = ''; continue; }
            mezo += c;
        }
        if (mezo !== '' || mezok.length) { mezok.push(mezo); sorok.push(mezok); }

        return sorok;
    }

    /**
     * CSV szöveg → tiszta sorok.
     *
     * @return {{sorok: Array, beolvasott: number, kihagyott: number, fejlec: Array}}
     */
    function csvBol(szoveg) {
        var tabla = csvTabla(szoveg).filter(function (s) {
            return s.length > 1 || (s.length === 1 && String(s[0]).trim() !== '');
        });
        if (tabla.length === 0) return { sorok: [], beolvasott: 0, kihagyott: 0, fejlec: [] };

        var fejlec = tabla[0].map(function (c) { return String(c).trim(); });
        var nyersSorok = [];

        for (var i = 1; i < tabla.length; i++) {
            var ny = {};
            for (var j = 0; j < fejlec.length; j++) {
                ny[fejlec[j]] = tabla[i][j] !== undefined ? tabla[i][j] : null;
            }
            nyersSorok.push(ny);
        }

        var ki = sorokbol(nyersSorok);
        ki.fejlec = fejlec;
        return ki;
    }

    /** Megvan-e a fájlban az, amire szükségünk van? */
    function hianyzoOszlopok(fejlec) {
        var kell = {
            vevonev: 'Vevőnév',
            szamlazasidatum: 'Számlázási dátum',
            nettoarbevetel: 'Nettó árbevétel',
        };
        var van = {};
        (fejlec || []).forEach(function (f) { van[tomorit(f)] = true; });

        return Object.keys(kell).filter(function (k) { return !van[k]; }).map(function (k) { return kell[k]; });
    }

    glob.CegesBeolvaso = {
        csvBol: csvBol,
        sorokbol: sorokbol,
        hianyzoOszlopok: hianyzoOszlopok,
        tomorit: tomorit,
        megye: megye,
        szam: szam,
        datum: datum,
        TOMEG_EGYSEG: TOMEG_EGYSEG,
    };
})(typeof globalThis !== 'undefined' ? globalThis : this);
