import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";

const CACHE_PATH = path.join(process.cwd(), "nba_cache.json");
const ODDS_CACHE_PATH = path.join(process.cwd(), "odds_cache.json");
const ODDS_HISTORY_PATH = path.join(process.cwd(), "odds_history.json");
const BASELINE_PATH = path.join(process.cwd(), "src/data/nba_stats.json");

function loadCache() {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"));
    }
    if (fs.existsSync(BASELINE_PATH)) {
      return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf-8"));
    }
  } catch (e) {
    console.error("Error loading cache:", e);
  }
  return [];
}

function saveCache(data: any) {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error("Error saving cache:", e);
  }
}

function loadOddsCache() {
  try {
    if (fs.existsSync(ODDS_CACHE_PATH)) {
      const data = JSON.parse(fs.readFileSync(ODDS_CACHE_PATH, "utf-8"));
      // Cache for 12 hours (max 2 calls a day)
      const twelveHours = 12 * 60 * 60 * 1000;
      if (new Date().getTime() - new Date(data.timestamp).getTime() < twelveHours) {
        return data.odds;
      }
    }
  } catch (e) {
    console.error("Error loading odds cache:", e);
  }
  return null;
}

function saveOddsCache(odds: any) {
  try {
    fs.writeFileSync(ODDS_CACHE_PATH, JSON.stringify({
      timestamp: new Date().toISOString(),
      odds
    }, null, 2));
  } catch (e) {
    console.error("Error saving odds cache:", e);
  }
}

function loadOddsHistory() {
  try {
    if (fs.existsSync(ODDS_HISTORY_PATH)) {
      return JSON.parse(fs.readFileSync(ODDS_HISTORY_PATH, "utf-8"));
    }
  } catch (e) {
    console.error("Error loading odds history:", e);
  }
  return [];
}

function saveOddsHistory(newOdds: any[], source: string = "API") {
  try {
    const history = loadOddsHistory();
    const timestamp = new Date().toISOString();
    
    // Tag each entry with a timestamp and source
    const entries = newOdds.map(item => ({
      ...item,
      historyTimestamp: timestamp,
      historySource: source
    }));
    
    // Keep last 5000 entries (larger buffer for historical variance analysis)
    const updatedHistory = [...entries, ...history].slice(0, 5000);
    fs.writeFileSync(ODDS_HISTORY_PATH, JSON.stringify(updatedHistory, null, 2));
  } catch (e) {
    console.error("Error saving odds history:", e);
  }
}

// Helper to update a player in the cache
function updatePlayerInCache(playerData: any) {
  const cache = loadCache();
  
  const normalize = (name: string) => 
    name.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Remove accents
      .replace(/[.'-]/g, "")          // Remove punctuation
      .trim();

  const pNameNorm = normalize(playerData.Player);
  const index = cache.findIndex((p: any) => normalize(p.Player) === pNameNorm);
  
  if (index !== -1) {
    // Merge gamelogs if they exist
    let newGamelogs = cache[index].gamelogs || [];
    if (playerData.newGame) {
      const gameExists = newGamelogs.some((g: any) => g.date === playerData.newGame.date);
      if (!gameExists) {
        newGamelogs = [playerData.newGame, ...newGamelogs].slice(0, 15); // Keep last 15
      }
    } else if (playerData.gamelogs) {
      newGamelogs = playerData.gamelogs;
    }

    cache[index] = { 
      ...cache[index], 
      ...playerData, 
      gamelogs: newGamelogs,
      lastUpdated: new Date().toISOString() 
    };
    
    // Recalculate L5/L10 from logs if we have them
    if (newGamelogs.length > 0) {
      const calcAvg = (key: string, n: number) => {
        const slice = newGamelogs.slice(0, n);
        return parseFloat((slice.reduce((acc: number, g: any) => acc + (g[key] || 0), 0) / slice.length).toFixed(1));
      };
      
      cache[index].Last5_PTS = calcAvg('pts', 5);
      cache[index].Last10_PTS = calcAvg('pts', 10);
      cache[index].Last5_REB = calcAvg('reb', 5);
      cache[index].Last10_REB = calcAvg('reb', 10);
      cache[index].Last5_AST = calcAvg('ast', 5);
      cache[index].Last10_AST = calcAvg('ast', 10);
      cache[index].Last5_3PM = calcAvg('tpm', 5);
      cache[index].Last10_3PM = calcAvg('tpm', 10);
    }
  } else {
    cache.push({ ...playerData, lastUpdated: new Date().toISOString() });
  }
  
  saveCache(cache);
}

async function syncRecentGames() {
  console.log("🏀 Syncing recent game results...");
  try {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    
    const formatDate = (d: Date) => d.toISOString().split('T')[0].replace(/-/g, '');
    const dates = [formatDate(yesterday), formatDate(today)];
    
    for (const date of dates) {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
      const data = await res.json();
      
      for (const event of (data.events || [])) {
        if (event.status.type.completed) {
          // Fetch boxscore for this game
          const boxRes = await fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${event.id}`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });
          const boxData = await boxRes.json();
          
          const athletes = boxData.players?.flatMap((p: any) => p.statistics[0]?.athletes) || [];
          
          athletes.forEach((a: any) => {
            if (!a.athlete) return;
            const stats = a.stats; // Array of strings: ["MIN","FG","3PT","FT","OREB","DREB","REB","AST","STL","BLK","TO","PF","+/-","PTS"]
            // ESPN Boxscore indices: PTS is 13, REB is 6, AST is 7, 3PT is 2 (e.g. "2-5")
            
            const pts = parseInt(stats[13]) || 0;
            const reb = parseInt(stats[6]) || 0;
            const ast = parseInt(stats[7]) || 0;
            const tpm = parseInt(stats[2]?.split('-')[0]) || 0;
            
            updatePlayerInCache({
              Player: a.athlete.displayName,
              newGame: {
                date: event.date,
                pts, reb, ast, tpm,
                opp: event.competitions[0].competitors.find((c: any) => c.id !== a.athlete.teamId)?.team.abbreviation
              }
            });
          });
        }
      }
    }
    console.log("✅ Recent games synced.");
  } catch (e) {
    console.error("❌ Game Sync Failed:", e);
  }
}

// --- ESPN API UTILS ---
let espnCache: any = null;
let lastEspnFetch = 0;
let injuryCache: any = null;
let lastInjuryFetch = 0;

async function fetchEspnScoreboard() {
  const now = Date.now();
  if (espnCache && (now - lastEspnFetch < 300000)) return espnCache; // Cache for 5 mins

  try {
    const today = new Date();
    const tomorrow = new Date();
    tomorrow.setDate(today.getDate() + 1);

    const formatDate = (d: Date) => d.toISOString().split('T')[0].replace(/-/g, '');
    
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };

    // Fetch today and tomorrow
    const [resToday, resTomorrow] = await Promise.all([
      fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${formatDate(today)}`, { headers }),
      fetch(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${formatDate(tomorrow)}`, { headers })
    ]);

    const dataToday = await resToday.json();
    const dataTomorrow = await resTomorrow.json();

    espnCache = [...(dataToday.events || []), ...(dataTomorrow.events || [])];
    lastEspnFetch = now;
    return espnCache;
  } catch (e) {
    console.error("ESPN Fetch Error:", e);
    return espnCache || [];
  }
}

async function fetchInjuries() {
  const now = Date.now();
  if (injuryCache && (now - lastInjuryFetch < 600000)) return injuryCache; // Cache for 10 mins

  try {
    const res = await fetch("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries", {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const data = await res.json();
    injuryCache = data.injuries || [];
    lastInjuryFetch = now;
    return injuryCache;
  } catch (e) {
    console.error("Injury Fetch Error:", e);
    return injuryCache || [];
  }
}

function getDefensiveMatchup(oppAbbr: string, category: string) {
  // Simplified Defensive Rankings (Lower is better defense)
  // 1 = Elite Defense, 30 = Poor Defense
  const defRanks: Record<string, any> = {
    "MIN": { Points: 1, Rebounds: 5, Assists: 2 },
    "BOS": { Points: 2, Rebounds: 3, Assists: 1 },
    "OKC": { Points: 3, Rebounds: 10, Assists: 5 },
    "ORL": { Points: 4, Rebounds: 2, Assists: 8 },
    "NYK": { Points: 5, Rebounds: 1, Assists: 12 },
    "CLE": { Points: 6, Rebounds: 4, Assists: 6 },
    "MIA": { Points: 7, Rebounds: 15, Assists: 10 },
    "DEN": { Points: 8, Rebounds: 6, Assists: 4 },
    "PHI": { Points: 9, Rebounds: 12, Assists: 15 },
    "LAC": { Points: 10, Rebounds: 8, Assists: 7 },
    "WAS": { Points: 30, Rebounds: 30, Assists: 28 },
    "DET": { Points: 28, Rebounds: 25, Assists: 25 },
    "CHA": { Points: 29, Rebounds: 29, Assists: 30 },
    "SAS": { Points: 25, Rebounds: 20, Assists: 26 },
    "UTA": { Points: 27, Rebounds: 28, Assists: 29 },
    "POR": { Points: 26, Rebounds: 27, Assists: 24 },
    "ATL": { Points: 24, Rebounds: 26, Assists: 27 },
    "TOR": { Points: 23, Rebounds: 24, Assists: 23 },
    "MEM": { Points: 12, Rebounds: 18, Assists: 14 },
    "GSW": { Points: 15, Rebounds: 14, Assists: 18 },
    "LAL": { Points: 18, Rebounds: 12, Assists: 20 },
    "DAL": { Points: 20, Rebounds: 22, Assists: 22 },
    "PHX": { Points: 14, Rebounds: 16, Assists: 16 },
    "MIL": { Points: 22, Rebounds: 21, Assists: 19 },
    "IND": { Points: 21, Rebounds: 23, Assists: 21 },
    "SAC": { Points: 19, Rebounds: 19, Assists: 17 },
    "NOP": { Points: 11, Rebounds: 11, Assists: 9 },
    "HOU": { Points: 13, Rebounds: 7, Assists: 11 },
    "CHI": { Points: 16, Rebounds: 17, Assists: 13 },
    "BKN": { Points: 17, Rebounds: 13, Assists: 12 }
  };

  const rank = defRanks[oppAbbr]?.[category] || 15;
  if (rank <= 5) return { label: "Elite Defense", color: "red", score: -10 };
  if (rank <= 12) return { label: "Strong Defense", color: "orange", score: -5 };
  if (rank >= 25) return { label: "Weak Defense", color: "green", score: 10 };
  if (rank >= 18) return { label: "Average Defense", color: "yellow", score: 5 };
  return { label: "Neutral Matchup", color: "gray", score: 0 };
}

function getMatchupContext(teamAbbr: string, events: any[]) {
  const teamMap: Record<string, string> = {
    "BKN": "BKN", "PHX": "PHX", "GSW": "GS", "LAC": "LAC", "LAL": "LAL",
    "NOP": "NO", "NYK": "NY", "SAS": "SA", "UTA": "UT", "WAS": "WSH"
  };
  
  const searchAbbr = teamMap[teamAbbr] || teamAbbr;
  
  // Sort events to prioritize Live > Scheduled > Final
  const sortedEvents = [...events].sort((a, b) => {
    const statusA = a.status.type.description;
    const statusB = b.status.type.description;
    if (statusA === "In Progress" && statusB !== "In Progress") return -1;
    if (statusB === "In Progress" && statusA !== "In Progress") return 1;
    return 0;
  });

  for (const event of sortedEvents) {
    const status = event.status.type.description;
    if (status === "Final" || status === "Postponed") continue; // Skip finished games

    const teams = event.competitions[0].competitors;
    const home = teams.find((t: any) => t.homeAway === 'home');
    const away = teams.find((t: any) => t.homeAway === 'away');
    
    if (!home?.team || !away?.team) continue;
    
    if (home.team.abbreviation === searchAbbr || away.team.abbreviation === searchAbbr) {
      const isHome = home.team.abbreviation === searchAbbr;
      const opponent = isHome ? away : home;
      const clock = event.status.displayClock;
      const period = event.status.period;
      
      return {
        opponent: opponent.team.displayName,
        oppAbbr: opponent.team.abbreviation,
        location: isHome ? "vs" : "@",
        status: status === "Scheduled" ? "Upcoming" : status,
        score: `${away.score} - ${home.score}`,
        time: status === "In Progress" ? `Q${period} ${clock}` : event.status.type.shortDetail,
        venue: event.competitions[0].venue.fullName
      };
    }
  }
  return null;
}

// --- ANALYSIS UTILS ---

function getWinProb(avg: number, line: number, stdDev: number): number {
  if (stdDev <= 0) return avg >= line ? 0.85 : 0.15;
  
  // Z-Score: How many "consistency units" is the line from the average?
  const z = (avg - line) / stdDev;
  
  // Standard Normal Cumulative Distribution Function (Sigmoid Approximation)
  const prob = 1 / (1 + Math.exp(-1.7 * z));
  
  // REALITY CHECK: No bet is 100%. Clamp between 5% and 90%
  return Math.max(0.05, Math.min(0.90, prob));
}

function calculatePowerRank(winProb: number, ev: number, oddsInt: number, trendFactor: number): number {
  const oddsMultiplier = (oddsInt < -250) ? 0.75 : 1.0;
  
  // Scoring: Win Prob (50%) + EV (30%) + Trend (20%)
  const winScore = (winProb - 0.45) * 300; 
  const evScore = Math.min(50, ev * 1.5);
  const trendScore = (trendFactor - 1.0) * 100;

  return Math.max(0, Math.floor((winScore + evScore + trendScore) * oddsMultiplier));
}

async function bulkSyncLeagueStats() {
  console.log("🚀 Starting Global League Sync...");
  try {
    // ESPN's hidden API for league-wide player stats
    // Adding User-Agent to prevent 403s
    const response = await fetch("https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byplayer?region=us&lang=en&contentorigin=espn&limit=1000&sort=points%3Adesc", {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`ESPN API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data || !data.athletes) {
      return { success: false, error: "No athlete data found in response" };
    }

    const cache = loadCache();
    const now = new Date().toISOString();

    data.athletes.forEach((entry: any) => {
      const athlete = entry.athlete;
      const stats = entry.categories[0].stats; // Usually the main stats category
      
      // Map ESPN stats to our internal format
      const pName = athlete.displayName;
      const index = cache.findIndex((p: any) => p.Player.toLowerCase() === pName.toLowerCase());

      const getStat = (name: string) => stats.find((s: any) => s.name === name)?.value || 0;

      const updatedPlayer = {
        Player: pName,
        Team: athlete.team?.abbreviation || "N/A",
        PTS: getStat("avgPoints"),
        REB: getStat("avgRebounds"),
        AST: getStat("avgAssists"),
        FG3M: getStat("avgThreePointFieldGoalsMade"),
        GP: getStat("gamesPlayed"),
        lastUpdated: now,
        syncSource: "ESPN Bulk"
      };

      if (index !== -1) {
        cache[index] = { ...cache[index], ...updatedPlayer };
      } else {
        cache.push(updatedPlayer);
      }
    });

    saveCache(cache);
    console.log(`✅ Bulk Sync Complete. ${data.athletes.length} players updated.`);
    return { success: true, count: data.athletes.length };
  } catch (e: any) {
    console.error("❌ Bulk Sync Failed:", e);
    return { success: false, error: e.message || String(e) };
  }
}

async function deepSyncNbaStats(lastN: number = 0) {
  const label = lastN === 0 ? "Season" : `Last ${lastN}`;
  console.log(`🏀 Deep Syncing NBA.com ${label} Stats...`);
  
  try {
    const season = "2025-26";
    const url = `https://stats.nba.com/stats/leaguedashplayerstats?LastNGames=${lastN}&MeasureType=Base&Month=0&PaceAdjust=N&PerMode=PerGame&Period=0&PlusMinus=N&Rank=N&Season=${season}&SeasonSegment=&SeasonType=Regular+Season&TeamID=0&VsConference=&VsDivision=`;
    
    const response = await fetch(url, {
      headers: {
        'Host': 'stats.nba.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.nba.com/',
        'Origin': 'https://www.nba.com',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Connection': 'keep-alive'
      }
    });

    if (!response.ok) throw new Error(`NBA API returned ${response.status}`);
    
    const data = await response.json();
    const headers = data.resultSets[0].headers;
    const rows = data.resultSets[0].rowSet;
    const h = Object.fromEntries(headers.map((name: string, i: number) => [name, i]));

    const cache = loadCache();
    const now = new Date().toISOString();
    let updatedCount = 0;

    rows.forEach((r: any) => {
      const pName = r[h.PLAYER_NAME];
      const index = cache.findIndex((p: any) => p.Player.toLowerCase() === pName.toLowerCase());
      
      const stats: any = {
        Player: pName,
        Team: r[h.TEAM_ABBREVIATION],
        lastUpdated: now,
        syncSource: `NBA.com ${label}`
      };

      if (lastN === 0) {
        stats.PTS = r[h.PTS];
        stats.REB = r[h.REB];
        stats.AST = r[h.AST];
        stats.FG3M = r[h.FG3M];
        stats.GP = r[h.GP];
      } else if (lastN === 5) {
        stats.Last5_PTS = r[h.PTS];
        stats.Last5_REB = r[h.REB];
        stats.Last5_AST = r[h.AST];
        stats.Last5_3PM = r[h.FG3M];
      } else if (lastN === 10) {
        stats.Last10_PTS = r[h.PTS];
        stats.Last10_REB = r[h.REB];
        stats.Last10_AST = r[h.AST];
        stats.Last10_3PM = r[h.FG3M];
      }

      if (index !== -1) {
        cache[index] = { ...cache[index], ...stats };
      } else {
        cache.push(stats);
      }
      updatedCount++;
    });

    saveCache(cache);
    console.log(`✅ ${label} Sync Complete. ${updatedCount} players updated.`);
    return { success: true, count: updatedCount };
  } catch (e: any) {
    console.error(`❌ ${label} Sync Failed:`, e);
    return { success: false, error: e.message };
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Auto-sync check on startup
  const currentCache = loadCache();
  const lastUpdate = currentCache.length > 0 ? new Date(currentCache[0].lastUpdated || 0) : new Date(0);
  const hoursSinceUpdate = (Date.now() - lastUpdate.getTime()) / (1000 * 60 * 60);

  if (hoursSinceUpdate > 12) {
    console.log(`🕒 Cache is ${hoursSinceUpdate.toFixed(1)}h old. Triggering auto-sync...`);
    bulkSyncLeagueStats();
    syncRecentGames();
  }

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/bulk-sync", async (req, res) => {
    try {
      const result = await bulkSyncLeagueStats();
      res.json(result || { success: false, error: "Sync failed with no result" });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message || "Internal server error" });
    }
  });

  app.get("/api/game-sync", async (req, res) => {
    await syncRecentGames();
    res.json({ success: true });
  });

  app.get("/api/odds", async (req, res) => {
    const cachedOdds = loadOddsCache();
    if (cachedOdds) {
      return res.json({ success: true, odds: cachedOdds, cached: true });
    }

    const apiKey = process.env.THE_ODDS_API_KEY || "04e50035c75ba494b11ce87af7c7dbdc";
    // Fetching NBA odds (H2H, Spreads, Totals)
    const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to fetch odds");
      }
      const odds = await response.json();
      saveOddsCache(odds);
      saveOddsHistory(odds, "TheOddsAPI");
      res.json({ success: true, odds, cached: false });
    } catch (error: any) {
      console.error("Odds API Error:", error.message);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/player-props/:gameId", async (req, res) => {
    const { gameId } = req.params;
    const apiKey = process.env.THE_ODDS_API_KEY || "04e50035c75ba494b11ce87af7c7dbdc";
    
    // Fetching common player props
    const markets = "player_points,player_rebounds,player_assists,player_threes";
    const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${gameId}/odds?apiKey=${apiKey}&regions=us&markets=${markets}&oddsFormat=american`;

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch player props");
      const data = await response.json();
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get("/api/odds-history", (req, res) => {
    const history = loadOddsHistory();
    res.json({ success: true, history });
  });

  app.post("/api/bulk-import", (req, res) => {
    const { players, type } = req.body;
    if (!players || !Array.isArray(players)) return res.status(400).json({ error: "Invalid data" });

    const cache = loadCache();
    let updatedCount = 0;
    const isL10 = type === 'L10';

    // Helper to normalize names for matching
    const normalize = (name: string) => 
      name.toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove accents
        .replace(/[.'-]/g, "")          // Remove punctuation
        .trim();

    players.forEach((p: any) => {
      const pNameNorm = normalize(p.Player);
      const index = cache.findIndex((item: any) => normalize(item.Player) === pNameNorm);
      
      const statsUpdate = isL10 ? {
        Last10_PTS: p.PTS,
        Last10_REB: p.REB,
        Last10_AST: p.AST,
        Last10_3PM: p.FG3M,
        syncSource: "NBA.com Bulk Import (L10)"
      } : {
        Last5_PTS: p.PTS,
        Last5_REB: p.REB,
        Last5_AST: p.AST,
        Last5_3PM: p.FG3M,
        syncSource: "NBA.com Bulk Import (L5)"
      };

      if (index !== -1) {
        cache[index] = {
          ...cache[index],
          ...statsUpdate,
          lastUpdated: new Date().toISOString()
        };
        updatedCount++;
      } else {
        // Add new player if not found
        cache.push({
          Player: p.Player,
          Team: p.Team || "N/A",
          Season: "2025-26",
          ...statsUpdate,
          lastUpdated: new Date().toISOString()
        });
        updatedCount++;
      }
    });

    saveCache(cache);
    res.json({ success: true, count: updatedCount });
  });

  // API Route for Syncing
  app.get("/api/sync", async (req, res) => {
    const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1Ej3dcAyp-Ss82R1x6zG9_0tktk01nUFLpwR65PHraN0/export?format=csv";
    try {
      const sheetResponse = await fetch(SHEET_CSV_URL);
      if (!sheetResponse.ok) throw new Error("Failed to fetch Google Sheet data");
      const csvText = await sheetResponse.text();
      const lines = csvText.split("\n");
      const count = lines.length - 1;
      res.json({ success: true, count, timestamp: new Date().toISOString() });
    } catch (error) {
      res.status(500).json({ success: false, error: "Sync failed" });
    }
  });

  app.post("/api/analyze", async (req, res) => {
    const { text } = req.body;
    if (!text) return res.json([]);

    let dfStats = loadCache();
    
    // Attempt to sync with Google Sheets if cache is old or missing
    const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/1Ej3dcAyp-Ss82R1x6zG9_0tktk01nUFLpwR65PHraN0/export?format=csv";
    
    if (dfStats.length === 0) {
      try {
        console.log("Cache empty, fetching from Google Sheets...");
        const sheetResponse = await fetch(SHEET_CSV_URL);
        if (sheetResponse.ok) {
          const csvText = await sheetResponse.text();
          const lines = csvText.split("\n");
          const headers = lines[0].split(",").map(h => h.trim());
          
          dfStats = lines.slice(1).map(line => {
            const values = line.split(",");
            const obj: any = {};
            headers.forEach((header, index) => {
              let val: any = values[index]?.trim() || "";
              if (!isNaN(val as any) && val !== "") val = parseFloat(val);
              obj[header] = val;
            });
            return obj;
          }).filter(p => p.Player);
          
          saveCache(dfStats);
        }
      } catch (e) {
        console.error("Initial sync failed:", e);
      }
    }

    const lines = text.split("\n").map((l: string) => l.trim()).filter(Boolean);
    const results: any[] = [];
    let currentCat = "Points";
    let currentLine = 0;

    const catMap: Record<string, any> = {
      "Points": { avg: "PTS", l10: "Last10_PTS", l5: "Last5_PTS", std: "StdDev_PTS" },
      "Rebounds": { avg: "REB", l10: "Last10_REB", l5: "Last5_REB", std: "StdDev_REB" },
      "Assists": { avg: "AST", l10: "Last10_AST", l5: "Last5_AST", std: "StdDev_AST" },
      "Threes": { avg: "FG3M", l10: "Last10_3PM", l5: "Last5_3PM", std: "StdDev_3PM" }
    };

    const normalize = (name: string) => 
      name.toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // Remove accents
        .replace(/[.'-]/g, "")          // Remove punctuation
        .trim();

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      const low = lineText.toLowerCase();

      if (low.includes("rebound")) currentCat = "Rebounds";
      else if (low.includes("assist")) currentCat = "Assists";
      else if (low.includes("three")) currentCat = "Threes";
      else if (low.includes("points")) currentCat = "Points";

      const lineMatch = lineText.match(/(\d+(\.\d+)?)\+/);
      if (lineMatch) {
        currentLine = parseFloat(lineMatch[1]);
        continue;
      }

      const oddsMatch = lineText.match(/^[+-](\d{1,4})$/);
      if (oddsMatch && i > 0) {
        const playerNameInput = lines[i - 1].trim();
        const pNameNorm = normalize(playerNameInput);
        const oddsInt = parseInt(lineText);

        if (oddsInt < -500 || oddsInt > 400) continue;

        const playerRow = dfStats.find(p => {
          const rowNameNorm = normalize(p.Player);
          return rowNameNorm.includes(pNameNorm) || pNameNorm.includes(rowNameNorm);
        });

        if (!playerRow) continue;

        const cols = catMap[currentCat];
        const avgVal = parseFloat(playerRow[cols.avg]) || 0;
        const l10Avg = parseFloat(playerRow[cols.l10]) || 0;
        const l5Avg = parseFloat(playerRow[cols.l5]) || 0;
        const stdDev = parseFloat(playerRow[cols.std]) || 0;

        // --- PRO-VEGAS ALGORITHM ---
        // 1. Weighted Projection (Season 40%, L10 40%, L5 20%)
        // Handle missing L10 or L5 data gracefully
        let projectedAvg = avgVal;
        if (l10Avg > 0 && l5Avg > 0) {
          projectedAvg = (avgVal * 0.3) + (l10Avg * 0.4) + (l5Avg * 0.3);
        } else if (l10Avg > 0) {
          projectedAvg = (avgVal * 0.5) + (l10Avg * 0.5);
        } else if (l5Avg > 0) {
          projectedAvg = (avgVal * 0.6) + (l5Avg * 0.4);
        }
        
        // 2. Win Probability using REAL Standard Deviation
        const winProb = getWinProb(projectedAvg, currentLine, stdDev);
        
        // 3. Standard EV% Calculation
        // Decimal Odds = (100/abs(odds)) + 1 if negative, (odds/100) + 1 if positive
        const decimalOdds = oddsInt < 0 ? (100 / Math.abs(oddsInt)) + 1 : (oddsInt / 100) + 1;
        const ev = parseFloat(((winProb * decimalOdds - 1) * 100).toFixed(1));
        
        // 4. Trend Analysis
        const trendFactor = projectedAvg / currentLine;
        
        // 5. Power Rank
        const power = calculatePowerRank(winProb, ev, oddsInt, trendFactor);

        // Live Context from ESPN
        const [espnEvents, allInjuries] = await Promise.all([
          fetchEspnScoreboard(),
          fetchInjuries()
        ]);
        const matchup = getMatchupContext(playerRow.Team, espnEvents);
        
        // Injury & Restriction Check
        const playerInjuries = (allInjuries || []).find((t: any) => t.team?.abbreviation === playerRow.Team)?.injuries || [];
        const injury = playerInjuries.find((i: any) => i.athlete?.displayName?.toLowerCase().includes(playerRow.Player.toLowerCase()));
        
        // Matchup Analysis
        const matchupAnalysis = matchup ? getDefensiveMatchup(matchup.oppAbbr, currentCat) : null;
        
        // Role & Position
        const role = playerRow.Pos || "N/A";

        // Deep Analysis Reasons
        const analysis = [];
        const score_components = [];

        if (injury) {
          analysis.push(`⚠️ INJURY ALERT: ${injury.status} - ${injury.comment}`);
          if (injury.comment.toLowerCase().includes("restriction")) {
            analysis.push(`🛑 MINUTE RESTRICTION: Player may see limited court time.`);
          }
        }

        if (matchupAnalysis) {
          analysis.push(`${matchupAnalysis.label === 'Elite Defense' ? '🔒' : '🎯'} MATCHUP: Facing ${matchup.opponent} (${matchupAnalysis.label})`);
        }

        if (l5Avg > currentLine * 1.1) {
          analysis.push(`🔥 ELITE TREND: Averaging ${l5Avg.toFixed(1)} over last 5 games (${((l5Avg/currentLine - 1)*100).toFixed(0)}% over line)`);
          score_components.push("High Momentum");
        } else if (l5Avg > currentLine) {
          analysis.push(`📈 Positive Trend: Last 5 games avg (${l5Avg.toFixed(1)}) is above current line`);
        }

        if (avgVal > currentLine * 1.2) {
          analysis.push(`💎 MASSIVE EDGE: Season average is ${((avgVal/currentLine - 1)*100).toFixed(0)}% higher than this line`);
          score_components.push("Value Play");
        }

        if (stdDev < (avgVal * 0.25)) {
          analysis.push(`🎯 CONSISTENCY: Very low variance player. High floor expected.`);
          score_components.push("Safe Floor");
        }

        if (ev > 15) {
          analysis.push(`💰 MATH EDGE: Significant +EV spot at ${oddsInt} odds`);
          score_components.push("Sharp Odds");
        }

        // 6. Kelly Criterion (Fractional 0.25)
        const b = decimalOdds - 1;
        const p = winProb;
        const q = 1 - p;
        const kellyRaw = (b * p - q) / b;
        const kelly = Math.max(0, parseFloat((kellyRaw * 0.25 * 100).toFixed(1))); // 1/4 Kelly

        // Final Grade Thresholds (Adjusted for Pro-Edges)
        const powerFinal = power + (matchupAnalysis?.score || 0);
        let grade = "C";
        if (powerFinal > 60) grade = "S+";      // Elite Edge (> 60% Win Prob)
        else if (powerFinal > 45) grade = "A";  // Strong Edge (> 55% Win Prob)
        else if (powerFinal > 30) grade = "B";  // Slight Edge (> 52% Win Prob)

        // Probability Breakdown for the popup
        const zScore = stdDev > 0 ? (avgVal - currentLine) / stdDev : 0;
        const probExplanation = {
          avg: avgVal.toFixed(1),
          line: currentLine,
          stdDev: stdDev.toFixed(1),
          zScore: zScore.toFixed(2),
          formula: "Sigmoid(1.7 * (Avg - Line) / StdDev)",
          description: `The player's season average of ${avgVal.toFixed(1)} is ${avgVal > currentLine ? 'above' : 'below'} the line of ${currentLine}. Given their consistency (StdDev: ${stdDev.toFixed(1)}), they have a ${zScore.toFixed(2)} standard deviation edge.`
        };

        results.push({
          id: `${playerRow.Player}_${currentCat}_${currentLine}_${oddsInt}`,
          player: playerRow.Player,
          team: playerRow.Team,
          role: role,
          cat: currentCat,
          line: `${currentLine}+`,
          odds_str: lineText,
          odds_int: oddsInt,
          ev: ev,
          kelly: kelly,
          power: powerFinal,
          grade: grade,
          confidence: Math.min(100, Math.floor(winProb * 100)),
          metrics: {
            season: avgVal.toFixed(1),
            l10: l10Avg.toFixed(1),
            l5: l5Avg.toFixed(1),
            std: stdDev.toFixed(1)
          },
          analysis: analysis,
          tags: score_components,
          prob_breakdown: probExplanation,
          matchup: matchup,
          injury: injury ? { status: injury.status, comment: injury.comment } : null,
          matchupAnalysis: matchupAnalysis
        });
      }
    }

    results.sort((a, b) => b.power - a.power);
    
    // Save these analyzed props to history for variance tracking
    if (results.length > 0) {
      saveOddsHistory(results, "ManualPaste_FanDuel");
    }
    
    res.json(results);
  });

  app.get("/api/deep-sync", async (req, res) => {
    try {
      // Run Season, L5, and L10 in sequence to avoid rate limits
      const season = await deepSyncNbaStats(0);
      await new Promise(r => setTimeout(r, 2000));
      const l10 = await deepSyncNbaStats(10);
      await new Promise(r => setTimeout(r, 2000));
      const l5 = await deepSyncNbaStats(5);
      
      res.json({ 
        success: true, 
        season: season.count, 
        l10: l10.count, 
        l5: l5.count 
      });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post("/api/update-cache", (req, res) => {
    const { player, stats, gamelogs } = req.body;
    if (!player || !stats) return res.status(400).json({ error: "Missing data" });

    // Map verified stats back to the cache format for all categories
    const playerData: any = {
      Player: player,
      lastUpdated: new Date().toISOString(),
      gamelogs: gamelogs || []
    };

    if (stats.pts) {
      playerData.PTS = stats.pts.season;
      playerData.Last10_PTS = stats.pts.l10;
      playerData.Last5_PTS = stats.pts.l5;
    }
    if (stats.reb) {
      playerData.REB = stats.reb.season;
      playerData.Last10_REB = stats.reb.l10;
      playerData.Last5_REB = stats.reb.l5;
    }
    if (stats.ast) {
      playerData.AST = stats.ast.season;
      playerData.Last10_AST = stats.ast.l10;
      playerData.Last5_AST = stats.ast.l5;
    }
    if (stats.tpm) {
      playerData.FG3M = stats.tpm.season;
      playerData.Last10_3PM = stats.tpm.l10;
      playerData.Last5_3PM = stats.tpm.l5;
    }

    updatePlayerInCache(playerData);
    res.json({ success: true });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
