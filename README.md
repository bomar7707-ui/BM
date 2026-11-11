# Horský zápisník & Archív tras

Jednotná webová aplikace pro evidenci horských výšlapů, interaktivní mapový archív GPX tras, výškové profily s analýzou sklonu terénu, analytiku, horské milníky a exporty (Excel, PDF, JSON, GPX).

> **„KDYŽ NEMÁŠ CESTU, NEMŮŽEŠ ZTRATIT CÍL“**

---

## Hlavní funkce

- **Mapa a trasy (`MapView`)**
  - Interaktivní mapa (Turistická Mapy.cz Outdoor & Topografická OpenTopoMap).
  - Přehled načtených tras s délkami jednotlivých úseků i celkovou délkou trasy.
  - Interaktivní výškový profil s barevným rozlišením sklonu terénu (*Rovina < 5 %*, *Standard 5–10 %*, *Prudký 10–20 %*, *Extrém > 20 %*) a synchronizací bodu na mapě.
- **Zápisník (`HikeForm` & `HikeList`)**
  - Zadávání jednodenních i vícedenních výšlapů, nahrávání GPX souborů k jednotlivým úsekům a automatický součet délek úseků.
  - Cloudová synchronizace s **Firebase Firestore** (`moje-hory`, kolekce `vyslapy`) + lokální záloha v prohlížeči.
- **Analytika (`AnalyticsView`)**
  - Přehled aktivních dnů, celkové vzdálenosti, nastoupaných a sestoupaných metrů.
  - Samostatné vyhodnocení **Nejdelší denní trasy** vs. **Nejdelší kumulované trasy (vícedenní)** a **Nejvyššího denního stoupání** vs. **Nejvyššího kumulovaného stoupání (vícedenní)**.
  - Graf měsíční aktivity, kalendářová heatmapa, analýza sklonu terénu a výškových zón.
- **Milníky (`MilestonesView`)**
  - 30 horských výzev rozdělených do 3 kategorií (Kilometrové výzvy, Výškové milníky, Časové a sezónní milníky) s nezávislým filtrováním podle roku, účastníka a stavu splnění.
- **Tisk a exporty (`PrintReportView`)**
  - Tisková sestava, export do PDF, Excelu (`.xlsx`) a záloha dat do `.json`.

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

---

## Nasazení na GitHub a GitHub Pages

Projekt je plně připraven k okamžitému nasazení na **GitHub Pages** pomocí připravené GitHub Action (`.github/workflows/deploy.yml`) a relativních cest (`base: './'` ve `vite.config.ts`).

### Postup krok za krokem:

1. **Nahrání kódu do nového GitHub repozitáře:**
   ```bash
   git init
   git add .
   git commit -m "První verze: Horský zápisník a Archív tras"
   git branch -M main
   git remote add origin https://github.com/<vase-jmeno>/<nazev-repozitare>.git
   git push -u origin main
   ```

2. **Aktivace GitHub Pages v repozitáři:**
   - Na GitHubu otevřete svůj repozitář a přejděte do **Settings → Pages**.
   - V sekci **Build and deployment → Source** vyberte **GitHub Actions**.
   - Při každém nahrání změn (`git push`) do větve `main` se v záložce **Actions** automaticky spustí workflow **Nasazení na GitHub Pages**, které aplikaci sestaví a publikuje.
