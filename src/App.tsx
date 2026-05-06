import React, { useState, useMemo } from 'react';
import { 
  Activity, 
  Search, 
  Trash2, 
  Flame, 
  Database,
  ChevronRight,
  TrendingUp,
  Target,
  Zap,
  AlertCircle,
  Filter,
  ArrowUpDown,
  X,
  ClipboardList,
  Info,
  Calculator,
  BarChart3,
  Trophy,
  Award,
  Dices,
  Layers,
  AlertTriangle,
  Shield,
  ShieldCheck,
  User,
  BrainCircuit,
  Wallet,
  TrendingDown,
  Sparkles,
  RefreshCw,
  Plus,
  ChevronLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  ReferenceLine
} from 'recharts';

interface ProbBreakdown {
  avg: string;
  line: number;
  stdDev: string;
  zScore: string;
  formula: string;
  description: string;
}

interface AnalysisResult {
  id: string;
  player: string;
  team: string;
  cat: string;
  line: string;
  odds_str: string;
  odds_int: number;
  ev: number;
  power: number;
  grade: string;
  confidence: number;
  metrics: {
    season: string;
    l10: string;
    l5: string;
    std: string;
  };
  injuryStatus?: string;
  aiBreakdown?: string;
  verifiedStats?: {
    l5_avg: number;
    l10_avg: number;
    season_avg: number;
    games: { date: string; opponent: string; val: number }[];
    source: string;
  };
  analysis: string[];
  tags: string[];
  prob_breakdown: ProbBreakdown;
  matchup?: {
    opponent: string;
    oppAbbr: string;
    location: string;
    status: string;
    score: string;
    time: string;
    venue: string;
  } | null;
}

export default function App() {
  const [inputText, setInputText] = useState(() => localStorage.getItem('nba_input_text') || '');
  const [results, setResults] = useState<AnalysisResult[]>(() => {
    const saved = localStorage.getItem('nba_analysis_results');
    return saved ? JSON.parse(saved) : [];
  });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  
  const [isFetchingOdds, setIsFetchingOdds] = useState(false);
  const [oddsData, setOddsData] = useState<any[]>([]);
  const [oddsTab, setOddsTab] = useState<'games' | 'props'>('games');
  const [targetOdds, setTargetOdds] = useState<string>('500');
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isInputModalOpen, setIsInputModalOpen] = useState(false);
  const [importType, setImportType] = useState<'L5' | 'L10'>('L5');
  const [importText, setImportText] = useState('');
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const handleBulkImport = async () => {
    if (!importText.trim()) return;
    
    // Auto-detect type from text
    let detectedType = importType;
    const lowerText = importText.toLowerCase();
    if (lowerText.includes('last 10 games') || lowerText.includes('last 10')) {
      detectedType = 'L10';
    } else if (lowerText.includes('last 5 games') || lowerText.includes('last 5')) {
      detectedType = 'L5';
    }

    if (detectedType !== importType) {
      setImportType(detectedType);
      console.log(`Auto-detected import type: ${detectedType}`);
    }

    const lines = importText.split('\n').filter(l => l.trim());
    const parsedPlayers: any[] = [];
    
    lines.forEach(line => {
      // Split by tab or multiple spaces
      const parts = line.split(/\t| {2,}/).map(p => p.trim()).filter(Boolean);
      
      // NBA.com Traditional Stats Table Structure (with Rank column):
      // 0: Rank, 1: Player, 2: Team, 3: Age, 4: GP, 5: W, 6: L, 7: Min, 8: PTS, 
      // 9: FGM, 10: FGA, 11: FG%, 12: 3PM, 13: 3PA, 14: 3P%, 15: FTM, 16: FTA, 17: FT%, 
      // 18: OREB, 19: DREB, 20: REB, 21: AST, 22: TOV, 23: STL, 24: BLK...
      
      if (parts.length >= 15) {
        const hasRank = !isNaN(parseInt(parts[0])) && parts[0].length <= 3;
        const playerIdx = hasRank ? 1 : 0;
        
        const name = parts[playerIdx];
        const team = parts[playerIdx + 1];
        const gpVal = parseFloat(parts[playerIdx + 3]);
        
        if (name && !isNaN(gpVal) && gpVal > 0) {
          // Detect if data is "Totals" or "Per Game"
          // If PTS is > 40 and GP is small, it's likely Totals. 
          // If PTS is small (e.g. 0.7) it's already Per Game.
          const rawPts = parseFloat(parts[playerIdx + 7]);
          const isTotals = rawPts > 50 && gpVal < 15; 
          
          const divisor = isTotals ? gpVal : 1;

          parsedPlayers.push({
            Player: name,
            Team: team,
            PTS: parseFloat((parseFloat(parts[playerIdx + 7]) / divisor).toFixed(1)),
            FG3M: parseFloat((parseFloat(parts[playerIdx + 11]) / divisor).toFixed(1)),
            REB: parseFloat((parseFloat(parts[playerIdx + 19]) / divisor).toFixed(1)),
            AST: parseFloat((parseFloat(parts[playerIdx + 20]) / divisor).toFixed(1))
          });
        }
      }
    });

    if (parsedPlayers.length > 0) {
      try {
        const res = await fetch('/api/bulk-import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ players: parsedPlayers, type: importType })
        });
        const data = await res.json();
        if (data.success) {
          setImportSuccess(`Successfully imported ${data.count} players!`);
          setImportText('');
          setLastSync(`Imported ${data.count} players from NBA.com (${importType})`);
          // Refresh analysis if results exist
          if (results.length > 0) handleAnalyze();
          
          // Clear success message after 3 seconds
          setTimeout(() => setImportSuccess(null), 3000);
        }
      } catch (e) {
        console.error("Import failed", e);
      }
    }
  };

  const handleFetchOdds = async () => {
    setIsFetchingOdds(true);
    try {
      const response = await fetch('/api/odds');
      const data = await response.json();
      if (data.success) {
        setOddsData(data.odds);
        setLastSync(`Odds Updated: ${data.odds.length} games found ${data.cached ? '(Cached)' : ''}`);
        // Refresh history to include the new fetch
        handleFetchOddsHistory();
      } else {
        console.error("Odds fetch failed", data.error);
      }
    } catch (error) {
      console.error("Odds fetch failed", error);
    } finally {
      setIsFetchingOdds(false);
    }
  };

  const handleFetchPlayerProps = async (gameId: string) => {
    setIsFetchingProps(true);
    setSelectedGameId(gameId);
    setPlayerPropsData(null);
    setSelectedPlayerName(null);
    try {
      const res = await fetch(`/api/player-props/${gameId}`);
      const data = await res.json();
      if (data.success) {
        setPlayerPropsData(data.data);
      }
    } catch (e) {
      console.error("Failed to fetch player props", e);
    } finally {
      setIsFetchingProps(false);
    }
  };

  const handleFetchOddsHistory = async () => {
    try {
      const res = await fetch('/api/odds-history');
      const data = await res.json();
      if (data.success) {
        setOddsHistory(data.history);
      }
    } catch (e) {
      console.error("Failed to fetch odds history", e);
    }
  };

  React.useEffect(() => {
    handleFetchOddsHistory();
    // Auto-fetch odds on mount (will use server cache)
    handleFetchOdds();
  }, []);

  // Persist results and input text
  React.useEffect(() => {
    localStorage.setItem('nba_input_text', inputText);
  }, [inputText]);

  React.useEffect(() => {
    localStorage.setItem('nba_analysis_results', JSON.stringify(results));
  }, [results]);

  const [error, setError] = useState<string | null>(null);
  const [selectedProp, setSelectedProp] = useState<AnalysisResult | null>(null);
  const [aiInsights, setAiInsights] = useState<Record<string, string>>({});
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);

  // Filter & Sort State
  const [filterCat, setFilterCat] = useState<string>('All');
  const [filterGrade, setFilterGrade] = useState<string>('All');
  const [sortBy, setSortBy] = useState<string>('power');
  const [activeTab, setActiveTab] = useState<'analysis' | 'parlay'>('analysis');
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [selectedPlayerName, setSelectedPlayerName] = useState<string | null>(null);
  const [playerPropsData, setPlayerPropsData] = useState<any>(null);
  const [isFetchingProps, setIsFetchingProps] = useState(false);
  const [oddsHistory, setOddsHistory] = useState<any[]>([]);
  const [isVerifying, setIsVerifying] = useState<string | null>(null);
  const [isVerifyingAll, setIsVerifyingAll] = useState(false);
  const [isBreakingDown, setIsBreakingDown] = useState<string | null>(null);
  const [regenerateSeed, setRegenerateSeed] = useState(0);

  // --- ANALYSIS UTILS (Frontend Port) ---
  const getWinProb = (avg: number, line: number, stdDev: number): number => {
    if (stdDev <= 0) return avg >= line ? 0.85 : 0.15;
    const z = (avg - line) / stdDev;
    const prob = 1 / (1 + Math.exp(-1.7 * z));
    return Math.max(0.05, Math.min(0.90, prob));
  };

  const calculatePowerRank = (winProb: number, ev: number, oddsInt: number, trendFactor: number): number => {
    const oddsMultiplier = (oddsInt < -250) ? 0.75 : 1.0;
    const winScore = (winProb - 0.45) * 300; 
    const evScore = Math.min(50, ev * 1.5);
    const trendScore = (trendFactor - 1.0) * 100;
    return Math.max(0, Math.floor((winScore + evScore + trendScore) * oddsMultiplier));
  };

  const getGrade = (power: number): string => {
    if (power >= 120) return 'S+';
    if (power >= 100) return 'S';
    if (power >= 85) return 'A+';
    if (power >= 70) return 'A';
    if (power >= 55) return 'B+';
    if (power >= 40) return 'B';
    return 'C';
  };

  const recalculateAnalysis = (item: AnalysisResult): AnalysisResult => {
    const metrics = item.metrics;
    const season = parseFloat(metrics.season);
    const l10 = parseFloat(metrics.l10);
    const l5 = parseFloat(metrics.l5);
    const stdDev = parseFloat(metrics.std);
    const currentLine = parseFloat(item.line);
    const oddsInt = item.odds_int;

    // Weighted Projection (Season 40%, L10 40%, L5 20%)
    const projectedAvg = (season * 0.4) + (l10 * 0.4) + (l5 * 0.2);
    const winProb = getWinProb(projectedAvg, currentLine, stdDev);
    const decimalOdds = oddsInt < 0 ? (100 / Math.abs(oddsInt)) + 1 : (oddsInt / 100) + 1;
    const ev = parseFloat(((winProb * decimalOdds - 1) * 100).toFixed(1));
    const trendFactor = projectedAvg / currentLine;
    const power = calculatePowerRank(winProb, ev, oddsInt, trendFactor);
    const grade = getGrade(power);
    const confidence = Math.round(winProb * 100);

    return {
      ...item,
      ev,
      power,
      grade,
      confidence
    };
  };

  const handleAnalyze = async () => {
    if (!inputText.trim()) return;
    
    setIsAnalyzing(true);
    setError(null);
    
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: inputText }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        // Check cache for existing verified stats
        const cachedStats = JSON.parse(localStorage.getItem('player_stats_cache') || '{}');
        
        const updatedData = data.map((item: AnalysisResult) => {
          const cacheKey = `${item.player}_${item.cat}`;
          if (cachedStats[cacheKey]) {
            const verified = cachedStats[cacheKey];
            const withVerified = {
              ...item,
              verifiedStats: verified,
              injuryStatus: verified.injury,
              metrics: {
                ...item.metrics,
                l5: verified.l5_avg.toString(),
                l10: verified.l10_avg.toString(),
                season: verified.season_avg.toString()
              }
            };
            return recalculateAnalysis(withVerified);
          }
          return item;
        });

        setResults(updatedData);
        setAiInsights({}); // Reset AI insights
        setActiveTab('analysis');
        
        // Refresh history to include the manual paste
        handleFetchOddsHistory();

        // Auto-verify top picks to ensure fresh data
        setTimeout(() => {
          handleVerifyAll();
        }, 1000);
      } else {
        setError(data.error || 'Analysis failed');
      }
    } catch (err) {
      setError('Network error connecting to analysis engine');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // --- GEMINI AI INSIGHTS ---
  const generateAIInsights = async (picks: AnalysisResult[]) => {
    if (picks.length === 0 || isGeneratingAI) return;
    setIsGeneratingAI(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = "gemini-3-flash-preview";

      const prompt = `You are a professional NBA betting analyst. Analyze these 4 top prop picks and provide a 1-sentence "Sharp Insight" for EACH one. 
      Focus on WHY the math likes it (matchup, trend, or value). Be concise and professional.
      
      Picks:
      ${picks.map((p, i) => `${i+1}. ${p.player} ${p.cat} ${p.line} (${p.odds_str}) - Matchup: ${p.matchup?.opponent || 'Unknown'}, Season Avg: ${p.metrics.season}, L10 Avg: ${p.metrics.l10}, L5 Avg: ${p.metrics.l5}`).join('\n')}
      
      Format your response as a JSON object where keys are the player names and values are the insights.`;

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: "application/json" }
      });

      const insights = JSON.parse(response.text || "{}");
      setAiInsights(prev => ({ ...prev, ...insights }));
    } catch (e) {
      console.error("AI Insight Error:", e);
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const handleVerifyStats = async (res: AnalysisResult) => {
    setIsVerifying(res.id);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = "gemini-3-flash-preview";

      const prompt = `Find the most recent 5 games for NBA player ${res.player} (${res.team}). 
      Provide their stats for Points, Rebounds, Assists, and 3PM for each of those 5 games.
      Also check their current season averages for these categories and their injury status.
      Return ONLY a JSON object with:
      - pts: { season: number, l10: number, l5: number }
      - reb: { season: number, l10: number, l5: number }
      - ast: { season: number, l10: number, l5: number }
      - tpm: { season: number, l10: number, l5: number }
      - games: array of { date: string, opponent: string, pts: number, reb: number, ast: number, tpm: number }
      - injury: string (current status, e.g. "Healthy", "Day-to-Day", "Out")
      - source: string (where you found it, e.g. ESPN, Basketball Reference)`;

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { 
          tools: [{ googleSearch: {} }],
          responseMimeType: "application/json" 
        }
      });

      const data = JSON.parse(response.text || "{}");
      
      // Extract the relevant category stats for the current prop
      const catKeyMap: Record<string, string> = {
        'Points': 'pts',
        'Rebounds': 'reb',
        'Assists': 'ast',
        'Threes': 'tpm'
      };
      const catKey = catKeyMap[res.cat] || 'pts';
      const catStats = data[catKey] || { season: 0, l10: 0, l5: 0 };

      // Update Local Cache
      const cachedStats = JSON.parse(localStorage.getItem('player_stats_cache') || '{}');
      cachedStats[`${res.player}_${res.cat}`] = {
        ...data,
        l5_avg: catStats.l5,
        l10_avg: catStats.l10,
        season_avg: catStats.season,
        val: catStats.l5 // for the chart
      };
      localStorage.setItem('player_stats_cache', JSON.stringify(cachedStats));

      // Update Server Cache
      fetch('/api/update-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          player: res.player, 
          stats: data,
          gamelogs: data.games.map((g: any) => ({
            date: g.date,
            pts: g.pts,
            reb: g.reb,
            ast: g.ast,
            tpm: g.tpm,
            opp: g.opponent
          }))
        }),
      }).catch(err => console.error("Server cache update failed", err));

      setResults(prev => prev.map(item => {
        if (item.id === res.id) {
          const updated = { 
            ...item, 
            verifiedStats: {
              ...data,
              l5_avg: catStats.l5,
              l10_avg: catStats.l10,
              season_avg: catStats.season,
              games: data.games.map((g: any) => ({ ...g, val: g[catKey] }))
            },
            injuryStatus: data.injury,
            metrics: {
              ...item.metrics,
              l5: catStats.l5.toString(),
              l10: catStats.l10.toString(),
              season: catStats.season.toString()
            }
          };
          return recalculateAnalysis(updated);
        }
        return item;
      }));
      
      if (selectedProp?.id === res.id) {
        setSelectedProp(prev => {
          if (!prev) return null;
          const updated = { 
            ...prev, 
            verifiedStats: {
              ...data,
              l5_avg: catStats.l5,
              l10_avg: catStats.l10,
              season_avg: catStats.season,
              games: data.games.map((g: any) => ({ ...g, val: g[catKey] }))
            },
            injuryStatus: data.injury,
            metrics: {
              ...prev.metrics,
              l5: catStats.l5.toString(),
              l10: catStats.l10.toString(),
              season: catStats.season.toString()
            }
          };
          return recalculateAnalysis(updated);
        });
      }
    } catch (err) {
      console.error("Verification failed", err);
    } finally {
      setIsVerifying(null);
    }
  };

  const handleVerifyAll = async () => {
    if (results.length === 0 || isVerifyingAll) return;
    setIsVerifyingAll(true);
    
    // Verify top 10 results to avoid excessive rate limiting
    const toVerify = results.slice(0, 10);
    
    try {
      // Process in small batches or sequence to be respectful to the API
      for (const res of toVerify) {
        if (!res.verifiedStats) {
          await handleVerifyStats(res);
          // Small delay between requests
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    } catch (err) {
      console.error("Verify All failed", err);
    } finally {
      setIsVerifyingAll(false);
    }
  };

  const handleAiBreakdown = async (res: AnalysisResult) => {
    setIsBreakingDown(res.id);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = "gemini-3-flash-preview";

      // Find historical odds for this player/market if available
      const history = oddsHistory.filter(h => {
        // Handle API format
        const apiMatch = h.bookmakers?.[0]?.markets?.some((m: any) => 
          m.outcomes.some((o: any) => o.description === res.player)
        );
        // Handle Manual Paste format
        const manualMatch = h.player === res.player && h.cat === res.cat;
        return apiMatch || manualMatch;
      }).slice(0, 8);

      const historyContext = history.length > 0 
        ? `Historical Odds Trend: ${history.map(h => {
            if (h.bookmakers) {
              const market = h.bookmakers?.[0]?.markets?.find((m: any) => m.key.includes(res.cat.toLowerCase()));
              const outcome = market?.outcomes.find((o: any) => o.description === res.player);
              return outcome ? `${outcome.point} (${outcome.price})` : null;
            } else {
              // Manual paste format
              return `${h.line} (${h.odds_str})`;
            }
          }).filter(Boolean).join(' -> ')}`
        : "No historical odds data available yet.";

      const prompt = `Analyze this NBA prop bet:
      Player: ${res.player}
      Category: ${res.cat}
      Line: ${res.line}
      Odds: ${res.odds_str}
      Season Avg: ${res.metrics.season}
      Last 10: ${res.metrics.l10}
      Last 5: ${res.metrics.l5}
      
      ${historyContext}
      
      Provide a concise 2-3 sentence professional betting breakdown. Focus on why this is a good or bad value based on the trend. Mention if the current line is higher or lower than historical norms if data is available.`;

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { tools: [{ googleSearch: {} }] }
      });

      const breakdown = response.text || "No breakdown available.";
      
      setResults(prev => prev.map(item => 
        item.id === res.id ? { ...item, aiBreakdown: breakdown } : item
      ));
      if (selectedProp?.id === res.id) {
        setSelectedProp(prev => prev ? { ...prev, aiBreakdown: breakdown } : null);
      }
    } catch (err) {
      console.error("Breakdown failed", err);
    } finally {
      setIsBreakingDown(null);
    }
  };

  const topPicks = useMemo(() => {
    if (results.length === 0) return [];
    return [...results].sort((a, b) => b.power - a.power).slice(0, 4);
  }, [results]);

  React.useEffect(() => {
    if (topPicks.length > 0 && Object.keys(aiInsights).length === 0) {
      generateAIInsights(topPicks);
    }
  }, [topPicks]);

  const parlaySuggestions = useMemo(() => {
    if (results.length < 2) return [];
    
    const topPicksForParlay = [...results]
      .sort((a, b) => b.power - a.power)
      .slice(0, 12);
    
    const ranges = [
      { name: 'Safe (200-400)', min: 200, max: 400 },
      { name: 'Value (500-700)', min: 500, max: 700 },
      { name: 'Aggressive (700-1000)', min: 700, max: 1000 },
      { name: 'Moonshot (1000+)', min: 1000, max: 100000 }
    ];

    const americanToDecimal = (odds: number) => odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
    const decimalToAmerican = (decimal: number) => {
      if (decimal >= 2.0) return `+${Math.round((decimal - 1) * 100)}`;
      return `${Math.round(-100 / (decimal - 1))}`;
    };

    const resultsByRange: any[] = [];

    ranges.forEach(range => {
      let bestParlay: any = null;
      let maxPower = -1;

      for (let size = 2; size <= 5; size++) {
        const combinations: any[][] = [];
        const helper = (start: number, current: any[]) => {
          if (current.length === size) {
            combinations.push([...current]);
            return;
          }
          // Limit search to keep it fast
          for (let i = start; i < topPicksForParlay.length && combinations.length < 100; i++) {
            const pick = topPicksForParlay[i];
            // Ensure unique players in the parlay
            if (!current.some(p => p.player === pick.player)) {
              current.push(pick);
              helper(i + 1, current);
              current.pop();
            }
          }
        };
        helper(0, []);

        combinations.forEach(combo => {
          const totalDecimal = combo.reduce((acc, p) => acc * americanToDecimal(p.odds_int), 1);
          const amOddsStr = decimalToAmerican(totalDecimal);
          const amOddsInt = parseInt(amOddsStr);
          const totalPower = combo.reduce((acc, p) => acc + p.power, 0);
          const totalWinProb = combo.reduce((acc, p) => acc * (p.confidence / 100), 1) * 100;

          if (amOddsInt >= range.min && amOddsInt <= range.max) {
            if (totalPower > maxPower) {
              maxPower = totalPower;
              bestParlay = {
                rangeName: range.name,
                picks: combo,
                totalOdds: amOddsStr,
                totalWinProb: totalWinProb.toFixed(1),
                avgPower: (totalPower / size).toFixed(0)
              };
            }
          }
        });
      }
      if (bestParlay) resultsByRange.push(bestParlay);
    });

    return resultsByRange;
  }, [results]);

  const customParlay = useMemo(() => {
    if (results.length < 2) return null;
    
    const target = parseInt(targetOdds) || 500;
    const targetDecimal = (target / 100) + 1;
    
    // Filter for quality plays
    const pool = [...results]
      .filter(r => ['S+', 'A', 'B'].includes(r.grade));

    // Simple greedy approach to find a parlay near target odds
    let currentLegs: AnalysisResult[] = [];
    let currentDecimal = 1.0;
    
    // Shuffle pool based on regenerateSeed
    const shuffledPool = [...pool].sort(() => Math.random() - 0.5);

    for (const pick of shuffledPool) {
      if (currentLegs.some(p => p.player === pick.player)) continue;
      
      const pickDecimal = pick.odds_int > 0 ? (pick.odds_int / 100) + 1 : (100 / Math.abs(pick.odds_int)) + 1;
      
      if (currentDecimal * pickDecimal <= targetDecimal * 1.5) {
        currentLegs.push(pick);
        currentDecimal *= pickDecimal;
      }
      
      if (currentDecimal >= targetDecimal * 0.9) break;
    }

    if (currentLegs.length < 2) return null;

    return {
      legs: currentLegs,
      totalOdds: currentDecimal >= 2.0 ? `+${Math.round((currentDecimal - 1) * 100)}` : `${Math.round(-100 / (currentDecimal - 1))}`,
      winProb: Math.round(currentLegs.reduce((acc, p) => acc * (p.confidence / 100), 1) * 100)
    };
  }, [results, targetOdds, regenerateSeed]);

  const filteredAndSortedResults = useMemo(() => {
    let filtered = [...results];

    if (filterCat !== 'All') {
      filtered = filtered.filter(r => r.cat === filterCat);
    }

    if (filterGrade !== 'All') {
      filtered = filtered.filter(r => r.grade === filterGrade);
    }

    filtered.sort((a, b) => {
      if (sortBy === 'power') return b.power - a.power;
      if (sortBy === 'ev') return b.ev - a.ev;
      if (sortBy === 'confidence') return b.confidence - a.confidence;
      if (sortBy === 'odds') return a.odds_int - b.odds_int;
      return 0;
    });

    return filtered;
  }, [results, filterCat, filterGrade, sortBy]);

  const clearInput = () => {
    setInputText('');
    setResults([]);
    setError(null);
  };

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'S+': return 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10';
      case 'A': return 'text-green-400 border-green-400/30 bg-green-400/10';
      case 'B': return 'text-blue-400 border-blue-400/30 bg-blue-400/10';
      default: return 'text-gray-400 border-gray-400/30 bg-gray-400/10';
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0c10] text-gray-100 font-sans selection:bg-blue-500/30">
      {/* Header */}
      <header className="border-b border-white/5 bg-black/40 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20">
              <Target className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight">PROP HUNTER <span className="text-blue-500">PRO</span></h1>
              <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">NBA Analysis Engine</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsInputModalOpen(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 rounded-xl text-xs font-bold text-white transition-all shadow-lg shadow-blue-600/20 group"
            >
              <Plus className="w-4 h-4 group-hover:rotate-90 transition-transform" />
              NEW ANALYSIS
            </button>

            <button 
              onClick={() => setIsImportModalOpen(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs font-bold text-gray-300 transition-all"
            >
              <Database className="w-4 h-4 text-blue-400" />
              NBA.COM IMPORT
            </button>

            <div className="h-8 w-px bg-white/10 mx-2" />

            <button 
              onClick={handleFetchOdds}
              disabled={isFetchingOdds}
              className="flex items-center gap-2 px-5 py-2.5 bg-orange-600/20 border border-orange-500/30 rounded-xl text-xs font-bold text-orange-400 hover:bg-orange-600/30 transition-all disabled:opacity-50"
            >
              {isFetchingOdds ? (
                <Activity className="w-4 h-4 animate-spin" />
              ) : (
                <TrendingUp className="w-4 h-4" />
              )}
              {isFetchingOdds ? 'FETCHING...' : 'LIVE ODDS'}
            </button>
            
            <button 
              onClick={clearInput}
              className="p-2.5 hover:bg-white/5 rounded-xl transition-colors text-gray-500 hover:text-red-400"
              title="Clear All"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      {/* Input Modal */}
      <AnimatePresence>
        {isInputModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsInputModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-[#0f1218] border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-600/20 rounded-xl">
                    <Plus className="w-5 h-5 text-blue-500" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">New Prop Analysis</h2>
                    <p className="text-xs text-gray-500 uppercase tracking-widest font-bold">Paste FanDuel Odds Data</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsInputModalOpen(false)}
                  className="p-2 hover:bg-white/5 rounded-xl text-gray-500 hover:text-white transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest">Input Data</label>
                    <span className="text-[10px] text-gray-600 font-mono">{inputText.split('\n').filter(Boolean).length} lines detected</span>
                  </div>
                  <textarea 
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Paste odds data here...&#10;Example:&#10;Points&#10;25+&#10;Luka Doncic&#10;-110"
                    className="w-full h-[400px] bg-black/40 border border-white/10 rounded-2xl px-5 py-4 text-sm focus:outline-none focus:border-blue-500/50 transition-all font-mono custom-scrollbar resize-none leading-relaxed"
                  />
                </div>

                <div className="p-4 bg-blue-500/5 rounded-2xl border border-blue-500/10 flex gap-4 items-start">
                  <div className="p-2 bg-blue-500/20 rounded-lg shrink-0">
                    <Zap className="w-4 h-4 text-blue-400" />
                  </div>
                  <p className="text-xs text-blue-400/80 leading-relaxed">
                    <strong>Pro Tip:</strong> Paste the full prop board from FanDuel. The engine automatically detects player names, lines, and odds. Ensure category headers (e.g. "Points") are included for best accuracy.
                  </p>
                </div>
              </div>

              <div className="p-6 bg-white/5 border-t border-white/5 flex gap-4">
                <button 
                  onClick={() => { setInputText(''); setResults([]); }}
                  className="px-6 py-3 bg-white/5 hover:bg-white/10 rounded-xl text-xs font-bold uppercase tracking-widest transition-all border border-white/10 text-gray-400"
                >
                  Reset
                </button>
                <button 
                  onClick={() => { handleAnalyze(); setIsInputModalOpen(false); }}
                  disabled={isAnalyzing || !inputText.trim()}
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-800 disabled:text-gray-500 rounded-xl font-bold text-sm transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 uppercase tracking-widest"
                >
                  {isAnalyzing ? (
                    <>
                      <Activity className="w-4 h-4 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Target className="w-4 h-4" />
                      Run Analysis
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <main className="max-w-[1600px] mx-auto px-6 py-8 grid grid-cols-12 gap-8">
        
        {/* Sidebar: Live Odds */}
        <div className="col-span-12 lg:col-span-3 space-y-6">
          <section className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-5 sticky top-24 max-h-[calc(100vh-120px)] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-orange-400" />
                <h2 className="text-sm font-bold text-white uppercase tracking-wider">Live Odds</h2>
              </div>
              <div className="flex bg-white/5 p-0.5 rounded-lg border border-white/10">
                <button 
                  onClick={() => setOddsTab('games')}
                  className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all ${oddsTab === 'games' ? 'bg-orange-500 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  GAMES
                </button>
                <button 
                  onClick={() => setOddsTab('props')}
                  className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all ${oddsTab === 'props' ? 'bg-orange-500 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  PROPS
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3 pr-1">
              {oddsTab === 'games' ? (
                oddsData.length > 0 ? oddsData.map((game: any) => {
                  const isSelected = selectedGameId === game.id;
                  const h2h = game.bookmakers?.[0]?.markets?.find((m: any) => m.key === 'h2h');
                  
                  return (
                    <div 
                      key={game.id} 
                      onClick={() => handleFetchPlayerProps(game.id)}
                      className={`bg-white/5 border rounded-xl p-3 hover:border-orange-500/30 transition-all cursor-pointer group ${isSelected ? 'border-orange-500 bg-orange-500/5' : 'border-white/5'}`}
                    >
                      <div className="flex justify-between items-center mb-2">
                        <span className="text-[9px] font-bold text-orange-400/70 uppercase">
                          {new Date(game.commence_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {isSelected && <ChevronRight className="w-3 h-3 text-orange-500" />}
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-medium text-gray-300 truncate max-w-[100px]">{game.home_team}</span>
                          {h2h && <span className="text-[10px] font-mono text-white bg-white/10 px-1.5 py-0.5 rounded">{h2h.outcomes.find((o: any) => o.name === game.home_team)?.price > 0 ? '+' : ''}{h2h.outcomes.find((o: any) => o.name === game.home_team)?.price}</span>}
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-medium text-gray-300 truncate max-w-[100px]">{game.away_team}</span>
                          {h2h && <span className="text-[10px] font-mono text-white bg-white/10 px-1.5 py-0.5 rounded">{h2h.outcomes.find((o: any) => o.name === game.away_team)?.price > 0 ? '+' : ''}{h2h.outcomes.find((o: any) => o.name === game.away_team)?.price}</span>}
                        </div>
                      </div>
                    </div>
                  );
                }) : (
                  <div className="py-8 text-center text-gray-600">
                    <p className="text-[10px] font-bold uppercase tracking-widest">No games found</p>
                  </div>
                )
              ) : (
                <div className="space-y-4">
                  {playerPropsData ? (
                    (() => {
                      const players: Record<string, any[]> = {};
                      playerPropsData.bookmakers?.[0]?.markets?.forEach((market: any) => {
                        market.outcomes.forEach((outcome: any) => {
                          if (!players[outcome.description]) players[outcome.description] = [];
                          players[outcome.description].push({
                            market: market.key.replace('player_', '').replace(/_/g, ' '),
                            name: outcome.name,
                            line: outcome.point,
                            price: outcome.price
                          });
                        });
                      });

                      return Object.entries(players).map(([name, props]) => (
                        <div key={name} className="bg-white/5 border border-white/10 rounded-xl p-2.5 space-y-2">
                          <h4 className="text-[10px] font-bold text-white truncate">{name}</h4>
                          <div className="space-y-1.5">
                            {props.map((p, i) => (
                              <div key={i} className="flex justify-between items-center text-[9px]">
                                <span className="text-gray-500 uppercase">{p.market}</span>
                                <span className="text-orange-400 font-mono">{p.line} ({p.price > 0 ? '+' : ''}{p.price})</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ));
                    })()
                  ) : (
                    <div className="py-8 text-center text-gray-600">
                      <p className="text-[10px] font-bold uppercase tracking-widest">Select a game to view props</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Main Content: Analysis & Parlay */}
        <div className="col-span-12 lg:col-span-9 space-y-8">
          
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex items-center gap-3 text-red-400 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              {error}
            </div>
          )}

          {/* Tab Switcher & Global Actions */}
          {results.length > 0 && (
            <div className="flex items-center justify-between">
              <div className="flex p-1 bg-white/5 border border-white/10 rounded-xl w-fit">
                <button
                  onClick={() => setActiveTab('analysis')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                    activeTab === 'analysis' 
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' 
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  <BarChart3 className="w-4 h-4" />
                  ANALYSIS
                </button>
                <button
                  onClick={() => setActiveTab('parlay')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                    activeTab === 'parlay' 
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' 
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  <Dices className="w-4 h-4" />
                  PARLAY SUGGESTER
                </button>
              </div>

              <button
                onClick={handleVerifyAll}
                disabled={isVerifyingAll}
                className="flex items-center gap-2 px-4 py-2 bg-green-600/20 border border-green-500/30 rounded-xl text-xs font-bold text-green-400 hover:bg-green-600/30 transition-all disabled:opacity-50"
              >
                {isVerifyingAll ? (
                  <Activity className="w-4 h-4 animate-spin" />
                ) : (
                  <ShieldCheck className="w-4 h-4" />
                )}
                {isVerifyingAll ? 'VERIFYING TOP PICKS...' : 'VERIFY ALL TOP PICKS'}
              </button>
            </div>
          )}

          {activeTab === 'analysis' ? (
            <>
              {/* Top 4 Picks Section */}
          {topPicks.length > 0 && (
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-yellow-500" />
                <h2 className="text-xl font-bold tracking-tight text-white">Top 4 Power Picks</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {topPicks.map((res, idx) => (
                  <motion.div
                    key={`top-${res.id}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: idx * 0.1 }}
                    onClick={() => setSelectedProp(res)}
                    className="relative overflow-hidden bg-gradient-to-br from-blue-600/20 to-purple-600/20 border border-blue-500/30 rounded-2xl p-4 hover:border-blue-400/50 transition-all cursor-pointer group"
                  >
                    <div className="absolute -right-4 -top-4 w-16 h-16 bg-blue-500/10 rounded-full blur-2xl group-hover:bg-blue-500/20 transition-all" />
                    
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex flex-col">
                        <span className="text-[10px] font-black text-blue-400 uppercase tracking-widest">{res.team} • {res.role}</span>
                        <span className="text-[9px] font-bold text-gray-500 uppercase">{res.cat}</span>
                      </div>
                      <div className="bg-yellow-500/20 border border-yellow-500/30 px-2 py-0.5 rounded text-[10px] font-black text-yellow-500">
                        #{idx + 1}
                      </div>
                    </div>

                    <h3 className="font-bold text-sm text-white mb-2 truncate">{res.player}</h3>
                    
                    {/* AI Insight Snippet */}
                    {aiInsights[res.player] && (
                      <div className="mb-3 p-2 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                        <p className="text-[9px] text-blue-300 leading-tight italic">
                          <Sparkles className="w-2.5 h-2.5 inline mr-1" />
                          {aiInsights[res.player]}
                        </p>
                      </div>
                    )}

                    <div className="flex justify-between items-end">
                      <div>
                        <p className="text-lg font-black text-white">{res.line}</p>
                        <p className="text-[10px] font-bold text-blue-400">{res.odds_str}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-gray-500 uppercase">Power</p>
                        <p className="text-lg font-black text-blue-400">{res.power}</p>
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-white/5 flex justify-between items-center">
                      <div className="flex gap-2">
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded ${getGradeColor(res.grade)}`}>
                          GRADE {res.grade}
                        </span>
                        {res.verifiedStats && (
                          <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-blue-500 text-white flex items-center gap-1">
                            <Shield className="w-2 h-2" />
                            VERIFIED
                          </span>
                        )}
                      </div>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleVerifyStats(res);
                        }}
                        disabled={isVerifying === res.id}
                        className="text-[9px] font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1"
                      >
                        {isVerifying === res.id ? (
                          <Activity className="w-2.5 h-2.5 animate-spin" />
                        ) : (
                          <Sparkles className="w-2.5 h-2.5" />
                        )}
                        {res.verifiedStats ? 'REFRESH' : 'VERIFY LIVE'}
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            </section>
          )}

              {/* Filters & Sorting */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-3">
              <Filter className="w-4 h-4 text-gray-500" />
              <div className="flex items-center gap-2">
                <select 
                  value={filterCat}
                  onChange={(e) => setFilterCat(e.target.value)}
                  className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500/50"
                >
                  <option value="All">All Categories</option>
                  <option value="Points">Points</option>
                  <option value="Rebounds">Rebounds</option>
                  <option value="Assists">Assists</option>
                  <option value="Threes">Threes</option>
                </select>
                <select 
                  value={filterGrade}
                  onChange={(e) => setFilterGrade(e.target.value)}
                  className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500/50"
                >
                  <option value="All">All Grades</option>
                  <option value="S+">S+ Only</option>
                  <option value="A">Grade A+</option>
                  <option value="B">Grade B+</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3 ml-auto">
              <ArrowUpDown className="w-4 h-4 text-gray-500" />
              <select 
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-black/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-blue-500/50"
              >
                <option value="power">Sort by Power Rank</option>
                <option value="ev">Sort by EV %</option>
                <option value="confidence">Sort by Win Prob</option>
                <option value="odds">Sort by Odds</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold tracking-tight">Analysis Results</h2>
              <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 text-[10px] font-bold rounded-md border border-blue-500/20">
                {filteredAndSortedResults.length} OPPORTUNITIES
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <AnimatePresence mode="popLayout">
              {filteredAndSortedResults.length === 0 ? (
                <div className="col-span-full h-64 bg-white/5 rounded-3xl border border-dashed border-white/10 flex flex-col items-center justify-center text-gray-600 space-y-4 p-8 text-center">
                  <Target className="w-10 h-10 opacity-20" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-gray-400">No analysis data yet</p>
                    <p className="text-xs text-gray-500 max-w-xs">
                      Paste your odds data into the input field and click "Run Analysis" to see results.
                    </p>
                  </div>
                </div>
              ) : (
                filteredAndSortedResults.map((res) => (
                  <motion.div
                    key={res.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    onClick={() => setSelectedProp(res)}
                    className="bg-white/5 rounded-2xl border border-white/10 p-5 hover:bg-white/[0.07] transition-all group relative flex flex-col cursor-pointer"
                  >
                    {/* Grade & Power Rank */}
                    <div className="absolute top-4 right-4 flex items-center gap-2">
                      <div className={`px-2 py-0.5 rounded text-[10px] font-black border ${getGradeColor(res.grade)}`}>
                        {res.grade}
                      </div>
                      <div className="bg-blue-600/20 border border-blue-500/30 px-3 py-1 rounded-full flex items-center gap-1.5">
                        <Flame className="w-3 h-3 text-blue-400" />
                        <span className="text-[10px] font-bold text-blue-400">{res.power}</span>
                      </div>
                    </div>

                    <div className="space-y-4 flex-1">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-blue-500 font-mono font-bold uppercase tracking-widest">{res.team} • {res.role}</span>
                          <span className="text-[10px] text-gray-600">•</span>
                          <span className="text-[10px] text-gray-500 font-bold uppercase">{res.cat}</span>
                        </div>
                        <h3 className="font-bold text-lg text-gray-200 group-hover:text-white transition-colors">
                          {res.player}
                        </h3>
                        
                        {/* Injury & Matchup Badges */}
                        <div className="flex flex-wrap gap-2 pt-1">
                          {(res.injury || res.injuryStatus) && (
                            <div className={`flex items-center gap-1 px-2 py-0.5 border rounded text-[8px] font-black uppercase ${
                              (res.injuryStatus?.toLowerCase().includes('healthy') || 
                               res.injuryStatus?.toLowerCase().includes('active') ||
                               res.injury?.status?.toLowerCase().includes('healthy') ||
                               res.injury?.status?.toLowerCase().includes('active')) 
                                ? 'bg-green-500/10 border-green-500/20 text-green-500' 
                                : 'bg-red-500/10 border-red-500/20 text-red-500'
                            }`}>
                              <AlertTriangle className="w-2.5 h-2.5" />
                              {res.injuryStatus || res.injury?.status}
                            </div>
                          )}
                          {res.matchupAnalysis && (
                            <div className={`flex items-center gap-1 px-2 py-0.5 bg-white/5 border border-white/10 rounded text-[8px] font-black uppercase ${
                              res.matchupAnalysis.color === 'red' ? 'text-red-500' : 
                              res.matchupAnalysis.color === 'orange' ? 'text-orange-500' : 
                              'text-green-500'
                            }`}>
                              <Shield className="w-2.5 h-2.5" />
                              {res.matchupAnalysis.label}
                            </div>
                          )}
                          {res.tags.map(tag => (
                            <span key={tag} className="text-[8px] px-1.5 py-0.5 bg-white/5 rounded border border-white/10 text-gray-400 font-bold uppercase">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <p className="text-[10px] text-gray-500 uppercase font-bold">Line & Odds</p>
                          <p className="text-xl font-black text-white">
                            {res.line} <span className="text-blue-500 ml-1">{res.odds_str}</span>
                          </p>
                        </div>
                        <div className="text-center space-y-1">
                          <p className="text-[10px] text-gray-500 uppercase font-bold">EV %</p>
                          <p className={`text-xl font-black ${res.ev > 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {res.ev > 0 ? `+${res.ev}` : res.ev}%
                          </p>
                        </div>
                        <div className="text-right space-y-1">
                          <p className="text-[10px] text-gray-500 uppercase font-bold">Kelly</p>
                          <p className="text-xl font-black text-blue-400">
                            {res.kelly}%
                          </p>
                        </div>
                      </div>

                      {/* Metrics Row */}
                      <div className="grid grid-cols-4 gap-2 py-3 border-y border-white/5">
                        <div className="text-center">
                          <p className="text-[9px] text-gray-500 uppercase font-bold">Season</p>
                          <p className="text-xs font-bold text-gray-300">{res.metrics.season}</p>
                        </div>
                        <div className="text-center border-x border-white/5">
                          <p className="text-[9px] text-gray-500 uppercase font-bold">L10</p>
                          <p className="text-xs font-bold text-gray-300">{res.metrics.l10}</p>
                        </div>
                        <div className="text-center border-r border-white/5">
                          <p className="text-[9px] text-gray-500 uppercase font-bold">L5</p>
                          <p className="text-xs font-bold text-gray-300">{res.metrics.l5}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[9px] text-gray-500 uppercase font-bold">StdDev</p>
                          <p className="text-xs font-bold text-gray-300">{res.metrics.std}</p>
                        </div>
                      </div>

                      {/* Live Matchup Context */}
                      {res.matchup && (
                        <div className="p-3 rounded-2xl bg-blue-500/5 border border-blue-500/10 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-[10px] font-bold text-blue-400">
                              {res.matchup.oppAbbr}
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter">
                                {res.matchup.location} {res.matchup.opponent}
                              </p>
                              <p className="text-[9px] text-blue-500 font-mono">{res.matchup.status}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-mono font-bold text-white">{res.matchup.score}</p>
                            <p className="text-[9px] text-gray-500 uppercase font-bold">{res.matchup.time}</p>
                          </div>
                        </div>
                      )}

                      {/* Confidence Bar */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[9px] font-bold uppercase">
                          <span className="text-gray-500">Win Probability</span>
                          <span className="text-blue-400">{res.confidence}%</span>
                        </div>
                        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${res.confidence}%` }}
                            className="h-full bg-blue-600 rounded-full"
                          />
                        </div>
                      </div>

                      {/* AI Breakdown Display */}
                      {res.aiBreakdown && (
                        <div className="mt-4 p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
                          <div className="flex items-center gap-2 mb-1.5">
                            <BrainCircuit className="w-3 h-3 text-blue-400" />
                            <span className="text-[9px] font-bold text-blue-400 uppercase">AI Breakdown</span>
                          </div>
                          <p className="text-[10px] text-gray-300 leading-relaxed italic">"{res.aiBreakdown}"</p>
                        </div>
                      )}
                    </div>

                    <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 text-[9px] text-blue-500 font-bold bg-blue-500/10 px-2 py-0.5 rounded">
                          <Info className="w-3 h-3" />
                          REASONING
                        </div>
                        {res.verifiedStats && (
                          <div className="flex items-center gap-1.5 text-[9px] text-green-500 font-bold bg-green-500/10 px-2 py-0.5 rounded">
                            <Shield className="w-3 h-3" />
                            VERIFIED
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAiBreakdown(res);
                          }}
                          disabled={isBreakingDown === res.id}
                          className="text-[9px] font-bold text-purple-400 hover:text-purple-300 flex items-center gap-1.5 px-3 py-1 bg-purple-500/5 border border-purple-500/10 rounded-lg hover:bg-purple-500/10 transition-all"
                        >
                          {isBreakingDown === res.id ? (
                            <Activity className="w-3 h-3 animate-spin" />
                          ) : (
                            <BrainCircuit className="w-3 h-3" />
                          )}
                          AI BREAKDOWN
                        </button>
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleVerifyStats(res);
                          }}
                          disabled={isVerifying === res.id}
                          className="text-[9px] font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1.5 px-3 py-1 bg-blue-500/5 border border-blue-500/10 rounded-lg hover:bg-blue-500/10 transition-all"
                        >
                          {isVerifying === res.id ? (
                            <Activity className="w-3 h-3 animate-spin" />
                          ) : (
                            <Sparkles className="w-3 h-3" />
                          )}
                          {res.verifiedStats ? 'REFRESH' : 'VERIFY LIVE'}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <Dices className="w-6 h-6 text-blue-500" />
            <div>
              <h2 className="text-xl font-bold tracking-tight text-white">Parlay Suggester</h2>
              <p className="text-xs text-gray-500">Optimized combinations based on Power Rank and Odds ranges</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6">
            {/* Custom Parlay Builder */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-gradient-to-br from-orange-600/10 to-blue-600/10 border border-white/10 rounded-3xl overflow-hidden"
            >
              <div className="p-6 border-b border-white/5 flex justify-between items-center bg-white/5">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-orange-500/20 rounded-lg">
                    <Target className="w-5 h-5 text-orange-400" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-white uppercase tracking-tight">Custom Parlay Builder</h3>
                    <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Targeted Odds Strategy</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest">Target Odds</span>
                    <div className="flex items-center bg-black/40 border border-white/10 rounded-lg px-3 py-1.5">
                      <span className="text-xs text-gray-500 mr-1">+</span>
                      <input 
                        type="text" 
                        value={targetOdds}
                        onChange={(e) => setTargetOdds(e.target.value)}
                        className="w-16 bg-transparent text-sm font-mono text-orange-400 focus:outline-none"
                      />
                    </div>
                  </div>
                  <button 
                    onClick={() => setRegenerateSeed(s => s + 1)}
                    className="p-2 bg-white/5 hover:bg-white/10 rounded-xl transition-all text-gray-400 hover:text-white border border-white/10"
                    title="Regenerate Parlay"
                  >
                    <RefreshCw className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {customParlay ? (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {customParlay.legs.map((leg, idx) => (
                        <div key={idx} className="bg-black/40 border border-white/5 rounded-2xl p-4 flex justify-between items-center group hover:border-orange-500/30 transition-all">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-lg border flex items-center justify-center text-[10px] font-black ${getGradeColor(leg.grade)}`}>
                              {leg.grade}
                            </div>
                            <div>
                              <p className="text-sm font-bold text-white">{leg.player}</p>
                              <p className="text-[10px] text-gray-500 uppercase font-bold">{leg.cat} {leg.line}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-mono font-bold text-orange-400">{leg.odds_str}</p>
                            <p className="text-[9px] text-gray-600 font-bold uppercase">{leg.confidence}% Win</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-col md:flex-row gap-4 pt-4 border-t border-white/5">
                      <div className="flex-1 bg-orange-500/10 border border-orange-500/20 rounded-2xl p-4 flex justify-between items-center">
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase font-bold">Total Odds</p>
                          <p className="text-2xl font-black text-orange-400">{customParlay.totalOdds}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-gray-500 uppercase font-bold">Win Prob</p>
                          <p className="text-2xl font-black text-white">{customParlay.winProb}%</p>
                        </div>
                      </div>
                      <button className="flex-[0.5] bg-orange-600 hover:bg-orange-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-lg shadow-orange-600/20 flex items-center justify-center gap-2">
                        <Zap className="w-4 h-4" />
                        LOCK IN
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="py-12 text-center border-2 border-dashed border-white/5 rounded-3xl">
                    <p className="text-sm text-gray-500 uppercase tracking-widest font-bold">
                      {results.length < 2 ? 'Run analysis to build custom parlay' : 'Could not find a parlay for these odds. Try a different target.'}
                    </p>
                  </div>
                )}
              </div>
            </motion.div>

            <div className="flex items-center gap-2 py-4">
              <div className="h-[1px] flex-1 bg-white/5"></div>
              <span className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">Recommended Presets</span>
              <div className="h-[1px] flex-1 bg-white/5"></div>
            </div>

            {parlaySuggestions.length === 0 ? (
              <div className="h-64 bg-white/5 rounded-3xl border border-dashed border-white/10 flex flex-col items-center justify-center text-gray-600 space-y-4 p-8 text-center">
                <Layers className="w-10 h-10 opacity-20" />
                <p className="text-sm font-medium text-gray-400">Not enough data to suggest parlays</p>
              </div>
            ) : (
              parlaySuggestions.map((parlay, idx) => (
                <motion.div
                  key={parlay.rangeName}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  className="bg-white/5 border border-white/10 rounded-3xl overflow-hidden"
                >
                  <div className="p-6 bg-gradient-to-r from-blue-600/10 to-transparent border-b border-white/5 flex justify-between items-center">
                    <div>
                      <h3 className="text-lg font-black text-white">{parlay.rangeName}</h3>
                      <p className="text-xs text-blue-400 font-bold uppercase tracking-widest">{parlay.picks.length} LEGS</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-black text-white">{parlay.totalOdds}</p>
                      <p className="text-[10px] font-bold text-gray-500 uppercase">Estimated Odds</p>
                    </div>
                  </div>

                  <div className="p-6 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {parlay.picks.map((pick: any) => (
                        <div key={pick.id} className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/5">
                          <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center text-[10px] font-black text-blue-400">
                            {pick.team}
                          </div>
                          <div className="flex-1">
                            <p className="text-xs font-bold text-white truncate">{pick.player}</p>
                            <p className="text-[10px] text-gray-500 uppercase font-bold">{pick.cat} {pick.line}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-bold text-blue-400">{pick.odds_str}</p>
                            <p className="text-[9px] font-bold text-gray-600">P: {pick.power}</p>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="pt-4 mt-4 border-t border-white/5 flex flex-wrap gap-6 items-center justify-between">
                      <div className="flex gap-6">
                        <div>
                          <p className="text-[10px] font-bold text-gray-500 uppercase">Win Probability</p>
                          <p className="text-lg font-black text-green-400">{parlay.totalWinProb}%</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-gray-500 uppercase">Avg Power</p>
                          <p className="text-lg font-black text-blue-400">{parlay.avgPower}</p>
                        </div>
                      </div>
                      <button className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-black transition-all shadow-lg shadow-blue-600/20">
                        COPY PARLAY
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
      </main>

      {/* Bulk Import Modal */}
      <AnimatePresence>
        {isImportModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsImportModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl bg-[#0D0D0D] border border-white/10 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-purple-600/10 to-transparent">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-600/20 rounded-lg">
                    <ClipboardList className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-white">NBA.com Stats Import</h2>
                    <p className="text-xs text-gray-500">Copy-paste the "Last 5 Games" table from NBA.com</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsImportModalOpen(false)}
                  className="p-2 hover:bg-white/5 rounded-full text-gray-500 hover:text-white transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="p-6 space-y-4 overflow-y-auto custom-scrollbar">
                <div className="flex items-center gap-4 mb-2">
                  <button 
                    onClick={() => setImportType('L5')}
                    className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all border ${importType === 'L5' ? 'bg-purple-600/20 border-purple-500 text-purple-400' : 'bg-white/5 border-white/10 text-gray-500'}`}
                  >
                    LAST 5 GAMES
                  </button>
                  <button 
                    onClick={() => setImportType('L10')}
                    className={`flex-1 py-3 rounded-xl font-bold text-sm transition-all border ${importType === 'L10' ? 'bg-purple-600/20 border-purple-500 text-purple-400' : 'bg-white/5 border-white/10 text-gray-500'}`}
                  >
                    LAST 10 GAMES
                  </button>
                </div>

                <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4 text-xs text-blue-400 space-y-2">
                  <p className="font-bold">Instructions:</p>
                  <ol className="list-decimal list-inside space-y-1 opacity-80">
                    <li>Go to NBA.com/stats/players/traditional</li>
                    <li>Set "Season Segment" to "{importType === 'L5' ? 'Last 5 Games' : 'Last 10 Games'}"</li>
                    <li>Set "Per Mode" to "Totals"</li>
                    <li>Highlight the table rows and Copy (Ctrl+C)</li>
                    <li>Paste below and click "Process Stats"</li>
                  </ol>
                </div>

                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder="Paste table data here..."
                  className="w-full h-64 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-purple-500/50 transition-all font-mono custom-scrollbar resize-none"
                />
              </div>

              <div className="p-6 border-t border-white/10 bg-black/20 flex flex-col gap-4">
                {importSuccess && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-green-500/10 border border-green-500/20 rounded-xl p-3 text-center text-sm text-green-400 font-bold"
                  >
                    {importSuccess}
                  </motion.div>
                )}
                <div className="flex gap-3">
                  <button
                    onClick={() => setIsImportModalOpen(false)}
                    className="flex-1 py-3 bg-white/5 hover:bg-white/10 rounded-xl font-bold text-sm transition-all text-gray-400"
                  >
                    CLOSE
                  </button>
                  <button
                    onClick={handleBulkImport}
                    disabled={!importText.trim()}
                    className="flex-[2] py-3 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:opacity-50 rounded-xl font-bold text-sm transition-all text-white shadow-lg shadow-purple-600/20"
                  >
                    PROCESS STATS
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Reasoning Modal */}
      <AnimatePresence>
        {selectedProp && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedProp(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-2xl bg-[#0d1117] border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
            >
              {/* Modal Header */}
              <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/5">
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center text-xl font-black ${getGradeColor(selectedProp.grade)}`}>
                    {selectedProp.grade}
                  </div>
                  <div>
                    <h2 className="text-xl font-bold">{selectedProp.player}</h2>
                    <p className="text-xs text-gray-500 font-mono uppercase tracking-widest">{selectedProp.team} • {selectedProp.cat}</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedProp(null)}
                  className="p-2 hover:bg-white/5 rounded-xl transition-colors text-gray-500 hover:text-white"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="p-8 space-y-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
                
                {/* AI Deep Insight */}
                {aiInsights[selectedProp.player] && (
                  <section className="space-y-4">
                    <div className="flex items-center gap-2 text-blue-400 font-bold text-sm uppercase tracking-wider">
                      <BrainCircuit className="w-4 h-4" />
                      Sharp AI Insight
                    </div>
                    <div className="bg-gradient-to-br from-blue-600/20 to-purple-600/20 border border-blue-500/30 rounded-2xl p-6">
                      <p className="text-sm text-gray-200 leading-relaxed italic">
                        "{aiInsights[selectedProp.player]}"
                      </p>
                    </div>
                  </section>
                )}

                {/* AI Breakdown (Detailed) */}
                {selectedProp.aiBreakdown && (
                  <section className="space-y-4">
                    <div className="flex items-center gap-2 text-purple-400 font-bold text-sm uppercase tracking-wider">
                      <BrainCircuit className="w-4 h-4" />
                      AI Analysis Breakdown
                    </div>
                    <div className="bg-purple-500/10 border border-purple-500/20 rounded-2xl p-6">
                      <p className="text-sm text-gray-200 leading-relaxed">
                        {selectedProp.aiBreakdown}
                      </p>
                    </div>
                  </section>
                )}

                {/* Kelly Criterion & Sizing */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-green-400 font-bold text-sm uppercase tracking-wider">
                    <Wallet className="w-4 h-4" />
                    Bankroll Management
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-green-500/5 border border-green-500/10 rounded-2xl p-6 flex flex-col items-center justify-center text-center">
                      <p className="text-[10px] font-bold text-green-400 uppercase mb-2">Kelly Size</p>
                      <p className="text-3xl font-black text-white">{selectedProp.kelly}%</p>
                      <p className="text-[10px] text-gray-500 font-bold uppercase mt-1">Of Bankroll</p>
                    </div>
                    <div className="bg-blue-500/5 border border-blue-500/10 rounded-2xl p-6 flex flex-col items-center justify-center text-center">
                      <p className="text-[10px] font-bold text-blue-400 uppercase mb-2">Rec. Units</p>
                      <p className="text-3xl font-black text-white">{(selectedProp.kelly / 2).toFixed(1)}u</p>
                      <p className="text-[10px] text-gray-500 font-bold uppercase mt-1">Standard Unit</p>
                    </div>
                  </div>
                </section>

                {/* Trend Chart */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-gray-400 font-bold text-sm uppercase tracking-wider">
                    <BarChart3 className="w-4 h-4" />
                    Performance Trend
                  </div>
                  <div className="bg-black/40 border border-white/5 rounded-2xl p-6 h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={
                        selectedProp.verifiedStats 
                          ? selectedProp.verifiedStats.games.map((g, i) => ({ name: `G${i+1}`, val: g.val }))
                          : [
                            { name: 'Season', val: parseFloat(selectedProp.metrics.season) },
                            { name: 'L10', val: parseFloat(selectedProp.metrics.l10) },
                            { name: 'L5', val: parseFloat(selectedProp.metrics.l5) },
                            { name: 'Proj', val: parseFloat(selectedProp.metrics.l5) * 1.05 }
                          ]
                      }>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                        <XAxis 
                          dataKey="name" 
                          stroke="#ffffff20" 
                          fontSize={10} 
                          tickLine={false} 
                          axisLine={false}
                        />
                        <YAxis 
                          stroke="#ffffff20" 
                          fontSize={10} 
                          tickLine={false} 
                          axisLine={false}
                          domain={['dataMin - 2', 'dataMax + 2']} 
                        />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#000', border: '1px solid #ffffff10', borderRadius: '12px' }}
                          itemStyle={{ color: '#3b82f6' }}
                        />
                        <ReferenceLine y={parseFloat(selectedProp.line)} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Line', position: 'right', fill: '#ef4444', fontSize: 10 }} />
                        <Line 
                          type="monotone" 
                          dataKey="val" 
                          stroke="#3b82f6" 
                          strokeWidth={4} 
                          dot={{ r: 6, fill: '#3b82f6', strokeWidth: 0 }}
                          activeDot={{ r: 8, strokeWidth: 0 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </section>

                {/* Verified Stats Table */}
                {selectedProp.verifiedStats && (
                  <section className="space-y-4">
                    <div className="flex items-center gap-2 text-blue-400 font-bold text-sm uppercase tracking-wider">
                      <Shield className="w-4 h-4" />
                      Live Verified Stats ({selectedProp.verifiedStats.source})
                    </div>
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-6 space-y-3">
                      {selectedProp.verifiedStats.games.map((g, i) => (
                        <div key={i} className="flex justify-between items-center text-xs">
                          <span className="text-gray-400 font-mono">{g.date} vs {g.opponent}</span>
                          <span className={`font-black ${g.val >= parseFloat(selectedProp.line) ? 'text-green-400' : 'text-red-400'}`}>
                            {g.val} {g.val >= parseFloat(selectedProp.line) ? '✅' : '❌'}
                          </span>
                        </div>
                      ))}
                      <div className="pt-4 mt-4 border-t border-white/10 grid grid-cols-3 gap-4 text-center">
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase font-bold">Live L5</p>
                          <p className="text-sm font-black text-white">{selectedProp.verifiedStats.l5_avg}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase font-bold">Live L10</p>
                          <p className="text-sm font-black text-white">{selectedProp.verifiedStats.l10_avg}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-500 uppercase font-bold">Season</p>
                          <p className="text-sm font-black text-white">{selectedProp.verifiedStats.season_avg}</p>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                {/* Probability Section */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-blue-400 font-bold text-sm uppercase tracking-wider">
                    <Calculator className="w-4 h-4" />
                    Probability Breakdown
                  </div>
                  <div className="bg-blue-500/5 border border-blue-500/10 rounded-2xl p-6 space-y-4">
                    <p className="text-sm text-gray-300 leading-relaxed italic">
                      "{selectedProp.prob_breakdown.description}"
                    </p>
                    <div className="grid grid-cols-3 gap-4 pt-4 border-t border-white/5">
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Z-Score</p>
                        <p className="text-lg font-mono font-bold text-blue-400">{selectedProp.prob_breakdown.zScore}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">StdDev</p>
                        <p className="text-lg font-mono font-bold text-blue-400">{selectedProp.prob_breakdown.stdDev}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">Model</p>
                        <p className="text-[10px] font-mono font-bold text-gray-500 mt-1.5">{selectedProp.prob_breakdown.formula}</p>
                      </div>
                    </div>
                  </div>
                </section>

                {/* EV Math Section */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-green-400 font-bold text-sm uppercase tracking-wider">
                    <TrendingUp className="w-4 h-4" />
                    Expected Value (EV) Math
                  </div>
                  <div className="bg-green-500/5 border border-green-500/10 rounded-2xl p-6 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <p className="text-[10px] text-gray-500 uppercase font-bold">Formula</p>
                        <code className="text-xs bg-black/40 p-2 rounded block text-green-400 font-mono">
                          (Win Prob × Decimal Odds - 1) × 100
                        </code>
                      </div>
                      <div className="space-y-2">
                        <p className="text-[10px] text-gray-500 uppercase font-bold">Calculation</p>
                        <p className="text-sm font-mono text-white">
                          ({(selectedProp.confidence / 100).toFixed(2)} × {(selectedProp.odds_int > 0 ? (selectedProp.odds_int / 100 + 1) : (100 / Math.abs(selectedProp.odds_int) + 1)).toFixed(2)} - 1) × 100 = <span className={selectedProp.ev > 0 ? 'text-green-400' : 'text-red-400'}>{selectedProp.ev}%</span>
                        </p>
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-500 leading-relaxed pt-4 border-t border-white/5">
                      EV % represents your long-term ROI. A positive EV means the bet is mathematically profitable over time.
                    </p>
                  </div>
                </section>

                {/* Analysis Section */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-green-400 font-bold text-sm uppercase tracking-wider">
                    <BarChart3 className="w-4 h-4" />
                    Deep Analysis
                  </div>
                  <div className="space-y-3">
                    {selectedProp.analysis.map((item, i) => (
                      <div key={i} className="bg-white/5 border border-white/5 rounded-xl p-4 flex items-start gap-3">
                        <TrendingUp className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                        <p className="text-sm text-gray-300">{item}</p>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Stats Grid */}
                <section className="grid grid-cols-4 gap-4">
                  {[
                    { label: 'Season Avg', val: selectedProp.metrics.season },
                    { label: 'Last 10', val: selectedProp.metrics.l10 },
                    { label: 'Last 5', val: selectedProp.metrics.l5 },
                    { label: 'StdDev', val: selectedProp.metrics.std }
                  ].map((stat, i) => (
                    <div key={i} className="bg-white/5 border border-white/5 rounded-2xl p-4 text-center">
                      <p className="text-[10px] text-gray-500 uppercase font-bold mb-1">{stat.label}</p>
                      <p className="text-lg font-bold text-white">{stat.val}</p>
                    </div>
                  ))}
                </section>

              </div>

              {/* Modal Footer */}
              <div className="p-6 bg-white/5 border-t border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Market Odds:</span>
                  <span className="text-sm font-bold text-blue-400">{selectedProp.odds_str}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Expected Value:</span>
                  <span className={`text-sm font-bold ${selectedProp.ev > 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {selectedProp.ev > 0 ? `+${selectedProp.ev}` : selectedProp.ev}%
                  </span>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
