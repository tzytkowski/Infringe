# Infringe · Metro Detroit Crime Atlas

A root-level Next.js and MapLibre app inspired by the map interface in `OSIRIS/osiris`. It plots public Detroit Police Department Records Management System (RMS) and regional CLEMIS offense records as separate sources. Filter by recent period, year, and offense category; pan and zoom the map; load additional pages from the incident stream.

## Run locally

```powershell
npm install
npm run dev
```

Open <http://localhost:3000>. `npm run typecheck` and `npm run build` verify the app.

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

## Data and coverage

- **Detroit Police · city** reads the [City of Detroit RMS Crime Incidents dataset](https://data.detroitmi.gov/datasets/detroitmi::rms-crime-incidents/about) through its [ArcGIS FeatureServer](https://services2.arcgis.com/qvkbeam7Wirps6zC/ArcGIS/rest/services/RMS_Crime_Incidents/FeatureServer/0). The city says records are extracted hourly. Detroit history starts in December 2016.
- **Oakland + Macomb · CLEMIS** reads the public [CLEMIS offense layer](https://services1.arcgis.com/cobAR8TNI9VyhY8z/arcgis/rest/services/PublicCrimeSearchOffenses/FeatureServer/4) used by the [CLEMIS Public Crime Search](https://experience.arcgis.com/experience/a945468523494efe97f8ab28d689f6dd). The default map now spans both full counties. Incident and category queries use generalized Oakland and Macomb polygons from the public [Michigan County Boundaries layer](https://services8.arcgis.com/oPzYIHLHP6C6pRlh/ArcGIS/rest/services/Michigan_County_Boundaries/FeatureServer/9). The public crime layer covers only participating agencies, so it does not provide complete crime reporting for every city or department. The map focus control zooms to both counties, Oakland, or Macomb; counts and records always use both counties. As checked in September 2026, the public layer has 2026 records but no 2025 records in this region; its year selector starts at 2026.
- The sources remain separate because agency coverage, offense labels, and publication schedules differ. A row represents an offense, so one event can have multiple rows. Locations may be approximate. Counts reflect the selected source and filters; the map initially loads up to 1,000 CLEMIS or 500 Detroit records, and **Load more records** pages through the rest. The heatmap and group summary describe **loaded records only**. Heat colors show relative concentration at the current zoom, not a crime rate or a comparison across different filter selections. Recent selections refresh every five minutes and are not a live dispatch feed.
- Neither incident layer has a **victim, suspect, or arrestee race field**. The race control therefore reports that it is unavailable. It would be misleading to infer a person's race from a neighborhood, scanner transmission, or Facebook post. The Michigan State Police [MICR data standard](https://www.michigan.gov/msp/divisions/cjic/micr/micr-data-elements) defines victim, offender, and arrest race separately; its [crime dashboard](https://www.michigan.gov/msp/divisions/cjic/dashboard-portal) is a separate statewide source and cannot assign race to these map points.

## Scanner and Facebook reports

The app links to public scanner listening pages as separate sources. A dispatch call is not proof that a crime occurred, and it is not plotted as a verified incident. [Broadcastify's feed catalog API](https://support.broadcastify.com/hc/en-us/articles/204740425-Live-Audio-Feed-Catalog-API-v-1-3-Documentation) requires an approved license and API key. For a scanner ingest, obtain a licensed stream or operate a lawful receiver, transcribe events, preserve source/time and review status, and keep those reports in a distinct **unverified leads** layer.

Meta requires approved access for reading public Page content through its APIs. Connecting a page such as Macomb County Scanner would require a Meta app with the appropriate Page permissions or cooperation from the page owner. The app does not scrape Facebook or convert posts into police records. Any future import should retain the original post URL, posting time, source label, and verification state.

## Structure

- `src/lib/arcgis-client.ts` validates filters and queries public ArcGIS incidents and categories in the browser.
- `src/components/CrimeMap.tsx` renders a MapLibre heat layer and selected-record highlight on OpenStreetMap tiles.
- `src/app/page.tsx` contains the filters, records, counts, and source links.
- `OSIRIS/` remains the reference project you added. The running Infringe app is entirely in the repository root.
