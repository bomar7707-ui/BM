# Horský zápisník & Archív tras (Verze 1.2)

Jednotná webová aplikace pro evidenci horských výšlapů, interaktivní mapový archív GPX tras, plánovač tras, výškové profily s analýzou sklonu terénu, analytiku, horské milníky, správu účastníků s automatickým odesíláním milníků e-mailem a exporty (Excel, PDF, JSON, GPX).

> **„KDYŽ NEMÁŠ CESTU, NEMŮŽEŠ ZTRATIT CÍL“**

---

## Přehled verzí (Changelog)

### Verze 1.2 (Aktuální)
- **Označení verze v horní liště (`Navbar.tsx`):** Zobrazení aktuální verze (`v1.2`) přímo vedle tlačítka pro export.
- **Úprava e-mailového oznámení o milníku (`milestoneCardGenerator.ts`):** České úvodní oznámení a přímý odkaz na veřejnou adresu aplikace `https://bomar7707-ui.github.io/BM/`.

### Verze 1.1
- **Plánované trasy (`PlannedRoutesView`):** Samostatná sekce s mapovým podkladem a zjednodušeným zápisníkem pro ukládání plánovaných tras (GPX soubory, odkazy na mapu, rozšířené poznámky, automatické barevné odlišení tras na mapě a zvýraznění po kliknutí).
- **Účastníci (`ParticipantsView`):** Sekce s ikonou turisty v horní liště (mezi Tiskem a Exportem) se seznamem účastníků, zadáním e-mailové adresy a automatickým i ručním odesíláním samostatného grafického certifikátu (PNG karty) při splnění milníku.
- **Chronologický Tisk a PDF (`PrintReportView` & `pdfCanvas.ts`):** Řazení tras od nejstarší k nejnovější, automatické vkládání splněných milníků přímo mezi trasy podle data splnění a přehled nesplněných milníků na konci sestavy.

### Verze 1.0
- Základní sjednocená aplikace: **Mapa a trasy**, **Zápisník**, **Analytika** (s rozdělením denních a vícedenních kumulovaných rekordů), **Milníky** (30 horských výzev), **Tisk a PDF** a **Export / Záloha**.

---

## Hlavní funkce

- **Mapa a trasy (`MapView`)**
  - Interaktivní mapa (Turistická Mapy.cz Outdoor & Topografická OpenTopoMap).
  - Přehled načtených tras s délkami jednotlivých úseků i celkovou délkou trasy.
  - Interaktivní výškový profil s barevným rozlišením sklonu terénu (*Rovina < 5 %*, *Standard 5–10 %*, *Prudký 10–20 %*, *Extrém > 20 %*) a synchronizací bodu na mapě.
- **Zápisník (`HikeForm` & `HikeList`)**
  - Zadávání jednodenních i vícedenních výšlapů, nahrávání GPX souborů k jednotlivým úsekům a automatický součet délek úseků.
  - Cloudová synchronizace s **Firebase Firestore** (`moje-hory`, kolekce `vyslapy`, `planovane_trasy`, `ucastnici`) + lokální záloha v prohlížeči.
- **Plánované trasy (`PlannedRoutesView`)**
  - Samostatná mapa a zápisník pro chystané výlety s nahráním GPX trasy, odkazem na mapu, poznámkou a automatickým barevným odlišením každé trasy.
- **Analytika (`AnalyticsView`)**
  - Přehled aktivních dnů, celkové vzdálenosti, nastoupaných a sestoupaných metrů.
  - Samostatné vyhodnocení **Nejdelší denní trasy** vs. **Nejdelší kumulované trasy (vícedenní)** a **Nejvyššího denního stoupání** vs. **Nejvyššího kumulovaného stoupání (vícedenní)**.
  - Graf měsíční aktivity, kalendářová heatmapa, analýza sklonu terénu a výškových zón.
- **Milníky (`MilestonesView`) & Účastníci (`ParticipantsView`)**
  - 23 horských výzev rozdělených do 3 kategorií (Kilometrové výzvy, Výškové milníky, Časové a sezónní milníky).
  - Evidence e-mailových adres účastníků a automatické generování a odesílání samostatného milníku na e-mail po jeho splnění.
- **Tisk a exporty (`PrintReportView`)**
  - Chronologická tisková sestava a PDF (od nejstarší trasy po nejnovější s vloženými splněnými milníky a přehledem nesplněných milníků na konci), export do Excelu (`.xlsx`) a záloha dat do `.json`.

---

## Lokální spuštění

1. **Instalace závislostí:**
   ```bash
   npm install
   ```

2. **Spuštění vývojového serveru (port 3000):**
   ```bash
   npm run dev
   ```

3. **Sestavení produkční verze (`dist/`):**
   ```bash
   npm run build
   ```
