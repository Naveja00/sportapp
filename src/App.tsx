import { useEffect, useMemo, useState } from 'react';

type IncidentType = 'Fire' | 'Crime' | 'Medical' | 'Special Ops';
type UnitRole = 'FIRE' | 'POLICE' | 'MEDIC' | 'SPECOPS';
type Rank = 'ROOKIE' | 'VETERAN' | 'ELITE';
type Status = 'IDLE' | 'EN_ROUTE' | 'ON_SCENE' | 'RECOVERING';

type Sector = {
  id: number;
  name: string;
  unlockRep: number;
  danger: number;
};

type Incident = {
  id: string;
  type: IncidentType;
  severity: number;
  sectorId: number;
  x: number;
  y: number;
  blocks: number;
  createdAt: number;
  deadlineMs: number;
  assignedUnitId?: string;
};

type Unit = {
  id: string;
  callsign: string;
  role: UnitRole;
  rank: Rank;
  trait: 'Fast Driver' | 'Low Stability' | 'Field Surgeon' | 'Breach Expert' | 'Calm Under Fire';
  fatigue: number;
  xp: number;
  status: Status;
  x: number;
  y: number;
  etaMs?: number;
  taskUntil?: number;
  log: string;
};

const INCIDENT_POOL: IncidentType[] = ['Fire', 'Crime', 'Medical', 'Special Ops'];
const initialSectors: Sector[] = [
  { id: 1, name: 'THE LOOP', unlockRep: 0, danger: 15 },
  { id: 2, name: 'INDUSTRIAL', unlockRep: 140, danger: 20 },
  { id: 3, name: 'SUBURBS', unlockRep: 300, danger: 10 }
];

const rankSpeed: Record<Rank, number> = { ROOKIE: 1, VETERAN: 0.87, ELITE: 0.67 };
const rankLabel = (xp: number): Rank => (xp > 320 ? 'ELITE' : xp > 150 ? 'VETERAN' : 'ROOKIE');

const createUnit = (id: string, callsign: string, role: UnitRole, x: number, y: number): Unit => {
  const traits: Unit['trait'][] = ['Fast Driver', 'Low Stability', 'Field Surgeon', 'Breach Expert', 'Calm Under Fire'];
  return {
    id,
    callsign,
    role,
    rank: 'ROOKIE',
    trait: traits[Math.floor(Math.random() * traits.length)],
    fatigue: Math.floor(Math.random() * 20),
    xp: 0,
    status: 'IDLE',
    x,
    y,
    log: 'Standing by for command input.'
  };
};

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.round(Math.hypot(a.x - b.x, a.y - b.y));

export default function App() {
  const [tick, setTick] = useState(Date.now());
  const [rep, setRep] = useState(100);
  const [stability, setStability] = useState(88);
  const [scanBoost, setScanBoost] = useState(0);
  const [gpsBoost, setGpsBoost] = useState(0);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [units, setUnits] = useState<Unit[]>([
    createUnit('u1', 'ADAM-12', 'POLICE', 12, 28),
    createUnit('u2', 'MEDIC-4', 'MEDIC', 58, 20),
    createUnit('u3', 'ENGINE-7', 'FIRE', 33, 58),
    createUnit('u4', 'SABLE-1', 'SPECOPS', 76, 48)
  ]);
  const [feed, setFeed] = useState<string[]>(['[BOOT] CENTRAL COMMAND AI ONLINE']);

  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const spawn = setInterval(() => {
      setIncidents((prev) => {
        if (prev.length > 14) return prev;
        const unlocked = initialSectors.filter((s) => rep >= s.unlockRep);
        const sector = unlocked[Math.floor(Math.random() * unlocked.length)];
        const isBlackSwan = Math.random() < 0.04;
        const count = isBlackSwan ? 10 : 1;
        const now = Date.now();
        const created = Array.from({ length: count }).map((_, i) => {
          const x = Math.floor(Math.random() * 90) + 5;
          const y = Math.floor(Math.random() * 90) + 5;
          const severity = Math.ceil(Math.random() * 5);
          return {
            id: `${now}-${i}`,
            type: INCIDENT_POOL[Math.floor(Math.random() * INCIDENT_POOL.length)],
            severity,
            sectorId: sector.id,
            x,
            y,
            blocks: Math.floor(Math.random() * 45) + 4,
            createdAt: now,
            deadlineMs: (45 - severity * 5) * 1000
          } as Incident;
        });
        if (isBlackSwan) setFeed((f) => [`[ALERT] BLACK SWAN EVENT: ${sector.name} GRID COLLAPSE`, ...f].slice(0, 16));
        return [...prev, ...created];
      });
    }, 4300 - scanBoost * 450);
    return () => clearInterval(spawn);
  }, [rep, scanBoost]);

  useEffect(() => {
    setIncidents((prev) => {
      let repDelta = 0;
      let stabDelta = 0;
      const alive = prev.filter((i) => {
        const expired = Date.now() - i.createdAt > i.deadlineMs && !i.assignedUnitId;
        if (expired) {
          repDelta -= 8;
          stabDelta -= 2;
          setFeed((f) => [`[FAIL] ${i.type} timed out in sector-${i.sectorId}`, ...f].slice(0, 16));
        }
        return !expired;
      });
      if (repDelta) setRep((r) => Math.max(0, r + repDelta));
      if (stabDelta) setStability((s) => Math.max(0, s + stabDelta));
      return alive;
    });

    setUnits((prev) =>
      prev.map((u) => {
        if (u.status === 'EN_ROUTE' && u.etaMs && tick >= u.etaMs) return { ...u, status: 'ON_SCENE', log: 'Breaching Perimeter / Tactical Sweep', taskUntil: tick + 12000 };
        if (u.status === 'ON_SCENE' && u.taskUntil && tick >= u.taskUntil) return { ...u, status: 'RECOVERING', taskUntil: tick + 9000, log: 'Analyzing Triage + Exporting Telemetry' };
        if (u.status === 'RECOVERING' && u.taskUntil && tick >= u.taskUntil) return { ...u, status: 'IDLE', fatigue: Math.min(100, u.fatigue + 18), log: 'Rearmed and ready.' };
        return u;
      })
    );
  }, [tick]);

  const unlockedSectors = useMemo(() => initialSectors.filter((s) => rep >= s.unlockRep), [rep]);

  const dispatch = (incident: Incident) => {
    const idle = units.filter((u) => u.status === 'IDLE');
    if (!idle.length) return;
    const target = idle
      .map((u) => ({ unit: u, d: dist(u, incident) }))
      .sort((a, b) => a.d - b.d)[0];
    const speed = (target.unit.trait === 'Fast Driver' ? 0.8 : 1) * rankSpeed[target.unit.rank] * (1 - gpsBoost * 0.08);
    const etaMs = Date.now() + target.d * 420 * speed;

    setUnits((prev) =>
      prev.map((u) => (u.id === target.unit.id ? { ...u, status: 'EN_ROUTE', etaMs, x: incident.x, y: incident.y, fatigue: Math.max(0, u.fatigue - 4), log: `Routing to ${incident.type} / ${target.d} BLKS` } : u))
    );

    const responseTime = etaMs - incident.createdAt;
    const successOdds = Math.max(0.2, 0.95 - incident.severity * 0.1 - target.unit.fatigue * 0.003 + (target.unit.rank === 'ELITE' ? 0.15 : 0));
    const success = Math.random() < successOdds;
    const repGain = success ? Math.max(4, 20 - Math.floor(responseTime / 3500)) : -10;

    setRep((r) => Math.max(0, r + repGain));
    setStability((s) => Math.max(0, Math.min(100, s + (success ? 2 : -3))));
    setFeed((f) => [`[${success ? 'OK' : 'LOSS'}] ${target.unit.callsign} -> ${incident.type} S${incident.severity} (${success ? '+' : ''}${repGain} REP)`, ...f].slice(0, 16));
    setIncidents((prev) => prev.filter((i) => i.id !== incident.id));
    setUnits((prev) => prev.map((u) => (u.id === target.unit.id ? { ...u, xp: u.xp + (success ? 30 : 10), rank: rankLabel(u.xp + (success ? 30 : 10)) } : u)));
  };

  return (
    <div className="terminal-root">
      <header><h1>CITY CENTRAL COMMAND // RETROFUTURIST TERMINAL</h1><div>REP {rep} | STABILITY {stability}% | UTC {new Date(tick).toLocaleTimeString()}</div></header>
      <section className="hud">
        <button onClick={() => setGpsBoost((g) => g + 1)}>Upgrade City Grid ({gpsBoost})</button>
        <button onClick={() => setScanBoost((s) => s + 1)}>Upgrade Dispatch AI ({scanBoost})</button>
        <div>Unlocked: {unlockedSectors.map((s) => s.name).join(', ')}</div>
      </section>
      <main>
        <div className="map">
          {incidents.map((i) => <button key={i.id} className={`incident sev-${i.severity}`} style={{ left: `${i.x}%`, top: `${i.y}%` }} onClick={() => dispatch(i)} title={`${i.type} / ${i.blocks} BLKS`} />)}
          {units.map((u) => <div key={u.id} className={`unit ${u.status.toLowerCase()}`} style={{ left: `${u.x}%`, top: `${u.y}%` }}>{u.callsign}</div>)}
          <div className="radar" />
        </div>
        <aside>
          <h3>TACTICAL TELEMETRY</h3>
          {units.map((u) => <div key={u.id} className="card"><b>{u.callsign}</b> [{u.role}] {u.rank}<br />{u.status} | Fatigue {u.fatigue}%<br /><small>{u.trait} // {u.log}</small></div>)}
          <h3>ACTIVITY LOG</h3>
          {feed.map((line, i) => <div key={i} className="log">{line}</div>)}
        </aside>
      </main>
    </div>
  );
}
