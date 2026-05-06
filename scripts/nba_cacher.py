import json
import os
import pandas as pd
import statistics
import time
from nba_api.stats.endpoints import playergamelog, leaguedashplayerstats

# --- CONFIGURATION ---
CACHE_FILE = "nba_cache.json"
OUTPUT_CSV = "nba_stats_upload.csv"
CURRENT_SEASON = "2025-26"

def load_cache():
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, "r", encoding='utf-8') as f:
            return json.load(f)
    return {}

def save_cache(cache):
    with open(CACHE_FILE, "w", encoding='utf-8') as f:
        json.dump(cache, f, indent=2, ensure_ascii=False)

def get_league_player_list():
    """Fetches all active players for the current season."""
    print(f"🚀 Fetching league-wide player list for {CURRENT_SEASON}...")
    try:
        stats = leaguedashplayerstats.LeagueDashPlayerStats(season=CURRENT_SEASON).get_dict()
        headers = stats['resultSets'][0]['headers']
        rows = stats['resultSets'][0]['rowSet']
        h = {header: i for i, header in enumerate(headers)}
        return rows, h
    except Exception as e:
        print(f"❌ Error fetching league stats: {e}")
        return [], {}

def update_player_gamelogs(player_id, player_name, existing_logs):
    """Fetches new games and merges them with history."""
    try:
        print(f"   - Updating logs for {player_name}...")
        log = playergamelog.PlayerGameLog(player_id=player_id, season=CURRENT_SEASON).get_dict()
        new_rows = log['resultSets'][0]['rowSet']
        headers = log['resultSets'][0]['headers']
        h = {header: i for i, header in enumerate(headers)}
        
        # Convert to simple list of dicts
        new_logs = []
        for r in new_rows:
            new_logs.append({
                "GAME_ID": r[h['Game_ID']],
                "GAME_DATE": r[h['GAME_DATE']],
                "PTS": r[h['PTS']],
                "REB": r[h['REB']],
                "AST": r[h['AST']],
                "FG3M": r[h['FG3M']]
            })
        
        # Merge by Game_ID to avoid duplicates
        existing_ids = {g['GAME_ID'] for g in existing_logs}
        added_count = 0
        for g in new_logs:
            if g['GAME_ID'] not in existing_ids:
                existing_logs.insert(0, g) # Add to front
                added_count += 1
        
        if added_count > 0:
            print(f"     ✅ Added {added_count} new games.")
        return existing_logs
    except Exception as e:
        print(f"     ⚠️ Error updating {player_name}: {e}")
        return existing_logs

def main():
    cache = load_cache()
    player_rows, h = get_league_player_list()
    
    final_stats = []
    
    for i, r in enumerate(player_rows):
        p_name = r[h['PLAYER_NAME']]
        p_id = r[h['PLAYER_ID']]
        team = r[h['TEAM_ABBREVIATION']]
        
        # Initialize player in cache if missing
        if p_name not in cache:
            cache[p_name] = {"id": p_id, "team": team, "gamelogs": []}
        
        # Update Gamelogs (Incremental)
        cache[p_name]["gamelogs"] = update_player_gamelogs(p_id, p_name, cache[p_name]["gamelogs"])
        logs = cache[p_name]["gamelogs"]
        
        if not logs: continue

        # --- CALCULATE STATS ---
        def get_avg(key, n=None):
            vals = [l[key] for l in (logs[:n] if n else logs)]
            return round(sum(vals)/len(vals), 1) if vals else 0
            
        def get_std(key):
            vals = [l[key] for l in logs]
            return round(statistics.stdev(vals), 2) if len(vals) > 1 else 0

        final_stats.append({
            "Player": p_name,
            "Team": team,
            "Season": CURRENT_SEASON,
            "GP": len(logs),
            "PTS": get_avg("PTS"),
            "REB": get_avg("REB"),
            "AST": get_avg("AST"),
            "FG3M": get_avg("FG3M"),
            "Last10_PTS": get_avg("PTS", 10),
            "Last5_PTS": get_avg("PTS", 5),
            "Last10_REB": get_avg("REB", 10),
            "Last5_REB": get_avg("REB", 5),
            "Last10_AST": get_avg("AST", 10),
            "Last5_AST": get_avg("AST", 5),
            "Last10_3PM": get_avg("FG3M", 10),
            "Last5_3PM": get_avg("FG3M", 5),
            "StdDev_PTS": get_std("PTS"),
            "StdDev_REB": get_std("REB"),
            "StdDev_AST": get_std("AST"),
            "StdDev_3PM": get_std("FG3M")
        })
        
        # Save cache every 20 players to prevent data loss
        if i % 20 == 0:
            save_cache(cache)
        
        # Rate limiting (NBA API is sensitive)
        time.sleep(0.6)

    # Final Save
    save_cache(cache)
    pd.DataFrame(final_stats).to_csv(OUTPUT_CSV, index=False)
    print(f"\n🏁 ALL DONE!")
    print(f"📊 {len(final_stats)} players processed.")
    print(f"📁 Upload '{OUTPUT_CSV}' to your Google Sheet now.")

if __name__ == "__main__":
    main()
