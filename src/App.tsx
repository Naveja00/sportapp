import { useEffect, useMemo, useState } from 'react';

type IncidentType = 'Fire' | 'Crime' | 'Medical' | 'Special Ops';
type UnitRole = 'FIRE' | 'POLICE' | 'MEDIC' | 'SPECOPS';
type Rank = 'ROOKIE' | 'VETERAN' | 'ELITE';
type Status = 'IDLE' | 'EN_ROUTE' | 'ON_SCENE' | 'RECOVERING';

type Sector = { id: number; name: string; unlockRep: number; danger: number };
type IncidentState = 'REPORTED' | 'ESCALATING' | 'CRITICAL';

type Incident = {
  id: string;
  type: IncidentType;
  severity: number;
  state: IncidentState;
  sectorId: number;
  x: number;
  y: number;
  blocks: number;
  createdAt: number;
  nextEscalationAt: number;
  assignedUnitIds: string[];
};

type Unit = {
  id: string;
  callsign: string;
  role: UnitRole;
  rank: Rank;
  trait: 'Fast Driver' | 'Low Stability' | 'Field Surgeon' | 'Breach Expert' | 'Calm Under Fire';
  fatigue: number;
  stress: number;
  xp: number;
  status: Status;
  x: number;
  y: number;
  etaMs?: number;
  taskUntil?: number;
  incidentId?: string;
  log: string;
};

const INCIDENT_POOL: IncidentType[] = ['Fire', 'Crime', 'Medical', 'Special Ops'];
const initialSectors: Sector[] = [
  { id: 1, name: 'THE LOOP', unlockRep: 0, danger: 15 },
  { id: 2, name: 'INDUSTRIAL', unlockRep: 140, danger: 22 },
  { id: 3, name: 'SUBURBS', unlockRep: 300, danger: 12 }
];
const rolePref: Record<IncidentType, UnitRole[]> = {
  Fire: ['FIRE', 'MEDIC'],
  Crime: ['POLICE', 'SPECOPS'],
  Medical: ['MEDIC', 'POLICE'],
  'Special Ops': ['SPECOPS', 'POLICE']
};
const rankSpeed: Record<Rank, number> = { ROOKIE: 1, VETERAN: 0.86, ELITE: 0.7 };
const rankLabel = (xp: number): Rank => (xp > 320 ? 'ELITE' : xp > 160 ? 'VETERAN' : 'ROOKIE');
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.round(Math.hypot(a.x - b.x, a.y - b.y));

const createUnit = (id: string, callsign: string, role: UnitRole, x: number, y: number): Unit => {
  const traits: Unit['trait'][] = ['Fast Driver', 'Low Stability', 'Field Surgeon', 'Breach Expert', 'Calm Under Fire'];
  return { id, callsign, role, rank: 'ROOKIE', trait: traits[Math.floor(Math.random() * traits.length)], fatigue: Math.floor(Math.random() * 20), stress: 10, xp: 0, status: 'IDLE', x, y, log: 'Monitoring city channels.' };
};

export default function App() {
  const [tick, setTick] = useState(Date.now());
  const [rep, setRep] = useState(100);
  const [stability, setStability] = useState(88);
  const [scanBoost, setScanBoost] = useState(0);
  const [gpsBoost, setGpsBoost] = useState(0);
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [units, setUnits] = useState<Unit[]>([
    createUnit('u1', 'ADAM-12', 'POLICE', 12, 28),
    createUnit('u2', 'MEDIC-4', 'MEDIC', 58, 20),
    createUnit('u3', 'ENGINE-7', 'FIRE', 33, 58),
    createUnit('u4', 'SABLE-1', 'SPECOPS', 76, 48)
  ]);
  const [feed, setFeed] = useState<string[]>(['[BOOT] CENTRAL COMMAND AI ONLINE']);

  useEffect(() => { const t = setInterval(() => setTick(Date.now()), 1000); return () => clearInterval(t); }, []);

  useEffect(() => {
    const spawn = setInterval(() => {
      setIncidents((prev) => {
        if (prev.length > 18) return prev;
        const unlocked = initialSectors.filter((s) => rep >= s.unlockRep);
        const sector = unlocked[Math.floor(Math.random() * unlocked.length)];
        const swan = Math.random() < 0.05;
        const count = swan ? 8 + Math.floor(Math.random() * 5) : 1;
        const now = Date.now();
        const created = Array.from({ length: count }).map((_, i) => {
          const severity = Math.ceil(Math.random() * 5);
          const escalationBase = 22000 - severity * 2000 - sector.danger * 120;
          return {
            id: `${now}-${i}`,
            type: INCIDENT_POOL[Math.floor(Math.random() * INCIDENT_POOL.length)],
            severity,
            state: 'REPORTED' as IncidentState,
            sectorId: sector.id,
            x: Math.floor(Math.random() * 90) + 5,
            y: Math.floor(Math.random() * 90) + 5,
            blocks: Math.floor(Math.random() * 45) + 4,
            createdAt: now,
            nextEscalationAt: now + Math.max(7000, escalationBase),
            assignedUnitIds: []
          };
        });
        if (swan) setFeed((f) => [`[ALERT] BLACK SWAN EVENT: ${sector.name} GRID DISTORTION`, ...f].slice(0, 18));
        return [...prev, ...created];
      });
    }, Math.max(1800, 4600 - scanBoost * 400));
    return () => clearInterval(spawn);
  }, [rep, scanBoost]);

  useEffect(() => {
    setIncidents((prev) => {
      let repDelta = 0;
      let stabilityDelta = 0;
      const next = prev.flatMap((i) => {
        const unattended = i.assignedUnitIds.length === 0;
        if (tick >= i.nextEscalationAt && unattended) {
          if (i.state === 'REPORTED') {
            setFeed((f) => [`[WARN] ${i.type} escalating in sector-${i.sectorId}`, ...f].slice(0, 18));
            return [{ ...i, state: 'ESCALATING', severity: Math.min(5, i.severity + 1), nextEscalationAt: tick + 12000 }];
          }
          if (i.state === 'ESCALATING') {
            setFeed((f) => [`[CRIT] ${i.type} critical mass reached sector-${i.sectorId}`, ...f].slice(0, 18));
            return [{ ...i, state: 'CRITICAL', severity: Math.min(5, i.severity + 1), nextEscalationAt: tick + 9000 }];
          }
          if (i.state === 'CRITICAL') {
            repDelta -= 12;
            stabilityDelta -= 4;
            setFeed((f) => [`[FAIL] Incident collapse: ${i.type} sector-${i.sectorId}`, ...f].slice(0, 18));
            return [];
          }
        }
        return [i];
      });
      if (repDelta) setRep((r) => Math.max(0, r + repDelta));
      if (stabilityDelta) setStability((s) => Math.max(0, s + stabilityDelta));
      return next;
    });

    setUnits((prev) => prev.map((u) => {
      if (u.status === 'EN_ROUTE' && u.etaMs && tick >= u.etaMs) return { ...u, status: 'ON_SCENE', taskUntil: tick + 10000 + u.fatigue * 120, log: 'Breaching Perimeter / Tactical Sweep' };
      if (u.status === 'ON_SCENE' && u.taskUntil && tick >= u.taskUntil) return { ...u, status: 'RECOVERING', taskUntil: tick + 8000, log: 'Analyzing Triage / Debrief uplink' };
      if (u.status === 'RECOVERING' && u.taskUntil && tick >= u.taskUntil) return { ...u, status: 'IDLE', incidentId: undefined, fatigue: Math.min(100, u.fatigue + 14), stress: Math.max(0, u.stress - 10), log: 'Ready / Awaiting redeploy.' };
      return u;
    }));

    setIncidents((prev) => prev.filter((i) => {
      const onScene = units.filter((u) => u.incidentId === i.id && u.status === 'ON_SCENE');
      if (!onScene.length) return true;
      const totalSkill = onScene.reduce((acc, u) => acc + (u.rank === 'ELITE' ? 0.32 : u.rank === 'VETERAN' ? 0.22 : 0.14) + (rolePref[i.type].includes(u.role) ? 0.2 : -0.05), 0);
      const fatigueTax = onScene.reduce((acc, u) => acc + u.fatigue * 0.003 + u.stress * 0.002, 0);
      const success = Math.random() < Math.max(0.08, Math.min(0.94, totalSkill - fatigueTax + (i.state === 'CRITICAL' ? -0.15 : 0)));
      if (success) {
        const gain = 8 + i.severity * 4 + (i.state === 'CRITICAL' ? 10 : 0);
        setRep((r) => r + gain);
        setStability((s) => Math.min(100, s + 2));
        setFeed((f) => [`[OK] ${i.type} neutralized by ${onScene.map((u) => u.callsign).join(', ')} (+${gain} REP)`, ...f].slice(0, 18));
        setUnits((all) => all.map((u) => u.incidentId === i.id ? { ...u, xp: u.xp + 24 + i.severity * 4, rank: rankLabel(u.xp + 24 + i.severity * 4), stress: Math.min(100, u.stress + 12), log: 'Site contained. Exfil and telemetry upload.' } : u));
        return false;
      }
      setFeed((f) => [`[LOSS] ${i.type} resisted containment; teams regrouping`, ...f].slice(0, 18));
      return true;
    }));
  }, [tick, units]);

  const unlockedSectors = useMemo(() => initialSectors.filter((s) => rep >= s.unlockRep), [rep]);

  const dispatch = (incident: Incident) => {
    const chosen = units.find((u) => u.id === selectedUnitId && u.status === 'IDLE') || units.filter((u) => u.status === 'IDLE').sort((a, b) => dist(a, incident) - dist(b, incident))[0];
    if (!chosen) return;
    const preferred = rolePref[incident.type].includes(chosen.role);
    const d = dist(chosen, incident);
    const speed = (chosen.trait === 'Fast Driver' ? 0.82 : 1) * rankSpeed[chosen.rank] * (1 - gpsBoost * 0.07);
    const etaMs = Date.now() + d * 400 * speed;

    setUnits((prev) => prev.map((u) => u.id === chosen.id ? { ...u, status: 'EN_ROUTE', x: incident.x, y: incident.y, incidentId: incident.id, etaMs, fatigue: Math.max(0, u.fatigue - 6), stress: Math.min(100, u.stress + 8), log: `${preferred ? 'Priority' : 'Non-ideal'} dispatch / ${d} BLKS` } : u));
    setIncidents((prev) => prev.map((i) => i.id === incident.id ? { ...i, assignedUnitIds: [...new Set([...i.assignedUnitIds, chosen.id])] } : i));
    setFeed((f) => [`[DISPATCH] ${chosen.callsign} -> ${incident.type} (${preferred ? 'role match' : 'role mismatch'})`, ...f].slice(0, 18));
    setSelectedUnitId(null);
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
          {incidents.map((i) => <button key={i.id} className={`incident sev-${i.severity}`} style={{ left: `${i.x}%`, top: `${i.y}%` }} onClick={() => dispatch(i)} title={`${i.type} | ${i.state} | ${i.blocks} BLKS`} />)}
          {units.map((u) => <button key={u.id} onClick={() => setSelectedUnitId(u.id)} className={`unit ${u.status.toLowerCase()} ${selectedUnitId === u.id ? 'selected' : ''}`} style={{ left: `${u.x}%`, top: `${u.y}%` }}>{u.callsign}</button>)}
          <div className="radar" />
        </div>
        <aside>
          <h3>TACTICAL TELEMETRY</h3>
          {units.map((u) => <div key={u.id} className="card"><b>{u.callsign}</b> [{u.role}] {u.rank}<br />{u.status} | Fatigue {u.fatigue}% | Stress {u.stress}%<br /><small>{u.trait} // {u.log}</small></div>)}
          <h3>ACTIVE INCIDENTS</h3>
          {incidents.map((i) => <div key={i.id} className="card">{i.type} / {i.state} / S{i.severity}<br /><small>Sector-{i.sectorId} • Assigned: {i.assignedUnitIds.length}</small></div>)}
          <h3>ACTIVITY LOG</h3>
          {feed.map((line, i) => <div key={i} className="log">{line}</div>)}
        </aside>
      </main>
    </div>
  );
}
