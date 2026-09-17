# Értékesítés-elemző

Értékesítési export elemzése **a böngészőben**: kimutatás, vásárlási előrejelzés,
vevőelemzés besorolással, valamint hívás- és látogatásterv a bevételi terv
munkaigényével együtt.

## Az adat nem hagyja el a gépet

Nincs kiszolgáló és nincs feltöltés. A táblázatot a böngésző olvassa be, és minden
számolás ott fut. A lap a betöltött adatot a böngésző saját tárában jegyzi meg,
hogy ne kelljen újra behúzni — az **Adat törlése** gombbal bármikor kiüríthető.

Ezért kerülhet ki ez a lap nyilvános tárhelyre: **adat nincs benne**, csak a program.

## Használat

1. Nyisd meg a lapot.
2. Húzd rá az értékesítési exportot (CSV vagy XLSX), vagy válaszd ki.
3. Szűrj üzleti évre, megyére, üzletkötőre, cikkcsoportra — a négy nézet együtt mozog.

Kipróbáláshoz a **Példaadat betöltése** gomb kitalált nevekkel tölt fel egy kis mintát.

### Milyen fájlt vár?

Fejléc (a sorrend mindegy, az ékezet és a kis-nagybetű is):

```
Üzleti év | Számlázási dátum | Vevőkód | Vevőnév | Megye | Cikkszám | Terméknév |
Cikkcsoport | Értékesített mennyiség | Mértékegység | Nettó árbevétel |
Pénznemkód | Fedezet/árrés Ft | Üzletkötőkód
```

A megye kétféle alakja („HU-CSONG” és „CSONGRÁD”) egy megyévé olvad össze, különben
minden kimutatásban kétszer jelenne meg. Csak a **kg**-ban mért sorok adódnak össze
mennyiségként — a zsák és a darab nem.

**A CSV a legbiztosabb út** (Excelből: „CSV (pontosvesszővel tagolt)”), mert internet
nélkül is megy. Az XLSX olvasásához a lap egy külső könyvtárat tölt le.

## A négy nézet

- **Értékesítés** — öt mutató (nettó árbevétel, fedezet, fedezeti hányad, értékesített
  mennyiség, vásárló vevő) és öt diagram: üzleti évek havi lefutása, legnagyobb
  cikkcsoportok, megyék részesedése, üzletkötők árbevétele, fedezeti hányad
  cikkcsoportonként. Alatta megye × üzletkötő kimutatás, cikkcsoportok és az üzleti évek
  lefedettsége. A **Piac** szűrővel belföldre vagy exportra (EUR-számla) szűkíthető — az
  összeg ott is forintban van, átváltás nélkül.
- **Vásárlási előrejelzés** — cikkcsoportonként, kg-ban, a következő 12 hónapra. A bázis az
  utolsó adatos hónappal záruló év *azonos naptári hónapja*: a vetőmag szezonális, egy
  éves átlag elmosná a szezont. Kézi korrekció ±.
- **Vevőelemzés** — ki mit és mennyit vásárolt, és a besorolása:
  - **Platinalistás** — eléri a platina szintet; ezen belül **mentendő**, aki egy korábbi
    üzleti évben már elérte, de most nincs ott, és **potenciális**, aki még sosem érte el,
    de a közelében jár;
  - **Mikro vevő** — mindenki más.
  A szint és a „közel” határ a lapon átírható (alapból 5 M Ft és 70 %). A szint éves
  árbevétel, ezért a besorolás mindig egy üzleti évre néz.
- **Hívás- és látogatásterv** — a tavalyi vásárlás évfordulója előtt keressük meg a vevőt;
  a 30 napon belüli vásárlások egy alkalomnak számítanak. A lista **munkaeszköz**:
  - cikkcsoportonként csoportosítva (egy szezonban egy fajjal dolgozik az ember), a
    csoport fejlécében a faj saját nap-beállításával;
  - soronként pipával ki-be kapcsolható a hívás és a látogatás;
  - a „nap” és a konkrét dátum soronként átírható — a saját érték keretes, a késve dátum
    piros (az ideális nap elmúlt), a napi keret miatt csúsztatott szaggatott;
  - napi keret (legfeljebb ennyi hívás és látogatás naponta): ami nem fér bele, a
    következő munkanapra csúszik, a nagyobb vevő marad elöl; hétvégére nem tervez;
  - kereső és „csak a látogatandók” szűrő, vevőnkénti rangsor (hányadik, mekkora rész);
  - **három nézet**: Lista, **Naptár** (havi rács, a tételek nyilakkal egy nappal arrébb
    tehetők, a keret fölötti nap sárga) és **Éves** (cikkcsoportonként, hónapról hónapra —
    mikor jön a dömping);
  - **megyenapok**: megadható, melyik hétköznap melyik megyékbe mész, és a látogatások
    (kérésre a hívások is) a hetükön belül a megyéjük napjára kerülnek;
  - **naptár feltöltése**: napi célszámig jelölteket teszünk a szabad helyre — olyan
    vevőket, akik vettek már a hét aktuális cikkcsoportjából, de arra a hétre nincsenek
    betervezve (a nagyobb vevő megy előbb). A jelöltek külön jelöléssel látszanak, és
    egyenként kivehetők.

  Fölötte a **bevételi terv → munkaigény**: a célösszegből vevőszám, abból látogatás,
  hívás és árajánlat — méret szerint más úton, meglévő és új vevőkre külön. Minden szám
  átírható; üresen hagyva a bázisból számolt érték marad.

  A kézi módosítások ezen a gépen megmaradnak; a „Kézi módosítások törlése” visszaállít.
  **Telefonszám szándékosan nincs a listán** (GDPR).

## Szerkezet

```
index.html
css/stil.css
js/beolvaso.js    fájlbeolvasás, oszlopfelismerés, megye-egységesítés
js/elemzes.js     kimutatás, előrejelzés, vevőelemzés, besorolás, tervező
js/munkaigeny.js  a bevételi terv → munkaigény számolója
js/app.js         a felület
tests/            node-os tesztek a számolásokra
```

A számolás tesztelt: `node tests/teszt.cjs` (a böngészővel azonos kódot futtatja).
