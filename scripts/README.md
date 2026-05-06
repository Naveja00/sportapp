# NBA Prop Hunter Pro - Local Setup

This folder contains the scripts needed to keep your NBA stats updated.

## 1. Setup
Install the required Python libraries:
```bash
pip install nba_api pandas
```

## 2. Data Migration
Place your existing `nba_cache.json` (the one with your 5-year history) into this `scripts/` folder.

## 3. Running the Update
Run the script to fetch the latest game data and update your stats:
```bash
python nba_cacher.py
```
*Note: The web app is configured to ignore changes in the `scripts/` folder, so running this script won't cause the website to refresh and lose your pasted odds.*

## 4. Syncing to Web App
1. The script will generate a file called `nba_stats_upload.csv`.
2. Open your Google Sheet: [Your Sheet Link](https://docs.google.com/spreadsheets/d/1Ej3dcAyp-Ss82R1x6zG9_0tktk01nUFLpwR65PHraN0/edit)
3. Go to **File > Import > Upload** and select `nba_stats_upload.csv`.
4. Choose **"Replace current sheet"**.
5. In the Web App, click **"Sync Sheets"** to pull the new data.

## 5. Running the Web App Locally
If you want to run the actual website on your PC:
1. Install Node.js (if you haven't already).
2. In the root folder (where `package.json` is), run:
   ```bash
   npm install
   npm run dev
   ```
3. Open `http://localhost:3000` in your browser.
