# Infringe · Metro Detroit Crime Atlas

A root-level Next.js and MapLibre OSINT dashboard app. Select Detroit Police, regional CLEMIS, Michigan CJIC crime and victim data, and individually reviewed local news homicide cases. Filter by period, offense, and reported victim race; inspect original source fields and article links in record details.

The offense menu includes a Homicide / Murder group that matches source labels containing homicide, murder, or manslaughter; record details retain each source's exact wording. Record sorting and the field/value dropdown operate on rows loaded into the records panel. The panel shows both its loaded-row count and the broader source-row count, with a button to load more rows. On the map, the crosshair centers on your location, a separate button resets the view, and the location marker shows the last position returned by the browser.

## Run locally

```powershell
npm install
npm run dev
```

Open <http://localhost:3000>. Startup and builds automatically prepare the downloaded CJIC files. `npm run typecheck`, `npm run test:cjic`, and `npm run build` verify the app.

If another development instance is already running, use an independent output directory and port:

```powershell
$env:INFRINGE_DIST_DIR='.next-cjic-dev'
npm run dev -- --port 3002
```

Open <http://localhost:3002> for that instance.

## Publish on GitHub Pages

The app exports static files and queries the public ArcGIS layers from each visitor's browser, so the recent data and filters continue to work on GitHub Pages. The deployment workflow in `.github/workflows/pages.yml` builds the site whenever `main` is pushed. It sets the repository path automatically (for this repository, `/Infringe`) and publishes the `out` directory.

To preview the Pages build locally, set the same path for both commands:

```powershell
$env:NEXT_PUBLIC_BASE_PATH='/Infringe'
npm run build
npm run preview:pages
```

Then open <http://127.0.0.1:3001/Infringe/>.

1. On GitHub, open **Infringe → Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**.
2. From this repository root, run:

   ```powershell
   git add .github .gitignore README.md next-env.d.ts next.config.ts package-lock.json package.json public src tools tsconfig.json
   git commit -m "Prepare Infringe for GitHub Pages"
   git push origin main
   ```

3. Check the **Actions** tab for the **Deploy GitHub Pages** run. When it succeeds, open <https://tzytkowski.github.io/Infringe/>. GitHub may take several minutes to publish the first deployment.

If you use a custom domain, remove the `NEXT_PUBLIC_BASE_PATH` setting in the workflow so asset URLs start at `/`. Public ArcGIS requests are made directly from the browser; any later private API or scanner ingestion will need a separate server.

## CJIC Files and Race Filters

The downloaded `public/data/michigan-cjic/crime-live.csv` and `victim-live.csv` contain only Macomb and Oakland counties, with 500,937 crime rows and 320,517 victim rows for 2021-2026. They are tab-delimited UTF-16 exports despite the `.csv` extension. The downloaded Live Data snapshot ends June 30, 2026; it is not a continuously updating feed.

`npm run data:cjic` creates lossless, dictionary-encoded year files in the ignored `public/data/michigan-cjic/prepared/` directory. A browser worker filters the entire selected dataset, searches all original fields, and calculates map totals before paginating the record list. The tests compare every original row and field to the prepared data and check map totals, pagination, source selection, and race linkage.

These CSVs contain reporting city/county and incident year, but no exact dates, street addresses, or incident coordinates. `OFFENSE_LOCATION` describes the type of premises, not an address. CJIC records therefore have null incident coordinates: they never create point hotspots or selected incident dots. CJIC heat colors the actual [Michigan Geographic Framework city, township, and village boundaries](https://gisagocss.state.mi.us/arcgis/rest/services/OpenData/michigan_geographic_framework/MapServer), clipped to the row's county. Cross-county places such as Northville use only the correct county portion. Colors represent matching rows per square kilometer, on a labeled logarithmic scale, using the same teal-to-red palette as agency heat. This is reporting-area density, not measured within-area distribution or population-adjusted crime risk. Institutions and other entries without a verified municipal boundary remain in records and totals, but are excluded from municipal heat and retained as county-only outlines and details. Selecting a CJIC record highlights its reporting boundary, never a made-up point. Recent day/week/month filters cannot include year-only CJIC dates.

Race is victim race. Victim rows filter on their original `RACE` value. Crime rows filter using victim races joined by county, year, `MICR_INCIDENTS_ID`, and `MICR_OFFENSE`; unlinked crime rows have no attributed race. Multiple selected races match any of those races. A crime row with several linked victim races remains one crime row. Detroit/CLEMIS records have no race fields and are excluded when a specific race filter is active. Clearing the race filter restores them. The selected sources may overlap, and crime rows and victim rows are never described as unique crimes.

Replace the two source files and restart or run `npm run data:cjic` to prepare a new download. The geography is bundled locally; `node tools/download-cjic-geography.mjs` refreshes the official boundary snapshot when needed.

## CJIC comparison and analysis

Open **Compare & analyze** beside the records tab, or select a reporting area and choose **Compare this reporting area**. Cohorts A and B each have independent place (both counties, one county, a municipality, or county-only locations), year, offense and victim-race filters. Both CJIC exports are always included. The default compares 2024 with 2025, the last two complete years in the bundled snapshot.

The worker aggregates every matching export row before any record pagination. The panel shows separate crime/victim totals, absolute and percentage changes, victim-to-crime row-volume ratios, sortable place tables, paired charts, offense breakdowns, year trends and victim race/age/sex breakdowns. **Export data** downloads cohort settings, all place totals and the selected breakdown as CSV. Analysis is calculated locally in the browser and uses no paid analysis service.

The comparison map can display A, B, or B minus A for crime or victim rows, with optional rows per square kilometer. Changes use a symmetric logarithmic scale: blue is lower in B, amber higher in B. A place outside one cohort is shown as A-only/B-only rather than falsely treating missing coverage as zero. Zero-match municipalities remain separate clickable overlays, including villages enclosed by townships. County-only rows remain in tables and totals with dashed county outlines and never contribute municipal density. Click a map area or a table place to highlight its boundary and inspect both counts. In Records, the CJIC map measure selector separates crime-row density from victim-row density; combining both requires selecting **All selected rows** explicitly.

The 2026 snapshot stops June 30; comparisons involving it are flagged as partial-year comparisons. Changes describe export row volumes, not unique crimes, unique people, population-adjusted risk, annualized trends, or causal relationships. Tests independently reconcile every city/year/source total and the analysis breakdowns against the original CSVs and verify county clipping, municipal aliases, empty overlays and missing-cohort handling.

**Compare last 2 full years** aligns place, offense, and victim-race filters across the latest two complete years. Because CJIC provides only incident years, it cannot compare the same months of a partial year against an earlier year. The panel hides percentage changes for unequal-length periods or counts below 10 while retaining raw differences.

## Data and coverage

- **Detroit Police · city** reads the [City of Detroit RMS Crime Incidents dataset](https://data.detroitmi.gov/datasets/detroitmi::rms-crime-incidents/about) through its [ArcGIS FeatureServer](https://services2.arcgis.com/qvkbeam7Wirps6zC/ArcGIS/rest/services/RMS_Crime_Incidents/FeatureServer/0). The city says records are extracted hourly. Detroit history starts in December 2016.
- **Oakland + Macomb · CLEMIS** reads the public [CLEMIS offense layer](https://services1.arcgis.com/cobAR8TNI9VyhY8z/arcgis/rest/services/PublicCrimeSearchOffenses/FeatureServer/4) used by the [CLEMIS Public Crime Search](https://experience.arcgis.com/experience/a945468523494efe97f8ab28d689f6dd). The default map now spans both full counties. Incident and category queries use generalized Oakland and Macomb polygons from the public [Michigan County Boundaries layer](https://services8.arcgis.com/oPzYIHLHP6C6pRlh/ArcGIS/rest/services/Michigan_County_Boundaries/FeatureServer/9). The public crime layer covers only participating agencies, so it does not provide complete crime reporting for every city or department. The map focus control zooms to both counties, Oakland, or Macomb; counts and records always use both counties. As checked in September 2026, the public layer has 2026 records but no 2025 records in this region; its year selector starts at 2026.
- Sources can be selected together, with each row labeled by source. The agency heatmap initially includes up to 1,000 CLEMIS and 500 Detroit rows; **Load more records** extends those agency layers. CJIC boundary heat and group counts use every matching CJIC row from the selected years regardless of record pagination. Adding CJIC does not change agency point weights. Agency heat colors show relative concentration at the current zoom, not a crime rate. Recent agency selections refresh every five minutes.
- The mapped Detroit and CLEMIS layers have no race fields. CJIC victim race is kept with its original records and reporting areas; the app does not infer race for Detroit or CLEMIS points.

## Local news reports

Select **Local news reports** under its own **Local news** data source section to see a separate case layer. It is designed to hold reviewed reports across crime categories; the current collection covers homicide only. The initial review dated September 30, 2026 contains three incidents: two in Detroit and one in Warren. Each case links directly to reporting from WXYZ and WDIV. A case is counted once even when both outlets cover it; its victim count is a separate field. This is a small, manually reviewed starting set, not a comprehensive crime count or a live police feed. News cases can overlap police and CJIC records, and the app does not attempt to match their IDs.

Orange circles are approximate nearby intersections from the cited reports. Their record details state what the marker represents. They are excluded from agency heat, and a case without a defensible intersection should have null coordinates and remain list-only. News cases have incident-date precision. The past-24-hours filter therefore includes a case when its reported calendar day overlaps the rolling 24-hour window; it does not claim an exact incident time. Year and all-years filters include every matching case present in the reviewed archive. Race is not inferred from articles. New articles do not automatically become mapped incidents.

Run `npm run data:news` to read the [WXYZ regional RSS feeds](https://www.wxyz.com/about-us/rss) and [WDIV news RSS feed](https://www.clickondetroit.com/rss/). The current collector targets homicide leads; future collectors can add other crime categories to the same local-news source. It saves headline, URL, publication time, category, and review status to `data/local-news/leads.json`; it does not download or republish article bodies. Review each lead in the original article, verify the incident and its category, distinguish the incident date from the publication date, combine articles about the same incident, and add one reviewed case to `public/data/local-news/incidents.json`. Keep one or more direct citations and document any approximate marker. Set a lead's `status` to `reviewed` or `dismissed` so a later run preserves your decision.

The collector uses the publishers' advertised RSS feeds only. RSS is a recent-headline feed, not a historical archive: running it regularly accumulates new leads going forward, but previous years require a separately sourced and reviewed backfill. [WXYZ's terms](https://www.wxyz.com/terms-of-use) prohibit automated page scraping without written permission. [WDIV's RSS page](https://www.clickondetroit.com/rss/) explicitly offers its feed; its [terms](https://www.grahammedia.com/terms) restrict republication of article content. Review these policies before changing the collector.

## Scanner and Facebook reports

The app links to public scanner listening pages as separate sources. A dispatch call is not proof that a crime occurred, and it is not plotted as a verified incident. [Broadcastify's feed catalog API](https://support.broadcastify.com/hc/en-us/articles/204740425-Live-Audio-Feed-Catalog-API-v-1-3-Documentation) requires an approved license and API key. For a scanner ingest, obtain a licensed stream or operate a lawful receiver, transcribe events, preserve source/time and review status, and keep those reports in a distinct **unverified leads** layer.

Meta requires approved access for reading public Page content through its APIs. Connecting a page such as Macomb County Scanner would require a Meta app with the appropriate Page permissions or cooperation from the page owner. The app does not scrape Facebook or convert posts into police records. Any future import should retain the original post URL, posting time, source label, and verification state.

## Structure

- `src/lib/arcgis-client.ts` validates filters and queries public ArcGIS incidents and categories in the browser.
- `src/components/CrimeMap.tsx` renders a MapLibre heat layer and selected-record highlight on OpenStreetMap tiles.
- `src/app/page.tsx` contains the filters, records, counts, and source links.
- `OSIRIS/` remains the reference project you added. The running Infringe app is entirely in the repository root.
