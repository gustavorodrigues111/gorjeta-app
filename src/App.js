// AppTip — sistema de gestão de gorjetas e equipe para restaurantes
import { useState, useEffect, Component } from "react";
import { db } from "./firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

const APP_VERSION = "5.35.0";

const DEFAULT_ADMISSION = () => `${new Date().getFullYear()}-01-01`;
const round2 = (v) => Math.round(v * 100) / 100;

// Error Boundary — evita tela branca mostrando mensagem de erro
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error("AppTip ErrorBoundary:", error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{minHeight:"100vh",background:"#1a1510",display:"flex",alignItems:"center",justifyContent:"center",padding:32}}>
          <div style={{background:"#211c16",borderRadius:20,padding:32,maxWidth:480,width:"100%",border:"1px solid #3d3325",textAlign:"center",fontFamily:"'DM Sans',sans-serif"}}>
            <div style={{fontSize:40,marginBottom:16}}>⚠️</div>
            <h2 style={{color:"#f0ece4",margin:"0 0 8px",fontSize:18}}>Algo deu errado</h2>
            <p style={{color:"#7a6e5a",fontSize:13,marginBottom:16}}>{this.state.error?.message || "Erro desconhecido"}</p>
            <button onClick={()=>{ this.setState({hasError:false,error:null}); window.location.reload(); }}
              style={{padding:"10px 24px",borderRadius:10,background:"#d4a017",border:"none",color:"#1a1510",fontWeight:700,cursor:"pointer",fontSize:14}}>
              Recarregar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
//
// ── localStorage cache helpers ──
function cacheSet(key, value) {
  try { localStorage.setItem("apptip_cache_" + key, JSON.stringify(value)); } catch { /* quota */ }
}
function cacheGet(key) {
  try {
    const raw = localStorage.getItem("apptip_cache_" + key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function load(key, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const snap = await getDoc(doc(db, "appdata", key));
      const val = snap.exists() ? snap.data().value : null;
      if (val !== null) cacheSet(key, val);
      return val;
    } catch (e) {
      console.error(`load error (tentativa ${i+1}/${retries}):`, key, e);
      if (i < retries - 1) await new Promise(r => setTimeout(r, 800 * (i + 1)));
    }
  }
  console.warn(`load FAILED after ${retries} retries — usando cache local:`, key);
  return cacheGet(key);
}
async function save(key, value, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await setDoc(doc(db, "appdata", key), { value });
      cacheSet(key, value);
      return true;
    } catch (e) {
      console.error(`save error (tentativa ${i+1}/${retries}):`, key, e);
      if (i < retries - 1) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  console.error(`save FAILED after ${retries} retries:`, key);
  return false;
}
// Flag global para detectar se o load principal conseguiu conectar
let _loadSuccess = false;

//
const fmt = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);
const fmtBR = (v) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v ?? 0);
const fmtDate = (d) => d ? new Date(d + "T12:00:00").toLocaleDateString("pt-BR") : "—";
const today = () => new Date().toISOString().slice(0, 10);
const maskCpf = (v) => { const d = (v ?? "").replace(/\D/g,"").slice(0,11); if(d.length<=3) return d; if(d.length<=6) return `${d.slice(0,3)}.${d.slice(3)}`; if(d.length<=9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`; return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9,11)}`; };
const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
const monthLabel = (y, m) => new Date(y, m, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
const getWeekMonday = (dateStr) => { const d = new Date(dateStr + "T12:00:00"); const day = d.getDay(); const diff = d.getDate() - day + (day === 0 ? -6 : 1); d.setDate(diff); return d.toISOString().slice(0, 10); };
const getWeeksInMonth = (y, m) => { const daysInM = new Date(y, m + 1, 0).getDate(); const weeks = new Map(); for (let d = 1; d <= daysInM; d++) { const ds = `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`; const mon = getWeekMonday(ds); if (!weeks.has(mon)) { const sunD = new Date(mon + "T12:00:00"); sunD.setDate(sunD.getDate() + 6); weeks.set(mon, { monday: mon, sunday: sunD.toISOString().slice(0,10), daysInMonth: [] }); } weeks.get(mon).daysInMonth.push(d); } return [...weeks.values()]; };
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const AREAS = ["Bar", "Cozinha", "Salão", "Limpeza"];
const AREA_COLORS = { Bar: "#3b82f6", Cozinha: "#f59e0b", Salão: "#10b981", Limpeza: "#8b5cf6" };
const DEFAULT_SPLIT = { Bar: 12, Cozinha: 40, Salão: 40, Limpeza: 8 };
const TAX = 0.33;
const DAY_OFF       = "off";      // folga programada
const DAY_COMP      = "comp";     // folga por compensação (banco de horas — folgando)
const DAY_COMP_TRAB = "comptrab"; // trabalho por compensação (deve horas — trabalhando)
const DAY_VACATION  = "vac";      // ferias
const DAY_FAULT_J   = "faultj";   // falta justificada
const DAY_FAULT_U   = "faultu";   // falta injustificada
const DAY_FREELA    = "freela";   // freela — presente mas sem gorjeta


const STATUS_SHORT = {
  [DAY_OFF]:"F",[DAY_FREELA]:"FL",[DAY_COMP]:"FC",[DAY_COMP_TRAB]:"TC",
  [DAY_VACATION]:"Fér",[DAY_FAULT_J]:"FJ",[DAY_FAULT_U]:"FI",
};
const STATUS_COLORS = {
  [DAY_OFF]:"var(--red)",[DAY_FREELA]:"#06b6d4",[DAY_COMP]:"#3b82f6",
  [DAY_COMP_TRAB]:"#0ea5e9",[DAY_VACATION]:"#8b5cf6",
  [DAY_FAULT_J]:"#f59e0b",[DAY_FAULT_U]:"var(--red)",
};

// Division mode constants
const MODE_AREA_POINTS = "area_points"; // default: split by area % then by points within area
const MODE_GLOBAL_POINTS = "global_points"; // split only by total points across all employees

//
function nextEmpSeq(employees, restaurantCode) {
  // Find all seqs ever used for this restaurant (including deleted)
  const used = employees
    .filter(e => e.restaurantId && e.empCode && e.empCode.startsWith(restaurantCode))
    .map(e => parseInt(e.empCode.slice(restaurantCode.length)) || 0);
  let seq = 1;
  while (used.includes(seq)) seq++;
  return seq;
}
function makeEmpCode(restaurantCode, seq) {
  return restaurantCode.toUpperCase() + String(seq).padStart(4, "0");
}

// ═══════════════════════════════════════════════════════════════
// ──  Ponto Import: Parser determinístico + Comparador         ──
// ═══════════════════════════════════════════════════════════════

const PONTO_SYSTEMS = [
  { id: "solides", label: "Sólides" },
  // futuro: { id: "tangerino", label: "Tangerino" }, etc.
];

// ── Helpers de horário ──
function parseHHMM(str) {
  if (!str) return null;
  const m = str.replace(/[^\d:]/g,"").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return parseInt(m[1]) * 60 + parseInt(m[2]);
}
function fmtMinutes(mins) {
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  return `${h}h${m.toString().padStart(2,"0")}min`;
}

// ── Normalizar string p/ fuzzy match ──
function normalizeStr(s) {
  return (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
}
function fuzzyNameMatch(pdfName, sysEmps) {
  const norm = normalizeStr(pdfName);
  const normParts = norm.split(/\s+/);
  // 1. Exact normalized match
  const exact = sysEmps.find(e => normalizeStr(e.name) === norm);
  if (exact) return exact;
  // 2. First+Last name match
  if (normParts.length >= 2) {
    const first = normParts[0], last = normParts[normParts.length - 1];
    const match = sysEmps.find(e => {
      const ep = normalizeStr(e.name).split(/\s+/);
      return ep[0] === first && ep[ep.length - 1] === last;
    });
    if (match) return match;
  }
  // 3. Contains match (one name contains the other)
  const contains = sysEmps.find(e => {
    const en = normalizeStr(e.name);
    return en.includes(norm) || norm.includes(en);
  });
  if (contains) return contains;
  // 4. Partial word overlap (>= 70%)
  const best = { emp: null, score: 0 };
  sysEmps.forEach(e => {
    const ep = new Set(normalizeStr(e.name).split(/\s+/));
    const overlap = normParts.filter(w => ep.has(w)).length;
    const score = overlap / Math.max(normParts.length, ep.size);
    if (score > best.score) { best.score = score; best.emp = e; }
  });
  if (best.score >= 0.6 && best.emp) return best.emp;
  return null;
}

// ── Mapa dia da semana pt-BR → index (0=dom) ──
const DOW_MAP = { domingo:0, segunda:1, "terça":1, terca:1, quarta:2, quinta:3, sexta:4, "sábado":5, sabado:5 };
function getDow(dateStr) { // "2026-03-01" → 0-6 (dom-sáb)
  const d = new Date(dateStr + "T12:00:00");
  return d.getDay();
}
// DOW_NAMES available for future parser extensions
// const DOW_NAMES = ["domingo","segunda","terca","quarta","quinta","sexta","sabado"];

// ── Parser Sólides ──
function parseSolidesPDF(fullText, expectedYear, expectedMonth) {
  // Validate month from PDF header
  const periodMatch = fullText.match(/(\d{2})\/(\d{2})\/(\d{4})\s+a\s+(\d{2})\/(\d{2})\/(\d{4})/);
  if (periodMatch) {
    const pdfMonth = parseInt(periodMatch[2]) - 1; // 0-indexed
    const pdfYear = parseInt(periodMatch[3]);
    if (pdfMonth !== expectedMonth || pdfYear !== expectedYear) {
      return { error: `O PDF é de ${periodMatch[2]}/${periodMatch[3]} mas você está vendo ${String(expectedMonth+1).padStart(2,"0")}/${expectedYear}. Navegue para o mês correto.` };
    }
  }

  // Split into per-employee blocks using "DADOS DO COLABORADOR" as separator
  const blocks = fullText.split(/DADOS DO COLABORADOR/i);
  blocks.shift(); // remove header before first employee

  const employees = [];

  for (const block of blocks) {
    const lines = block.split("\n").map(l => l.trim()).filter(Boolean);

    // Extract name
    let name = "";
    for (const l of lines) {
      const nm = l.match(/Nome:\s*(.+?)(?:\s{2,}CPF|CPF:|$)/);
      if (nm && nm[1].trim().length > 2 && !nm[1].includes("CNPJ")) { name = nm[1].trim(); break; }
    }
    if (!name) continue;

    // Extract function/role
    let funcao = "";
    for (const l of lines) {
      const fm = l.match(/Fun[çc][aã]o:\s*(.+?)(?:\s{2,}|Centro|$)/);
      if (fm) { funcao = fm[1].trim(); break; }
    }

    // Extract "Quadro de Horários" — expected schedule per day of week
    const quadro = {}; // { 0: {start:min, end:min, total:min}, 1: ... } (0=dom,1=seg...)
    let inQuadro = false;
    for (const l of lines) {
      if (/Quadro de Hor/i.test(l)) { inQuadro = true; continue; }
      if (/DIA\s*\/\s*M[EÊ]S/i.test(l)) { inQuadro = false; continue; }
      if (inQuadro) {
        const dowMatch = l.match(/^(Domingo|Segunda|Ter[çc]a|Quarta|Quinta|Sexta|S[aá]bado)/i);
        if (dowMatch) {
          const dowName = normalizeStr(dowMatch[1].replace(/-feira/i,""));
          const dowIdx = DOW_MAP[dowName];
          if (dowIdx !== undefined) {
            // Extract all HH:MM times in the line
            const times = l.match(/\d{1,2}:\d{2}/g) || [];
            // Last HH:MM is usually the Total
            const totalStr = times.length > 0 ? times[times.length - 1] : null;
            const total = parseHHMM(totalStr);
            // First time is start, second-to-last time pair is end
            const start = times.length >= 2 ? parseHHMM(times[0]) : null;
            // Find "às" pattern: "09:00 às 11:00  12:00 às 18:00" → start=09:00
            const asMatch = l.match(/(\d{1,2}:\d{2})\s+[aà]s\s+(\d{1,2}:\d{2})/g);
            let firstStart = start;
            let lastEnd = null;
            if (asMatch && asMatch.length > 0) {
              const firstPair = asMatch[0].match(/(\d{1,2}:\d{2})\s+[aà]s\s+(\d{1,2}:\d{2})/);
              if (firstPair) firstStart = parseHHMM(firstPair[1]);
              const lastPair = asMatch[asMatch.length - 1].match(/(\d{1,2}:\d{2})\s+[aà]s\s+(\d{1,2}:\d{2})/);
              if (lastPair) lastEnd = parseHHMM(lastPair[2]);
            }
            quadro[dowIdx] = { start: firstStart, end: lastEnd, total };
          }
        }
      }
    }

    // Extract daily entries
    const dailyEntries = []; // [{date:"YYYY-MM-DD", status:"work"|"folga"|"faultu"|"faultj"|"ferias"|"off_day", firstEntry:min|null, lastExit:min|null, worked:min|null, expected:min|null, saldo:min|null}]

    // Regex to match day lines: "01/03  domingo  ..."
    const dayLineRegex = /^(\d{2})\/(\d{2})\s+(domingo|segunda|ter[çc]a|quarta|quinta|sexta|s[aá]bado)[-\s]*(feira)?\s*(.*)/i;

    for (const l of lines) {
      const dm = l.match(dayLineRegex);
      if (!dm) continue;
      const day = dm[1], mon = dm[2];
      const dateStr = `${expectedYear}-${mon}-${day}`;
      const rest = dm[5] || "";
      const restUpper = rest.toUpperCase();

      let status = "work";
      let firstEntry = null;
      let lastExit = null;
      let worked = null;
      let expected = null;
      let saldo = null;

      if (restUpper.includes("FALTA") && restUpper.includes("NAO JUSTIFICADA")) {
        status = "faultu";
      } else if (restUpper.includes("FALTA") && restUpper.includes("JUSTIFICADA")) {
        status = "faultj";
      } else if (restUpper.includes("FÉRIAS") || restUpper.includes("FERIAS")) {
        status = "ferias";
      } else if (restUpper.trim() === "FOLGA" || restUpper.startsWith("FOLGA ") || restUpper.includes(" FOLGA")) {
        status = "folga";
      } else if (rest.trim() === "-" || rest.trim() === "") {
        status = "off_day";
      } else {
        // Work day — extract times
        // Format: "(m)11:30 16:00 | (m)18:30 22:55 | 08:55 10:00 -1:05"
        // Pipe-separated sections: entry/exit pairs, then LAST section = summary (TRABALHADAS [ABONO] PREVISTAS SALDO)

        // Clean (m), (fh), (p) markers for parsing
        const cleaned = rest.replace(/\([a-z]+\)/gi, "");

        // Split by pipe |
        const pipeParts = cleaned.split(/\|/).map(p => p.trim()).filter(Boolean);

        if (pipeParts.length >= 2) {
          // Last pipe section = summary (TRABALHADAS [ABONO] PREVISTAS SALDO)
          const summaryPart = pipeParts[pipeParts.length - 1];
          // Entry/exit sections = all except last
          const entryParts = pipeParts.slice(0, -1);

          // Extract entry/exit times
          const entryTimes = [];
          for (const part of entryParts) {
            const ts = part.match(/\d{1,2}:\d{2}/g) || [];
            entryTimes.push(...ts.map(parseHHMM).filter(t => t !== null));
          }

          if (entryTimes.length >= 2) {
            firstEntry = entryTimes[0]; // first clock-in
            lastExit = entryTimes[entryTimes.length - 1]; // last clock-out
          } else if (entryTimes.length === 1) {
            firstEntry = entryTimes[0];
          }

          // Parse summary: TRABALHADAS [ABONO] PREVISTAS SALDO
          const summaryTokens = summaryPart.match(/-?\d{1,2}:\d{2}/g) || [];
          for (const st of summaryTokens) {
            const val = parseHHMM(st.replace(/^[+-]/, ""));
            if (st.startsWith("-") || st.startsWith("+")) {
              saldo = st.startsWith("-") ? -val : val;
            } else if (worked === null) {
              worked = val;
            } else if (expected === null) {
              expected = val;
            }
          }
          // If saldo wasn't explicitly signed, calculate from worked-expected
          if (saldo === null && worked !== null && expected !== null) {
            saldo = worked - expected;
          }
        } else if (pipeParts.length === 1) {
          // No pipe — might be a single entry or just summary
          const allTimes = pipeParts[0].match(/\d{1,2}:\d{2}/g) || [];
          if (allTimes.length >= 4) {
            // Likely: entry exit worked expected [saldo]
            firstEntry = parseHHMM(allTimes[0]);
            lastExit = parseHHMM(allTimes[1]);
            worked = parseHHMM(allTimes[2]);
            expected = parseHHMM(allTimes[3]);
          } else if (allTimes.length >= 2) {
            firstEntry = parseHHMM(allTimes[0]);
            lastExit = parseHHMM(allTimes[1]);
          }
        }
      }

      // For non-work statuses, try to extract expected hours from the line
      if (status !== "work" && status !== "off_day") {
        const allTimes = rest.match(/\d{1,2}:\d{2}/g) || [];
        if (allTimes.length > 0) {
          expected = parseHHMM(allTimes[allTimes.length - 1]);
        }
      }

      dailyEntries.push({ date: dateStr, status, firstEntry, lastExit, worked, expected, saldo });
    }

    // Extract "Dias Faltosos"
    let diasFaltosos = 0;
    for (const l of lines) {
      const df = l.match(/Dias Faltosos:\s*(\d+)/);
      if (df) { diasFaltosos = parseInt(df[1]); break; }
    }

    employees.push({ name, funcao, quadro, dailyEntries, diasFaltosos });
  }

  return { employees, error: null };
}

// ── Comparador: ponto vs escala do sistema ──
function comparePontoVsSchedule(parsedEmps, schedEmps, effectiveMonth, mk, restRoles) {
  const TOLERANCE_ATRASO = 10; // minutos
  const TOLERANCE_SAIDA = 30; // minutos
  const TOLERANCE_HE = 30; // minutos para hora extra

  const scheduleChanges = {}; // {empId: {date: status}}
  const incidents = [];
  const unmatchedNames = [];
  const matchedSummary = []; // [{pdfName, sysName, empId}]
  const noScheduleEmps = []; // empregados sem escala no sistema

  for (const pEmp of parsedEmps) {
    // Fuzzy match
    const sysEmp = fuzzyNameMatch(pEmp.name, schedEmps);

    if (!sysEmp) {
      // Build unmatched entry
      const uSchedChanges = {};
      const uIncidents = [];
      for (const entry of pEmp.dailyEntries) {
        if (entry.status === "faultu") {
          uSchedChanges[entry.date] = "faultu";
          uIncidents.push({ type: "faultu", date: entry.date, description: "Falta não justificada", severity: "media" });
        } else if (entry.status === "faultj") {
          uSchedChanges[entry.date] = "faultj";
          uIncidents.push({ type: "faultj", date: entry.date, description: "Falta justificada", severity: "leve" });
        } else if (entry.status === "ferias") {
          uSchedChanges[entry.date] = "vac";
        } else if (entry.status === "folga") {
          uSchedChanges[entry.date] = "off";
        }
      }
      unmatchedNames.push({
        name: pEmp.name,
        funcao: pEmp.funcao,
        scheduleChanges: uSchedChanges,
        incidents: uIncidents
      });
      continue;
    }

    matchedSummary.push({ pdfName: pEmp.name, sysName: sysEmp.name, empId: sysEmp.id });
    const empSched = effectiveMonth[sysEmp.id] ?? {};
    const hasSchedule = Object.keys(empSched).length > 0;

    if (!hasSchedule) {
      noScheduleEmps.push(sysEmp.name);
    }

    for (const entry of pEmp.dailyEntries) {
      const sysStatus = empSched[entry.date] ?? "";
      const dow = getDow(entry.date);
      const quadroDay = pEmp.quadro[dow];

      // ── Faltas ──
      if (entry.status === "faultu") {
        if (sysStatus !== "faultu") {
          if (!scheduleChanges[sysEmp.id]) scheduleChanges[sysEmp.id] = {};
          scheduleChanges[sysEmp.id][entry.date] = "faultu";
        }
        incidents.push({
          empId: sysEmp.id,
          empName: sysEmp.name,
          type: "faultu",
          date: entry.date,
          description: "Falta não justificada",
          severity: "media"
        });
        continue;
      }
      if (entry.status === "faultj") {
        if (sysStatus !== "faultj") {
          if (!scheduleChanges[sysEmp.id]) scheduleChanges[sysEmp.id] = {};
          scheduleChanges[sysEmp.id][entry.date] = "faultj";
        }
        incidents.push({
          empId: sysEmp.id,
          empName: sysEmp.name,
          type: "faultj",
          date: entry.date,
          description: "Falta justificada",
          severity: "leve"
        });
        continue;
      }

      // ── Férias ──
      if (entry.status === "ferias") {
        if (sysStatus !== "vac") {
          if (!scheduleChanges[sysEmp.id]) scheduleChanges[sysEmp.id] = {};
          scheduleChanges[sysEmp.id][entry.date] = "vac";
        }
        continue;
      }

      // ── Folga ──
      if (entry.status === "folga") {
        if (sysStatus !== "off" && sysStatus !== "comp" && sysStatus !== "") {
          // System says work but PDF says folga
          if (!scheduleChanges[sysEmp.id]) scheduleChanges[sysEmp.id] = {};
          scheduleChanges[sysEmp.id][entry.date] = "off";
        } else if (sysStatus === "" || sysStatus === "trabalho") {
          // System has as work day, PDF has folga
          if (!scheduleChanges[sysEmp.id]) scheduleChanges[sysEmp.id] = {};
          scheduleChanges[sysEmp.id][entry.date] = "off";
        }
        continue;
      }

      // ── Dia sem escala (off_day) — skip ──
      if (entry.status === "off_day") continue;

      // ── Trabalho — check atraso, saída antecipada, hora extra ──
      if (entry.status === "work" && quadroDay && hasSchedule) {
        // Atraso na entrada
        if (entry.firstEntry !== null && quadroDay.start !== null) {
          const atraso = entry.firstEntry - quadroDay.start;
          if (atraso > TOLERANCE_ATRASO) {
            const sev = atraso > 60 ? "grave" : atraso > 30 ? "media" : "leve";
            incidents.push({
              empId: sysEmp.id,
              empName: sysEmp.name,
              type: "atraso",
              date: entry.date,
              description: `Atraso de ${fmtMinutes(atraso)} na entrada (previsto ${Math.floor(quadroDay.start/60)}:${String(quadroDay.start%60).padStart(2,"0")}, entrada ${Math.floor(entry.firstEntry/60)}:${String(entry.firstEntry%60).padStart(2,"0")})`,
              severity: sev
            });
          }
        }

        // Saída antecipada
        if (entry.lastExit !== null && quadroDay.end !== null) {
          const antecipada = quadroDay.end - entry.lastExit;
          if (antecipada > TOLERANCE_SAIDA) {
            const sev = antecipada > 60 ? "grave" : antecipada > 30 ? "media" : "leve";
            incidents.push({
              empId: sysEmp.id,
              empName: sysEmp.name,
              type: "saida_antecipada",
              date: entry.date,
              description: `Saída ${fmtMinutes(antecipada)} antes do previsto (previsto ${Math.floor(quadroDay.end/60)}:${String(quadroDay.end%60).padStart(2,"0")}, saída ${Math.floor(entry.lastExit/60)}:${String(entry.lastExit%60).padStart(2,"0")})`,
              severity: sev
            });
          }
        }

        // Hora extra (saldo positivo)
        if (entry.saldo !== null && entry.saldo > TOLERANCE_HE) {
          incidents.push({
            empId: sysEmp.id,
            empName: sysEmp.name,
            type: "hora_extra",
            date: entry.date,
            description: `Hora extra de ${fmtMinutes(entry.saldo)} (trabalhou ${entry.worked ? fmtMinutes(entry.worked) : "?"} / previsto ${entry.expected ? fmtMinutes(entry.expected) : "?"})`,
            severity: entry.saldo > 120 ? "grave" : entry.saldo > 60 ? "media" : "leve"
          });
        }
      }
    }
  }

  // Detect system employees NOT found in PDF
  const matchedEmpIds = new Set(matchedSummary.map(m => m.empId));
  const missingFromPonto = schedEmps
    .filter(e => !matchedEmpIds.has(e.id))
    .map(e => ({ empId: e.id, empName: e.name, roleId: e.roleId }));

  // Count schedule changes
  let totalSchedChanges = 0;
  Object.values(scheduleChanges).forEach(days => { totalSchedChanges += Object.keys(days).length; });

  // Build summary
  const parts = [];
  parts.push(`${parsedEmps.length} empregado(s) no PDF`);
  parts.push(`${matchedSummary.length} identificado(s) no sistema`);
  if (unmatchedNames.length > 0) parts.push(`${unmatchedNames.length} não identificado(s)`);
  if (missingFromPonto.length > 0) parts.push(`${missingFromPonto.length} do sistema ausente(s) no PDF`);
  if (totalSchedChanges > 0) parts.push(`${totalSchedChanges} alteração(ões) na escala`);
  if (incidents.length > 0) parts.push(`${incidents.length} ocorrência(s)`);
  if (noScheduleEmps.length > 0) parts.push(`${noScheduleEmps.length} sem escala no sistema (atrasos não verificados): ${noScheduleEmps.join(", ")}`);

  return {
    scheduleChanges,
    incidents,
    unmatchedNames: unmatchedNames.map((u, i) => ({ ...u, _key: `unm-${i}` })),
    missingFromPonto,
    totalSchedChanges,
    matchedSummary,
    summary: parts.join(". ") + "."
  };
}

//
const K = {
  owners: "v4:owners",
  managers:      "v4:managers",
  restaurants:   "v4:restaurants",
  employees:     "v4:employees",
  roles:         "v4:roles",
  tips:          "v4:tips",
  splits:        "v4:splits",
  schedules:     "v4:schedules",
  communications:"v4:communications",
  commAcks:      "v4:commAcks",
  faq:           "v4:faq",
  dpMessages:    "v4:dpMessages",
  workSchedules: "v4:workSchedules",
  notifications: "v4:notifications",
  noTipDays:     "v4:noTipDays",
  trash:         "v4:trash",           // {restaurants:[], managers:[], employees:[]}
  schedTemplates:"v4:schedTemplates",  // {[restaurantId]: [{id,name,days}]}
  schedDrafts:   "v4:schedDrafts",     // {[restaurantId]: {[empId]: {days,savedAt}}}
  scheduleVersions: "v4:scheduleVersions", // {[restaurantId]: {[monthKey]: [{id,ts,author,reason,snapshot}]}}
  tipVersions:      "v4:tipVersions",      // {[restaurantId]: {[monthKey]: [{id,ts,author,reason,snapshot}]}}
  vtConfig:         "v4:vtConfig",          // {[restaurantId]: {[employeeId]: {dailyRate: number}}}
  vtMonthly:        "v4:vtMonthly",         // {[restaurantId]: {[monthKey]: {[employeeId]: {adjustOverride: number|null, manualDiscount: number}}}}
  vtPayments:       "v4:vtPayments",        // {[restaurantId]: {[monthKey]: {paidAt: ISO, paidBy: string, snapshot: [{empId,name,role,dailyRate,plannedDays,grossVT,autoAdjust,manualDiscount,totalPaid}]}}}
  incidents:        "v4:incidents",         // [{id, restaurantId, employeeIds:[], type, severity, description, date, createdAt, createdBy, createdById, visibility:"internal"}]
  feedbacks:        "v4:feedbacks",         // [{id, restaurantId, employeeId, quarter, year, rating, strengths, improvements, internalNotes, goal, targetRoleId, devChecklist:[{title,link,type,done}], createdAt, createdBy}]
  devChecklists:    "v4:devChecklists",     // {[roleId]: [{title, link, type:"livro"|"video"|"curso"|"pratica"}]}
  scheduleAdjustments: "v4:scheduleAdjustments", // {[rid]: {[mk]: [{id, empId, date, from, to, author, timestamp}]}}
  scheduleStatus:      "v4:scheduleStatus",      // {[rid]: {[mk]: {status:"open"|"review"|"closed", closedAt, closedBy, lastPontoImport, pontoSystem, missingFromPonto:[], importHistory:[], lastImportSummary}}}
  schedulePrevista:    "v4:schedulePrevista",     // {[rid]: {[mk]: frozen snapshot of schedules at first edit/VT payment}}
  employeeGoals:       "v4:employeeGoals",        // {[empId]: [{id, type, title, targetRoleId?, topic?, materials:[], metas:[], createdAt, createdBy, status:"active"|"completed"|"cancelled"}]}
  delays:              "v4:delays",               // {[rid]: {[mk]: {[empId]: {[day]: minutes}}}}
  tipApprovals:        "v4:tipApprovals",         // {[rid]: {[weekMonday]: {approvedAt, approvedBy, approvedByName}}}
  meetingPlans:        "v4:meetingPlans",         // [{id, restaurantId, type:"alinhamento"|"avaliação", employeeIds:[], plannedDate, note, createdBy, createdAt, completedFeedbackIds:{[empId]:fbId}}]
};

// ── Version retention ──
const MAX_VERSIONS = 30;
const VERSION_DEBOUNCE_MS = 30000; // 30s
// Pending debounced snapshots: key = `${kind}:${rid}:${mk}`, value = { timer, firstSnapshot, author, reason }
const _pendingSnapshots = {};

// Format relative time in pt-BR ("há 5 min", "há 2h", "ontem às 14:30")
function fmtRelTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "agora há pouco";
  if (diffMin < 60) return `há ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return `ontem às ${d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}`;
  if (diffD < 7) return `há ${diffD} dias`;
  return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
}

// Create a snapshot of schedules for a specific month (deep copy)
function snapshotSchedulesMonth(schedules, rid, mk) {
  return JSON.parse(JSON.stringify(schedules?.[rid]?.[mk] ?? {}));
}
// Create a snapshot of tips for a specific month (deep copy)
function snapshotTipsMonth(tips, rid, mk) {
  return JSON.parse(JSON.stringify((tips ?? []).filter(t => t.restaurantId === rid && t.monthKey === mk)));
}

// Enqueue or save a version entry. `kind` = "schedules" | "tips".
// Bulk = true salva imediatamente (sem debounce). Bulk = false aguarda VERSION_DEBOUNCE_MS.
function saveVersion(kind, rid, mk, currentVersions, snapshot, author, reason, onUpdate, bulk = false) {
  const versionKey = kind === "schedules" ? "scheduleVersions" : "tipVersions";
  const pendKey = `${kind}:${rid}:${mk}`;

  function commit(snap, reas) {
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      ts: new Date().toISOString(),
      author: author || "Gestor Adm.",
      reason: reas,
      snapshot: snap,
    };
    const byRest = { ...(currentVersions ?? {}) };
    const byMonth = { ...(byRest[rid] ?? {}) };
    const list = [entry, ...(byMonth[mk] ?? [])].slice(0, MAX_VERSIONS);
    byMonth[mk] = list;
    byRest[rid] = byMonth;
    onUpdate(versionKey, byRest);
  }

  if (bulk) {
    // clear pending (bulk supersedes debounced edits)
    if (_pendingSnapshots[pendKey]) { clearTimeout(_pendingSnapshots[pendKey].timer); delete _pendingSnapshots[pendKey]; }
    commit(snapshot, reason);
    return;
  }

  // Debounced: if already pending, reset timer (keep original pre-edit snapshot)
  if (_pendingSnapshots[pendKey]) {
    clearTimeout(_pendingSnapshots[pendKey].timer);
    _pendingSnapshots[pendKey].editCount = (_pendingSnapshots[pendKey].editCount ?? 1) + 1;
    _pendingSnapshots[pendKey].timer = setTimeout(() => {
      const p = _pendingSnapshots[pendKey];
      if (!p) return;
      commit(p.preSnapshot, `Edição manual (${p.editCount} alteração${p.editCount>1?"ões":""})`);
      delete _pendingSnapshots[pendKey];
    }, VERSION_DEBOUNCE_MS);
    return;
  }

  // New pending: capture the PRE-edit state (snapshot passed in should be pre-edit)
  _pendingSnapshots[pendKey] = {
    preSnapshot: snapshot,
    editCount: 1,
    timer: setTimeout(() => {
      commit(snapshot, "Edição manual (1 alteração)");
      delete _pendingSnapshots[pendKey];
    }, VERSION_DEBOUNCE_MS),
  };
}

//
const ac = "#d4a017";
// ── Shared styles ──
const S = {
  input: { width:"100%", boxSizing:"border-box", padding:"11px 14px", borderRadius:10, border:"1px solid var(--border)", background:"var(--input-bg)", color:"var(--text)", fontSize:14, fontFamily:"'DM Sans',sans-serif", outline:"none" },
  btnPrimary: { width:"100%", padding:"12px", borderRadius:12, background:ac, border:"none", color:"var(--text)", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" },
  btnSecondary: { padding:"8px 18px", borderRadius:10, border:"1px solid var(--border)", background:"transparent", color:"var(--text2)", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontSize:13 },
  // Small action button with minimum touch target (44px)
  btnSmall: { padding:"8px 14px", borderRadius:8, border:"1px solid var(--border)", background:"transparent", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontSize:12, minHeight:44, display:"inline-flex", alignItems:"center", justifyContent:"center" },
  card: { background:"var(--card-bg)", borderRadius:16, padding:"18px 20px", border:"1px solid var(--border)" },
  label: { color:"var(--text3)", fontSize:12, marginBottom:4, display:"block", fontWeight:500 },
  mono: { fontFamily:"'DM Mono',monospace" },
};

//
function Toast({ msg, onClose }) {
  useEffect(() => { if (msg) { const t = setTimeout(onClose, 3200); return () => clearTimeout(t); } }, [msg, onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!msg) return null;
  return <div role="status" aria-live="polite" style={{ position:"fixed", bottom:32, left:"50%", transform:"translateX(-50%)", background:"var(--text)", color:"var(--bg)", padding:"12px 28px", borderRadius:40, fontFamily:"'DM Sans',sans-serif", fontWeight:600, fontSize:14, boxShadow:"0 8px 32px rgba(0,0,0,.15)", zIndex:9999, whiteSpace:"nowrap" }}>{msg}</div>;
}

function PrivacyModal({ open, onClose }) {
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label="Política de Privacidade" style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:"var(--card-bg)",borderRadius:16,padding:28,maxWidth:480,width:"100%",maxHeight:"85vh",overflowY:"auto",border:"1px solid var(--border)",fontFamily:"'DM Sans',sans-serif",boxShadow:"0 20px 60px rgba(0,0,0,.2)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <h2 style={{color:"var(--text)",margin:0,fontSize:18,fontWeight:700}}>🔒 Política de Privacidade</h2>
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:20}}>✕</button>
        </div>
        <div style={{color:"var(--text2)",fontSize:13,lineHeight:1.8,display:"flex",flexDirection:"column",gap:12}}>
          <p style={{color:"var(--text3)",fontSize:11}}>Última atualização: {new Date().toLocaleDateString("pt-BR")}</p>
          <p><strong style={{color:"var(--text)"}}>1. Quem somos</strong><br/>O AppTip é uma plataforma de gestão de gorjetas para restaurantes, operada pelo estabelecimento ao qual você está vinculado.</p>
          <p><strong style={{color:"var(--text)"}}>2. Dados coletados</strong><br/>Coletamos: nome completo, CPF, cargo, data de admissão e PIN de acesso. Esses dados são necessários para identificação e distribuição de gorjetas.</p>
          <p><strong style={{color:"var(--text)"}}>3. Finalidade</strong><br/>Seus dados são usados exclusivamente para: controle de acesso ao sistema, cálculo e distribuição de gorjetas, gestão de escala e comunicados internos.</p>
          <p><strong style={{color:"var(--text)"}}>4. Armazenamento</strong><br/>Os dados são armazenados no Google Firebase (servidores na América do Sul) com acesso restrito ao seu restaurante. Não compartilhamos seus dados com terceiros.</p>
          <p><strong style={{color:"var(--text)"}}>5. Seus direitos (LGPD)</strong><br/>Você tem direito a: acessar seus dados, corrigir informações incorretas, solicitar a exclusão dos seus dados e revogar o consentimento a qualquer momento.</p>
          <p><strong style={{color:"var(--text)"}}>6. Solicitação de exclusão</strong><br/>Para solicitar a exclusão dos seus dados, entre em contato com o gestor do seu restaurante através da função "Fale com DP" no aplicativo.</p>
          <p><strong style={{color:"var(--text)"}}>7. Contato</strong><br/>Dúvidas sobre privacidade devem ser direcionadas ao gestor responsável pelo restaurante.</p>
          <p style={{color:"var(--text3)",fontSize:11,borderTop:"1px solid var(--border)",paddingTop:12}}>Esta política está em conformidade com a Lei Geral de Proteção de Dados (LGPD — Lei nº 13.709/2018).</p>
        </div>
        <button onClick={onClose} style={{...S.btnPrimary,marginTop:16}}>Entendi</button>
      </div>
    </div>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.4)", zIndex:8000, display:"flex", alignItems:"center", justifyContent:"center", padding:16, overflowY:"auto" }} onKeyDown={e=>{if(e.key==="Escape")onClose();}}>
      <div style={{ background:"var(--card-bg)", borderRadius:20, padding:28, width:"100%", maxWidth:wide?680:480, border:"1px solid var(--border)", maxHeight:"92vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,.15)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <h3 style={{ color:"var(--text)", margin:0, fontFamily:"'DM Sans',sans-serif", fontSize:17, fontWeight:700 }}>{title}</h3>
          <button onClick={onClose} aria-label="Fechar" style={{ background:"none", border:"none", color:"var(--text3)", fontSize:20, cursor:"pointer" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── PDF Preview Modal ──
function PDFPreviewModal({ pdfDoc, fileName, onClose, title }) {
  const [blobUrl, setBlobUrl] = useState(null);
  useEffect(() => {
    if (!pdfDoc) return;
    const blob = pdfDoc.output("blob");
    const url = URL.createObjectURL(blob);
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [pdfDoc]);
  return (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.7)",zIndex:10000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"var(--bg2)",borderRadius:16,display:"flex",flexDirection:"column",width:"95vw",maxWidth:900,height:"90vh",border:"1px solid var(--border)",overflow:"hidden"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 20px",borderBottom:"1px solid var(--border)",flexShrink:0}}>
          <span style={{color:"var(--text)",fontWeight:700,fontSize:15,fontFamily:"'DM Sans',sans-serif"}}>{title || "Pré-visualização do PDF"}</span>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>{ if(pdfDoc) pdfDoc.save(fileName || "documento.pdf"); }} style={{padding:"6px 16px",borderRadius:8,border:"none",background:"var(--ac)",color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              Baixar PDF
            </button>
            <button onClick={onClose} style={{padding:"6px 16px",borderRadius:8,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",fontSize:13,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              Fechar
            </button>
          </div>
        </div>
        <div style={{flex:1,overflow:"hidden",background:"#525659"}}>
          {blobUrl ? (
            <iframe src={blobUrl} title="PDF Preview" style={{width:"100%",height:"100%",border:"none"}} />
          ) : (
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:"#fff",fontSize:14}}>Carregando...</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Version History Modal (shared by Escala + Gorjetas) ──
function VersionHistoryModal({ title, versions, currentSnapshot, onRestore, onClose, restoreLabel = "Restaurar esta versão", emptyMsg = "Nenhuma versão salva ainda. Qualquer alteração gera automaticamente um ponto de histórico." }) {
  const list = versions ?? [];
  return (
    <Modal title={title} onClose={onClose} wide>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <p style={{color:"var(--text3)",fontSize:13,margin:0,lineHeight:1.6}}>
          As últimas {MAX_VERSIONS} versões deste mês são mantidas automaticamente. Ao restaurar, a versão atual também vira um ponto no histórico — você pode desfazer se quiser.
        </p>
        {list.length === 0 && (
          <div style={{...S.card,textAlign:"center",padding:"32px 20px"}}>
            <div style={{fontSize:32,marginBottom:10}}>📂</div>
            <p style={{color:"var(--text3)",fontSize:13,margin:0}}>{emptyMsg}</p>
          </div>
        )}
        {list.map((v, idx) => (
          <div key={v.id} style={{...S.card,padding:"14px 18px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
              <div style={{flex:1,minWidth:200}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                  <span style={{color:"var(--text)",fontWeight:700,fontSize:14}}>{v.reason || "Alteração"}</span>
                  {idx === 0 && <span style={{background:"#10b98122",color:"var(--green)",fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:6}}>MAIS RECENTE</span>}
                </div>
                <div style={{color:"var(--text3)",fontSize:12,display:"flex",gap:8,flexWrap:"wrap"}}>
                  <span>👤 {v.author || "Gestor"}</span>
                  <span>·</span>
                  <span title={new Date(v.ts).toLocaleString("pt-BR")}>🕐 {fmtRelTime(v.ts)}</span>
                </div>
              </div>
              <button onClick={()=>{
                if (!window.confirm(`Restaurar esta versão?\n\n"${v.reason}" · ${fmtRelTime(v.ts)}\n\nA versão atual será salva como uma nova entrada no histórico — você pode desfazer depois.`)) return;
                onRestore(v);
              }} style={{...S.btnSecondary,fontSize:12,padding:"8px 16px",color:"var(--ac-text)",borderColor:"var(--ac)44"}}>
                ♻️ {restoreLabel}
              </button>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function AreaBadge({ area }) {
  return <span style={{ background:AREA_COLORS[area]+"22", color:AREA_COLORS[area], borderRadius:6, padding:"2px 9px", fontSize:11, fontWeight:700 }}>{area}</span>;
}

function PillBar({ options, value, onChange }) {
  return (
    <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
      {options.map(o => (
        <button key={o} onClick={() => onChange(o)} style={{ padding:"6px 16px", borderRadius:20, border:`1px solid ${value===o?ac:"var(--border)"}`, background:value===o?ac:"transparent", color:value===o?"#fff":"var(--text3)", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontSize:13, fontWeight:value===o?700:500 }}>{o}</button>
      ))}
    </div>
  );
}

function MonthNav({ year, month, onChange }) {
  const prev = () => { let m=month-1, y=year; if(m<0){m=11;y--;} onChange(y,m); };
  const next = () => { let m=month+1, y=year; if(m>11){m=0;y++;} onChange(y,m); };
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      <button onClick={prev} style={{ ...S.btnSecondary, padding:"6px 12px" }}>‹</button>
      <span style={{ color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:13, minWidth:140, textAlign:"center", textTransform:"capitalize" }}>{monthLabel(year,month)}</span>
      <button onClick={next} style={{ ...S.btnSecondary, padding:"6px 12px" }}>›</button>
    </div>
  );
}


//
function CalendarGrid({ year, month, dayMap, onDayClick, readOnly, delayMap }) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++)
    cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);

  const colorOf = (dateStr) => {
    if (!dateStr) return null;
    const s = dayMap?.[dateStr];
    if (s === DAY_OFF)       return { bg: "#e74c3c22", border: "var(--red)",  text: "var(--red)"  };
    if (s === DAY_FREELA)    return { bg: "#06b6d422", border: "#06b6d4",  text: "#06b6d4"  };
    if (s === DAY_COMP)      return { bg: "#3b82f622", border: "#3b82f6",  text: "#3b82f6"  };
    if (s === DAY_COMP_TRAB) return { bg: "#0ea5e922", border: "#0ea5e9",  text: "#0ea5e9"  };
    if (s === DAY_VACATION)  return { bg: "#8b5cf622", border: "#8b5cf6",  text: "#8b5cf6"  };
    if (s === DAY_FAULT_J)   return { bg: "#f59e0b22", border: "#f59e0b",  text: "#f59e0b"  };
    if (s === DAY_FAULT_U)   return { bg: "#ef444422", border: "var(--red)",  text: "var(--red)"  };
    return { bg: "#10b98122", border: "var(--green)", text: "var(--green)" };
  };

  const LEGEND = [
    ["var(--green)", "Trabalho"],
    ["var(--red)", "Folga"],
    ["#06b6d4", "Freela"],
    ["#3b82f6", "Folga p/ Comp. (FC)"],
    ["#0ea5e9", "Trab. p/ Comp. (TC)"],
    ["#8b5cf6", "Férias"],
    ["#f59e0b", "Falta Just."],
    ["var(--red)", "Falta Injust."],
  ];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 3 }}>
        {WEEKDAYS.map(w => <div key={w} style={{ textAlign: "center", color: "var(--text3)", fontSize: 10, fontFamily: "'DM Mono',monospace", padding: "4px 0" }}>{w}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {cells.map((dateStr, idx) => {
          if (!dateStr) return <div key={`e-${idx}`} />;
          const d = parseInt(dateStr.slice(-2));
          const col = colorOf(dateStr);
          const hasDelay = delayMap && (delayMap[String(d)] > 0);
          return (
            <button key={dateStr} onClick={() => !readOnly && onDayClick && onDayClick(dateStr)}
              title={hasDelay ? `Atraso: ${delayMap[String(d)]} min` : undefined}
              style={{ aspectRatio: "1", borderRadius: 8, border: `1px solid ${col.border}`, background: col.bg, color: col.text, cursor: readOnly ? "default" : "pointer", fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 600, padding: 0, position:"relative" }}>
              {d}
              {hasDelay && <span style={{position:"absolute",top:1,right:2,fontSize:7,color:"#f59e0b",fontWeight:800,lineHeight:1}}>⏰</span>}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        {LEGEND.map(([c, lbl]) => (
          <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 11, height: 11, borderRadius: 3, background: c + "33", border: `1px solid ${c}`, flexShrink: 0 }} />
            <span style={{ color: "var(--text3)", fontSize: 10, fontFamily: "'DM Mono',monospace" }}>{lbl}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Cycle order: work > off > freela > comp > faultJ > faultU > work (férias só via formulário)
const DAY_CYCLE = [DAY_OFF, DAY_FREELA, DAY_COMP, DAY_COMP_TRAB, DAY_FAULT_J, DAY_FAULT_U];

//
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

//
function ExportModal({ onClose, employees, roles, tips, restaurant }) {
  const now = new Date();
  const [dateFrom, setDateFrom] = useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-01`);
  const [dateTo, setDateTo] = useState(today());
  const [status, setStatus] = useState("");
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewFileName, setPreviewFileName] = useState("");
  function buildMatrix() {
    const filtered = tips.filter(t => t.restaurantId === restaurant.id && t.date >= dateFrom && t.date <= dateTo);
    const dates = [...new Set(filtered.map(t => t.date))].sort();
    const rows = employees.filter(e => e.restaurantId === restaurant.id).map(emp => {
      const role = roles.find(r => r.id === emp.roleId);
      const byDay = {};
      dates.forEach(d => { const t = filtered.find(t => t.employeeId === emp.id && t.date === d); byDay[d] = t ? t.myShare : 0; });
      const totalBruto = Object.values(byDay).reduce((a, v) => a + v, 0);
      return { name: emp.name, role: role?.name ?? "—", area: role?.area ?? "—", byDay, totalBruto, deducao: totalBruto * TAX, liquido: totalBruto * (1 - TAX) };
    });
    const dayTotals = {};
    dates.forEach(d => { dayTotals[d] = rows.reduce((a, r) => a + (r.byDay[d] ?? 0), 0); });
    const grandBruto = rows.reduce((a, r) => a + r.totalBruto, 0);
    return { dates, rows, dayTotals, grandBruto, grandDeducao: grandBruto * TAX, grandLiquido: grandBruto * (1 - TAX) };
  }

  async function exportExcel() {
    setStatus("loading");
    try {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
      const XLSX = window.XLSX;
      const { dates, rows, dayTotals, grandBruto, grandDeducao, grandLiquido } = buildMatrix();
      const ds = (d) => new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      const header = ["Nome", "Cargo", "Área", ...dates.map(ds), "Total Bruto", "Dedução (33%)", "Líquido"];
      const wsData = [
        [`${restaurant.name} — Relatório de Gorjetas: ${fmtDate(dateFrom)} a ${fmtDate(dateTo)}`],
        [],
        header,
        ...rows.map(r => [r.name, r.role, r.area, ...dates.map(d => r.byDay[d] ?? 0), r.totalBruto, r.deducao, r.liquido]),
        [],
        ["TOTAL DO DIA", "", "", ...dates.map(d => dayTotals[d]), grandBruto, grandDeducao, grandLiquido],
      ];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws["!cols"] = [{ wch: 28 }, { wch: 18 }, { wch: 12 }, ...dates.map(() => ({ wch: 10 })), { wch: 14 }, { wch: 14 }, { wch: 14 }];
      ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: header.length - 1 } }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Gorjetas");
      XLSX.writeFile(wb, `gorjetas_${restaurant.name}_${dateFrom}_${dateTo}.xlsx`);
      setStatus("done");
    } catch (e) { console.error(e); setStatus("error"); }
  }

  async function exportPDF() {
    setStatus("loading");
    try {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
      const { jsPDF } = window.jspdf;
      const { dates, rows, dayTotals, grandBruto, grandDeducao, grandLiquido } = buildMatrix();
      const ds = (d) => new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

      // A4 landscape = 297mm wide, margins 10mm each side = 277mm usable
      const pageW = 277;
      // Fixed columns: Nome(32) Cargo(28) Área(16) TotalBruto(22) Deducao(20) Liquido(22) = 140mm
      const fixedW = 140;
      // Remaining for day columns
      const dayW = Math.max(10, Math.floor((pageW - fixedW) / Math.max(dates.length, 1)));

      doc.setFontSize(13); doc.setFont("helvetica", "bold");
      doc.text(restaurant.name, 10, 12);
      doc.setFontSize(9); doc.setFont("helvetica", "normal");
      doc.text(`Relatório de Gorjetas: ${fmtDate(dateFrom)} a ${fmtDate(dateTo)}   |   Gerado em: ${new Date().toLocaleDateString("pt-BR")}`, 10, 19);

      const head = [["Nome", "Cargo", "Área", ...dates.map(ds), "Total Bruto", "Dedução", "Líquido"]];
      const body = [
        ...rows.map(r => [r.name, r.role, r.area, ...dates.map(d => r.byDay[d] ? fmtBR(r.byDay[d]) : "–"), fmtBR(r.totalBruto), fmtBR(r.deducao), fmtBR(r.liquido)]),
        ["TOTAL", "", "", ...dates.map(d => dayTotals[d] ? fmtBR(dayTotals[d]) : "–"), fmtBR(grandBruto), fmtBR(grandDeducao), fmtBR(grandLiquido)],
      ];

      doc.autoTable({
        head, body,
        startY: 23,
        margin: { left: 10, right: 10 },
        styles: {
          fontSize: dates.length > 20 ? 6 : 7,
          font: "helvetica",
          cellPadding: { top: 2, bottom: 2, left: 2, right: 2 },
          overflow: "linebreak",  // allow name/role to wrap
          lineColor: [200, 200, 200],
          lineWidth: 0.1,
        },
        headStyles: {
          fillColor: [30, 30, 30],
          textColor: [245, 200, 66],
          fontStyle: "bold",
          halign: "center",
          overflow: "hidden",
        },
        alternateRowStyles: { fillColor: [248, 248, 248] },
        columnStyles: {
          0: { cellWidth: 32, overflow: "linebreak" },   // Nome — pode quebrar
          1: { cellWidth: 28, overflow: "linebreak" },   // Cargo — pode quebrar
          2: { cellWidth: 16, halign: "center" },        // Área
          // Day columns — fixed width, no wrap
          ...Object.fromEntries(dates.map((_, i) => [i + 3, { cellWidth: dayW, halign: "right", overflow: "hidden" }])),
          [dates.length + 3]: { cellWidth: 22, halign: "right", fontStyle: "bold", overflow: "hidden" },
          [dates.length + 4]: { cellWidth: 20, halign: "right", textColor: [180, 40, 40], overflow: "hidden" },
          [dates.length + 5]: { cellWidth: 22, halign: "right", textColor: [10, 130, 60], fontStyle: "bold", overflow: "hidden" },
        },
        didParseCell: (data) => {
          if (data.row.index === body.length - 1) {
            data.cell.styles.fillColor = [30, 30, 30];
            data.cell.styles.textColor = [245, 200, 66];
            data.cell.styles.fontStyle = "bold";
          }
        },
      });

      doc.setFontSize(7); doc.setTextColor(150);
      doc.text("* Valores brutos sem dedução fiscal. Documento gerado pelo AppTip.", 10, doc.lastAutoTable.finalY + 5);
      setPreviewDoc(doc); setPreviewFileName(`gorjetas_${restaurant.name}_${dateFrom}_${dateTo}.pdf`);
      setStatus("done");
    } catch (e) { console.error(e); setStatus("error"); }
  }

  const preview = dateFrom && dateTo && dateFrom <= dateTo ? (() => {
    const f = tips.filter(t => t.restaurantId === restaurant.id && t.date >= dateFrom && t.date <= dateTo);
    return { dias: [...new Set(f.map(t => t.date))].length, emps: [...new Set(f.map(t => t.employeeId))].length, total: f.reduce((a, t) => a + t.myShare, 0) };
  })() : null;

  return (
    <Modal title={`📤 Exportar — ${restaurant.name}`} onClose={onClose}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div><label style={S.label}>Data Inicial</label><input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={S.input} /></div>
          <div><label style={S.label}>Data Final</label><input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={S.input} /></div>
        </div>
        {preview && (
          <div style={{ background: "var(--bg1)", borderRadius: 10, padding: 12, fontSize: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text2)", marginBottom: 3 }}><span>Dias com gorjeta</span><span style={{ color: "var(--text)" }}>{preview.dias}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text2)", marginBottom: 3 }}><span>Empregados</span><span style={{ color: "var(--text)" }}>{preview.emps}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text2)" }}><span>Total bruto</span><span style={{ color: "var(--ac)", fontWeight: 700 }}>{fmt(preview.total)}</span></div>
          </div>
        )}
        {status === "loading" && <p style={{ color: "var(--ac)", textAlign: "center", fontSize: 13 }}>⏳ Gerando arquivo…</p>}
        {status === "done"    && <p style={{ color: "var(--green)", textAlign: "center", fontSize: 13 }}>✅ Arquivo salvo nos seus downloads!</p>}
        {status === "error"   && <p style={{ color: "var(--red)", textAlign: "center", fontSize: 13 }}>❌ Erro ao gerar. Tente novamente.</p>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button onClick={exportExcel} disabled={status === "loading" || !preview} style={{ ...S.btnPrimary, background: "#217346", color: "var(--text)", opacity: !preview ? 0.5 : 1 }}>📊 Excel</button>
          <button onClick={exportPDF}   disabled={status === "loading" || !preview} style={{ ...S.btnPrimary, background: "#c0392b", color: "var(--text)", opacity: !preview ? 0.5 : 1 }}>📄 PDF</button>
        </div>
        <button onClick={onClose} style={{ ...S.btnSecondary, textAlign: "center" }}>Fechar</button>
      </div>
      {previewDoc && <PDFPreviewModal pdfDoc={previewDoc} fileName={previewFileName} title="Relatório de Gorjetas" onClose={()=>setPreviewDoc(null)} />}
    </Modal>
  );
}

//
// EMPLOYEE PORTAL
//
//
// COMUNICADOS TAB (employee view)
//
function ComunicadosTab({ empId, restaurantId, communications, commAcks, onUpdate, roles, emp }) {
  const empRole = roles?.find(r => r.id === emp?.roleId);
  const myComms = communications.filter(c => {
    if (c.restaurantId !== restaurantId || c.deleted) return false;
    if (!c.target || c.target === "all") return true;
    if (c.target.startsWith("emps:")) return c.target.replace("emps:","").split(",").includes(empId);
    if (c.target.startsWith("areas:")) return empRole && c.target.replace("areas:","").split(",").includes(empRole.area);
    if (c.target === `emp:${empId}`) return true;
    if (c.target.startsWith("area:") && empRole) return c.target === `area:${empRole.area}`;
    return false;
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pending = myComms.filter(c => !commAcks?.[c.id]?.[empId]);
  const done    = myComms.filter(c =>  commAcks?.[c.id]?.[empId]);
  const [tab, setTab] = useState("pending");
  const ac = "var(--ac)";

  function ack(commId) {
    const now = new Date().toISOString();
    onUpdate("commAcks", {
      ...commAcks,
      [commId]: { ...(commAcks?.[commId] ?? {}), [empId]: now }
    });
  }

  const list = tab === "pending" ? pending : done;

  return (
    <div>
      {pending.length > 0 && (
        <div style={{ background: "#e74c3c22", border: "1px solid #e74c3c44", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "var(--red)", fontFamily: "'DM Mono',monospace" }}>
          ⚠️ Você tem <strong>{pending.length}</strong> comunicado{pending.length > 1 ? "s" : ""} pendente{pending.length > 1 ? "s" : ""} de ciência.
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[["pending", `Pendentes (${pending.length})`], ["done", `Lidos (${done.length})`]].map(([id, lbl]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex: 1, padding: "8px", borderRadius: 10, border: `1px solid ${tab === id ? ac : "var(--border)"}`, background: tab === id ? ac + "22" : "transparent", color: tab === id ? ac : "#555", cursor: "pointer", fontFamily: "'DM Mono',monospace", fontSize: 12 }}>{lbl}</button>
        ))}
      </div>
      {list.length === 0 && <p style={{ color: "var(--text3)", textAlign: "center", fontSize: 14 }}>Nenhum comunicado {tab === "pending" ? "pendente" : "lido"}.</p>}
      {list.map(c => (
        <div key={c.id} style={{ background: "var(--card-bg)", borderRadius: 14, padding: 16, marginBottom: 12, border: `1px solid ${!commAcks?.[c.id]?.[empId] ? "#e74c3c44" : "var(--border)"}` }}>
          <div style={{ color: "var(--text)", fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{c.title}</div>
          <div style={{ color: "var(--text2)", fontSize: 13, marginBottom: 12, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{c.body}</div>
          <div style={{ color: "var(--text3)", fontSize: 11, marginBottom: commAcks?.[c.id]?.[empId] ? 0 : 12 }}>
            Publicado em {fmtDate(c.createdAt?.slice(0,10))}
            {commAcks?.[c.id]?.[empId] && <span style={{ color: "var(--green)", marginLeft: 12 }}>✓ Ciência em {new Date(commAcks[c.id][empId]).toLocaleString("pt-BR")}</span>}
          </div>
          {!commAcks?.[c.id]?.[empId] && (
            <button onClick={() => ack(c.id)} style={{ width: "100%", padding: "11px", borderRadius: 10, background: "var(--ac)", border: "none", color: "#111", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "'DM Mono',monospace" }}>
              ✓ Dar Ciência
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

//
// FAQ TAB (employee view)
//
function FaqTab({ restaurantId, faq, emp, roles, restaurants, splits }) {
  const items = (faq?.[restaurantId] ?? []).filter(item => item.visible !== false);
  const [openSys, setOpenSys] = useState(null);
  const [openRest, setOpenRest] = useState(null);

  const rest = restaurants?.find(r => r.id === restaurantId);
  const empRole = roles?.find(r => r.id === emp?.roleId);
  const restRolesComGorjeta = (roles ?? []).filter(r => r.restaurantId === restaurantId && !r.inactive && !r.noTip);
  const restRolesSemGorjeta = (roles ?? []).filter(r => r.restaurantId === restaurantId && !r.inactive && r.noTip);
  const taxRate = rest?.taxRate ?? 0.33;
  const taxLabel = taxRate === 0.20 ? "20% (Simples Nacional)" : "33% (Lucro Real/Presumido)";
  const splitType = (rest?.divisionMode ?? MODE_AREA_POINTS) === MODE_AREA_POINTS ? "area" : "points";
  const ac = "var(--ac)";

  const now = new Date();
  const mk = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const curSplit = splits?.[restaurantId]?.[mk] ?? DEFAULT_SPLIT;

  const pontosCargo = parseFloat(empRole?.points) || 0;
  const totalPontos = restRolesComGorjeta.reduce((s,r) => s+(parseFloat(r.points)||0), 0);
  const empArea = emp?.area ?? empRole?.area ?? "—";
  const cargosEmpArea = restRolesComGorjeta.filter(r => r.area === empArea);
  const totalPtsArea = cargosEmpArea.reduce((s,r) => s+(parseFloat(r.points)||0), 0);
  const pctArea = curSplit[empArea] ?? 0;
  const EX = 1000;

  function fmtR(n) { return n.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}); }

  const FAQ_SISTEMA = [
    {
      id:"__gorjeta__",
      q:"💸 Como é calculada a minha gorjeta?",
      a:(() => {
        if (!empRole) return "Cargo não identificado. Fale com o gestor.";
        if (empRole.noTip) return `Seu cargo (${empRole.name}) não participa da distribuição de gorjetas.`;
        if (splitType==="area") {
          const pool = EX*(pctArea/100);
          const bruto = totalPtsArea>0 ? (pool/totalPtsArea)*pontosCargo : 0;
          const liq = bruto * (1-taxRate);
          return `Modo atual: Área + Pontos
A gorjeta total do dia é primeiro dividida pelo percentual de cada área. Depois, dentro da sua área, é dividida pelos pontos dos cargos.

📌 Seu cargo: ${empRole.name} — ${pontosCargo} ponto${pontosCargo!==1?"s":""}
📌 Sua área: ${empArea} — recebe ${pctArea}% do total
📌 Dedução: ${taxLabel}

Passo a passo:
1. Gestor lança o valor total do dia
2. Sistema separa o valor por área conforme os percentuais configurados
3. Sua área (${empArea}) recebe ${pctArea}% do total
4. Dentro da área, divide pelos pontos de quem trabalhou
5. Multiplica pelos seus pontos → bruto
6. Deduz ${(taxRate*100).toFixed(0)}% → líquido

Exemplo (gorjeta R$${fmtR(EX)}):
• ${empArea} recebe ${pctArea}% → R$${fmtR(pool)}
• Pontos na área: ${totalPtsArea}pt · Seus: ${pontosCargo}pt
• Seu bruto: R$${fmtR(bruto)}
• Após ${(taxRate*100).toFixed(0)}%: R$${fmtR(liq)} líquido`;
        } else {
          const vpp = totalPontos > 0 ? EX/totalPontos : 0;
          const bruto = vpp * pontosCargo;
          const liq = bruto * (1-taxRate);
          return `Modo atual: Pontos Global
A gorjeta total do dia é somada e dividida diretamente pelos pontos de todos os empregados do restaurante que trabalharam no dia, sem separação por área.

📌 Seu cargo: ${empRole.name} — ${pontosCargo} ponto${pontosCargo!==1?"s":""}
📌 Dedução: ${taxLabel}

Passo a passo:
1. Gestor lança o valor total do dia
2. Sistema soma os pontos de todos que trabalharam no dia
3. Divide o total pelos pontos → valor por ponto
4. Multiplica pelos seus pontos → bruto
5. Deduz ${(taxRate*100).toFixed(0)}% → líquido

Exemplo (gorjeta R$${fmtR(EX)}, ${totalPontos}pt no total):
• Valor por ponto: R$${fmtR(vpp)}
• Seus ${pontosCargo}pt → R$${fmtR(bruto)} bruto
• Após ${(taxRate*100).toFixed(0)}%: R$${fmtR(liq)} líquido`;
        }
      })(),
    },
    {
      id:"__sistema__",
      q: splitType==="area" ? "🏢 Como funciona a divisão por área e pontos?" : "📊 Como funciona a tabela de pontos?",
      a:(() => {
        if (splitType==="area") {
          const AREAS = ["Bar","Cozinha","Salão","Limpeza"];
          const ativas = AREAS.filter(a => (curSplit[a]??0)>0);
          const linhas = ativas.map(a => {
            const pct = curSplit[a]??0;
            const cargos = restRolesComGorjeta.filter(r=>r.area===a);
            const pts = cargos.reduce((s,r)=>s+(parseFloat(r.points)||0),0);
            const cs = cargos.length>0 ? cargos.map(r=>`   • ${r.name}: ${r.points}pt`).join("\n") : "   (sem cargos)";
            return `${a} — ${pct}%\n${cs}\n   Total: ${pts}pt`;
          }).join("\n\n");
          const pool = EX*(pctArea/100);
          const bruto = totalPtsArea>0 ? (pool/totalPtsArea)*pontosCargo : 0;
          return `Sistema atual: Área + Pontos\n\nO valor total da gorjeta do dia é primeiro dividido pelo percentual configurado de cada área. Depois, dentro de cada área, o valor é dividido pelos pontos dos cargos dos empregados presentes.\n\nDistribuição por área:\n${linhas}${restRolesSemGorjeta.length>0?"\n\nCargos sem gorjeta: "+restRolesSemGorjeta.map(r=>r.name).join(", "):""}\n\nSua situação (área: ${empArea}):\n• ${empArea} recebe ${pctArea}% → R$${fmtR(pool)} (de R$${fmtR(EX)})\n• Você tem ${pontosCargo}pt de ${totalPtsArea}pt da área\n• Bruto: R$${fmtR(bruto)} → Líquido: R$${fmtR(bruto*(1-taxRate))}`;
        } else {
          const linhas = restRolesComGorjeta
            .sort((a,b)=>(parseFloat(b.points)||0)-(parseFloat(a.points)||0))
            .map(r=>{
              const pct = totalPontos>0 ? ((parseFloat(r.points)||0)/totalPontos*100).toFixed(1):"0";
              const d = r.id===empRole?.id?" ◄ você":"";
              return `• ${r.name}: ${r.points}pt (${pct}%)${d}`;
            }).join("\n");
          return `Sistema atual: Pontos Global\n\nTodos os pontos de todos os empregados do restaurante que trabalharam no dia são somados. O valor total da gorjeta é dividido por essa soma, e cada empregado recebe proporcionalmente aos pontos do seu cargo. Não há separação por área.\n\nTabela de cargos (${totalPontos}pt total):\n${linhas}${restRolesSemGorjeta.length>0?"\n\nCargos sem gorjeta: "+restRolesSemGorjeta.map(r=>r.name).join(", "):""}\n\nQuanto maior a pontuação, maior a fatia da gorjeta.`;
        }
      })(),
    },
    {
      id:"__escala__",
      tabKey: "escala",
      q:"📅 Como funciona a escala e por que ela importa?",
      a:"A escala registra sua presença em cada dia e define diretamente se você recebe gorjeta.\n\nVocê recebe gorjeta quando:\n✅ Trabalhando normalmente\n✅ Compensação de banco de horas (C)\n\nVocê NÃO recebe gorjeta quando:\n❌ Folga\n❌ Freela (FL) — presente cobrindo a equipe, mas sem gorjeta\n❌ Falta injustificada (F) — além de não receber, pode haver penalidade\n❌ Falta justificada (FJ)\n❌ Atestado médico (A)\n❌ Férias (V) — nenhum empregado recebe gorjeta durante férias, incluindo produção\n\nExceções:\n• Empregados de produção (🏭) recebem gorjeta todos os dias, exceto férias\n• Empregados freela (🎯) nunca participam do rateio de gorjeta\n\nSe notar algum erro na sua escala, avise o gestor o quanto antes — erros afetam diretamente o valor que você recebe.",
    },
    {
      id:"__producao__",
      tabKey: null,
      q:"🏭 O que é empregado de produção?",
      a:(() => {
        const penU = rest?.producaoPenaltyU ?? 6.66;
        const penJ = rest?.producaoPenaltyJ ?? 3.33;
        const isEmpProd = emp?.isProducao;
        return `Empregados marcados como "Produção" têm regras especiais de gorjeta:\n\n✅ Recebem gorjeta TODOS os dias (trabalhando, folga, compensação, etc.)\n❌ NÃO recebem gorjeta durante férias — assim como qualquer outro empregado\n✅ A distribuição segue os pontos do cargo normalmente\n\n⚠️ Penalidades por falta (sobre o pool mensal, por dia):\n• Falta injustificada: ${penU}% por dia\n• Falta justificada: ${penJ}% por dia\n\nExemplo: pool mensal de R$${fmtR(10000)}, 2 faltas injustificadas + 1 justificada → desconto de ${penU*2}% + ${penJ}% = ${penU*2+penJ}% = R$${fmtR(10000*(penU*2+penJ)/100)}\n\n${isEmpProd ? "📌 Você está marcado como empregado de produção. Essas regras se aplicam a você." : "Essas regras só se aplicam a empregados marcados como produção pelo gestor."}\n\nO status de produção é definido pelo gestor na aba Equipe e pode ser atribuído a empregados de qualquer área.`;
      })(),
    },
    {
      id:"__freela__",
      tabKey: null,
      q:"🎯 O que é empregado freela?",
      a:(() => {
        const isEmpFreela = emp?.isFreela;
        return `Empregados marcados como "Freela" são colaboradores que cobrem a equipe esporadicamente:\n\n✅ Aparecem normalmente na escala\n❌ Nunca participam do rateio de gorjeta, independente do status na escala\n✅ O cargo e área são atribuídos normalmente\n\nAlém disso, qualquer empregado pode receber o status "Freela" (FL) em um dia específico da escala. Nesse caso, ele está presente mas não recebe gorjeta naquele dia — útil para quem estava de folga e resolveu cobrir.\n\n${isEmpFreela ? "📌 Você está marcado como empregado freela. Você não participa do rateio de gorjeta." : "Essas regras só se aplicam a empregados marcados como freela pelo gestor."}\n\nO status de freela é definido pelo gestor na aba Equipe.`;
      })(),
    },
    {
      id:"__dp__",
      tabKey: "dp",
      q:"💬 Para que serve o Fale com DP?",
      a:"Canal direto entre você e o departamento pessoal do restaurante. Use para:\n\n• Dúvidas trabalhistas (férias, horas extras, INSS, FGTS...)\n• Entrega de atestados e justificativas de falta\n• Solicitação de documentos (holerite, declaração de vínculo...)\n• Sugestões e elogios\n• Denúncias — você pode enviar de forma totalmente anônima\n\nO gestor responsável pelo DP responde diretamente pelo aplicativo.",
    },
    {
      id:"__comunicados__",
      tabKey: "comunicados",
      q:"📢 Como funcionam os comunicados?",
      a:"Avisos enviados pelo gestor para a equipe ou grupos específicos.\n\nQuando chegar um comunicado novo:\n• Você recebe uma notificação\n• Leia o comunicado completo\n• Confirme clicando em \"Li e entendi\"\n\nO gestor acompanha quem confirmou. É importante confirmar — comunicados podem conter informações sobre escalas, regras e avisos importantes do restaurante.",
    },
    {
      id:"__pin__",
      tabKey: null,
      q:"🔐 O que é o PIN e como trocar?",
      a:"O PIN é sua senha de acesso ao AppTip — um código de 4 dígitos numéricos.\n\nPara fazer login use:\n• Seu ID de empregado (ex: LBZ0005) ou CPF\n• Seu PIN de 4 dígitos\n\nNo primeiro acesso o sistema pedirá que você crie um PIN pessoal.\n\nPara trocar o PIN depois: solicite ao seu gestor que faça o reset. Após o reset, você deverá criar um novo PIN no próximo acesso.\n\nNunca compartilhe seu PIN com ninguém.",
    },
  ].filter(item => {
    if (!item.tabKey) return rest?.tabsGestor?.faqAuto?.[item.id] !== false;
    if (rest?.tabsConfig?.[item.tabKey] === false) return false;
    if (rest?.tabsGestor?.[item.tabKey] === false) return false;
    if (rest?.tabsGestor?.faqAuto?.[item.id] === false) return false;
    return true;
  });

  return (
    <div style={{paddingBottom:20}}>

      <div style={{padding:"12px 16px 8px"}}>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
          <span style={{fontSize:14}}>📐</span>
          <span style={{color:ac,fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>Regras do sistema</span>
        </div>
        <p style={{color:"var(--text3)",fontSize:11,margin:"0 0 8px"}}>Geradas automaticamente com as regras do seu restaurante</p>
      </div>
      {FAQ_SISTEMA.map((item,i) => (
        <div key={item.id} style={{background:"var(--card-bg)",borderRadius:12,marginBottom:6,border:"1px solid var(--ac)22",overflow:"hidden",marginInline:8}}>
          <button onClick={()=>setOpenSys(openSys===i?null:i)}
            style={{width:"100%",padding:"12px 14px",background:openSys===i?"var(--ac-bg)":"transparent",border:"none",color:openSys===i?ac:"var(--text)",textAlign:"left",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
            <span>{item.q}</span>
            <span style={{fontSize:16,color:"var(--text3)",flexShrink:0}}>{openSys===i?"−":"+"}</span>
          </button>
          {openSys===i && (
            <div style={{padding:"10px 14px 14px",color:"var(--text2)",fontSize:12,lineHeight:1.75,borderTop:"1px solid var(--ac)22",whiteSpace:"pre-wrap",fontFamily:"'DM Mono',monospace"}}>
              {item.a}
              <div style={{marginTop:10,fontSize:10,color:"var(--text3)",fontStyle:"italic",fontFamily:"'DM Sans',sans-serif"}}>Atualizado automaticamente com as regras do restaurante.</div>
            </div>
          )}
        </div>
      ))}

      <div style={{padding:"20px 16px 8px"}}>
        <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
          <span style={{fontSize:14}}>🏢</span>
          <span style={{color:"var(--text2)",fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>Sobre o restaurante</span>
        </div>
        <p style={{color:"var(--text3)",fontSize:11,margin:"0 0 8px"}}>Perguntas e respostas cadastradas pelo gestor</p>
      </div>
      {items.length===0
        ? <p style={{color:"var(--text3)",textAlign:"center",fontSize:13,padding:"12px 0"}}>Nenhuma pergunta cadastrada pelo gestor ainda.</p>
        : items.map((item,i) => (
          <div key={item.id??i} style={{background:"var(--card-bg)",borderRadius:12,marginBottom:6,border:"1px solid var(--border)",overflow:"hidden",marginInline:8}}>
            <button onClick={()=>setOpenRest(openRest===i?null:i)}
              style={{width:"100%",padding:"12px 14px",background:"none",border:"none",color:openRest===i?ac:"var(--text)",textAlign:"left",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600,display:"flex",justifyContent:"space-between",alignItems:"center",gap:8}}>
              <span>{item.q}</span>
              <span style={{fontSize:16,color:"var(--text3)",flexShrink:0}}>{openRest===i?"−":"+"}</span>
            </button>
            {openRest===i && (
              <div style={{padding:"10px 14px 14px",color:"var(--text2)",fontSize:13,lineHeight:1.7,borderTop:"1px solid var(--border)",whiteSpace:"pre-wrap"}}>
                {item.a}
              </div>
            )}
          </div>
        ))
      }
    </div>
  );
}

//
// FALE COM DP TAB (employee view)
//
function FaleDpTab({ empId, emp, restaurantId, dpMessages, onUpdate }) {
  const [category, setCategory] = useState("sugestao");
  const [body, setBody] = useState("");
  const [anon, setAnon] = useState(false);
  const [sent, setSent] = useState(false);
  const CATS = [["sugestao","💡 Sugestão"],["elogio","👏 Elogio"],["reclamacao","⚠️ Reclamação"],["denuncia","🚨 Denúncia"]];
  const ac = "var(--ac)";

  function send() {
    if (!body.trim()) return;
    const msg = {
      id: Date.now().toString(),
      restaurantId,
      empId: anon ? null : empId,
      empName: anon ? "Anônimo" : (emp?.name ?? "—"),
      category,
      body: body.trim(),
      date: new Date().toISOString(),
      read: false,
    };
    onUpdate("dpMessages", [...dpMessages, msg]);
    setBody(""); setSent(true);
    setTimeout(() => setSent(false), 3000);
  }

  return (
    <div>
      <p style={{ color: "var(--text3)", fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
        Envie sugestões, elogios, reclamações ou denúncias ao Departamento Pessoal. Você pode escolher se quer se identificar ou enviar de forma anônima.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        {CATS.map(([val, lbl]) => (
          <button key={val} onClick={() => setCategory(val)} style={{ padding: "10px", borderRadius: 10, border: `1px solid ${category === val ? ac : "var(--border)"}`, background: category === val ? ac + "22" : "transparent", color: category === val ? ac : "#555", cursor: "pointer", fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: category === val ? 700 : 400 }}>{lbl}</button>
        ))}
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>Mensagem</label>
        <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Escreva sua mensagem aqui…" rows={5} style={{ ...S.input, resize: "vertical", lineHeight: 1.5 }} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <button onClick={() => setAnon(!anon)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", fontFamily: "'DM Mono',monospace", color: anon ? ac : "#555", fontSize: 13, padding: 0 }}>
          <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${anon ? ac : "#555"}`, background: anon ? ac : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#111" }}>{anon ? "✓" : ""}</div>
          Enviar de forma anônima
        </button>
        {!anon && <p style={{ color: "var(--text3)", fontSize: 11, marginTop: 4, marginLeft: 26 }}>Identificado como: <strong style={{ color: "var(--text2)" }}>{emp?.name}</strong></p>}
      </div>
      {sent && <p style={{ color: "var(--green)", fontSize: 13, marginBottom: 10 }}>✅ Mensagem enviada com sucesso!</p>}
      <button onClick={send} disabled={!body.trim()} style={{ width: "100%", padding: "12px", borderRadius: 12, background: body.trim() ? ac : "var(--border)", border: "none", color: "#111", fontWeight: 700, fontSize: 14, cursor: body.trim() ? "pointer" : "default", fontFamily: "'DM Mono',monospace" }}>
        Enviar Mensagem
      </button>

      {/* Direitos LGPD */}
      <div style={{marginTop:24,padding:"16px",borderRadius:12,border:"1px solid var(--border)",background:"var(--bg1)"}}>
        <p style={{color:"var(--text3)",fontSize:12,fontWeight:700,margin:"0 0 8px"}}>🔒 Seus direitos (LGPD)</p>
        <p style={{color:"var(--text3)",fontSize:11,margin:"0 0 12px",lineHeight:1.6}}>
          Pela Lei Geral de Proteção de Dados você pode solicitar acesso, correção ou exclusão dos seus dados pessoais a qualquer momento.
        </p>
        <button onClick={()=>{
          if(!window.confirm("Confirma a solicitação de exclusão dos seus dados? O gestor receberá sua solicitação.")) return;
          const msg = {
            id: Date.now().toString(),
            restaurantId,
            empId,
            empName: emp?.name ?? "—",
            category: "denuncia",
            body: `[SOLICITAÇÃO LGPD] ${emp?.name} (${emp?.empCode}) solicita a exclusão de todos os seus dados pessoais do sistema, conforme direito garantido pela Lei nº 13.709/2018 (LGPD).`,
            date: new Date().toISOString(),
            read: false,
          };
          onUpdate("dpMessages", [...dpMessages, msg]);
          onUpdate("_toast", "✅ Solicitação enviada ao gestor.");
        }} style={{padding:"8px 16px",borderRadius:8,border:"1px solid #ef444433",background:"transparent",color:"var(--red)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>
          Solicitar exclusão dos meus dados
        </button>
        <button onClick={()=>window.__showPrivacy?.()} style={{display:"block",marginTop:8,background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:11,padding:0,textDecoration:"underline"}}>
          Ver Política de Privacidade completa
        </button>
      </div>
    </div>
  );
}

//
// COMUNICADOS MANAGER TAB (manager/super view)
//
function ComunicadosManagerTab({ restaurantId, communications, commAcks, employees, onUpdate, currentManagerName, isOwner, trash }) {
  const myComms = communications.filter(c => c.restaurantId === restaurantId && !c.autoSchedule && !c.deleted)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const trashedComms = communications.filter(c => c.restaurantId === restaurantId && !c.autoSchedule && c.deleted)
    .sort((a, b) => (b.deletedAt||b.createdAt).localeCompare(a.deletedAt||a.createdAt));
  const [showTrash, setShowTrash] = useState(false);
  const restEmps = employees.filter(e => e.restaurantId === restaurantId && !(e.inactive && e.inactiveFrom && e.inactiveFrom <= today()));
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody]   = useState("");
  const [selComm, setSelComm] = useState(null);
  const [selAreas, setSelAreas] = useState([]);
  const [selEmps, setSelEmps] = useState([]);
  const [aiInput, setAiInput] = useState("");
  const { generate: aiGenerate, aiLoading, aiError, setAiError } = useAiGenerate();

  async function handleAiSuggest() {
    if (!aiInput.trim()) return;
    const result = await aiGenerate(
      `Você é um assistente de comunicação interna de restaurantes. O gestor quer enviar um comunicado para a equipe. Redija de forma profissional, clara e direta. Responda APENAS com JSON: {"titulo": "título objetivo", "corpo": "texto completo do comunicado"}`,
      aiInput.trim()
    );
    if (result) { setTitle(result.titulo); setBody(result.corpo); setAiInput(""); }
  }

  // target logic: "all" | "areas:[Bar,Cozinha]" | "emps:[id1,id2]"
  function toggleArea(a) { setSelAreas(p => p.includes(a) ? p.filter(x=>x!==a) : [...p,a]); setSelEmps([]); }
  function toggleEmp(id) { setSelEmps(p => p.includes(id) ? p.filter(x=>x!==id) : [...p,id]); setSelAreas([]); }
  function selectAll() { setSelAreas([]); setSelEmps([]); }
  const isAll = selAreas.length===0 && selEmps.length===0;

  function publish() {
    if (!title.trim() || !body.trim()) return;
    let target = "all";
    if (selAreas.length > 0) target = `areas:${selAreas.join(",")}`;
    else if (selEmps.length > 0) target = `emps:${selEmps.join(",")}`;
    const c = { id: Date.now().toString(), restaurantId, title: title.trim(), body: body.trim(), createdAt: new Date().toISOString(), createdBy: currentManagerName, target };
    onUpdate("communications", [...communications, c]);
    setTitle(""); setBody(""); setSelAreas([]); setSelEmps([]); setShowNew(false);
  }

  function softDelete(id) {
    if(!window.confirm("Mover este comunicado para a lixeira?")) return;
    onUpdate("communications", communications.map(c => c.id === id ? { ...c, deleted: true, deletedAt: new Date().toISOString() } : c));
    onUpdate("_toast", "🗑️ Comunicado movido para a lixeira");
  }

  function permanentDelete(id) {
    if(!window.confirm("Apagar permanentemente este comunicado? Esta ação não pode ser desfeita.")) return;
    onUpdate("communications", communications.filter(c => c.id !== id));
    const newAcks = { ...commAcks };
    delete newAcks[id];
    onUpdate("commAcks", newAcks);
    onUpdate("_toast", "🗑️ Comunicado apagado permanentemente");
  }

  function restoreFromTrash(id) {
    onUpdate("communications", communications.map(c => c.id === id ? { ...c, deleted: false, deletedAt: undefined } : c));
    onUpdate("_toast", "♻️ Comunicado restaurado");
  }

  if (selComm) {
    const c = myComms.find(x => x.id === selComm);
    return (
      <div>
        <button onClick={() => setSelComm(null)} style={{ ...S.btnSecondary, marginBottom: 16 }}>← Voltar</button>
        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={{ color: "var(--text)", fontWeight: 700, fontSize: 16, marginBottom: 4 }}>{c.title}</div>
          <div style={{ color: "var(--text3)", fontSize: 12, marginBottom: 4 }}>Publicado em {new Date(c.createdAt).toLocaleString("pt-BR")} por {c.createdBy}</div>
          <div style={{fontSize:11,color:"var(--text3)",marginBottom:12}}>→ {!c.target||c.target==="all"?"Todos":c.target.startsWith("emps:")?`${c.target.replace("emps:","").split(",").length} empregado(s)`:c.target.startsWith("areas:")?`Áreas: ${c.target.replace("areas:","").replace(/,/g,", ")}`:c.target.startsWith("emp:")?employees.find(e=>e.id===c.target.replace("emp:",""))?.name?.split(" ")[0]??"":`Área ${c.target.replace("area:","")}`}</div>
          <div style={{ color: "var(--text2)", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 12 }}>{c.body}</div>
        </div>
        {(() => {
          const targetLabel = !c.target || c.target==="all" ? "Todos os empregados"
            : c.target.startsWith("emps:") ? `Empregados: ${c.target.replace("emps:","").split(",").map(id=>employees.find(e=>e.id===id)?.name?.split(" ")[0]??"").join(", ")}`
            : c.target.startsWith("areas:") ? `Áreas: ${c.target.replace("areas:","").replace(/,/g,", ")}`
            : c.target.startsWith("emp:") ? `Empregado: ${employees.find(e=>e.id===c.target.replace("emp:",""))?.name??""}`
            : `Área: ${c.target.replace("area:","")}`;
          return (
            <>
              <p style={{ color: "var(--text3)", fontSize: 12, marginBottom: 4 }}>Destinatário: <strong style={{color:"var(--text2)"}}>{targetLabel}</strong></p>
              <p style={{ color: "var(--text3)", fontSize: 12, marginBottom: 10 }}>Tabela de ciências</p>
              <div style={{ ...S.card }}>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 6, marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
                  {["Empregado", "Envio", "Ciência"].map(h => <div key={h} style={{ color: "var(--text3)", fontSize: 11 }}>{h}</div>)}
                </div>
                {restEmps.map(e => {
                  const ackDate = commAcks?.[c.id]?.[e.id];
                  return (
                    <div key={e.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 6, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                      <div style={{ color: "var(--text)", fontSize: 13 }}>{e.name}</div>
                      <div style={{ color: "var(--text3)", fontSize: 11 }}>{fmtDate(c.createdAt?.slice(0,10))}</div>
                      <div style={{ color: ackDate ? "var(--green)" : "var(--red)", fontSize: 11 }}>{ackDate ? new Date(ackDate).toLocaleDateString("pt-BR") : "Pendente"}</div>
                    </div>
                  );
                })}
                <div style={{ marginTop: 12, color: "var(--text3)", fontSize: 12 }}>
                  ✓ {restEmps.filter(e => commAcks?.[c.id]?.[e.id]).length} de {restEmps.length} confirmados
                </div>
              </div>
            </>
          );
        })()}
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => { setShowNew(!showNew); setAiInput(""); setAiError(""); }} style={{ ...S.btnPrimary, marginBottom: 16 }}>
        {showNew ? "Cancelar" : "+ Novo Comunicado"}
      </button>
      {showNew && (
        <div style={{ ...S.card, marginBottom: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Destinatários */}
            <div>
              <label style={S.label}>Destinatários</label>
              {/* Todos button */}
              <div style={{marginBottom:8}}>
                <button onClick={selectAll} style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${isAll?"var(--ac)":"var(--border)"}`,background:isAll?"var(--ac)22":"transparent",color:isAll?"var(--ac)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:isAll?700:400}}>
                  👥 Todos
                </button>
              </div>
              {/* Areas */}
              <div style={{marginBottom:6}}>
                <div style={{color:"var(--text3)",fontSize:10,marginBottom:4}}>ÁREAS</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {AREAS.map(a=>{
                    const on = selAreas.includes(a);
                    return <button key={a} onClick={()=>toggleArea(a)} style={{padding:"4px 12px",borderRadius:20,border:`1px solid ${on?AREA_COLORS[a]??"#555":"var(--border)"}`,background:on?(AREA_COLORS[a]??"#555")+"22":"transparent",color:on?AREA_COLORS[a]??"var(--text)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:on?700:400}}>{a}</button>;
                  })}
                </div>
              </div>
              {/* Employees */}
              <div>
                <div style={{color:"var(--text3)",fontSize:10,marginBottom:4}}>EMPREGADOS ESPECÍFICOS</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {restEmps.sort((a,b)=>a.name.localeCompare(b.name)).map(e=>{
                    const on = selEmps.includes(e.id);
                    return <button key={e.id} onClick={()=>toggleEmp(e.id)} style={{padding:"4px 12px",borderRadius:20,border:`1px solid ${on?"var(--green)":"var(--border)"}`,background:on?"#10b98122":"transparent",color:on?"var(--green)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:on?700:400}}>{e.name.split(" ")[0]}</button>;
                  })}
                </div>
              </div>
              {/* Summary */}
              <div style={{marginTop:8,fontSize:11,color:"var(--text3)"}}>
                {isAll ? "→ Enviando para todos os empregados"
                  : selAreas.length>0 ? `→ Áreas: ${selAreas.join(", ")}`
                  : `→ ${selEmps.length} empregado(s) selecionado(s)`}
              </div>
            </div>
            {/* Assistente IA */}
            <div style={{padding:"12px 14px",borderRadius:10,background:"var(--ac-bg)",border:"1px solid var(--ac)33"}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                <span style={{fontSize:14}}>✨</span>
                <span style={{color:"var(--ac-text)",fontWeight:700,fontSize:13}}>Assistente IA</span>
              </div>
              <p style={{color:"var(--text3)",fontSize:12,margin:"0 0 8px"}}>Descreva informalmente o que quer comunicar. A IA redige o título e o texto de forma profissional.</p>
              <textarea value={aiInput} onChange={e=>setAiInput(e.target.value)}
                placeholder='Ex: "lembrar a equipe que a escala de fim de semana mudou, sábado agora começa às 11h"'
                rows={2} style={{...S.input,resize:"vertical",marginBottom:8,fontSize:13}}/>
              {aiError && <p style={{color:"var(--red)",fontSize:12,margin:"0 0 8px"}}>{aiError}</p>}
              <button onClick={handleAiSuggest} disabled={!aiInput.trim()||aiLoading}
                style={{...S.btnPrimary,width:"auto",padding:"7px 18px",fontSize:13,opacity:(!aiInput.trim()||aiLoading)?0.6:1}}>
                {aiLoading?"✨ Gerando...":"✨ Sugerir com IA"}
              </button>
              {title && <p style={{color:"var(--text3)",fontSize:11,marginTop:8,marginBottom:0}}>↓ Sugestão gerada abaixo — edite à vontade antes de publicar</p>}
            </div>
            <div><label style={S.label}>Título</label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Título do comunicado" style={S.input} /></div>
            <div><label style={S.label}>Conteúdo</label><textarea value={body} onChange={e => setBody(e.target.value)} rows={5} placeholder="Texto do comunicado…" style={{ ...S.input, resize: "vertical" }} /></div>
            <button onClick={publish} style={{ ...S.btnPrimary }}>Publicar</button>
          </div>
        </div>
      )}
      {myComms.length === 0 && !showTrash && <p style={{ color: "var(--text3)", textAlign: "center" }}>Nenhum comunicado publicado.</p>}
      {!showTrash && myComms.map(c => {
        const ackCount = restEmps.filter(e => commAcks?.[c.id]?.[e.id]).length;
        return (
          <div key={c.id} style={{ ...S.card, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: "var(--text)", fontWeight: 600, marginBottom: 4 }}>{c.title}</div>
                <div style={{ color: "var(--text3)", fontSize: 12 }}>{fmtDate(c.createdAt?.slice(0,10))} · {ackCount}/{restEmps.length} ciências</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setSelComm(c.id)} style={{ ...S.btnSecondary, fontSize: 12 }}>Ver ciências</button>
                <button onClick={() => softDelete(c.id)} style={{ background: "none", border: "1px solid #e74c3c33", borderRadius: 8, color: "var(--red)", cursor: "pointer", fontSize: 12, padding: "6px 12px", fontFamily: "'DM Mono',monospace" }}>🗑️</button>
              </div>
            </div>
          </div>
        );
      })}

      {/* Trash toggle */}
      {trashedComms.length > 0 && (
        <button onClick={() => setShowTrash(!showTrash)} style={{ ...S.btnSecondary, fontSize: 12, marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
          🗑️ Lixeira ({trashedComms.length}) {showTrash ? "▲" : "▼"}
        </button>
      )}

      {/* Trash view */}
      {showTrash && trashedComms.map(c => (
        <div key={c.id} style={{ ...S.card, marginBottom: 10, marginTop: 10, opacity: 0.6, borderColor: "var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div style={{ color: "var(--text)", fontWeight: 600, marginBottom: 4 }}>{c.title}</div>
              <div style={{ color: "var(--text3)", fontSize: 12 }}>Apagado em {c.deletedAt ? new Date(c.deletedAt).toLocaleDateString("pt-BR") : "—"}</div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => restoreFromTrash(c.id)} style={{ ...S.btnSecondary, fontSize: 12 }}>♻️ Restaurar</button>
              {isOwner && <button onClick={() => permanentDelete(c.id)} style={{ background: "none", border: "1px solid #e74c3c33", borderRadius: 8, color: "var(--red)", cursor: "pointer", fontSize: 12, padding: "6px 12px", fontFamily: "'DM Mono',monospace" }}>✕ Apagar</button>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

//
// ── AI helper (Groq — Llama 3) ────────────────────────────────────────────────
const GROQ_KEY = process.env.REACT_APP_GROQ_KEY ?? "";

async function groqGenerate(systemPrompt, userInput) {
  if (!GROQ_KEY || GROQ_KEY.length < 20) {
    throw new Error("Chave da IA não configurada (REACT_APP_GROQ_KEY ausente no build). Contate o admin.");
  }
  let res;
  try {
    res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${GROQ_KEY}` },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userInput },
        ],
        temperature: 0.15,
        response_format: { type: "json_object" },
        max_tokens: 4096,
      }),
    });
  } catch (netErr) {
    console.error("[Groq] Erro de rede:", netErr);
    throw new Error("Erro de conexão com a IA. Verifique sua internet e tente novamente.");
  }

  let data;
  try {
    data = await res.json();
  } catch (parseErr) {
    console.error("[Groq] Resposta inválida (não-JSON):", res.status, await res.text().catch(()=>"(sem corpo)"));
    throw new Error(`Resposta inválida da IA (HTTP ${res.status}).`);
  }

  if (!res.ok || data.error) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    const code = data.error?.code || data.error?.type;
    console.error("[Groq] Erro da API:", { status: res.status, code, msg, data });
    if (res.status === 401) throw new Error("Chave da IA inválida ou expirada. Contate o admin.");
    if (res.status === 429) throw new Error("Limite de requisições da IA excedido. Aguarde alguns instantes.");
    if (res.status === 404 || /model.*not.*found|decommission/i.test(msg)) throw new Error("Modelo da IA indisponível. Atualização necessária.");
    throw new Error(`IA retornou erro: ${msg}`);
  }

  const raw = data.choices?.[0]?.message?.content ?? "";
  if (!raw.trim()) throw new Error("IA retornou resposta vazia. Tente reformular o pedido.");
  try {
    return JSON.parse(raw.replace(/```json|```/g, "").trim());
  } catch (parseErr) {
    console.error("[Groq] Não foi possível parsear JSON:", raw);
    throw new Error("IA retornou texto fora do formato esperado. Tente novamente.");
  }
}

// ── useMobile hook — unified mobile detection ──
function useMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < breakpoint);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, [breakpoint]);
  return isMobile;
}

// ── useAiGenerate hook — wraps groqGenerate with loading/error state ──
function useAiGenerate() {
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  async function generate(systemPrompt, userInput) {
    setAiLoading(true); setAiError("");
    try {
      const result = await groqGenerate(systemPrompt, userInput);
      return result;
    } catch (e) {
      setAiError(e.message || "Não foi possível gerar sugestão. Tente novamente.");
      return null;
    } finally {
      setAiLoading(false);
    }
  }
  return { generate, aiLoading, aiError, setAiError };
}

// FAQ MANAGER TAB
//

function FaqManagerTab({ restaurantId, faq, onUpdate }) {
  const items = faq?.[restaurantId] ?? [];
  const [editIdx, setEditIdx] = useState(null);
  const [form, setForm] = useState({ q: "", a: "" });
  const [aiInput, setAiInput] = useState("");
  const { generate: aiGenerate, aiLoading, aiError, setAiError } = useAiGenerate();
  const ac = "var(--ac)";

  function saveItem() {
    if (!form.q.trim() || !form.a.trim()) return;
    const newItem = {
      id: editIdx === "new" ? Date.now().toString() : (items[editIdx]?.id ?? Date.now().toString()),
      q: form.q.trim(),
      a: form.a.trim(),
      visible: editIdx === "new" ? true : (items[editIdx]?.visible ?? true),
    };
    const newItems = editIdx === "new"
      ? [...items, newItem]
      : items.map((x, i) => i === editIdx ? { ...x, ...newItem } : x);
    onUpdate("faq", { ...faq, [restaurantId]: newItems });
    setEditIdx(null); setForm({ q: "", a: "" }); setAiInput(""); setAiError("");
  }

  function removeItem(i) {
    onUpdate("faq", { ...faq, [restaurantId]: items.filter((_, idx) => idx !== i) });
  }

  function toggleVisible(i) {
    const updated = items.map((x, idx) => idx === i ? { ...x, visible: x.visible === false ? true : false } : x);
    onUpdate("faq", { ...faq, [restaurantId]: updated });
  }

  async function handleAiSuggest() {
    if (!aiInput.trim()) return;
    const result = await aiGenerate(
      `Você é um assistente especializado em restaurantes. O gestor descreveu informalmente uma pergunta e resposta para o FAQ dos empregados. Reformule de forma clara, profissional e empática. Responda APENAS com JSON: {"q": "pergunta clara", "a": "resposta profissional"}`,
      aiInput.trim()
    );
    if (result) { setForm({ q: result.q, a: result.a }); setAiInput(""); }
  }

  const isEditing = editIdx !== null;

  return (
    <div>
      <button onClick={() => { setEditIdx("new"); setForm({ q: "", a: "" }); setAiInput(""); setAiError(""); }}
        style={{ ...S.btnPrimary, marginBottom: 16 }}>+ Nova Pergunta</button>

      {isEditing && (
        <div style={{ ...S.card, marginBottom: 16, border: "1px solid var(--ac)33" }}>
          {/* Assistente IA */}
          <div style={{ marginBottom: 14, padding: "12px 14px", borderRadius: 10, background: "var(--ac-bg)", border: "1px solid var(--ac)33" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <span style={{ fontSize: 16 }}>✨</span>
              <span style={{ color: "var(--ac-text)", fontWeight: 700, fontSize: 13 }}>Assistente IA</span>
            </div>
            <p style={{ color: "var(--text3)", fontSize: 12, margin: "0 0 8px" }}>
              Descreva informalmente a pergunta e resposta que quer criar. A IA redige de forma profissional.
            </p>
            <textarea
              value={aiInput}
              onChange={e => setAiInput(e.target.value)}
              placeholder='Ex: "quando o empregado falta sem avisar ele perde a gorjeta do dia e precisa justificar para o gestor"'
              rows={3}
              style={{ ...S.input, resize: "vertical", marginBottom: 8, fontSize: 13 }}
            />
            {aiError && <p style={{ color: "var(--red)", fontSize: 12, margin: "0 0 8px" }}>{aiError}</p>}
            <button onClick={handleAiSuggest} disabled={!aiInput.trim() || aiLoading}
              style={{ ...S.btnPrimary, width: "auto", padding: "8px 20px", fontSize: 13, opacity: (!aiInput.trim() || aiLoading) ? 0.6 : 1 }}>
              {aiLoading ? "✨ Gerando..." : "✨ Sugerir com IA"}
            </button>
            {form.q && <p style={{ color: "var(--text3)", fontSize: 11, marginTop: 8, marginBottom: 0 }}>↓ Sugestão gerada abaixo — edite à vontade antes de salvar</p>}
          </div>

          {/* Formulário */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <label style={S.label}>Pergunta</label>
              <input value={form.q} onChange={e => setForm(p => ({ ...p, q: e.target.value }))}
                placeholder="Ex: Como funciona o rateio de gorjeta?" style={S.input} />
            </div>
            <div>
              <label style={S.label}>Resposta</label>
              <textarea value={form.a} onChange={e => setForm(p => ({ ...p, a: e.target.value }))}
                rows={5} placeholder="Resposta detalhada…" style={{ ...S.input, resize: "vertical" }} />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={saveItem} style={{ ...S.btnPrimary, flex: 1 }}>Salvar</button>
              <button onClick={() => { setEditIdx(null); setAiInput(""); setAiError(""); }} style={S.btnSecondary}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {items.length === 0 && !isEditing && (
        <p style={{ color: "var(--text3)", textAlign: "center", padding: "20px 0" }}>Nenhuma pergunta cadastrada.</p>
      )}

      {items.map((item, i) => {
        const isVisible = item.visible !== false;
        return (
          <div key={item.id ?? i} style={{ ...S.card, marginBottom: 8, opacity: isVisible ? 1 : 0.6, border: `1px solid ${isVisible ? "var(--border)" : "var(--border)"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: isVisible ? ac : "var(--text3)", fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{item.q}</div>
                <div style={{ color: "var(--text3)", fontSize: 12 }}>{item.a.slice(0, 80)}{item.a.length > 80 ? "…" : ""}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
                {/* Toggle visibilidade */}
                <button onClick={() => toggleVisible(i)}
                  style={{ padding: "5px 12px", borderRadius: 20, border: "none", background: isVisible ? "var(--green)" : "var(--border)", color: isVisible ? "#fff" : "var(--text3)", fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", fontSize: 11, whiteSpace: "nowrap" }}>
                  {isVisible ? "👁 Exibindo" : "🚫 Oculto"}
                </button>
                <button onClick={() => { setEditIdx(i); setForm({ q: item.q, a: item.a }); setAiInput(""); setAiError(""); }}
                  style={{ ...S.btnSecondary, fontSize: 12 }}>Editar</button>
                <button onClick={() => removeItem(i)}
                  style={{ background: "none", border: "1px solid #e74c3c33", borderRadius: 8, color: "var(--red)", cursor: "pointer", fontSize: 12, padding: "6px 10px", fontFamily: "'DM Mono',monospace" }}>✕</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

//
// DP MESSAGES MANAGER TAB
//
// ── Notificações Tab (DP only) ────────────────────────────────────────────────
function NotificacoesTab({ restaurantId, dpMessages, notifications, onUpdate }) {
  const ac = "#3b82f6";
  const [showTrash, setShowTrash] = useState(false);

  // All DP messages for this restaurant (exclude soft-deleted)
  const dpMsgs = (dpMessages ?? [])
    .filter(m => m.restaurantId === restaurantId && !m.deleted)
    .map(m => ({ ...m, _kind: "dp" }));

  // System notifications (horário changes, etc) — exclude admin-only items and soft-deleted
  const sysNots = (notifications ?? [])
    .filter(n => n.restaurantId === restaurantId && n.targetRole !== "admin" && n.type !== "upgrade_request" && !n.deleted)
    .map(n => ({ ...n, _kind: "sys" }));

  // Trashed items
  const trashedDp = (dpMessages ?? []).filter(m => m.restaurantId === restaurantId && m.deleted).map(m => ({ ...m, _kind: "dp" }));
  const trashedSys = (notifications ?? []).filter(n => n.restaurantId === restaurantId && n.targetRole !== "admin" && n.type !== "upgrade_request" && n.deleted).map(n => ({ ...n, _kind: "sys" }));
  const trashed = [...trashedDp, ...trashedSys].sort((a, b) => (b.deletedAt || b.date || "").localeCompare(a.deletedAt || a.date || ""));

  const all = [...dpMsgs, ...sysNots]
    .sort((a, b) => (b.date || b.createdAt || "").localeCompare(a.date || a.createdAt || ""));

  const unread = all.filter(m => !m.read).length;

  function markRead(item) {
    if (item._kind === "dp") {
      onUpdate("dpMessages", dpMessages.map(m => m.id === item.id ? { ...m, read: true } : m));
    } else {
      onUpdate("notifications", notifications.map(n => n.id === item.id ? { ...n, read: true } : n));
    }
  }

  function markAllRead() {
    onUpdate("dpMessages", dpMessages.map(m => m.restaurantId === restaurantId ? { ...m, read: true } : m));
    onUpdate("notifications", notifications.map(n => n.restaurantId === restaurantId ? { ...n, read: true } : n));
  }

  function softDeleteItem(item) {
    if (item._kind === "dp") {
      onUpdate("dpMessages", dpMessages.map(m => m.id === item.id ? { ...m, deleted: true, deletedAt: new Date().toISOString(), read: true } : m));
    } else {
      onUpdate("notifications", notifications.map(n => n.id === item.id ? { ...n, deleted: true, deletedAt: new Date().toISOString(), read: true } : n));
    }
    onUpdate("_toast", "🗑️ Mensagem movida para a lixeira");
  }

  function restoreItem(item) {
    if (item._kind === "dp") {
      onUpdate("dpMessages", dpMessages.map(m => m.id === item.id ? { ...m, deleted: false, deletedAt: undefined } : m));
    } else {
      onUpdate("notifications", notifications.map(n => n.id === item.id ? { ...n, deleted: false, deletedAt: undefined } : n));
    }
    onUpdate("_toast", "♻️ Mensagem restaurada");
  }

  const CATS = { sugestao:"💡 Sugestão", elogio:"👏 Elogio", reclamacao:"⚠️ Reclamação", denuncia:"🚨 Denúncia" };

  return (
    <div style={{fontFamily:"'DM Mono',monospace"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <p style={{color:ac,fontSize:15,fontWeight:700,margin:0}}>📬 Notificações</p>
          {unread > 0 && <p style={{color:"var(--text3)",fontSize:12,margin:"2px 0 0"}}>{unread} não lida{unread>1?"s":""}</p>}
        </div>
        {unread > 0 && <button onClick={markAllRead} style={{...S.btnSecondary,fontSize:12}}>Marcar todas lidas</button>}
      </div>
      {all.length === 0 && <p style={{color:"var(--text3)",textAlign:"center",marginTop:40}}>Nenhuma notificação.</p>}
      {all.map(item => {
        const date = item.date || item.createdAt || "";
        const isDP = item._kind === "dp";
        const isSys = item._kind === "sys";
        return (
          <div key={item.id} style={{...S.card,marginBottom:10,opacity:item.read?0.65:1,borderColor:item.read?"var(--border)":isDP?"var(--ac)44":"#3b82f644"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                {isDP && <span style={{background:"var(--ac)22",color:"var(--ac)",borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:700}}>💬 Fale com DP</span>}
                {isSys && <span style={{background:"#3b82f622",color:"#3b82f6",borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:700}}>⚙️ Sistema</span>}
                {isDP && item.category && <span style={{color:"var(--text3)",fontSize:11}}>{CATS[item.category]??item.category}</span>}
                {!item.read && <span style={{background:isDP?"var(--ac)":"#3b82f6",color:"var(--text)",borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:700}}>Novo</span>}
              </div>
              <span style={{color:"var(--text3)",fontSize:11,whiteSpace:"nowrap"}}>{date ? new Date(date).toLocaleString("pt-BR") : ""}</span>
            </div>
            {isDP && <div style={{color:"var(--text2)",fontSize:12,marginBottom:6}}>De: <span style={{color:item.empName==="Anônimo"?"#8b5cf6":"var(--text)"}}>{item.empName}</span></div>}
            <div style={{color:"var(--text)",fontSize:13,lineHeight:1.6,whiteSpace:"pre-wrap",marginBottom:8}}>{item.body}</div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              {!item.read && <button onClick={()=>markRead(item)} style={{...S.btnSecondary,fontSize:11,padding:"4px 12px"}}>Marcar como lida</button>}
              <button onClick={()=>softDeleteItem(item)} aria-label="Excluir item" style={{background:"none",border:"1px solid #e74c3c22",borderRadius:8,color:"var(--text3)",cursor:"pointer",fontSize:11,padding:"4px 10px",fontFamily:"'DM Mono',monospace"}}>🗑️</button>
            </div>
          </div>
        );
      })}

      {/* Trash toggle */}
      {trashed.length > 0 && (
        <button onClick={() => setShowTrash(!showTrash)} style={{ ...S.btnSecondary, fontSize: 12, marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
          🗑️ Lixeira ({trashed.length}) {showTrash ? "▲" : "▼"}
        </button>
      )}

      {/* Trash view */}
      {showTrash && trashed.map(item => (
        <div key={item.id} style={{...S.card,marginBottom:10,marginTop:10,opacity:0.5,borderColor:"var(--border)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div style={{flex:1}}>
              <div style={{color:"var(--text3)",fontSize:11,marginBottom:4}}>
                {item._kind==="dp"?"💬 Fale com DP":"⚙️ Sistema"} · Apagado em {item.deletedAt ? new Date(item.deletedAt).toLocaleDateString("pt-BR") : "—"}
              </div>
              <div style={{color:"var(--text2)",fontSize:13,lineHeight:1.5}}>{item.body?.slice(0,100)}{(item.body?.length??0)>100?"…":""}</div>
            </div>
            <button onClick={()=>restoreItem(item)} style={{...S.btnSecondary,fontSize:11,padding:"4px 10px",flexShrink:0}}>♻️ Restaurar</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Work Schedule helpers ──────────────────────────────────────────────────────
const WEEK_DAYS_LABEL = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

function timeToMin(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}
function fmtHHMM(totalMin) {
  if (!totalMin && totalMin !== 0) return "—";
  const sign = totalMin < 0 ? "-" : "";
  const abs = Math.abs(totalMin);
  return `${sign}${String(Math.floor(abs/60)).padStart(2,"0")}:${String(abs%60).padStart(2,"0")}`;
}

// Calcula horas do dia respeitando hora ficta noturna (CLT Art. 73)
// Método padrão folha: intervalo descontado das horas diurnas primeiro,
// horas noturnas mantidas intactas, ficta aplicada sobre noturnas reais.
// Retorna {worked, diurnal, nocturnal, nocturnalFicta, totalContract, error}
function calcDayHours(inTime, outTime, breakMin) {
  if (!inTime || !outTime) return { worked: 0, diurnal: 0, nocturnal: 0, nocturnalFicta: 0, totalContract: 0 };
  let inM = timeToMin(inTime);
  let outM = timeToMin(outTime);
  // Handle overnight (e.g. 22:00 -> 06:00)
  if (outM <= inM) outM += 24 * 60;

  const totalPeriod = outM - inM;
  const bk = breakMin || 0;
  const worked = totalPeriod - bk;
  if (worked <= 0) return { worked: 0, diurnal: 0, nocturnal: 0, nocturnalFicta: 0, totalContract: 0, error: "Horário inválido" };

  // Count raw nocturnal minutes (22:00-05:00, CLT Art. 73)
  let noctRaw = 0;
  for (let t = inM; t < outM; t++) {
    const tMod = t % (24 * 60);
    if (tMod >= 22 * 60 || tMod < 5 * 60) noctRaw++;
  }
  const diurnRaw = totalPeriod - noctRaw;

  // Desconta intervalo das horas diurnas primeiro; se sobrar, desconta das noturnas
  let diurnAfterBreak, noctAfterBreak;
  if (bk <= diurnRaw) {
    diurnAfterBreak = diurnRaw - bk;
    noctAfterBreak = noctRaw;
  } else {
    diurnAfterBreak = 0;
    noctAfterBreak = noctRaw - (bk - diurnRaw);
  }

  // Hora ficta: 52min30s reais = 60min contratuais (CLT Art. 73 §1)
  const nocturnalFicta = Math.round(noctAfterBreak * (60 / 52.5));

  return {
    worked,
    diurnal: diurnAfterBreak,
    nocturnal: noctAfterBreak,
    nocturnalFicta,
    totalContract: diurnAfterBreak + nocturnalFicta,
  };
}

// Validate a full week schedule (CLT compliant)
function validateWeekSchedule(days) {
  const errors = [];
  const activeDays = Object.entries(days).filter(([,d]) => d && d.in && d.out);
  // ── Per day validations ──
  activeDays.forEach(([dayIdx, d]) => {
    const label = WEEK_DAYS_LABEL[parseInt(dayIdx)];
    const calc = calcDayHours(d.in, d.out, d.break || 0);
    if (calc.error) { errors.push(`${label}: ${calc.error}`); return; }

    // Jornada máxima: 10h contratuais/dia (Art. 59 CLT)
    if (calc.totalContract > 10 * 60) {
      errors.push(`${label}: jornada contratual de ${fmtHHMM(calc.totalContract)} ultrapassa o máximo de 10h (${fmtHHMM(calc.diurnal)} diurnas + ${fmtHHMM(calc.nocturnalFicta)} noturnas fictas).`);
    }

    // Intervalo intrajornada (Art. 71 CLT)
    const bk = d.break || 0;
    if (calc.worked > 6 * 60 && bk < 60) {
      errors.push(`${label}: jornada de ${fmtHHMM(calc.worked)} exige intervalo mínimo de 60 minutos (atual: ${bk}min). Art. 71 CLT.`);
    } else if (calc.worked > 4 * 60 && calc.worked <= 6 * 60 && bk < 15) {
      errors.push(`${label}: jornada de ${fmtHHMM(calc.worked)} exige intervalo mínimo de 15 minutos (atual: ${bk}min). Art. 71 §1 CLT.`);
    }
  });

  // ── Interjornada ≥ 11h (Art. 66 CLT) — com wrap-around (último→primeiro) ──
  const sorted = [...activeDays].sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
  for (let i = 0; i < sorted.length; i++) {
    const curIdx = parseInt(sorted[i][0]);
    const nxtI = (i + 1) % sorted.length;
    const nxtIdx = parseInt(sorted[nxtI][0]);
    const [, curD] = sorted[i];
    const [, nxtD] = sorted[nxtI];

    // Calendar days between (wrap around week)
    const daysBetween = nxtIdx > curIdx ? nxtIdx - curIdx : nxtIdx + 7 - curIdx;

    const curIn = timeToMin(curD.in);
    const curOut = timeToMin(curD.out);
    const nxtIn = timeToMin(nxtD.in);
    const isOvernight = curOut <= curIn;

    // Gap = (minutes remaining in day after out) + (full days between -1) * 1440 + nxtIn
    // For overnight shifts, out is actually next calendar morning
    let gap;
    if (isOvernight) {
      // Shift ends at curOut on the NEXT calendar day
      gap = (24 * 60 - curOut) + (daysBetween - 2) * 24 * 60 + nxtIn;
    } else {
      gap = (24 * 60 - curOut) + (daysBetween - 1) * 24 * 60 + nxtIn;
    }

    if (gap < 11 * 60) {
      errors.push(`Interjornada entre ${WEEK_DAYS_LABEL[curIdx]} e ${WEEK_DAYS_LABEL[nxtIdx]} é de ${fmtHHMM(gap)}, mínimo exigido é 11h. Art. 66 CLT.`);
    }
  }

  // ── DSR: mínimo 1 folga por semana (Art. 67 CLT) ──
  if (activeDays.length >= 7) {
    errors.push("Sem dia de folga na semana. O empregado deve ter pelo menos 1 descanso semanal remunerado. Art. 67 CLT.");
  }

  // ── Carga semanal: 43:55 a 44:00 (Art. 58 CLT + Art. 7 XIV CF) ──
  const totalContract = activeDays.reduce((sum, [,d]) => {
    const c = calcDayHours(d.in, d.out, d.break || 0);
    return sum + (c.totalContract || 0);
  }, 0);
  const MIN_WEEK = 43 * 60 + 55;
  const MAX_WEEK = 44 * 60;
  if (activeDays.length > 0 && (totalContract < MIN_WEEK || totalContract > MAX_WEEK)) {
    errors.push(`Carga semanal de ${fmtHHMM(totalContract)} fora do intervalo permitido (43:55 a 44:00).`);
  }

  return { errors, totalContract };
}

// ── Work Schedule Manager Tab ─────────────────────────────────────────────────
function WorkScheduleManagerTab({ restaurantId, employees, roles, workSchedules, notifications, managers, currentManagerName, onUpdate, communications, isOwner, mobileOnly }) {
  const ac = "var(--ac)";
  const restEmps = employees.filter(e => e.restaurantId === restaurantId && !e.inactive);

  // ── State ──
  const [selEmpId, setSelEmpId]             = useState(null);
  const [editDays, setEditDays]             = useState({});   // {dayIdx: {active:bool, in?, out?, break?}}
  const [errors, setErrors]                 = useState([]);
  const [showValidFrom, setShowValidFrom]   = useState(false);
  const [validFrom, setValidFrom]           = useState(today());
  const [selectedSchedIds, setSelectedSchedIds] = useState(new Set());
  const [, setSaveMode]                     = useState(null); // saveMode read elsewhere via effects
  const [validated, setValidated]           = useState(false); // true após validar horários com sucesso

  const selEmp = restEmps.find(e => e.id === selEmpId);
  const empSchedules = workSchedules?.[restaurantId]?.[selEmpId] ?? [];

  // ── Helpers: convert between internal format (with active flag) and storage format ──
  function toInternal(storedEntry) {
    const storedDays = storedEntry?.days;
    const out = {};
    for (let i = 0; i < 7; i++) {
      const d = storedDays?.[i];
      if (d && (d.in || d.out)) {
        out[i] = { active: true, in: d.in || "", out: d.out || "", break: d.break ?? 0 };
      } else if (d && d.active) {
        // days-only save: active but no hours
        out[i] = { active: true, in: "", out: "", break: 0 };
      } else if (storedDays && !d) {
        // missing from stored = folga
        out[i] = { active: false };
      } else {
        out[i] = { active: true }; // fresh default
      }
    }
    return out;
  }

  function toStorage(internalDays, daysOnly) {
    const out = {};
    Object.entries(internalDays).forEach(([idx, d]) => {
      if (d.active) {
        if (!daysOnly && d.in && d.out) {
          out[idx] = { in: d.in, out: d.out, break: d.break ?? 0 };
        } else {
          // days-only: store just active flag so we know it's a work day
          out[idx] = { active: true };
        }
      }
      // inactive days (folga) → not stored (absence = folga)
    });
    return out;
  }

  // ── Check if hours are filled for all active days ──
  function hasAllHours(days) {
    return Object.values(days).every(d => !d.active || (d.in && d.out));
  }


  // ── Load employee ──
  function loadEmp(empId) {
    setSelEmpId(empId);
    setErrors([]);
    setShowValidFrom(false);
    setSaveMode(null);
    setValidated(false);
    setCopyPickerOpen(false);
    const sched = (workSchedules?.[restaurantId]?.[empId] ?? []);
    const cur = sched[sched.length - 1];
    if (cur) {
      setEditDays(toInternal(cur));
    } else {
      // New employee: all days active, no hours
      const fresh = {};
      for (let i = 0; i < 7; i++) fresh[i] = { active: true };
      setEditDays(fresh);
    }
  }

  // ── Toggle work/folga ──
  function toggleDay(dayIdx) {
    setEditDays(prev => {
      const cur = prev[dayIdx] ?? { active: true };
      return { ...prev, [dayIdx]: cur.active ? { active: false } : { active: true, in: "", out: "", break: 0 } };
    });
    setErrors([]);
    setValidated(false);
  }

  // ── Update time/break field ──
  function handleDayChange(dayIdx, field, val) {
    setEditDays(prev => ({
      ...prev,
      [dayIdx]: { ...(prev[dayIdx] ?? { active: true }), [field]: val }
    }));
    setErrors([]);
    setValidated(false);
  }


  // ── "Validar Horários" (só valida, não salva) ──
  function tryValidateFull() {
    const activeDays = Object.values(editDays).filter(d => d.active);
    if (activeDays.length === 0) { setErrors(["Selecione pelo menos um dia de trabalho."]); setValidated(false); return; }
    if (!hasAllHours(editDays)) {
      setErrors(["Preencha os horarios de todos os dias marcados como trabalho para validar a carga semanal."]);
      setValidated(false);
      return;
    }
    // Freela: pula validação CLT
    if (selEmp?.isFreela) {
      setErrors([]);
      setValidated(true);
      onUpdate("_toast", "✅ Horário registrado (freela — sem validação CLT)");
      return;
    }
    const storageDays = toStorage(editDays, false);
    const { errors: errs } = validateWeekSchedule(storageDays);
    setErrors(errs);
    if (errs.length === 0) {
      setValidated(true);
      onUpdate("_toast", "✅ Horário validado — clique em Salvar para confirmar");
    } else {
      setValidated(false);
    }
  }

  // ── "Prosseguir para salvar" (abre modal de vigência — só após validar) ──
  function proceedToSave() {
    setSaveMode("full");
    setShowValidFrom(true);
  }

  // ── Save schedule ──
  function saveSchedule() {
    const storageDays = toStorage(editDays, false);

    // Freela: pula validação CLT (jornada, interjornada, carga semanal, etc.)
    const isFreela = selEmp?.isFreela;
    let totalContract = 0;
    if (!isFreela) {
      const { errors: errs, totalContract: tc } = validateWeekSchedule(storageDays);
      totalContract = tc;
      if (errs.length > 0) { setErrors(errs); return; }
    } else {
      // Calcula totalContract apenas para exibição, sem validar
      const activeDays = Object.entries(storageDays).filter(([,d]) => d && d.in && d.out);
      totalContract = activeDays.reduce((sum, [,d]) => {
        const c = calcDayHours(d.in, d.out, d.break || 0);
        return sum + (c.totalContract || 0);
      }, 0);
    }

    const newEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
      days: storageDays,
      validFrom,
      createdBy: currentManagerName,
      createdAt: new Date().toISOString(),
      totalContract,
      hoursComplete: true,
      ...(isFreela ? { freela: true } : {}),
    };

    onUpdate("workSchedules", prev => {
      const empScheds = [...(prev?.[restaurantId]?.[selEmpId] ?? []), newEntry];
      return { ...prev, [restaurantId]: { ...(prev?.[restaurantId] ?? {}), [selEmpId]: empScheds } };
    });

    // Format schedule description for notifications
    function fmtSchedLine(i) {
      const d = storageDays[i];
      if (!d) return `${WEEK_DAYS_LABEL[i]}: Folga`;
      if (d.in && d.out) return `${WEEK_DAYS_LABEL[i]}: ${d.in} - ${d.out} (intervalo ${d.break??0}min)`;
      return `${WEEK_DAYS_LABEL[i]}: Trabalha (horario a definir)`;
    }

    // Notify DP managers
    const dpMgrs = managers.filter(m => m.isDP && (m.restaurantIds ?? []).includes(restaurantId));
    if (dpMgrs.length > 0) {
      const body = `Horario alterado\n\nEmpregado: ${selEmp?.name}\nAlterado por: ${currentManagerName}\nVigencia a partir de: ${fmtDate(validFrom)}\n\nNovo horario:\n${[0,1,2,3,4,5,6].map(fmtSchedLine).join("\n")}`;
      const notif = {
        id: `${Date.now()}-notif-${Math.random().toString(36).slice(2,5)}`,
        restaurantId, type: "horario", body,
        date: new Date().toISOString(), read: false, targetRole: "dp",
      };
      onUpdate("notifications", [...(notifications ?? []), notif]);
    }

    // Comunicado for employee
    const schedBody = `Seu horario de trabalho foi atualizado por ${currentManagerName}.\nVigencia a partir de: ${fmtDate(validFrom)}\n\nNovo horario:\n${[0,1,2,3,4,5,6].map(fmtSchedLine).join("\n")}`;
    const commForEmp = {
      id: `${Date.now()}-comm-${Math.random().toString(36).slice(2,5)}`,
      restaurantId,
      title: `Novo horario - vigencia ${fmtDate(validFrom)}`,
      body: schedBody,
      createdAt: new Date().toISOString(),
      createdBy: currentManagerName,
      target: `emp:${selEmpId}`,
      autoSchedule: true,
    };
    onUpdate("communications", [...(communications ?? []), commForEmp]);

    setShowValidFrom(false);
    setSaveMode(null);
    setValidated(false);
    setErrors([]);
    onUpdate("_toast", `Horario de ${selEmp?.name} salvo com vigencia a partir de ${fmtDate(validFrom)}`);
  }

  // ── Calculated values ──
  const activeDayCount = Object.values(editDays).filter(d => d.active).length;
  const folgaDayCount = 7 - activeDayCount;
  const allHoursFilled = hasAllHours(editDays);
  const storageDaysCalc = allHoursFilled && activeDayCount > 0 ? toStorage(editDays, false) : {};
  const { totalContract } = allHoursFilled && activeDayCount > 0 ? validateWeekSchedule(storageDaysCalc) : { totalContract: 0 };
  const MIN_WEEK = 43*60+55, MAX_WEEK = 44*60;
  const isEmpFreela = selEmp?.isFreela;
  const weekOk = allHoursFilled && activeDayCount > 0 && (isEmpFreela || (totalContract >= MIN_WEEK && totalContract <= MAX_WEEK));

  // ── IA Assistant state ──
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiResult, setAiResult] = useState(null); // { days: {}, message: "" }
  const [aiLoading, setAiLoading] = useState(false);

  // ── Copy from another employee ──
  const [copyPickerOpen, setCopyPickerOpen] = useState(false);
  // Empregados que têm horário cadastrado (exceto o atual)
  const empsWithSched = restEmps.filter(e => e.id !== selEmpId && (workSchedules?.[restaurantId]?.[e.id]?.length ?? 0) > 0);

  function copyFromEmployee(srcEmpId) {
    const srcScheds = workSchedules?.[restaurantId]?.[srcEmpId] ?? [];
    const src = srcScheds[srcScheds.length - 1];
    if (!src) { onUpdate("_toast","⚠️ Empregado de origem sem horário cadastrado"); return; }
    setEditDays(toInternal(src));
    setErrors([]);
    setCopyPickerOpen(false);
    const srcEmp = restEmps.find(e => e.id === srcEmpId);
    onUpdate("_toast", `📋 Horário copiado de ${srcEmp?.name ?? "outro empregado"}`);
  }

  function parseAiCommand(text) {
    const DIAS_FULL = [
      {names:["dom","domingo"], idx:0}, {names:["seg","segunda"], idx:1},
      {names:["ter","terca","terça"], idx:2}, {names:["qua","quarta"], idx:3},
      {names:["qui","quinta"], idx:4}, {names:["sex","sexta"], idx:5},
      {names:["sab","sabado","sábado"], idx:6},
    ];
    const normText = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g," ").trim();
    // Normaliza: lowercase, remove acentos, normaliza espaços
    const lower = normText(text);
    const newDays = JSON.parse(JSON.stringify(editDays));
    const changes = [];

    // Helper: extrai indices de dias de um trecho (sem duplicar)
    function extractDays(txt) {
      const found = new Set();
      const rangeMatch = txt.match(/(\w+)\s+a\s+(\w+)/);
      if (rangeMatch) {
        const fromD = DIAS_FULL.find(d => d.names.some(n => rangeMatch[1].includes(n)));
        const toD = DIAS_FULL.find(d => d.names.some(n => rangeMatch[2].includes(n)));
        if (fromD && toD) {
          for (let i = fromD.idx; i !== (toD.idx + 1) % 7; i = (i + 1) % 7) found.add(i);
          return [...found];
        }
      }
      DIAS_FULL.forEach(d => {
        const sorted = [...d.names].sort((a,b)=>b.length-a.length);
        for (const n of sorted) { if (txt.includes(n)) { found.add(d.idx); break; } }
      });
      return [...found];
    }

    // Helper: formata hora "HH:MM" a partir de captura (h, m opcional); aceita "24" como "00:00" (fim de jornada)
    function fmtTime(h, m) {
      const hi = parseInt(h);
      if (isNaN(hi)) return null;
      const mi = m ? String(parseInt(m)).padStart(2,"0") : "00";
      if (hi === 24) return "00:00"; // cruza meia-noite, calcDayHours lida
      if (hi < 0 || hi > 23) return null;
      return `${String(hi).padStart(2,"0")}:${mi}`;
    }

    // ═══ 0. MODO MULTI-GRUPO ═══
    // Detecta listas como:
    //   "Quarta e Quinta: das 15h às 24h com 1h de intervalo"
    //   "Sexta e Sábado: das 12:20h às 24h com 2h de intervalo"
    //   "Domingo: das 11h às 19:30h com 1h de intervalo"
    // Separadores suportados: linha nova, •, ·, ;, - inicial
    const rawSegs = text.split(/[\n•·;]|(?:^\s*[-*]\s)/m).map(s => s.trim()).filter(s => s.length > 2);
    const groupSegs = rawSegs.map(seg => {
      const segLow = normText(seg);
      const dayIds = extractDays(segLow);
      // Precisa ter pelo menos um dia E algum horário (d{1,2}h ou d{1,2}:d{1,2})
      const hasTime = /\b\d{1,2}\s*[:.h]/.test(segLow) || /das?\s+\d/.test(segLow);
      return { seg, segLow, dayIds, hasTime };
    }).filter(g => g.dayIds.length > 0 && g.hasTime);

    if (groupSegs.length >= 2) {
      const mentioned = new Set();
      groupSegs.forEach(({ seg, segLow, dayIds }) => {
        // "das 15h às 24h", "das 12:20 às 24h", "12:20 às 24:00", "das 11h as 19h30"
        const rangeMatch = segLow.match(/(?:das?\s+)?(\d{1,2})\s*[:.h]?\s*(\d{2})?\s*(?:h\s*)?(?:as?|até|ate|a)\s+(\d{1,2})\s*[:.h]?\s*(\d{2})?/);
        let inTime = null, outTime = null;
        if (rangeMatch) {
          inTime = fmtTime(rangeMatch[1], rangeMatch[2]);
          outTime = fmtTime(rangeMatch[3], rangeMatch[4]);
        } else {
          const entM = segLow.match(/(?:entra(?:da|ndo)?|inicia\w*)\s*(?:as?\s*)?(\d{1,2})\s*[:.h]?\s*(\d{2})?/);
          const saiM = segLow.match(/(?:sai(?:da|ndo)?|termin\w*)\s*(?:as?\s*)?(\d{1,2})\s*[:.h]?\s*(\d{2})?/);
          if (entM) inTime = fmtTime(entM[1], entM[2]);
          if (saiM) outTime = fmtTime(saiM[1], saiM[2]);
        }
        // Intervalo: "1h de intervalo", "2h de intervalo", "30 min de intervalo", "intervalo 60min", "com 1h"
        let breakMin = null;
        const intHoraM = segLow.match(/(\d+)\s*h(?:ora)?s?\s*(?:de\s+)?intervalo|(?:com\s+)?intervalo\s*(?:de\s+)?(\d+)\s*h(?:ora)?s?/);
        const intMinM = segLow.match(/(\d+)\s*(?:min|minutos?)\s*(?:de\s+)?intervalo|intervalo\s*(?:de\s+)?(\d+)\s*(?:min|minutos?)/);
        if (intHoraM) breakMin = parseInt(intHoraM[1] || intHoraM[2]) * 60;
        else if (intMinM) breakMin = parseInt(intMinM[1] || intMinM[2]);

        dayIds.forEach(idx => {
          mentioned.add(idx);
          newDays[idx] = {
            active: true,
            in: inTime || newDays[idx]?.in || "",
            out: outTime || newDays[idx]?.out || "",
            break: breakMin != null ? breakMin : (newDays[idx]?.break || 0),
          };
        });
        const label = dayIds.sort().map(i => WEEK_DAYS_LABEL[i]).join("/");
        const parts = [];
        if (inTime && outTime) parts.push(`${inTime}-${outTime}`);
        else { if (inTime) parts.push(`ent ${inTime}`); if (outTime) parts.push(`sai ${outTime}`); }
        if (breakMin != null) parts.push(`int ${breakMin}min`);
        changes.push(`${label}: ${parts.join(", ") || "(sem horário)"}`);
      });
      // Dias não mencionados em nenhum grupo = folga
      for (let i = 0; i < 7; i++) {
        if (!mentioned.has(i)) {
          newDays[i] = { active: false };
          changes.push(`${WEEK_DAYS_LABEL[i]}: Folga`);
        }
      }
      // Validação CLT
      const warnings = [];
      const activeDays = Object.values(newDays).filter(d => d.active);
      if (activeDays.length === 0) warnings.push("Nenhum dia de trabalho definido.");
      if (activeDays.length > 6) warnings.push("Mais de 6 dias pode violar a CLT.");
      const allHaveHours = activeDays.every(d => d.in && d.out);
      if (allHaveHours && activeDays.length > 0) {
        const stDays = {};
        Object.entries(newDays).forEach(([idx, d]) => { if (d.active && d.in && d.out) stDays[idx] = { in:d.in, out:d.out, break:d.break??0 }; });
        const { errors: errs, totalContract: tc } = validateWeekSchedule(stDays);
        if (tc > 0) changes.push(`Carga semanal: ${fmtHHMM(tc)}`);
        errs.forEach(e => warnings.push(e));
      }
      return { days: newDays, message: changes.join("\n"), warnings };
    }

    // ═══ 1. Parse carga horária semanal ═══
    // Aceita: "divida/dividindo/divide 44h", "44 horas semanais", "44 semanis", "44h semanais"
    const cargaMatch = lower.match(/(?:divid\w*\s+(?:as?\s+)?)?(\d{2,3})\s*(?:h(?:oras?)?|hrs?)?\s*semana\w*/);
    let cargaSemanalMin = 0;
    let numDiasTrab = 0;
    if (cargaMatch) {
      cargaSemanalMin = parseInt(cargaMatch[1]) * 60;
    }
    // "em X dias"
    const emDiasMatch = lower.match(/em\s+(\d)\s*dias/);
    if (emDiasMatch) numDiasTrab = parseInt(emDiasMatch[1]);

    // ═══ 2. Parse folga ═══
    // Aceita: folga/folgue/folgando/folgar/folgou + dias
    const folgaDays = new Set();
    const folgaMatch = lower.match(/folg\w*\s+(?:esse\s+empregado\s+|para\s+(?:ele\s+)?|(?:nos?\s+)?(?:dias?\s+)?(?:de?\s+)?)?(.+?)(?:\s+e\s+trabalh|\s+(?:divid|entrand|entrad|horari|interval|escala)\w*|\s*[,.]|$)/);
    if (folgaMatch) {
      extractDays(folgaMatch[1]).forEach(idx => {
        folgaDays.add(idx);
        newDays[idx] = { active: false };
        changes.push(`${WEEK_DAYS_LABEL[idx]}: Folga`);
      });
    }

    // ═══ 3. Parse "trabalha/trabalhe nos outros dias" ═══
    const trabOutros = /trabalh\w*\s+(?:n[oa]s?\s+)?outr\w*\s+dias?/.test(lower);
    if (trabOutros) {
      for (let i = 0; i < 7; i++) {
        if (!folgaDays.has(i)) {
          newDays[i] = { active: true, in: newDays[i]?.in||"", out: newDays[i]?.out||"", break: newDays[i]?.break||0 };
        }
      }
      changes.push(`Trabalha: ${7 - folgaDays.size} dias`);
    } else {
      // Parse dias específicos de trabalho
      const trabMatch = lower.match(/trabalh\w*\s+(?:n[oa]s?\s+)?(?:dias?\s+)?(.+?)(?:\s+(?:folg|divid|entrand|entrad|horari|interval|escala)\w*|\s*[,.]|$)/);
      if (trabMatch && !trabOutros) {
        extractDays(trabMatch[1]).forEach(idx => {
          if (!folgaDays.has(idx)) {
            newDays[idx] = { active: true, in: newDays[idx]?.in||"", out: newDays[idx]?.out||"", break: newDays[idx]?.break||0 };
            changes.push(`${WEEK_DAYS_LABEL[idx]}: Trabalha`);
          }
        });
      }
    }

    // ═══ 4. Parse "escala 6x1" ═══
    const escalaMatch = lower.match(/escala\s+(\d)x(\d)/);
    if (escalaMatch) {
      const trab = parseInt(escalaMatch[1]), folg = parseInt(escalaMatch[2]);
      let count = 0;
      for (let i = 1; i <= 6; i++) {
        if (count < trab) { newDays[i] = { active: true, in: newDays[i]?.in||"", out: newDays[i]?.out||"", break: newDays[i]?.break||0 }; count++; }
        else { newDays[i] = { active: false }; folgaDays.add(i); }
      }
      newDays[0] = { active: false }; folgaDays.add(0);
      changes.push(`Escala ${trab}x${folg}: ${trab} dias trabalho, ${folg} folga (dom folga)`);
    }

    // ═══ 5. Se carga horária + folgas, inferir dias de trabalho ═══
    if (cargaSemanalMin > 0 && folgaDays.size > 0 && numDiasTrab === 0) {
      numDiasTrab = 7 - folgaDays.size;
    }
    if (cargaSemanalMin > 0 && numDiasTrab > 0) {
      const trabIds = [];
      for (let i = 0; i < 7; i++) {
        if (!folgaDays.has(i) && trabIds.length < numDiasTrab) {
          trabIds.push(i);
          newDays[i] = { active: true, in: newDays[i]?.in||"", out: newDays[i]?.out||"", break: newDays[i]?.break||0 };
        } else if (!folgaDays.has(i)) {
          newDays[i] = { active: false }; folgaDays.add(i);
          changes.push(`${WEEK_DAYS_LABEL[i]}: Folga (excedente)`);
        }
      }
      changes.push(`Carga: ${Math.round(cargaSemanalMin/60)}h semanais em ${numDiasTrab} dias`);
    }

    // ═══ 6. Parse horários ═══
    // Aceita: entra/entrada/entrando + as/a/s + hora
    // Também "horario de entrada as 10", "entrandoa s 10"
    const entradaMatch = lower.match(/(?:entrand\w*\s*a?\s*s?\s*|entra(?:da)?\s*(?:as?\s*)?|horario\s+de\s+entrada\s*(?:as?\s*)?)(\d{1,2})\s*[:.h]?\s*(\d{2})?/);
    const saidaMatch = lower.match(/(?:saind\w*\s*a?\s*s?\s*|sa[ii](?:da)?\s*(?:as?\s*)?|horario\s+de\s+saida\s*(?:as?\s*)?)(\d{1,2})\s*[:.h]?\s*(\d{2})?/);
    const intervaloMatch = lower.match(/intervalo\s*(?:de\s+)?(\d+)\s*(?:min|minutos?|h|hora)/);

    const entH = entradaMatch ? `${String(parseInt(entradaMatch[1])).padStart(2,"0")}:${entradaMatch[2]||"00"}` : null;
    const saiH = saidaMatch ? `${String(parseInt(saidaMatch[1])).padStart(2,"0")}:${saidaMatch[2]||"00"}` : null;
    const breakMin = intervaloMatch ? parseInt(intervaloMatch[1]) * (intervaloMatch[0].includes("h")?60:1) : null;

    // ═══ 7. Se tem carga + entrada (sem saída), calcular saída ═══
    let calcSaiH = saiH;
    if (cargaSemanalMin > 0 && entH && !saiH && numDiasTrab > 0) {
      const dailyMin = Math.round(cargaSemanalMin / numDiasTrab);
      const bk = breakMin ?? 60;
      const totalMin = dailyMin + bk;
      const entMin = parseInt(entH.split(":")[0]) * 60 + parseInt(entH.split(":")[1]);
      const saiMin = entMin + totalMin;
      calcSaiH = `${String(Math.floor(saiMin / 60) % 24).padStart(2,"0")}:${String(saiMin % 60).padStart(2,"0")}`;
      const jornH = Math.floor(dailyMin / 60);
      const jornM = dailyMin % 60;
      changes.push(`Jornada: ${jornH}h${jornM > 0 ? String(jornM).padStart(2,"0") + "min" : ""}/dia`);
      changes.push(`Entrada: ${entH} → Saída: ${calcSaiH} (intervalo ${bk}min)`);
    } else {
      if (entH) changes.push(`Entrada: ${entH}`);
      if (saiH) changes.push(`Saída: ${saiH}`);
    }
    if (breakMin !== null && !(cargaSemanalMin > 0 && entH && !saiH)) changes.push(`Intervalo: ${breakMin}min`);

    // Apply horários aos dias ativos
    const finalEnt = entH;
    const finalSai = calcSaiH || saiH;
    const finalBreak = breakMin ?? (cargaSemanalMin > 0 && entH && !saiH ? 60 : null);
    if (finalEnt || finalSai || finalBreak !== null) {
      const targetDays = [0,1,2,3,4,5,6].filter(i => newDays[i]?.active);
      targetDays.forEach(idx => {
        if (finalEnt) newDays[idx] = { ...newDays[idx], in: finalEnt };
        if (finalSai) newDays[idx] = { ...newDays[idx], out: finalSai };
        if (finalBreak !== null) newDays[idx] = { ...newDays[idx], break: finalBreak };
      });
    }

    // ═══ 8. Validação CLT ═══
    const warnings = [];
    const activeDays = Object.values(newDays).filter(d => d.active);
    if (activeDays.length === 0) warnings.push("Nenhum dia de trabalho definido.");
    if (activeDays.length > 6) warnings.push("Mais de 6 dias de trabalho pode violar a CLT.");

    const allHaveHours = activeDays.every(d => d.in && d.out);
    if (allHaveHours && activeDays.length > 0) {
      const stDays = {};
      Object.entries(newDays).forEach(([idx, d]) => { if (d.active && d.in && d.out) stDays[idx] = { in:d.in, out:d.out, break:d.break??0 }; });
      const { errors: errs, totalContract: tc } = validateWeekSchedule(stDays);
      if (tc > 0) changes.push(`Carga semanal: ${fmtHHMM(tc)}`);
      errs.forEach(e => warnings.push(e));
    }

    if (changes.length === 0) return { days: null, message: "Não consegui entender. Tente algo como:\n• \"folga segunda e terça, entrada 10:00\"\n• \"entra 08:00 sai 17:00 intervalo 60min\"\n• \"escala 6x1\"\n• \"folgue seg e ter, trabalhe nos outros dias, 44h semanais entrando as 10\"", warnings: [] };
    return { days: newDays, message: changes.join("\n"), warnings };
  }

  function handleAiSubmit() {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setTimeout(() => {
      const result = parseAiCommand(aiPrompt);
      setAiResult(result);
      setAiLoading(false);
    }, 300);
  }

  function applyAiSuggestion() {
    if (aiResult?.days) {
      setEditDays(aiResult.days);
      setErrors([]);
      setAiResult(null);
      setAiPrompt("");
      setAiOpen(false);
    }
  }

  // ── Styles ──
  const cardS = { ...S.card, marginBottom: mobileOnly ? 8 : 12, padding: mobileOnly ? "10px 12px" : undefined };
  const toggleOn = { width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", position: "relative", background: "var(--ac)", transition: "background .2s" };
  const toggleOff = { ...toggleOn, background: "var(--border)" };
  const toggleDot = (on) => ({ position: "absolute", top: 2, left: on ? 22 : 2, width: 20, height: 20, borderRadius: 10, background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,.2)" });

  // ═══ LIST VIEW (employee selection) — grouped by area ═══
  if (!selEmpId) {
    const restRoles = roles?.filter(r => r.restaurantId === restaurantId) ?? [];
    const byArea = {}; AREAS.forEach(a => { byArea[a] = []; });
    const noArea = [];
    restEmps.forEach(emp => {
      const role = restRoles.find(r => r.id === emp.roleId);
      const a = role?.area;
      if (a && byArea[a]) byArea[a].push(emp);
      else noArea.push(emp);
    });

    const renderEmpCard = (emp) => {
      const sched = workSchedules?.[restaurantId]?.[emp.id] ?? [];
      const cur = sched[sched.length - 1];
      const hasHoursComplete = cur?.hoursComplete !== false;
      const workDays = cur ? Object.keys(cur.days).length : 0;
      const folgaDays = cur ? 7 - workDays : 0;
      const role = restRoles.find(r => r.id === emp.roleId);
      const areaColor = role?.area ? AREA_COLORS[role.area] : "var(--text3)";
      const initial = emp.name?.trim()?.[0]?.toUpperCase() ?? "?";

      // Status compacto (lado direito)
      let statusBadge = null;
      if (!cur) {
        statusBadge = <span style={{background:"var(--bg1)",color:"var(--text3)",fontSize:mobileOnly?10:11,padding:mobileOnly?"3px 8px":"5px 12px",borderRadius:8,fontWeight:600,border:"1px solid var(--border)"}}>Sem horário</span>;
      } else if (!hasHoursComplete) {
        statusBadge = <span style={{background:"#f59e0b18",color:"#b45309",fontSize:mobileOnly?10:11,padding:mobileOnly?"3px 8px":"5px 12px",borderRadius:8,fontWeight:700,border:"1px solid #f59e0b33"}}>⏳ {mobileOnly?"Pendente":"Horários pendentes"}</span>;
      } else {
        statusBadge = <span style={{background:"#10b98118",color:"#047857",fontSize:mobileOnly?10:11,padding:mobileOnly?"3px 8px":"5px 12px",borderRadius:8,fontWeight:700,border:"1px solid #10b98133",fontFamily:"'DM Mono',monospace"}}>{fmtHHMM(cur.totalContract)}/sem</span>;
      }

      if (mobileOnly) {
        // Mobile: layout compacto existente
        return (
          <div key={emp.id} onClick={()=>loadEmp(emp.id)} style={{...S.card,marginBottom:6,padding:"8px 10px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{color:"var(--text)",fontWeight:600,fontSize:13,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                {emp.name}
                {cur && !hasHoursComplete && <span style={{background:"#f59e0b22",color:"#f59e0b",fontSize:9,padding:"2px 6px",borderRadius:6,fontWeight:700}}>PENDENTE</span>}
              </div>
              <div style={{color:"var(--text3)",fontSize:10}}>
                {cur
                  ? (hasHoursComplete ? `${fmtHHMM(cur.totalContract)}/sem` : `${workDays} dias, ${folgaDays} folga(s)`)
                  : "Sem horario"}
              </div>
            </div>
            <span style={{color:ac,fontSize:16,fontWeight:700,flexShrink:0,paddingLeft:6}}>&rsaquo;</span>
          </div>
        );
      }

      // Desktop: layout espaçoso com avatar, grid, status e seta
      return (
        <div key={emp.id} onClick={()=>loadEmp(emp.id)} onMouseEnter={e=>e.currentTarget.style.borderColor="var(--ac)66"} onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}
          style={{...S.card,marginBottom:10,padding:"16px 20px",cursor:"pointer",display:"grid",gridTemplateColumns:"48px 1fr auto 20px",gap:16,alignItems:"center",transition:"border-color .15s"}}>
          {/* Avatar com inicial */}
          <div style={{width:48,height:48,borderRadius:12,background:`${areaColor}15`,border:`2px solid ${areaColor}33`,display:"flex",alignItems:"center",justifyContent:"center",color:areaColor,fontWeight:800,fontSize:18,letterSpacing:-0.5}}>
            {initial}
          </div>
          {/* Nome + cargo + vigência */}
          <div style={{minWidth:0}}>
            <div style={{color:"var(--text)",fontWeight:700,fontSize:15,marginBottom:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{emp.name}</div>
            <div style={{color:"var(--text3)",fontSize:12,display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
              {role && <span>{role.name}</span>}
              {cur && hasHoursComplete && <span>· Vigente desde {fmtDate(cur.validFrom)}</span>}
              {cur && !hasHoursComplete && <span>· {workDays} dias de trabalho</span>}
            </div>
          </div>
          {/* Status badge */}
          <div style={{flexShrink:0}}>{statusBadge}</div>
          {/* Seta */}
          <span style={{color:"var(--text3)",fontSize:18,fontWeight:600,textAlign:"right"}}>›</span>
        </div>
      );
    };

    return (
      <div>
        <p style={{color:"var(--text3)",fontSize:mobileOnly?11:14,marginBottom:mobileOnly?10:20}}>
          Selecione um empregado para cadastrar ou editar o horário de trabalho:
        </p>
        {AREAS.map(area => {
          const emps = byArea[area];
          if (emps.length === 0) return null;
          return (
            <div key={area} style={{marginBottom:mobileOnly?16:24}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:mobileOnly?8:12,paddingBottom:mobileOnly?4:6,borderBottom:`2px solid ${AREA_COLORS[area]}33`}}>
                <span style={{width:mobileOnly?8:10,height:mobileOnly?8:10,borderRadius:"50%",background:AREA_COLORS[area],display:"inline-block"}}></span>
                <span style={{color:AREA_COLORS[area],fontSize:mobileOnly?12:13,fontWeight:700,letterSpacing:1}}>{area.toUpperCase()}</span>
                <span style={{color:"var(--text3)",fontSize:mobileOnly?11:12,marginLeft:4}}>({emps.length})</span>
              </div>
              {emps.map(renderEmpCard)}
            </div>
          );
        })}
        {noArea.length > 0 && (
          <div style={{marginBottom:mobileOnly?16:24}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:mobileOnly?8:12,paddingBottom:mobileOnly?4:6,borderBottom:"2px solid var(--border)"}}>
              <span style={{color:"var(--text3)",fontSize:mobileOnly?12:13,fontWeight:700,letterSpacing:1}}>SEM ÁREA</span>
              <span style={{color:"var(--text3)",fontSize:mobileOnly?11:12,marginLeft:4}}>({noArea.length})</span>
            </div>
            {noArea.map(renderEmpCard)}
          </div>
        )}
      </div>
    );
  }

  // ═══ EDIT VIEW (single employee) ═══
  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",gap:mobileOnly?6:10,marginBottom:mobileOnly?10:16,flexWrap:"wrap"}}>
        <button onClick={()=>{setSelEmpId(null);setErrors([]);setShowValidFrom(false);setSaveMode(null);setValidated(false);}} style={{...S.btnSecondary,fontSize:mobileOnly?11:12,padding:mobileOnly?"5px 10px":"6px 14px"}}>← Voltar</button>
        <div style={{flex:1,minWidth:0}}>
          <div style={{color:"var(--text)",fontWeight:700,fontSize:mobileOnly?14:15}}>{selEmp?.name}</div>
          <div style={{color:"var(--text3)",fontSize:mobileOnly?10:11}}>{mobileOnly?`${activeDayCount} dias · ${folgaDayCount} folga(s)`:`Horario semanal · ${activeDayCount} dias · ${folgaDayCount} folga(s)`}</div>
        </div>
        {empSchedules.length > 0 && (
          <button onClick={()=>{
            if (!window.confirm(`Resetar o horário de ${selEmp?.name}?\n\nTodas as versões (${empSchedules.length}) serão apagadas permanentemente. O empregado ficará sem horário cadastrado.`)) return;
            onUpdate("workSchedules", prev => {
              const w = { ...(prev ?? {}) };
              if (w[restaurantId]) {
                const emp = { ...w[restaurantId] };
                delete emp[selEmpId];
                w[restaurantId] = emp;
              }
              return w;
            });
            // Reset edit state
            const fresh = {};
            for (let i = 0; i < 7; i++) fresh[i] = { active: true };
            setEditDays(fresh);
            setErrors([]);
            setShowValidFrom(false);
            setSaveMode(null);
            onUpdate("_toast", `🔄 Horário de ${selEmp?.name} resetado`);
          }} style={{...S.btnSecondary,fontSize:mobileOnly?11:12,padding:mobileOnly?"5px 10px":"6px 14px",color:"var(--red)",borderColor:"var(--red)44"}}>
            🔄 {mobileOnly?"Resetar":"Resetar horário"}
          </button>
        )}
      </div>

      {/* History */}
      {empSchedules.length > 1 && (
        <details style={{marginBottom:12}}>
          <summary style={{color:"var(--text3)",fontSize:12,cursor:"pointer",padding:"8px 12px",background:"var(--bg1)",borderRadius:8}}>
            Historico ({empSchedules.length} versoes)
          </summary>
          <div style={{paddingTop:8}}>
            {isOwner && (
              <div style={{padding:"6px 12px 10px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <span style={{color:"var(--text3)",fontSize:11}}>Selecione versoes para apagar:</span>
                {selectedSchedIds.size > 0 && (
                  <button onClick={()=>{
                    if(!window.confirm(`Apagar ${selectedSchedIds.size} versao(oes)?`)) return;
                    onUpdate("workSchedules", prev => {
                      const remaining = (prev?.[restaurantId]?.[selEmpId] ?? []).filter(s => !selectedSchedIds.has(s.id));
                      return { ...prev, [restaurantId]: { ...(prev?.[restaurantId]??{}), [selEmpId]: remaining } };
                    });
                    setSelectedSchedIds(new Set());
                    onUpdate("_toast", `${selectedSchedIds.size} versao(oes) apagada(s)`);
                  }} style={{padding:"5px 12px",borderRadius:8,border:"none",background:"var(--red)",color:"#fff",fontWeight:700,cursor:"pointer",fontSize:11}}>
                    Apagar ({selectedSchedIds.size})
                  </button>
                )}
              </div>
            )}
            {[...empSchedules].reverse().slice(1).map(s => (
              <div key={s.id} style={{padding:"8px 12px",borderBottom:"1px solid var(--border)",fontSize:12,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                {isOwner && (
                  <input type="checkbox" checked={selectedSchedIds.has(s.id)}
                    onChange={e=>{ const next = new Set(selectedSchedIds); e.target.checked ? next.add(s.id) : next.delete(s.id); setSelectedSchedIds(next); }}
                    style={{accentColor:"var(--red)",cursor:"pointer",width:14,height:14}}
                  />
                )}
                <span style={{color:"var(--text2)",flex:1,minWidth:140}}>Vigente de {fmtDate(s.validFrom)}</span>
                <span style={{color:"var(--text3)"}}>por {s.createdBy}</span>
                <span style={{color:"var(--text3)"}}>{s.hoursComplete !== false ? `${fmtHHMM(s.totalContract)}/sem` : "dias apenas"}</span>
                <button onClick={()=>{
                  if(!window.confirm(`Reativar esta versão do horário?\n\nOs dias e horários dessa versão serão copiados como nova vigência (a mais recente fica preservada no histórico).`)) return;
                  // Cria uma nova entrada baseada nessa versão antiga, como a mais recente
                  const reactivated = {
                    ...s,
                    id: `${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
                    validFrom: today(),
                    createdBy: currentManagerName,
                    createdAt: new Date().toISOString(),
                    reactivatedFrom: s.id,
                  };
                  onUpdate("workSchedules", prev => {
                    const newList = [...(prev?.[restaurantId]?.[selEmpId] ?? []), reactivated];
                    return { ...prev, [restaurantId]: { ...(prev?.[restaurantId]??{}), [selEmpId]: newList } };
                  });
                  // Carrega a versão reativada no editor
                  setEditDays(toInternal(reactivated));
                  onUpdate("_toast", `♻️ Horário de ${fmtDate(s.validFrom)} reativado como vigência a partir de hoje`);
                }} title="Copiar esta versão como nova vigência" style={{padding:"4px 10px",borderRadius:6,border:"1px solid var(--ac)44",background:"transparent",color:"var(--ac-text)",cursor:"pointer",fontSize:11,fontWeight:600}}>♻️ Reativar</button>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ═══ COPY FROM ANOTHER EMPLOYEE ═══ */}
      {empsWithSched.length > 0 && (
        <div style={{...S.card,marginBottom:mobileOnly?8:14,padding:mobileOnly?"12px 14px":"18px 22px",border:copyPickerOpen?"2px solid #06b6d444":"1px solid var(--border)",background:copyPickerOpen?"#06b6d408":"var(--card-bg)"}}>
          <div onClick={()=>setCopyPickerOpen(!copyPickerOpen)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",gap:12}}>
            <div style={{display:"flex",alignItems:"center",gap:mobileOnly?10:14}}>
              <span style={{fontSize:mobileOnly?18:22,lineHeight:1}}>📋</span>
              <div>
                <div style={{color:"#06b6d4",fontWeight:700,fontSize:mobileOnly?13:15,letterSpacing:-0.2}}>Copiar horário de outro empregado</div>
                {!mobileOnly && <div style={{color:"var(--text3)",fontSize:12,marginTop:2}}>Traga os dias e horários de um colega como ponto de partida</div>}
              </div>
            </div>
            <span style={{color:"var(--text3)",fontSize:14,flexShrink:0}}>{copyPickerOpen?"▲":"▼"}</span>
          </div>
          {copyPickerOpen && (
            <div style={{marginTop:mobileOnly?12:16,paddingTop:mobileOnly?12:16,borderTop:"1px solid var(--border)"}}>
              <p style={{color:"var(--text3)",fontSize:mobileOnly?11:12,margin:"0 0 12px",lineHeight:1.6}}>
                Seleciona um empregado — os dias e horários serão copiados para edição (nada é salvo automaticamente).
              </p>
              <select defaultValue="" onChange={e=>{ if(e.target.value) copyFromEmployee(e.target.value); e.target.value=""; }}
                style={{...S.input,width:"100%",fontSize:mobileOnly?13:14,padding:mobileOnly?undefined:"12px 14px",cursor:"pointer"}}>
                <option value="" disabled>Selecionar empregado...</option>
                {(() => {
                  const restRoles = roles?.filter(r => r.restaurantId === restaurantId) ?? [];
                  const byArea = {};
                  AREAS.forEach(a => { byArea[a] = []; });
                  const noArea = [];
                  empsWithSched.forEach(emp => {
                    const role = restRoles.find(r => r.id === emp.roleId);
                    const a = role?.area;
                    if (a && byArea[a]) byArea[a].push({ emp, role });
                    else noArea.push({ emp, role });
                  });
                  const fmtOpt = ({emp, role}) => {
                    const scheds = workSchedules?.[restaurantId]?.[emp.id] ?? [];
                    const cur = scheds[scheds.length - 1];
                    const hasHoursComplete = cur?.hoursComplete !== false;
                    const workDays = cur ? Object.keys(cur.days).length : 0;
                    const suf = hasHoursComplete && cur?.totalContract
                      ? ` — ${fmtHHMM(cur.totalContract)}/sem`
                      : ` — ${workDays} dias (pendente)`;
                    return <option key={emp.id} value={emp.id}>{emp.name}{role ? ` (${role.name})` : ""}{suf}</option>;
                  };
                  const groups = [];
                  AREAS.forEach(area => {
                    const list = byArea[area];
                    if (list.length === 0) return;
                    groups.push(<optgroup key={area} label={area}>{list.sort((a,b)=>a.emp.name.localeCompare(b.emp.name)).map(fmtOpt)}</optgroup>);
                  });
                  if (noArea.length > 0) {
                    groups.push(<optgroup key="sem" label="Sem área">{noArea.sort((a,b)=>a.emp.name.localeCompare(b.emp.name)).map(fmtOpt)}</optgroup>);
                  }
                  return groups;
                })()}
              </select>
            </div>
          )}
        </div>
      )}

      {/* ═══ AI ASSISTANT ═══ */}
      <div style={{...S.card,marginBottom:mobileOnly?8:14,padding:mobileOnly?"12px 14px":"18px 22px",border:aiOpen?"2px solid #8b5cf644":"1px solid var(--border)",background:aiOpen?"#8b5cf608":"var(--card-bg)"}}>
        <div onClick={()=>setAiOpen(!aiOpen)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer",gap:12}}>
          <div style={{display:"flex",alignItems:"center",gap:mobileOnly?10:14}}>
            <span style={{fontSize:mobileOnly?18:22,lineHeight:1}}>🤖</span>
            <div>
              <div style={{color:"#8b5cf6",fontWeight:700,fontSize:mobileOnly?13:15,letterSpacing:-0.2}}>Assistente de Horários</div>
              {!mobileOnly && <div style={{color:"var(--text3)",fontSize:12,marginTop:2}}>Descreva o horário em linguagem natural — a IA preenche os campos</div>}
            </div>
          </div>
          <span style={{color:"var(--text3)",fontSize:14,flexShrink:0}}>{aiOpen?"▲":"▼"}</span>
        </div>
        {aiOpen && (
          <div style={{marginTop:mobileOnly?12:16,paddingTop:mobileOnly?12:16,borderTop:"1px solid var(--border)"}}>
            <p style={{color:"var(--text3)",fontSize:mobileOnly?11:12,margin:"0 0 12px",lineHeight:1.6}}>
              {mobileOnly
                ? "Ex: \"folga dom e seg, 44h semanais entrando às 10\""
                : "Exemplos: \"folga domingo e segunda, entra 08:00 sai 17:00 intervalo 60min\" · \"escala 6x1\" · \"Qua e Qui: 15h às 24h com 1h de intervalo\""}
            </p>
            <div style={{display:"flex",flexDirection:mobileOnly?"column":"row",gap:mobileOnly?8:10}}>
              <input
                type="text" value={aiPrompt}
                onChange={e=>setAiPrompt(e.target.value)}
                onKeyDown={e=>{ if(e.key==="Enter") handleAiSubmit(); }}
                placeholder="Descreva o horário..."
                style={{...S.input,flex:1,fontSize:mobileOnly?13:14,padding:mobileOnly?undefined:"12px 14px",boxSizing:"border-box"}}
              />
              <button onClick={handleAiSubmit} disabled={aiLoading||!aiPrompt.trim()}
                style={{...S.btnPrimary,padding:mobileOnly?"10px 16px":"12px 28px",fontSize:mobileOnly?13:14,fontWeight:700,whiteSpace:"nowrap",opacity:aiLoading||!aiPrompt.trim()?0.5:1,background:"#8b5cf6",width:mobileOnly?"100%":"auto",minWidth:mobileOnly?undefined:140}}>
                {aiLoading ? "..." : "✨ Sugerir"}
              </button>
            </div>
            {aiResult && (
              <div style={{marginTop:mobileOnly?12:16,padding:mobileOnly?"12px 14px":"16px 18px",borderRadius:12,background:aiResult.days?"#f0fdf4":"#fff7ed",border:`1px solid ${aiResult.days?"#10b98133":"#f59e0b33"}`}}>
                <p style={{color:aiResult.days?"var(--green)":"#f59e0b",fontSize:mobileOnly?12:13,fontWeight:700,margin:"0 0 10px"}}>
                  {aiResult.days ? "✅ Sugestão do assistente:" : "⚠️ Não entendido"}
                </p>
                <pre style={{color:"var(--text2)",fontSize:mobileOnly?11:12,margin:0,whiteSpace:"pre-wrap",fontFamily:"'DM Mono',monospace",lineHeight:1.6}}>{aiResult.message}</pre>
                {aiResult.warnings?.length > 0 && (
                  <div style={{marginTop:10,padding:"10px 12px",borderRadius:8,background:"#fff7ed",border:"1px solid #f59e0b33"}}>
                    <p style={{color:"#f59e0b",fontSize:mobileOnly?11:12,fontWeight:700,margin:"0 0 4px"}}>⚠️ Avisos:</p>
                    {aiResult.warnings.map((w,i) => <p key={i} style={{color:"#92400e",fontSize:mobileOnly?11:12,margin:"2px 0"}}>{w}</p>)}
                  </div>
                )}
                {aiResult.days && (
                  <div style={{display:"flex",gap:10,marginTop:14,flexWrap:"wrap"}}>
                    <button onClick={applyAiSuggestion} style={{...S.btnPrimary,padding:mobileOnly?"8px 16px":"10px 20px",fontSize:mobileOnly?12:13,fontWeight:700,background:"#8b5cf6"}}>✓ Aplicar sugestão</button>
                    <button onClick={()=>setAiResult(null)} style={{...S.btnSecondary,padding:mobileOnly?"8px 16px":"10px 20px",fontSize:mobileOnly?12:13}}>Descartar</button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ DAY CARDS (mobile-first) ═══ */}
      <div style={{background:"var(--bg1)",borderRadius:10,padding:mobileOnly?"8px 10px":"10px 14px",marginBottom:mobileOnly?8:12}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{color:"var(--green)",fontSize:11,fontWeight:600}}>ON = Trabalha</span>
          <span style={{color:"var(--text3)",fontSize:11,fontWeight:600}}>OFF = Folga</span>
        </div>
        {!mobileOnly && <p style={{color:"var(--text3)",fontSize:11,margin:"6px 0 0"}}>Defina os dias de trabalho e folga. Horarios podem ser preenchidos agora ou depois.</p>}
      </div>
      {/* ═══ DAY ROWS ═══ */}
      {mobileOnly ? (
        /* ── MOBILE: single card with all days as compact rows ── */
        <div style={{...S.card,padding:0,marginBottom:8,overflow:"hidden"}}>
          {[0,1,2,3,4,5,6].map(dayIdx => {
            const d = editDays[dayIdx] ?? { active: true };
            const isActive = d.active;
            const hasHours = isActive && d.in && d.out;
            const calc = hasHours ? calcDayHours(d.in, d.out, parseInt(d.break)||0) : null;
            const isWeekend = dayIdx === 0 || dayIdx === 6;
            const contractOver = calc && calc.totalContract > 10*60;
            return (
              <div key={dayIdx} style={{
                padding:"10px 12px",
                borderBottom: dayIdx < 6 ? "1px solid var(--border)" : "none",
                opacity: isActive ? 1 : 0.5,
                background: isActive ? "var(--card-bg)" : "var(--bg1)",
              }}>
                {/* Row: day + toggle */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:isActive?8:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{color:isWeekend?"#f59e0b":"var(--text)",fontWeight:700,fontSize:14,minWidth:30}}>{WEEK_DAYS_LABEL[dayIdx]}</span>
                    {!isActive && <span style={{color:"var(--text3)",fontSize:11}}>Folga</span>}
                    {isActive && hasHours && calc && (
                      <span style={{color:contractOver?"var(--red)":ac,fontSize:10,fontWeight:700,fontFamily:"'DM Mono',monospace"}}>{fmtHHMM(calc.totalContract)}</span>
                    )}
                  </div>
                  <button onClick={()=>toggleDay(dayIdx)} style={isActive ? toggleOn : toggleOff}>
                    <div style={toggleDot(isActive)} />
                  </button>
                </div>
                {/* Inputs inline */}
                {isActive && (
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 52px",gap:6,alignItems:"center"}}>
                    <input type="time" value={d.in||""} onChange={e=>handleDayChange(dayIdx,"in",e.target.value)}
                      placeholder="Entrada" style={{...S.input,fontSize:13,padding:"7px 4px",textAlign:"center",width:"100%",boxSizing:"border-box"}}/>
                    <input type="time" value={d.out||""} onChange={e=>handleDayChange(dayIdx,"out",e.target.value)}
                      placeholder="Saída" style={{...S.input,fontSize:13,padding:"7px 4px",textAlign:"center",width:"100%",boxSizing:"border-box"}}/>
                    <input type="number" min="0" max="120" value={d.break||""} onChange={e=>handleDayChange(dayIdx,"break",parseInt(e.target.value)||0)}
                      placeholder="Int" style={{...S.input,fontSize:13,padding:"7px 2px",textAlign:"center",width:"100%",boxSizing:"border-box"}}/>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* ── DESKTOP: linhas espaçosas com grid generoso ── */
        <div style={{...S.card,padding:0,marginBottom:16,overflow:"hidden"}}>
          {[0,1,2,3,4,5,6].map(dayIdx => {
            const d = editDays[dayIdx] ?? { active: true };
            const isActive = d.active;
            const hasHours = isActive && d.in && d.out;
            const calc = hasHours ? calcDayHours(d.in, d.out, parseInt(d.break)||0) : null;
            const isWeekend = dayIdx === 0 || dayIdx === 6;
            const contractOver = calc && calc.totalContract > 10*60;
            return (
              <div key={dayIdx} style={{
                padding:"16px 20px",
                borderBottom: dayIdx < 6 ? "1px solid var(--border)" : "none",
                background: isActive ? (hasHours && contractOver ? "#fef2f2" : "transparent") : "var(--bg1)",
                opacity: isActive ? 1 : 0.55,
                display:"grid",
                gridTemplateColumns:"120px 1fr auto",
                gap:20,
                alignItems:"center",
              }}>
                {/* Coluna 1: Dia + status */}
                <div style={{display:"flex",flexDirection:"column",gap:2}}>
                  <span style={{color:isWeekend?"#f59e0b":"var(--text)",fontWeight:700,fontSize:16,letterSpacing:0.3}}>{WEEK_DAYS_LABEL[dayIdx]}</span>
                  <span style={{color: isActive ? (hasHours ? "var(--green)" : "var(--text3)") : "var(--text3)", fontSize:11, fontWeight: isActive ? 600 : 500, letterSpacing:0.3}}>
                    {isActive ? (hasHours ? "Trabalha" : "Sem horário") : "Folga"}
                  </span>
                </div>

                {/* Coluna 2: Inputs + métricas */}
                {isActive ? (
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 110px",gap:12,alignItems:"end"}}>
                      <div>
                        <label style={{color:"var(--text3)",fontSize:10,display:"block",marginBottom:4,letterSpacing:0.5,textTransform:"uppercase",fontWeight:600}}>Entrada</label>
                        <input type="time" value={d.in||""} onChange={e=>handleDayChange(dayIdx,"in",e.target.value)}
                          style={{...S.input,fontSize:15,padding:"11px 12px",textAlign:"center",width:"100%",boxSizing:"border-box"}}/>
                      </div>
                      <div>
                        <label style={{color:"var(--text3)",fontSize:10,display:"block",marginBottom:4,letterSpacing:0.5,textTransform:"uppercase",fontWeight:600}}>Saída</label>
                        <input type="time" value={d.out||""} onChange={e=>handleDayChange(dayIdx,"out",e.target.value)}
                          style={{...S.input,fontSize:15,padding:"11px 12px",textAlign:"center",width:"100%",boxSizing:"border-box"}}/>
                      </div>
                      <div>
                        <label style={{color:"var(--text3)",fontSize:10,display:"block",marginBottom:4,letterSpacing:0.5,textTransform:"uppercase",fontWeight:600}}>Intervalo (min)</label>
                        <input type="number" min="0" max="120" value={d.break||""} onChange={e=>handleDayChange(dayIdx,"break",parseInt(e.target.value)||0)}
                          placeholder="30" style={{...S.input,fontSize:15,padding:"11px 10px",textAlign:"center",width:"100%",boxSizing:"border-box"}}/>
                      </div>
                    </div>
                    {calc && (
                      <div style={{display:"flex",gap:14,flexWrap:"wrap",fontSize:11,fontFamily:"'DM Mono',monospace",paddingTop:4}}>
                        <span style={{color:"var(--text3)"}}>Real <strong style={{color:"var(--text2)"}}>{fmtHHMM(calc.worked)}</strong></span>
                        <span style={{color:"var(--text3)"}}>Diurna <strong style={{color:"var(--text2)"}}>{fmtHHMM(calc.diurnal)}</strong></span>
                        {calc.nocturnal > 0 && <span style={{color:"#8b5cf6"}}>Not.real <strong>{fmtHHMM(calc.nocturnal)}</strong></span>}
                        {calc.nocturnalFicta > 0 && <span style={{color:"#ec4899"}}>Not.ficta <strong>{fmtHHMM(calc.nocturnalFicta)}</strong></span>}
                        <span style={{color:contractOver?"var(--red)":ac,fontWeight:700,marginLeft:"auto"}}>Contratual {fmtHHMM(calc.totalContract)}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{color:"var(--text3)",fontSize:12,fontStyle:"italic"}}>— dia não trabalhado</div>
                )}

                {/* Coluna 3: Toggle */}
                <button onClick={()=>toggleDay(dayIdx)} style={isActive ? toggleOn : toggleOff}>
                  <div style={toggleDot(isActive)} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Weekly total (only if all hours filled) */}
      {allHoursFilled && activeDayCount > 0 && (
        <div style={{
          ...cardS,
          padding: mobileOnly ? "14px 16px" : "20px 24px",
          display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",
          gap: mobileOnly ? 10 : 16,
          borderColor:weekOk?"var(--green)33":"var(--red)33",
          background: weekOk ? "#10b98108" : "#ef444408",
        }}>
          <div style={{display:"flex",alignItems:"center",gap:mobileOnly?8:12}}>
            <span style={{fontSize:mobileOnly?18:22}}>{weekOk?"✅":"⚠️"}</span>
            <div>
              <div style={{color:"var(--text3)",fontSize:mobileOnly?11:12,fontWeight:500,letterSpacing:0.3,textTransform:"uppercase"}}>{mobileOnly?"Total semanal":"Total semanal contratual"}</div>
              <div style={{color:weekOk?"var(--green)":"var(--red)",fontSize:mobileOnly?11:12,fontWeight:600,marginTop:2}}>
                {isEmpFreela ? "Freela — sem validação CLT" : weekOk ? "Dentro do limite CLT" : "Fora do limite — deve estar entre 43:55 e 44:00"}
              </div>
            </div>
          </div>
          <div style={{display:"flex",alignItems:"baseline",gap:6}}>
            <span style={{color:weekOk?"var(--green)":"var(--red)",fontWeight:800,fontSize:mobileOnly?22:28,fontFamily:"'DM Mono',monospace",letterSpacing:-0.5}}>{fmtHHMM(totalContract)}</span>
            <span style={{color:"var(--text3)",fontSize:mobileOnly?11:13,fontWeight:500}}>/ sem</span>
          </div>
        </div>
      )}

      {/* Validation errors */}
      {errors.length > 0 && (
        <div style={{background:"#e74c3c11",border:"1px solid #e74c3c44",borderRadius:10,padding:"12px 16px",marginBottom:12}}>
          <p style={{color:"var(--red)",fontWeight:700,fontSize:13,margin:"0 0 8px"}}>Corrija antes de salvar:</p>
          {errors.map((e,i)=><div key={i} style={{color:"var(--red)",fontSize:12,marginBottom:4}}>• {e}</div>)}
        </div>
      )}

      {/* Valid from confirmation */}
      {showValidFrom && (
        <div style={{...cardS,border:"1px solid var(--ac)44"}}>
          <p style={{color:ac,fontWeight:700,fontSize:mobileOnly?13:14,margin:"0 0 8px"}}>
            Salvar horário
          </p>
          <p style={{color:"var(--text3)",fontSize:mobileOnly?11:12,marginBottom:8}}>A partir de quando entra em vigor?</p>
          <input type="date" value={validFrom} onChange={e=>setValidFrom(e.target.value)} style={{...S.input,marginBottom:10,fontSize:mobileOnly?14:15,padding:mobileOnly?"10px 10px":"12px 14px",width:"100%",boxSizing:"border-box"}}/>
          <p style={{color:"var(--text3)",fontSize:12,marginBottom:12}}>Todos os gestores DP receberão uma notificação com esta alteração.</p>
          <div style={{display:"flex",gap:mobileOnly?10:12,flexWrap:"wrap"}}>
            <button onClick={saveSchedule} style={{...S.btnPrimary,flex:1,minWidth:mobileOnly?140:200,padding:mobileOnly?undefined:"14px 24px",fontSize:mobileOnly?undefined:14,fontWeight:700}}>✓ Confirmar e Salvar</button>
            <button onClick={()=>{setShowValidFrom(false);setSaveMode(null);}} style={{...S.btnSecondary,flex:1,minWidth:mobileOnly?100:140,padding:mobileOnly?undefined:"14px 24px",fontSize:mobileOnly?undefined:14}}>Voltar</button>
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!showValidFrom && (
        <div style={{display:"flex",flexDirection:"column",gap:10,marginTop:mobileOnly?4:8}}>
          {/* Validado com sucesso — mostra aviso e libera Salvar */}
          {validated && (
            <div style={{...S.card,padding:mobileOnly?"10px 14px":"14px 18px",background:"#10b98108",borderColor:"#10b98144",display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:mobileOnly?18:22}}>✅</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{color:"var(--green)",fontWeight:700,fontSize:mobileOnly?13:14}}>Horário validado</div>
                <div style={{color:"var(--text3)",fontSize:mobileOnly?11:12,marginTop:2}}>{isEmpFreela ? "Freela — horário registrado sem validação CLT." : "Todas as regras da CLT estão atendidas. Pode salvar com segurança."}</div>
              </div>
            </div>
          )}
          <div style={{display:"flex",gap:mobileOnly?8:12,flexWrap:"wrap"}}>
            {validated ? (
              <button onClick={proceedToSave}
                style={{...S.btnPrimary,flex:1,minWidth:mobileOnly?120:220,fontSize:mobileOnly?13:15,padding:mobileOnly?"12px 10px":"14px 24px",fontWeight:700,background:"var(--green)"}}>
                💾 Salvar Horário
              </button>
            ) : (
              <button onClick={tryValidateFull} disabled={!allHoursFilled || activeDayCount === 0}
                style={{...S.btnPrimary,flex:1,minWidth:mobileOnly?120:220,fontSize:mobileOnly?13:15,padding:mobileOnly?"12px 10px":"14px 24px",fontWeight:700,opacity:allHoursFilled&&activeDayCount>0?1:0.4}}>
                ✓ Validar Horários
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Work Schedule Employee Tab ────────────────────────────────────────────────
function WorkScheduleEmployeeTab({ empId, restaurantId, workSchedules }) {
  const ac = "var(--ac)";
  const empScheds = [...(workSchedules?.[restaurantId]?.[empId] ?? [])].sort((a,b)=>a.validFrom.localeCompare(b.validFrom));
  const current = empScheds[empScheds.length - 1];

  function scheduleBlock(s, validUntil) {
    return (
      <div>
        {[0,1,2,3,4,5,6].map(i => {
          const d = s.days[i];
          const hasShift = d?.in && d?.out;
          const isWorkDay = !!d; // day exists in storage = work day
          const isWeekend = i === 0 || i === 6;
          const calc = hasShift ? calcDayHours(d.in, d.out, parseInt(d.break)||0) : null;
          return (
            <div key={i} style={{
              padding:"10px 14px",marginBottom:6,borderRadius:10,
              background:isWorkDay?"var(--card-bg)":"var(--bg1)",
              border:`1px solid ${isWorkDay?"var(--border)":"transparent"}`,
              opacity:isWorkDay?1:0.5,
            }}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{color:isWeekend?"#f59e0b":"var(--text)",fontWeight:700,fontSize:14,minWidth:36}}>{WEEK_DAYS_LABEL[i]}</span>
                {hasShift
                  ? <span style={{color:"var(--text2)",fontSize:13,fontFamily:"'DM Mono',monospace"}}>{d.in} - {d.out}</span>
                  : isWorkDay
                    ? <span style={{color:"#f59e0b",fontSize:12}}>Trabalha (horario pendente)</span>
                    : <span style={{color:"var(--text3)",fontSize:12}}>Folga</span>
                }
              </div>
              {hasShift && calc && (
                <div style={{display:"flex",gap:8,marginTop:4,fontSize:11,fontFamily:"'DM Mono',monospace",color:"var(--text3)",flexWrap:"wrap"}}>
                  <span>Intervalo: {d.break||0}min</span>
                  <span>Contratual: <strong style={{color:ac}}>{fmtHHMM(calc.totalContract)}</strong></span>
                  {calc.nocturnal > 0 && <span style={{color:"#8b5cf6"}}>Noturna: {fmtHHMM(calc.nocturnalFicta)}</span>}
                </div>
              )}
            </div>
          );
        })}
        {validUntil && (
          <p style={{color:"var(--text3)",fontSize:11,marginTop:6,textAlign:"right"}}>Vigente ate {fmtDate(validUntil)}</p>
        )}
      </div>
    );
  }

  if (!current) return (
    <div style={{textAlign:"center",marginTop:40}}>
      <div style={{fontSize:32,marginBottom:12}}>🕐</div>
      <p style={{color:"var(--text3)",fontSize:14}}>Nenhum horario cadastrado ainda.</p>
    </div>
  );

  return (
    <div>
      {/* Current schedule */}
      <div style={{...S.card,marginBottom:20,borderColor:"var(--ac)33"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:6}}>
          <span style={{color:ac,fontSize:14,fontWeight:700}}>Horario atual</span>
          <span style={{color:"var(--text3)",fontSize:12}}>Desde {fmtDate(current.validFrom)}</span>
        </div>
        {current.hoursComplete === false && (
          <div style={{background:"#f59e0b11",borderRadius:8,padding:"8px 12px",marginBottom:12,border:"1px solid #f59e0b33"}}>
            <span style={{color:"#f59e0b",fontSize:12,fontWeight:600}}>Dias de trabalho e folga definidos. Horarios ainda nao preenchidos pelo gestor.</span>
          </div>
        )}
        {current.totalContract > 0 && (
          <div style={{background:"var(--bg1)",borderRadius:8,padding:"8px 12px",marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{color:"var(--text3)",fontSize:12}}>Carga semanal</span>
            <span style={{color:ac,fontWeight:700,fontSize:14,fontFamily:"'DM Mono',monospace"}}>{fmtHHMM(current.totalContract)}/sem</span>
          </div>
        )}
        {scheduleBlock(current, null)}
      </div>

      {/* Previous schedules */}
      {empScheds.length > 1 && (
        <details>
          <summary style={{color:"var(--text3)",fontSize:12,cursor:"pointer",padding:"8px 12px",background:"var(--bg1)",borderRadius:8,marginBottom:8}}>
            Horarios anteriores ({empScheds.length - 1})
          </summary>
          <div style={{paddingTop:4}}>
            {[...empScheds].reverse().slice(1).map((s, idx) => {
              const newerSched = [...empScheds].reverse()[idx];
              const validUntil = newerSched?.validFrom
                ? (() => { const d = new Date(newerSched.validFrom+"T12:00:00"); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); })()
                : null;
              return (
                <div key={s.id} style={{...S.card,marginBottom:10,opacity:0.7}}>
                  <p style={{color:"var(--text3)",fontSize:12,fontWeight:700,margin:"0 0 10px"}}>Vigencia a partir de {fmtDate(s.validFrom)}</p>
                  {scheduleBlock(s, validUntil)}
                </div>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

function DpManagerTab({ restaurantId, dpMessages, onUpdate, isOwner }) {
  const msgs = dpMessages.filter(m => m.restaurantId === restaurantId && !m.deleted)
    .sort((a, b) => b.date.localeCompare(a.date));
  const trashedMsgs = dpMessages.filter(m => m.restaurantId === restaurantId && m.deleted)
    .sort((a, b) => (b.deletedAt||b.date).localeCompare(a.deletedAt||a.date));
  const [filter, setFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [showTrash, setShowTrash] = useState(false);
  const CATS = { all: "Todos", sugestao: "💡 Sugestões", elogio: "👏 Elogios", reclamacao: "⚠️ Reclamações", denuncia: "🚨 Denúncias" };
  const filtered = filter === "all" ? msgs : msgs.filter(m => m.category === filter);
  const unread = msgs.filter(m => !m.read).length;
  const ac = "var(--ac)";

  function markRead(id) {
    onUpdate("dpMessages", dpMessages.map(m => m.id === id ? { ...m, read: true } : m));
  }

  function toggleSelect(id) {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  }

  function deleteSelected() {
    if (isOwner) {
      if(!window.confirm(`Apagar ${selectedIds.size} mensagem(ns) permanentemente? Esta ação não pode ser desfeita.`)) return;
      onUpdate("dpMessages", dpMessages.filter(m => !selectedIds.has(m.id)));
      setSelectedIds(new Set());
      onUpdate("_toast", `🗑️ ${selectedIds.size} mensagem(ns) apagada(s) permanentemente`);
    } else {
      if(!window.confirm(`Mover ${selectedIds.size} mensagem(ns) para a lixeira?`)) return;
      onUpdate("dpMessages", dpMessages.map(m => selectedIds.has(m.id) ? { ...m, deleted: true, deletedAt: new Date().toISOString(), read: true } : m));
      setSelectedIds(new Set());
      onUpdate("_toast", `🗑️ ${selectedIds.size} mensagem(ns) movida(s) para a lixeira`);
    }
  }

  function restoreFromTrash(id) {
    onUpdate("dpMessages", dpMessages.map(m => m.id === id ? { ...m, deleted: false, deletedAt: undefined } : m));
    onUpdate("_toast", "♻️ Mensagem restaurada");
  }

  function permanentDeleteFromTrash(id) {
    if(!window.confirm("Apagar permanentemente? Esta ação não pode ser desfeita.")) return;
    onUpdate("dpMessages", dpMessages.filter(m => m.id !== id));
    onUpdate("_toast", "🗑️ Mensagem apagada permanentemente");
  }

  return (
    <div>
      {unread > 0 && <div style={{ background: "var(--ac)22", border: "1px solid var(--ac)44", borderRadius: 10, padding: "8px 14px", marginBottom: 12, fontSize: 12, color: ac, fontFamily: "'DM Mono',monospace" }}>📬 {unread} mensagem{unread > 1 ? "s" : ""} não lida{unread > 1 ? "s" : ""}</div>}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8,marginBottom:16}}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Object.entries(CATS).map(([val, lbl]) => (
            <button key={val} onClick={() => setFilter(val)} style={{ padding: "6px 12px", borderRadius: 20, border: `1px solid ${filter === val ? ac : "var(--border)"}`, background: filter === val ? ac + "22" : "transparent", color: filter === val ? ac : "#555", cursor: "pointer", fontFamily: "'DM Mono',monospace", fontSize: 11 }}>{lbl}</button>
          ))}
        </div>
        {selectedIds.size > 0 && (
          <button onClick={deleteSelected} style={{padding:"6px 14px",borderRadius:8,border:"none",background:"var(--red)",color:"var(--text)",fontWeight:700,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>
            🗑️ {isOwner ? "Apagar" : "Mover p/ lixeira"} ({selectedIds.size})
          </button>
        )}
      </div>

      {filtered.length === 0 && !showTrash && <p style={{ color: "var(--text3)", textAlign: "center" }}>Nenhuma mensagem.</p>}
      {!showTrash && filtered.map(m => (
        <div key={m.id} style={{ ...S.card, marginBottom: 10, opacity: m.read ? 0.7 : 1, borderColor: selectedIds.has(m.id) ? "#ef444488" : m.read ? "var(--border)" : "var(--ac)44", background: selectedIds.has(m.id) ? "#1a0808" : undefined }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, alignItems:"flex-start" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="checkbox" checked={selectedIds.has(m.id)} onChange={()=>toggleSelect(m.id)}
                style={{accentColor:"var(--red)",cursor:"pointer",width:14,height:14,flexShrink:0}}
              />
              <span style={{ color: "var(--text2)", fontSize: 12 }}>{CATS[m.category] ?? m.category}</span>
              {!m.read && <span style={{ background: ac, color: "#111", borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>Novo</span>}
            </div>
            <span style={{ color: "var(--text3)", fontSize: 11 }}>{new Date(m.date).toLocaleString("pt-BR")}</span>
          </div>
          <div style={{ color: "var(--text2)", fontSize: 12, marginBottom: 8 }}>De: <span style={{ color: m.empName === "Anônimo" ? "#8b5cf6" : "var(--text)" }}>{m.empName}</span></div>
          <div style={{ color: "var(--text)", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 8 }}>{m.body}</div>
          {!m.read && <button onClick={() => markRead(m.id)} style={{ ...S.btnSecondary, fontSize: 12 }}>Marcar como lida</button>}
        </div>
      ))}

      {/* Trash toggle */}
      {trashedMsgs.length > 0 && (
        <button onClick={() => setShowTrash(!showTrash)} style={{ ...S.btnSecondary, fontSize: 12, marginTop: 12, display: "flex", alignItems: "center", gap: 6 }}>
          🗑️ Lixeira ({trashedMsgs.length}) {showTrash ? "▲" : "▼"}
        </button>
      )}

      {/* Trash view */}
      {showTrash && trashedMsgs.map(m => (
        <div key={m.id} style={{...S.card,marginBottom:10,marginTop:10,opacity:0.5,borderColor:"var(--border)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div style={{flex:1}}>
              <div style={{color:"var(--text3)",fontSize:11,marginBottom:4}}>{CATS[m.category]??m.category} · Apagado em {m.deletedAt ? new Date(m.deletedAt).toLocaleDateString("pt-BR") : "—"}</div>
              <div style={{color:"var(--text2)",fontSize:12,marginBottom:2}}>De: {m.empName}</div>
              <div style={{color:"var(--text2)",fontSize:13,lineHeight:1.5}}>{m.body?.slice(0,100)}{(m.body?.length??0)>100?"…":""}</div>
            </div>
            <div style={{display:"flex",gap:6,flexShrink:0}}>
              <button onClick={()=>restoreFromTrash(m.id)} style={{...S.btnSecondary,fontSize:11,padding:"4px 10px"}}>♻️</button>
              {isOwner && <button onClick={()=>permanentDeleteFromTrash(m.id)} style={{background:"none",border:"1px solid #e74c3c33",borderRadius:8,color:"var(--red)",cursor:"pointer",fontSize:11,padding:"4px 10px",fontFamily:"'DM Mono',monospace"}}>✕</button>}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmployeePortal({ employees, roles, tips, schedules, splits, restaurants, communications, commAcks, faq, dpMessages, workSchedules, incidents, feedbacks, devChecklists, onBack, onUpdateEmployee, onUpdate, toggleTheme, theme, onSwitchToManager, employeeGoals, tipApprovals, delays, meetingPlans }) {
  const [empId, setEmpId] = useState(() => localStorage.getItem("apptip_empid") || null);

  useEffect(() => {
    if (empId) localStorage.setItem("apptip_empid", empId);
    else localStorage.removeItem("apptip_empid");
  }, [empId]);

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [tab, setTab] = useState("comunicados");
  const [firstCpf, setFirstCpf] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [firstPin2, setFirstPin2] = useState("");
  const [firstErr, setFirstErr] = useState("");
  const [empSchedView, setEmpSchedView] = useState("mine");

  const emp = employees.find(e => e.id === empId);
  const role = emp ? roles.find(r => r.id === emp.roleId) : null;
  const restaurant = emp ? restaurants.find(r => r.id === emp.restaurantId) : null;
  const empNumericPin = (emp?.empCode ?? "").replace(/\D/g, "").padStart(4, "0");
  const isFirstAccess = emp && (emp.mustChangePin || String(emp.pin) === empNumericPin || String(emp.pin) === String(emp.empCode));
  const needsCpf = emp && !emp.cpf;

  // Verificação em tempo real — empregado inativado ou não encontrado → logout
  useEffect(() => {
    if (!empId) return;
    if (employees.length === 0) return; // dados ainda não carregaram
    if (!emp) { onBack(); return; } // empregado não existe mais
    if (emp.inactive && emp.inactiveFrom && emp.inactiveFrom <= today()) {
      alert("Seu acesso foi desativado. Entre em contato com o gestor.");
      onBack();
    }
  }, [emp, empId, employees.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const mk = monthKey(year, month);
  const ridApprovals = tipApprovals?.[emp?.restaurantId] ?? {};
  const myTips = tips.filter(t => t.employeeId === empId && t.monthKey === mk).filter(t => {
    const monday = getWeekMonday(t.date);
    return !!ridApprovals[monday];
  });
  const grossTotal = myTips.reduce((a, t) => a + (t.myShare ?? 0), 0);
  const taxTotal   = myTips.reduce((a, t) => a + (t.myTax   ?? 0), 0);
  const netTotal   = myTips.reduce((a, t) => a + (t.myNet   ?? 0), 0);
  const dayMap = emp ? (schedules?.[emp.restaurantId]?.[mk]?.[empId] ?? {}) : {};

  // Pending communications
  const empRole = roles?.find(r => r.id === emp?.roleId);
  const myComms = emp ? communications.filter(c => {
    if (c.restaurantId !== emp.restaurantId) return false;
    if (c.autoSchedule || c.deleted) return false;
    if (!c.target || c.target === "all") return true;
    if (c.target.startsWith("emps:")) return c.target.replace("emps:","").split(",").includes(empId);
    if (c.target.startsWith("areas:")) return empRole && c.target.replace("areas:","").split(",").includes(empRole.area);
    if (c.target === `emp:${empId}`) return true;
    if (c.target.startsWith("area:") && empRole) return c.target === `area:${empRole.area}`;
    return false;
  }) : [];
  const pendingComms = myComms.filter(c => !commAcks?.[c.id]?.[empId]);
  const hasPending = pendingComms.length > 0;

  // Abas do empregado — respeita config do admin E escolha do gestor
  const empTabVisible = (key) => restaurant?.tabsConfig?.[key] !== false && restaurant?.tabsGestor?.[key] !== false;

  function handleTabChange(id) {
    if (hasPending && id !== "comunicados") {
      return; // block navigation while pending comms exist
    }
    setTab(id);
  }

  // Auto-switch to comunicados if pending
  useEffect(() => {
    if (hasPending && tab !== "comunicados") setTab("comunicados");
  }, [hasPending, tab]);

  function completeFirstAccess() {
    if (needsCpf && !firstCpf.trim()) { setFirstErr("Informe seu CPF."); return; }
    if (firstPin.length !== 4 || !/^\d{4}$/.test(firstPin)) { setFirstErr("PIN deve ter exatamente 4 dígitos numéricos."); return; }
    if (firstPin !== firstPin2) { setFirstErr("PINs não coincidem."); return; }
    const updated = { ...emp, pin: firstPin, cpf: firstCpf.trim() || emp.cpf, mustChangePin: false };
    onUpdateEmployee(updated);
  }

  // Se não tem empId — redireciona para login unificado
  if (!empId) { onBack(); return null; }

  if (empId && isFirstAccess) return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans',sans-serif", padding:24 }}>
      <div style={{ ...S.card, maxWidth:380, width:"100%", boxShadow:"0 8px 32px rgba(0,0,0,0.08)" }}>
        <div style={{ textAlign:"center", marginBottom:24 }}>
          <div style={{ fontSize:36, marginBottom:12 }}>🔑</div>
          <h2 style={{ color:"var(--text)", margin:"0 0 8px", fontSize:22, fontWeight:800 }}>
            {emp?.mustChangePin ? "Novo PIN" : "Primeiro Acesso"}
          </h2>
          <p style={{ color:"var(--text3)", fontSize:14, lineHeight:1.5 }}>
            {emp?.mustChangePin
              ? `PIN resetado pelo gestor. Defina um novo PIN, ${emp?.name}.`
              : `Bem-vindo, ${emp?.name}! ${needsCpf ? "Complete seu cadastro e defina seu PIN." : "Defina seu PIN de acesso."}`}
          </p>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {needsCpf && (
            <div>
              <label style={S.label}>Seu CPF</label>
              <input value={firstCpf} onChange={e=>setFirstCpf(maskCpf(e.target.value))} placeholder="000.000.000-00" style={S.input} inputMode="numeric"/>
            </div>
          )}
          <div>
            <label style={S.label}>Novo PIN (4 dígitos)</label>
            <input type="password" inputMode="numeric" maxLength={4} value={firstPin} onChange={e=>setFirstPin(e.target.value)} placeholder="••••" style={{ ...S.input, letterSpacing:8, fontSize:22, textAlign:"center", fontFamily:"'DM Mono',monospace" }}/>
          </div>
          <div>
            <label style={S.label}>Confirmar PIN</label>
            <input type="password" inputMode="numeric" maxLength={4} value={firstPin2} onChange={e=>setFirstPin2(e.target.value)} placeholder="••••" style={{ ...S.input, letterSpacing:8, fontSize:22, textAlign:"center", fontFamily:"'DM Mono',monospace" }} onKeyDown={e=>e.key==="Enter"&&completeFirstAccess()}/>
          </div>
          {firstErr && <div style={{background:"var(--red-bg)",border:"1px solid var(--red)33",borderRadius:8,padding:"10px 12px",color:"var(--red)",fontSize:13}}>{firstErr}</div>}
          <button onClick={completeFirstAccess} style={{...S.btnPrimary,marginTop:4}}>Confirmar e Entrar →</button>
          <button onClick={()=>{ setEmpId(null); onBack(); }} style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:13,marginTop:4,padding:8,fontFamily:"'DM Sans',sans-serif"}}>← Voltar ao login</button>
        </div>
      </div>
    </div>
  );

  // Bottom nav config: icon + short label
  const NAV = [
    ["comunicados","📢","Avisos"],
    ["escala","📅","Escala"],
    restaurant?.showTipsToEmployee && ["extrato","💸","Gorjeta"],
    ["trilha","📈","Trilha"],
    empTabVisible("horarios") && ["horarios","🕐","Horários"],
    empTabVisible("faq")      && ["faq","❓","FAQ"],
    empTabVisible("dp")       && ["dp","💬","Fale DP"],
  ].filter(Boolean);

  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", fontFamily:"'DM Sans',sans-serif", paddingBottom:76 }}>
      {/* Header */}
      <div style={{ background:"var(--header-bg)", borderBottom:"1px solid var(--border)", padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", boxShadow:"0 1px 4px rgba(0,0,0,0.04)", gap:8 }}>
        <div style={{minWidth:0,flex:1}}>
          <div style={{ color:"var(--text)", fontWeight:700, fontSize:15, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{emp?.name}</div>
          <div style={{ color:"var(--text3)", fontSize:11, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{role?.name} · {restaurant?.name}</div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
          <button onClick={toggleTheme} style={{background:"none",border:"1px solid var(--border)",borderRadius:20,padding:"5px 8px",cursor:"pointer",fontSize:14,color:"var(--text2)"}}>
            {theme==="dark"?"☀️":"🌙"}
          </button>
          {onSwitchToManager && <button onClick={onSwitchToManager} style={{...S.btnSecondary,fontSize:11,padding:"5px 10px",color:"var(--ac)",borderColor:"var(--ac)"}}>📊</button>}
          <button onClick={() => { setEmpId(null); onBack(); }} style={{ ...S.btnSecondary, fontSize:11, padding:"5px 10px" }}>Sair</button>
        </div>
      </div>

      {hasPending && (
        <div style={{ background:"var(--red-bg)", padding:"8px 16px", fontSize:13, color:"var(--red)", textAlign:"center", fontWeight:500 }}>
          ⚠️ Dê ciência nos comunicados para acessar as outras abas.
        </div>
      )}

      {/* Content */}
      <div style={{ padding: "16px 16px", maxWidth: 600, margin: "0 auto" }}>

        {tab === "extrato" && (
          <div>
            <div style={{ marginBottom: 20 }}><MonthNav year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} /></div>
            {/* Legal disclaimer */}
            <div style={{ background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 11, color: "var(--text3)", lineHeight: 1.5 }}>
              ⚠️ <strong style={{ color: "var(--text2)" }}>Aviso:</strong> Os valores exibidos são aproximados, apurados até o momento atual e sujeitos a alterações. Esta tela tem caráter informativo e de transparência, podendo conter imprecisões. Os valores definitivos serão apurados pela empresa e comunicados pelos canais oficiais.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
              {[["Bruto", grossTotal, "var(--text)"], ["Imposto", taxTotal, "var(--red)"], ["Líquido", netTotal, ac]].map(([lbl, val, col]) => (
                <div key={lbl} style={{ ...S.card, textAlign: "center" }}>
                  <div style={{ color: "var(--text3)", fontSize: 10, marginBottom: 4 }}>{lbl}</div>
                  <div style={{ color: col, fontWeight: 700, fontSize: 14 }}>{fmt(val)}</div>
                </div>
              ))}
            </div>
            {myTips.length === 0 && <p style={{ color: "var(--text3)", textAlign: "center" }}>Nenhuma gorjeta registrada neste mês.</p>}
            {myTips.length > 0 && (() => {
              const sorted = [...myTips].sort((a,b) => a.date.localeCompare(b.date));
              let running = 0;
              return (
                <div>
                  {/* Table header */}
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:4,padding:"6px 8px",background:"var(--bg1)",borderRadius:"8px 8px 0 0",marginBottom:2}}>
                    {["Data","Bruto","Desconto","Líquido"].map(h=><div key={h} style={{color:"var(--text3)",fontSize:10,fontWeight:700}}>{h}</div>)}
                  </div>
                  {sorted.map(t => {
                    running += t.myNet;
                    const statusOfDay = schedules?.[emp?.restaurantId]?.[mk]?.[empId]?.[t.date];
                    const statusLabels = {off:"Folga",freela:"Freela",vac:"Férias",faultj:"Falta Just.",faultu:"Falta Injust.",comp:"Compensação"};
                    return (
                      <div key={t.id} style={{background:"var(--card-bg)",borderBottom:"1px solid var(--border)",padding:"8px",borderRadius:0}}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:4,marginBottom: statusOfDay||t.note?4:0}}>
                          <div style={{color:"var(--text2)",fontSize:12}}>{fmtDate(t.date)}</div>
                          <div style={{color:"var(--text)",fontSize:12}}>{fmt(t.myShare)}</div>
                          <div style={{color:"var(--red)",fontSize:12}}>-{fmt(t.myTax)}</div>
                          <div style={{color:ac,fontSize:12,fontWeight:700}}>{fmt(t.myNet)}</div>
                        </div>
                        {(statusOfDay || t.note) && (
                          <div style={{color:"var(--text3)",fontSize:10}}>
                            {statusOfDay && <span style={{marginRight:8}}>{statusLabels[statusOfDay]??statusOfDay}</span>}
                            {t.note && <span>📝 {t.note}</span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* Running total */}
                  <div style={{background:"var(--bg1)",borderRadius:"0 0 8px 8px",padding:"10px 8px",display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:4}}>
                    <div style={{color:"var(--text3)",fontSize:11,fontWeight:700}}>Acumulado</div>
                    <div style={{color:"var(--text)",fontSize:11}}>{fmt(myTips.reduce((a,t)=>a+t.myShare,0))}</div>
                    <div style={{color:"var(--red)",fontSize:11}}>-{fmt(myTips.reduce((a,t)=>a+t.myTax,0))}</div>
                    <div style={{color:ac,fontSize:13,fontWeight:700}}>{fmt(running)}</div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {tab === "escala" && (
          <div>
            <div style={{ marginBottom: 20 }}><MonthNav year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} /></div>
            <div style={{display:"flex",gap:8,marginBottom:14}}>
              <button onClick={()=>setEmpSchedView("mine")} style={{flex:1,padding:"8px",borderRadius:10,border:`1px solid ${empSchedView==="mine"?ac:"var(--border)"}`,background:empSchedView==="mine"?ac+"22":"transparent",color:empSchedView==="mine"?ac:"#555",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>Minha Escala</button>
              <button onClick={()=>setEmpSchedView("area")} style={{flex:1,padding:"8px",borderRadius:10,border:`1px solid ${empSchedView==="area"?ac:"var(--border)"}`,background:empSchedView==="area"?ac+"22":"transparent",color:empSchedView==="area"?ac:"#555",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>Escala da Área</button>
            </div>

            {empSchedView === "mine" && (
              <div>
                <p style={{ color: "var(--text3)", fontSize: 13, marginBottom: 16, textTransform: "capitalize" }}>Sua escala em {monthLabel(year, month)}</p>
                <CalendarGrid year={year} month={month} dayMap={dayMap} readOnly delayMap={delays?.[emp?.restaurantId]?.[mk]?.[empId] ?? {}} />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 20 }}>
                  {(() => {
                    const dim = new Date(year, month + 1, 0).getDate();
                    const empDelayMap = delays?.[emp?.restaurantId]?.[mk]?.[empId] ?? {};
                    const counts = { work: 0, off: 0, freela: 0, comp: 0, comptrab: 0, vac: 0, fj: 0, fu: 0, delays: 0 };
                    for (let d = 1; d <= dim; d++) {
                      const k = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                      const s = dayMap[k];
                      if (s === DAY_OFF) counts.off++;
                      else if (s === DAY_FREELA) counts.freela++;
                      else if (s === DAY_COMP) counts.comp++;
                      else if (s === DAY_COMP_TRAB) counts.comptrab++;
                      else if (s === DAY_VACATION) counts.vac++;
                      else if (s === DAY_FAULT_J) counts.fj++;
                      else if (s === DAY_FAULT_U) counts.fu++;
                      else counts.work++;
                      if (empDelayMap[String(d)] > 0) counts.delays++;
                    }
                    return [
                      ["Trabalho", counts.work, "var(--green)"], ["Folga", counts.off, "var(--red)"],
                      ["Freela", counts.freela, "#06b6d4"],
                      ["Folga Comp.", counts.comp, "#3b82f6"], ["Trab. Comp.", counts.comptrab, "#0ea5e9"],
                      ["Férias", counts.vac, "#8b5cf6"],
                      ["Falta Just.", counts.fj, "#f59e0b"], ["Falta Injust.", counts.fu, "var(--red)"],
                      ["Atrasos", counts.delays, "#f59e0b"],
                    ].filter(([,val]) => val > 0).map(([lbl, val, col]) => (
                      <div key={lbl} style={{ ...S.card, textAlign: "center", padding: "12px 8px" }}>
                        <div style={{ color: "var(--text3)", fontSize: 9, marginBottom: 4 }}>{lbl}</div>
                        <div style={{ color: col, fontWeight: 700, fontSize: 20 }}>{val}</div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}

            {empSchedView === "area" && (() => {
              const empRole = roles.find(r => r.id === emp?.roleId);
              const empArea = empRole?.area;
              const areaEmpsList = employees.filter(e => {
                const r = roles.find(r => r.id === e.roleId);
                return r?.area === empArea && e.restaurantId === emp?.restaurantId &&
                  !(e.inactive && e.inactiveFrom && e.inactiveFrom <= today());
              }).sort((a,b) => a.name.localeCompare(b.name));

              const dim = new Date(year, month+1, 0).getDate();
              const LEGEND = [
                ["var(--green)","Trabalho"],["var(--red)","Folga"],["#06b6d4","Freela"],
                ["#3b82f6","FC"],["#0ea5e9","TC"],
                ["#8b5cf6","Férias"],["#f59e0b","F.Just."],["var(--red)","F.Injust."],
              ];

              return (
                <div>
                  <p style={{color:"var(--text3)",fontSize:12,marginBottom:10}}>
                    Área <span style={{color:AREA_COLORS[empArea]??ac,fontWeight:700}}>{empArea}</span> — {monthLabel(year,month)}
                  </p>

                  {/* Legenda */}
                  <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
                    {LEGEND.map(([c,lbl])=>(
                      <div key={lbl} style={{display:"flex",alignItems:"center",gap:3}}>
                        <div style={{width:10,height:10,borderRadius:3,background:c+"33",border:`1px solid ${c}`,flexShrink:0}}/>
                        <span style={{color:"var(--text3)",fontSize:9,fontFamily:"'DM Mono',monospace"}}>{lbl}</span>
                      </div>
                    ))}
                  </div>

                  {/* Tabela com scroll horizontal */}
                  <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch",borderRadius:10,border:"1px solid var(--border)"}}>
                    <table style={{borderCollapse:"collapse",fontFamily:"'DM Mono',monospace",fontSize:10,minWidth:"100%"}}>
                      <thead>
                        <tr style={{background:"var(--bg1)"}}>
                          <th style={{position:"sticky",left:0,background:"var(--bg1)",zIndex:2,padding:"6px 8px",textAlign:"left",color:"var(--text3)",fontSize:10,borderBottom:"1px solid var(--border)",whiteSpace:"nowrap",minWidth:90}}>
                            Empregado
                          </th>
                          {Array.from({length:dim},(_,i)=>{
                            const d = i+1;
                            const date = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                            const wd = new Date(date+"T12:00:00").getDay();
                            const isWe = wd===0||wd===6;
                            const isToday = date === today();
                            return (
                              <th key={d} style={{padding:"3px 1px",textAlign:"center",color:isToday?ac:isWe?"#f59e0b":"var(--text3)",fontSize:9,borderBottom:"1px solid var(--border)",minWidth:22,width:22,background:isToday?"var(--ac)11":"transparent"}}>
                                <div style={{fontWeight:isToday?700:400}}>{d}</div>
                                <div style={{fontSize:7,opacity:0.7}}>{["D","S","T","Q","Q","S","S"][wd]}</div>
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {areaEmpsList.map((e, ei) => {
                          const isMe = e.id === empId;
                          const dm = schedules?.[emp?.restaurantId]?.[mk]?.[e.id] ?? {};
                          const role = roles.find(r=>r.id===e.roleId);
                          return (
                            <tr key={e.id} style={{background:isMe?"var(--ac-bg)":ei%2===0?"var(--bg1)":"var(--bg2)"}}>
                              <td style={{position:"sticky",left:0,background:isMe?"var(--ac-bg)":ei%2===0?"var(--bg1)":"var(--bg2)",zIndex:1,padding:"5px 8px",borderRight:"1px solid var(--border)",minWidth:90}}>
                                <div style={{color:isMe?ac:"var(--text)",fontSize:10,fontWeight:isMe?700:600,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:85}}>
                                  {e.name.split(" ")[0]}{isMe?" ✦":""}
                                </div>
                                <div style={{color:"var(--text3)",fontSize:8,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:85}}>{role?.name}</div>
                              </td>
                              {Array.from({length:dim},(_,i)=>{
                                const d = i+1;
                                const date = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                                const status = dm[date];
                                const color = STATUS_COLORS[status] ?? "var(--green)";
                                const label = STATUS_SHORT[status] ?? "•";
                                const wd = new Date(date+"T12:00:00").getDay();
                                const isWe = wd===0||wd===6;
                                const isToday = date === today();
                                const delayMin = delays?.[emp?.restaurantId]?.[mk]?.[e.id]?.[String(d)] ?? 0;
                                return (
                                  <td key={d} title={delayMin > 0 ? `⏰ ${delayMin}min atraso` : undefined} style={{
                                    textAlign:"center",padding:"3px 1px",
                                    background:isToday?"var(--ac)11":status?color+"22":(isWe?"var(--bg1)":"transparent"),
                                    borderRight:`1px solid ${delayMin > 0 ? "#f59e0b" : "var(--border)"}`,
                                    borderBottom: delayMin > 0 ? "2px solid #f59e0b" : undefined,
                                    width:22,outline:isToday?`1px solid ${ac}44`:undefined
                                  }}>
                                    <span style={{color:color,fontSize:status?8:9,fontWeight:status?700:300}}>{label}</span>
                                    {delayMin > 0 && <div style={{fontSize:6,color:"#f59e0b",lineHeight:1}}>⏰</div>}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <p style={{color:"var(--text3)",fontSize:10,marginTop:8,textAlign:"center"}}>
                    ✦ você · role na coluna da esquerda
                  </p>
                </div>
              );
            })()}
          </div>
        )}

        {tab === "comunicados" && (
          <ComunicadosTab empId={empId} restaurantId={emp?.restaurantId} communications={communications} commAcks={commAcks} onUpdate={onUpdate} roles={roles} emp={emp} />
        )}

        {tab === "faq" && (
          <FaqTab restaurantId={emp?.restaurantId} faq={faq} emp={emp} roles={roles} restaurants={restaurants} splits={splits} />
        )}

        {tab === "trilha" && emp && (
          <EmpTrilhaView empId={empId} employees={employees} roles={roles} schedules={schedules} incidents={incidents??[]} feedbacks={feedbacks??[]} devChecklists={devChecklists??{}} restaurantId={emp.restaurantId} onUpdate={onUpdate} employeeGoals={employeeGoals??{}} meetingPlans={meetingPlans??[]}/>
        )}

        {tab === "dp" && (
          <FaleDpTab empId={empId} emp={emp} restaurantId={emp?.restaurantId} dpMessages={dpMessages} onUpdate={onUpdate} />
        )}

        {tab === "horarios" && (
          <WorkScheduleEmployeeTab empId={empId} restaurantId={emp?.restaurantId} workSchedules={workSchedules ?? {}} />
        )}


      </div>

      {/* Bottom navigation bar */}
      <div style={{ position:"fixed", bottom:0, left:0, right:0, background:"var(--header-bg)", borderTop:"1px solid var(--border)", display:"flex", zIndex:100, paddingBottom:"env(safe-area-inset-bottom, 0px)", boxShadow:"0 -2px 12px rgba(0,0,0,0.06)" }}>
        {NAV.map(([id, icon, label]) => {
          const blocked = hasPending && id !== "comunicados";
          const isActive = tab === id;
          const hasBadge = id === "comunicados" && pendingComms.length > 0;
          return (
            <button key={id} onClick={() => !blocked && handleTabChange(id)}
              style={{ flex:1, background:"none", border:"none", padding:"10px 4px 8px", cursor:blocked?"not-allowed":"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3, opacity:blocked?0.3:1, position:"relative" }}>
              {hasBadge && (
                <span style={{ position:"absolute", top:6, right:"calc(50% - 14px)", background:"var(--red)", color:"var(--text)", borderRadius:10, padding:"1px 5px", fontSize:9, fontWeight:700, lineHeight:1.4 }}>{pendingComms.length}</span>
              )}
              <span style={{ fontSize:22, lineHeight:1 }}>{icon}</span>
              <span style={{ fontSize:9, fontFamily:"'DM Sans',sans-serif", color:isActive?ac:"var(--text3)", fontWeight:isActive?700:500 }}>{label}</span>
              {isActive && <div style={{ position:"absolute", bottom:0, left:"20%", right:"20%", height:2, background:ac, borderRadius:2 }}/>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
//
//
function RoleSpreadsheet({ restRoles, rid, roles, employees, onUpdate }) {
  const blank = () => ({ id: null, name: "", area: "Bar", points: "1", restaurantId: rid });
  const [newRow, setNewRow] = useState(blank());
  const [editRows, setEditRows] = useState({});
  const [aiInput, setAiInput] = useState("");
  const { generate: aiGenerate, aiLoading, aiError, setAiError } = useAiGenerate();
  const [showAi, setShowAi] = useState(false);
  const [pendingNoTip, setPendingNoTip] = useState({}); // track noTip changes locally

  const [aiPreview, setAiPreview] = useState(null); // {criar:[], modificar:[], inativar:[]}

  async function handleAiCargos() {
    if (!aiInput.trim()) return;
    setAiPreview(null);
    const existingList = restRoles.map(r => `- id:"${r.id}" nome:"${r.name}" area:"${r.area}" pontos:${r.points} semGorjeta:${!!r.noTip} inativo:${!!r.inactive}`).join("\n");
    const result = await aiGenerate(
        `Você é um assistente de gestão de restaurantes. O usuário pode pedir para CRIAR novos cargos, MODIFICAR cargos existentes (renomear, mudar pontos, área, sem gorjeta) ou INATIVAR cargos.

Cargos existentes:
${existingList || "(nenhum)"}

Regras:
- "area" deve ser: Bar, Cozinha, Salão ou Limpeza
- "pontos": 0 a 20 (0 = sem gorjeta). Se não informado ao criar, estime pela hierarquia (Gerente=10, Subchef=9, Garçom=6, Auxiliar=3)
- Se não informar área ao criar, deduza pelo nome do cargo
- Para modificar, use o "id" do cargo existente e inclua APENAS os campos que mudam
- Para inativar, use o "id" do cargo existente

Responda com JSON:
{
  "criar": [{"nome":"...", "area":"...", "pontos":6, "semGorjeta":false}],
  "modificar": [{"id":"...", "nome":"...", "area":"...", "pontos":6, "semGorjeta":false}],
  "inativar": ["id1", "id2"]
}
Inclua apenas as ações solicitadas. Arrays vazios se não houver ação daquele tipo.`,
      aiInput.trim()
    );
    if (!result) return;
    // Prepare preview
    const preview = {
      criar: (result.criar ?? []).map(c => ({
        id: `role-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
        name: c.nome, area: c.area, points: c.semGorjeta ? 0 : (c.pontos ?? 1), noTip: c.semGorjeta ?? false,
      })),
      modificar: (result.modificar ?? []).map(m => {
        const existing = restRoles.find(r => r.id === m.id);
        if (!existing) return null;
        return {
          id: m.id, oldName: existing.name,
          name: m.nome ?? existing.name,
          area: m.area ?? existing.area,
          points: m.semGorjeta ? 0 : (m.pontos !== undefined ? m.pontos : existing.points),
          noTip: m.semGorjeta !== undefined ? m.semGorjeta : !!existing.noTip,
        };
      }).filter(Boolean),
      inativar: (result.inativar ?? []).map(id => restRoles.find(r => r.id === id)).filter(Boolean),
    };
    if (!preview.criar.length && !preview.modificar.length && !preview.inativar.length) {
      setAiError("A IA não identificou nenhuma ação. Tente reformular.");
    } else {
      setAiPreview(preview);
    }
  }

  function confirmAiChanges() {
    if (!aiPreview) return;
    let updated = [...roles];
    // Create new roles
    aiPreview.criar.forEach(c => {
      updated.push({ id: c.id, restaurantId: rid, name: c.name, area: c.area, points: c.points, noTip: c.noTip, inactive: false });
    });
    // Modify existing
    aiPreview.modificar.forEach(m => {
      updated = updated.map(r => r.id === m.id ? { ...r, name: m.name, area: m.area, points: m.points, noTip: m.noTip } : r);
    });
    // Inactivate
    aiPreview.inativar.forEach(r => {
      updated = updated.map(x => x.id === r.id ? { ...x, inactive: true } : x);
    });
    onUpdate("roles", updated);
    const total = aiPreview.criar.length + aiPreview.modificar.length + aiPreview.inativar.length;
    onUpdate("_toast", `✨ ${total} ação(ões) aplicada(s) pela IA!`);
    setAiPreview(null); setAiInput(""); setShowAi(false);
  }

  const ROLE_COLS = "minmax(80px,2fr) 60px 100px auto";

  function getRow(r) { return editRows[r.id] ?? { name: r.name, area: r.area ?? "Bar", points: r.points === 0 ? "0" : String(r.points || "") }; }
  function setRow(role, field, val) { setEditRows(prev => ({ ...prev, [role.id]: { ...getRow(role), [field]: val } })); }
  function getNoTip(r) { return pendingNoTip[r.id] !== undefined ? pendingNoTip[r.id] : !!r.noTip; }

  // Check if any rows have unsaved changes
  const isDirty = Object.keys(editRows).length > 0 || Object.keys(pendingNoTip).length > 0;

  function saveAll() {
    let updated = [...roles];
    // Apply all editRows and pendingNoTip changes
    for (const r of restRoles) {
      const row = editRows[r.id];
      const noTipChanged = pendingNoTip[r.id] !== undefined;
      if (!row && !noTipChanged) continue;
      const merged = row ?? { name: r.name, area: r.area ?? "Bar", points: r.points === 0 ? "0" : String(r.points || "") };
      if (!merged.name.trim()) continue;
      const noTip = noTipChanged ? pendingNoTip[r.id] : !!r.noTip;
      const pts = noTip ? 0 : (merged.points === "" ? 0 : (Number(merged.points) || 0));
      updated = updated.map(x => x.id === r.id ? { ...x, name: merged.name.trim(), area: merged.area, points: pts, noTip } : x);
    }
    onUpdate("roles", updated);
    setEditRows({});
    setPendingNoTip({});
    onUpdate("_toast", "✅ Cargos salvos!");
  }

  function discardAll() {
    setEditRows({});
    setPendingNoTip({});
  }

  function saveNew() {
    if (!newRow.name.trim()) return;
    const pts = newRow.points === "" ? 0 : (Number(newRow.points) || 0);
    const r = { ...newRow, id: Date.now().toString(), points: pts };
    onUpdate("roles", [...roles, r]);
    setNewRow(blank());
  }

  function inactivateRole(id) { onUpdate("roles", roles.map(x => x.id === id ? {...x, inactive: true} : x)); }
  function reactivateRole(id) { onUpdate("roles", roles.map(x => x.id === id ? {...x, inactive: false} : x)); }

  function deleteRole(id) {
    const r = roles.find(x => x.id === id);
    const empCount = (employees ?? []).filter(e => e.roleId === id && e.restaurantId === rid).length;
    if (empCount > 0) {
      onUpdate("_toast", `⚠️ Não é possível apagar: ${empCount} empregado(s) vinculado(s) a este cargo`);
      return;
    }
    if (!window.confirm(`Apagar permanentemente o cargo "${r?.name ?? ""}"?`)) return;
    onUpdate("roles", roles.filter(x => x.id !== id));
    onUpdate("_toast", "🗑️ Cargo apagado");
  }

  const inStyle = { background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontFamily: "'DM Mono',monospace", fontSize: 12, padding: "6px 8px", outline: "none", width: "100%", boxSizing:"border-box" };
  const sel = { ...inStyle, cursor: "pointer" };
  const ac = "var(--ac)";

  // Agrupar por área
  const activeByArea = {};
  const inactiveList = [];
  AREAS.forEach(a => { activeByArea[a] = []; });
  [...restRoles].sort((a,b) => a.name.localeCompare(b.name)).forEach(r => {
    if (r.inactive) inactiveList.push(r);
    else if (activeByArea[r.area]) activeByArea[r.area].push(r);
    else activeByArea[r.area] = [r];
  });

  const renderRow = (r) => {
    const row = getRow(r);
    const noTip = getNoTip(r);
    const hasEdit = !!editRows[r.id] || pendingNoTip[r.id] !== undefined;
    return (
      <div key={r.id} style={{ display:"grid", gridTemplateColumns:ROLE_COLS, gap:6, marginBottom:4, background:hasEdit?"var(--ac-bg)":"var(--card-bg)", borderRadius:10, padding:"6px 8px", border:`1px solid ${hasEdit?"var(--ac)44":r.inactive?"#8b5cf622":"var(--border)"}`, opacity:r.inactive?0.6:1, alignItems:"center" }}>
        <input value={row.name} onChange={e => setRow(r, "name", e.target.value)} style={inStyle} />
        <input type="number" min="0" step="0.5" value={noTip ? 0 : row.points} disabled={noTip} onChange={e => setRow(r, "points", e.target.value)} style={{...inStyle, opacity: noTip ? 0.4 : 1, textAlign:"center"}} />
        <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",color:"var(--text2)",fontSize:12,fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap"}}>
          <input type="checkbox" checked={noTip} onChange={e=>{setPendingNoTip(p=>({...p,[r.id]:e.target.checked}));if(e.target.checked) setRow(r,"points","0");}} style={{width:14,height:14,cursor:"pointer",accentColor:ac}}/>
          Sem gorjeta
        </label>
        <div style={{display:"flex",gap:4,justifyContent:"flex-end"}}>
          {r.inactive
            ? <>
                <button onClick={()=>reactivateRole(r.id)} style={{padding:"5px 10px",borderRadius:7,border:"1px solid #10b98144",background:"transparent",color:"var(--green)",cursor:"pointer",fontSize:11,fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap"}}>Reativar</button>
                <button onClick={()=>deleteRole(r.id)} style={{padding:"5px 10px",borderRadius:7,border:"1px solid #e74c3c33",background:"transparent",color:"var(--red)",cursor:"pointer",fontSize:11,fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap"}}>✕</button>
              </>
            : <button onClick={()=>inactivateRole(r.id)} style={{padding:"5px 10px",borderRadius:7,border:"1px solid #f59e0b44",background:"transparent",color:"#f59e0b",cursor:"pointer",fontSize:11,fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap"}}>Inativar</button>
          }
        </div>
      </div>
    );
  };

  return (
    <div style={{ fontFamily: "'DM Mono',monospace" }}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <p style={{ color: "var(--text3)", fontSize: 12, margin:0 }}>Edite inline. Salve tudo ao terminar.</p>
        {isDirty && (
          <div style={{display:"flex",gap:8}}>
            <button onClick={discardAll} style={{...S.btnSecondary,fontSize:12,padding:"5px 12px"}}>Descartar</button>
            <button onClick={saveAll} style={{padding:"5px 14px",borderRadius:8,border:"none",background:ac,color:"var(--text)",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"'DM Mono',monospace"}}>💾 Salvar tudo</button>
          </div>
        )}
      </div>

      {/* Unsaved changes banner */}
      {isDirty && (
        <div style={{background:"#f59e0b22",border:"1px solid #f59e0b44",borderRadius:10,padding:"8px 14px",marginBottom:12,fontSize:12,color:"#f59e0b",fontFamily:"'DM Mono',monospace"}}>
          ⚠️ Alterações não salvas — clique "Salvar tudo" para confirmar
        </div>
      )}

      {/* Assistente IA */}
      <div style={{marginBottom:14}}>
        <button onClick={()=>{setShowAi(!showAi);setAiError("");setAiPreview(null);}}
          style={{...S.btnSecondary,fontSize:12,display:"inline-flex",alignItems:"center",gap:6,padding:"7px 14px",
            background:showAi?"var(--ac-bg)":undefined,borderColor:showAi?"var(--ac)":undefined,color:showAi?"var(--ac-text)":undefined}}>
          ✨ Gerenciar cargos com IA
        </button>
        {showAi && (
          <div style={{marginTop:10,padding:"14px",borderRadius:12,background:"var(--ac-bg)",border:"1px solid var(--ac)33"}}>
            <p style={{color:"var(--text2)",fontSize:13,margin:"0 0 6px",fontWeight:600}}>✨ Assistente de cargos</p>
            <p style={{color:"var(--text3)",fontSize:12,margin:"0 0 6px",lineHeight:1.5}}>Crie, modifique, inative ou ajuste pontos dos cargos. A IA entende linguagem natural.</p>
            <p style={{color:"var(--text3)",fontSize:11,margin:"0 0 10px",fontStyle:"italic"}}>Ex: "Adicione Garçom 6pts no Salão" · "Mude o Barman para 8 pontos" · "Inative o cargo Auxiliar" · "Cozinheiro agora é sem gorjeta"</p>
            <textarea value={aiInput} onChange={e=>setAiInput(e.target.value)}
              placeholder="Descreva o que quer fazer com os cargos..." rows={3}
              style={{...S.input,resize:"vertical",marginBottom:8,fontSize:13}}/>
            {aiError && <p style={{color:"var(--red)",fontSize:12,margin:"0 0 8px"}}>{aiError}</p>}

            {/* AI Preview/Confirmation */}
            {aiPreview && (
              <div style={{background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:10,padding:"12px",marginBottom:10}}>
                <p style={{color:"var(--text)",fontWeight:700,fontSize:13,margin:"0 0 10px"}}>Confirme as alterações:</p>
                {aiPreview.criar.length > 0 && (
                  <div style={{marginBottom:8}}>
                    <span style={{color:"var(--green)",fontSize:11,fontWeight:700}}>+ CRIAR</span>
                    {aiPreview.criar.map(c => (
                      <div key={c.id} style={{padding:"4px 8px",marginTop:4,borderRadius:6,background:"#10b98111",fontSize:12,color:"var(--text2)"}}>
                        {c.name} · {c.area} · {c.noTip ? "Sem gorjeta" : `${c.points} pts`}
                      </div>
                    ))}
                  </div>
                )}
                {aiPreview.modificar.length > 0 && (
                  <div style={{marginBottom:8}}>
                    <span style={{color:"#3b82f6",fontSize:11,fontWeight:700}}>✏️ MODIFICAR</span>
                    {aiPreview.modificar.map(m => (
                      <div key={m.id} style={{padding:"4px 8px",marginTop:4,borderRadius:6,background:"#3b82f611",fontSize:12,color:"var(--text2)"}}>
                        {m.oldName !== m.name ? <><s>{m.oldName}</s> → {m.name}</> : m.name} · {m.area} · {m.noTip ? "Sem gorjeta" : `${m.points} pts`}
                      </div>
                    ))}
                  </div>
                )}
                {aiPreview.inativar.length > 0 && (
                  <div style={{marginBottom:8}}>
                    <span style={{color:"#f59e0b",fontSize:11,fontWeight:700}}>⏸ INATIVAR</span>
                    {aiPreview.inativar.map(r => (
                      <div key={r.id} style={{padding:"4px 8px",marginTop:4,borderRadius:6,background:"#f59e0b11",fontSize:12,color:"var(--text2)"}}>
                        {r.name} · {r.area}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{display:"flex",gap:8,marginTop:10}}>
                  <button onClick={confirmAiChanges} style={{...S.btnPrimary,flex:1,fontSize:13}}>✅ Confirmar e aplicar</button>
                  <button onClick={()=>setAiPreview(null)} style={S.btnSecondary}>Cancelar</button>
                </div>
              </div>
            )}

            {!aiPreview && (
              <div style={{display:"flex",gap:8}}>
                <button onClick={handleAiCargos} disabled={!aiInput.trim()||aiLoading}
                  style={{...S.btnPrimary,flex:1,fontSize:13,opacity:(!aiInput.trim()||aiLoading)?0.6:1}}>
                  {aiLoading?"✨ Processando...":"✨ Processar com IA"}
                </button>
                <button onClick={()=>{setShowAi(false);setAiInput("");setAiError("");setAiPreview(null);}} style={S.btnSecondary}>Cancelar</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cabeçalho */}
      <div style={{ display:"grid", gridTemplateColumns:ROLE_COLS, gap:6, marginBottom:6, padding:"0 8px" }}>
        {["Nome do Cargo","Pontos","",""].map((h,i) => <div key={i} style={{color:"var(--text3)",fontSize:10,fontWeight:700}}>{h}</div>)}
      </div>

      {/* Nova linha */}
      <div style={{ display:"grid", gridTemplateColumns:ROLE_COLS, gap:6, marginBottom:16, background:"#f0fdf4", borderRadius:10, padding:"6px 8px", border:"1px solid #10b98144", alignItems:"center" }}>
        <input value={newRow.name} onChange={e => setNewRow(p => ({ ...p, name: e.target.value }))} placeholder="Nome do cargo…" style={inStyle} />
        <input type="number" min="0.5" step="0.5" value={newRow.noTip ? 0 : newRow.points} disabled={newRow.noTip} onChange={e => setNewRow(p => ({ ...p, points: e.target.value }))} style={{...inStyle, opacity: newRow.noTip ? 0.4 : 1, textAlign:"center"}} />
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",color:"var(--text2)",fontSize:12,whiteSpace:"nowrap"}}>
            <input type="checkbox" checked={!!newRow.noTip} onChange={e=>setNewRow(p=>({...p,noTip:e.target.checked,points:e.target.checked?"0":p.points}))} style={{width:14,height:14,cursor:"pointer",accentColor:ac}}/>
            Sem gorjeta
          </label>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          <select value={newRow.area} onChange={e => setNewRow(p => ({ ...p, area: e.target.value }))} style={{...sel,flex:1}}>
            {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button onClick={saveNew} style={{padding:"6px 10px",borderRadius:8,border:"none",background:"var(--green)",color:"var(--text)",fontWeight:700,fontSize:12,cursor:"pointer",fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap"}}>+ Add</button>
        </div>
      </div>

      {/* Agrupado por área */}
      {AREAS.map(area => {
        const areaRoles = activeByArea[area] ?? [];
        if (!areaRoles.length) return null;
        return (
          <div key={area} style={{marginBottom:16}}>
            <div style={{color:AREA_COLORS[area]??"#888",fontSize:11,fontWeight:700,padding:"6px 8px 4px",borderBottom:`1px solid ${AREA_COLORS[area]??"var(--bg4)"}33`,marginBottom:4,letterSpacing:1}}>
              {area.toUpperCase()} · {areaRoles.length} cargo{areaRoles.length!==1?"s":""}
            </div>
            {areaRoles.map(renderRow)}
          </div>
        );
      })}

      {/* Inativos */}
      {inactiveList.length > 0 && (
        <div style={{marginTop:8}}>
          <div style={{color:"var(--text3)",fontSize:11,fontWeight:700,padding:"6px 8px 4px",borderBottom:"1px solid var(--border)",marginBottom:4,letterSpacing:1}}>
            INATIVOS · {inactiveList.length}
          </div>
          {inactiveList.map(renderRow)}
        </div>
      )}

      {/* Bottom save bar */}
      {isDirty && (
        <div style={{position:"sticky",bottom:0,background:"var(--bg)",borderTop:"1px solid var(--ac)44",padding:"10px 0",marginTop:16,display:"flex",justifyContent:"flex-end",gap:8}}>
          <button onClick={discardAll} style={{...S.btnSecondary,fontSize:12,padding:"6px 14px"}}>Descartar</button>
          <button onClick={saveAll} style={{padding:"6px 16px",borderRadius:8,border:"none",background:ac,color:"var(--text)",fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"'DM Mono',monospace"}}>💾 Salvar tudo</button>
        </div>
      )}
    </div>
  );
}



function EmployeeSpreadsheet({ restEmps, restRoles, rid, employees, onUpdate, restCode: restCode_, isOwner, restaurant, notifications, privacyMask, onGenerateDismissalReport, incidents, feedbacks, devChecklists, schedules, currentUser, isLider, mobileOnly: mobileOnlyProp, roles, vtPayments, vtConfig, scheduleStatus, employeeGoals, delays, meetingPlans }) {
  const mobileOnly = mobileOnlyProp ?? false; // eslint-disable-line no-unused-vars
  const PLANOS = [
    { id:"p10",  empMax:10  },
    { id:"p20",  empMax:20  },
    { id:"p50",  empMax:50  },
    { id:"p999", empMax:100 },
    { id:"pOrc", empMax:999 },
  ];
  const plano = PLANOS.find(p=>p.id===(restaurant?.planoId??"p10")) ?? PLANOS[0];
  const activeCount = restEmps.filter(e=>!e.inactive).length;
  const blank = () => ({ name:"", cpf:"", admission:"", pin:"", roleId:"", restaurantId:rid });
  const [newRow, setNewRow] = useState(blank());
  const [editRows, setEditRows] = useState({});
  const [saved, setSaved] = useState({});
  const [showInactive, setShowInactive] = useState(false);
  const [showAiEmp, setShowAiEmp] = useState(false);
  const [aiEmpInput, setAiEmpInput] = useState("");
  const { generate: aiEmpGenerate, aiLoading: aiEmpLoading, aiError: aiEmpError, setAiError: setAiEmpError } = useAiGenerate();
  const [aiEmpPreview, setAiEmpPreview] = useState(null);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewFileName, setPreviewFileName] = useState("");
  const [showDismissalChecklist, setShowDismissalChecklist] = useState(false);
  const [dismissalCheckEmp, setDismissalCheckEmp] = useState(null);
  const [detailEmp, setDetailEmp] = useState(null); // empId for detail view
  const [detailTab, setDetailTab] = useState("cadastro"); // cadastro | acoes | trilha
  const [showIncForm, setShowIncForm] = useState(false);
  const [showFbForm, setShowFbForm] = useState(false);
  const [expandedJornada, setExpandedJornada] = useState(null); // id of expanded event
  const [showNewForm, setShowNewForm] = useState(false);

  async function handleAiEmpregados() {
    if (!aiEmpInput.trim()) return;
    setAiEmpPreview(null);
    const cargosDisponiveis = restRoles.filter(r=>!r.inactive).map(r=>`- cargo:"${r.name}" area:"${r.area}" id:"${r.id}"`).join("\n");
    const empregadosExistentes = restEmps.map(e => {
      const r = restRoles.find(r=>r.id===e.roleId);
      return `- id:"${e.id}" nome:"${e.name}" cargo:"${r?.name??"(sem cargo)"}" cpf:"${e.cpf||""}" producao:${!!e.isProducao} inativo:${!!e.inactive}`;
    }).join("\n");
    const result = await aiEmpGenerate(
        `Você é um assistente de gestão de restaurantes. O usuário pode pedir para CRIAR novos empregados, MODIFICAR empregados existentes (trocar cargo, CPF, admissão, produção) ou INATIVAR empregados.

Cargos disponíveis:
${cargosDisponiveis || "(nenhum)"}

Empregados existentes:
${empregadosExistentes || "(nenhum)"}

Regras:
- Para CRIAR: "nome" obrigatório (nome completo). "cargo" = nome do cargo (deve ser um da lista acima). "admissao" no formato YYYY-MM-DD, se não informado use ${today()}. "cpf" apenas se explicitamente mencionado. "producao" = true/false (se o empregado é da produção).
- Para MODIFICAR: use o "id" do empregado existente, inclua APENAS os campos que mudam. "cargo" = nome do novo cargo.
- Para INATIVAR: use o "id" do empregado existente.
- Deduza o cargo pelo nome/função quando possível (garçom→Garçom, barman→Barman, cozinheiro→Cozinheiro, etc.)
- Se o usuário mencionar "produção" para um empregado, marque producao:true

Responda com JSON:
{
  "criar": [{"nome":"...", "cargo":"nome do cargo", "admissao":"YYYY-MM-DD", "cpf":null, "producao":false}],
  "modificar": [{"id":"...", "cargo":"novo cargo", "cpf":"...", "producao":true}],
  "inativar": ["id1", "id2"]
}
Inclua apenas as ações solicitadas. Arrays vazios se não houver ação daquele tipo.`,
      aiEmpInput.trim()
    );
    if (!result) return;

    // Build preview
      const restCode = restCode_ || "XXX";
      let seq = nextEmpSeq(employees, restCode);
      const matchCargo = (nomeCargo) => {
        if (!nomeCargo) return null;
        const lower = nomeCargo.toLowerCase().trim();
        return restRoles.find(r => !r.inactive && r.name.toLowerCase() === lower)
          ?? restRoles.find(r => !r.inactive && r.name.toLowerCase().includes(lower))
          ?? restRoles.find(r => !r.inactive && lower.includes(r.name.toLowerCase()))
          ?? null;
      };

      const preview = {
        criar: (result.criar ?? []).map(e => {
          const role = matchCargo(e.cargo);
          const empCode = makeEmpCode(restCode, seq);
          const pin = String(seq).padStart(4,"0");
          seq++;
          return {
            id: Date.now().toString() + Math.random().toString(36).slice(2,6),
            empCode, pin,
            name: e.nome,
            cpf: e.cpf || "",
            admission: e.admissao || DEFAULT_ADMISSION(),
            roleId: role?.id || "",
            roleName: role?.name || e.cargo || "(não encontrado)",
            roleMatched: !!role,
            isProducao: !!e.producao,
            restaurantId: rid,
            mustChangePin: true,
          };
        }),
        modificar: (result.modificar ?? []).map(m => {
          const existing = restEmps.find(e => e.id === m.id);
          if (!existing) return null;
          const existingRole = restRoles.find(r => r.id === existing.roleId);
          const newRole = m.cargo ? matchCargo(m.cargo) : null;
          return {
            id: m.id,
            name: existing.name,
            oldRoleName: existingRole?.name ?? "(sem cargo)",
            newRoleName: newRole?.name ?? m.cargo ?? null,
            newRoleId: newRole?.id ?? null,
            roleMatched: m.cargo ? !!newRole : true,
            cpf: m.cpf !== undefined ? m.cpf : null,
            producao: m.producao !== undefined ? m.producao : null,
          };
        }).filter(Boolean),
        inativar: (result.inativar ?? []).map(id => restEmps.find(e => e.id === id)).filter(Boolean),
      };

    if (!preview.criar.length && !preview.modificar.length && !preview.inativar.length) {
      setAiEmpError("A IA não identificou nenhuma ação. Tente reformular.");
    } else if (activeCount + preview.criar.length > plano.empMax) {
      setAiEmpError(`Limite do plano: ${plano.empMax} empregados. Você tem ${activeCount} ativos e está tentando adicionar ${preview.criar.length}.`);
    } else {
      setAiEmpPreview(preview);
    }
  }

  function confirmAiEmpChanges() {
    if (!aiEmpPreview) return;
    let updated = [...employees];
    // Criar
    aiEmpPreview.criar.forEach(e => {
      updated.push({ id: e.id, restaurantId: e.restaurantId, empCode: e.empCode, name: e.name, cpf: e.cpf, admission: e.admission, pin: e.pin, roleId: e.roleId, mustChangePin: true, isProducao: e.isProducao || undefined });
    });
    // Modificar
    aiEmpPreview.modificar.forEach(m => {
      updated = updated.map(e => {
        if (e.id !== m.id) return e;
        const changes = {};
        if (m.newRoleId) changes.roleId = m.newRoleId;
        if (m.cpf !== null) changes.cpf = m.cpf;
        if (m.producao !== null) changes.isProducao = m.producao;
        return { ...e, ...changes };
      });
    });
    // Inativar
    aiEmpPreview.inativar.forEach(e => {
      updated = updated.map(x => x.id === e.id ? { ...x, inactive: true, inactiveFrom: today() } : x);
    });
    onUpdate("employees", updated);
    const total = aiEmpPreview.criar.length + aiEmpPreview.modificar.length + aiEmpPreview.inativar.length;
    onUpdate("_toast", `✨ ${total} ação(ões) aplicada(s) pela IA!`);
    setAiEmpPreview(null); setAiEmpInput(""); setShowAiEmp(false);
  }

  const sorted = [...restEmps].sort((a,b) => {
    const rA = restRoles.find(r=>r.id===a.roleId);
    const rB = restRoles.find(r=>r.id===b.roleId);
    return (rA?.area??"z").localeCompare(rB?.area??"z") || a.name.localeCompare(b.name);
  });
  const activeEmps   = sorted.filter(e => !e.inactive || (e.inactiveFrom && e.inactiveFrom > today()));
  const inactiveEmps = sorted.filter(e => e.inactive && e.inactiveFrom && e.inactiveFrom <= today());
  const list = showInactive ? inactiveEmps : activeEmps;

  function getRow(emp) {
    return { name:emp.name||"", cpf:emp.cpf||"", admission:emp.admission||"", roleId:emp.roleId||"", inactiveFrom:emp.inactiveFrom||"", ...(editRows[emp.id]??{}) };
  }

  function setField(id, field, val) {
    setEditRows(prev => ({ ...prev, [id]: { ...(prev[id]??{}), [field]: val } }));
  }

  function saveEmp(emp) {
    setEditRows(prev => {
      const row = { name:emp.name||"", cpf:emp.cpf||"", admission:emp.admission||"", roleId:emp.roleId||"", inactiveFrom:emp.inactiveFrom||"", ...(prev[emp.id]??{}) };
      if (!row.name.trim()) return prev;
      onUpdate("employees", employees.map(x => x.id===emp.id ? {...emp, name:row.name.trim(), cpf:row.cpf, admission:row.admission, roleId:row.roleId, inactiveFrom:row.inactiveFrom} : x));
      setSaved(p=>({...p,[emp.id]:true}));
      setTimeout(()=>setSaved(p=>({...p,[emp.id]:false})),1500);
      return prev;
    });
  }

  function saveNew() {
    if (!newRow.name.trim()) return;
    if (activeCount >= plano.empMax) {
      alert(`⚠️ Limite do plano atingido (${plano.empMax} empregados).\n\nPara adicionar mais empregados, faça upgrade do plano com seu administrador.`);
      return;
    }
    const restCode = restCode_ || "XXX";
    const seq = nextEmpSeq(employees, restCode);
    const empCode = makeEmpCode(restCode, seq);
    const pin = newRow.pin || String(seq).padStart(4,"0");
    onUpdate("employees", [...employees, { ...newRow, admission: newRow.admission || DEFAULT_ADMISSION(), id:Date.now().toString(), empCode, pin, restaurantId:rid }]);
    setNewRow(blank());
  }

  function toggleInactive(emp) {
    const row = getRow(emp);
    onUpdate("employees", employees.map(x => x.id===emp.id ? {...emp, inactive:!emp.inactive, inactiveFrom:row.inactiveFrom||today()} : x));
  }

  function dismissEmp(emp) {
    const dataStr = window.prompt(`Demitir "${emp.name}"?\n\nInforme a data da demissão (DD/MM/AAAA):`, new Date().toLocaleDateString("pt-BR"));
    if (!dataStr) return;
    const parts = dataStr.split("/");
    if (parts.length !== 3) { window.alert("Data inválida. Use o formato DD/MM/AAAA."); return; }
    const [dd,mm,yyyy] = parts;
    const demitidoEm = `${yyyy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`;
    if (isNaN(new Date(demitidoEm+"T12:00:00").getTime())) { window.alert("Data inválida."); return; }
    if (!window.confirm(`Confirmar demissão de "${emp.name}" em ${dataStr}?\n\nA partir desta data:\n• Sai do cálculo de gorjeta\n• Consta como "DEM" na escala\n• No próximo mês será movido para inativo`)) return;
    onUpdate("employees", employees.map(x => x.id===emp.id ? {...x, demitidoEm, demitidoPor: isOwner ? "Gestor AppTip" : "Gestor Adm.", inactive: true, inactiveFrom: demitidoEm} : x));
    onUpdate("_toast", `📋 ${emp.name} demitido em ${dataStr}`);
  }

  function undoDismiss(emp) {
    if (!window.confirm(`Reverter demissão de "${emp.name}"?`)) return;
    onUpdate("employees", employees.map(x => {
      if (x.id !== emp.id) return x;
      const copy = {...x};
      delete copy.demitidoEm;
      delete copy.demitidoPor;
      return copy;
    }));
    onUpdate("_toast", `↩️ Demissão de ${emp.name} revertida`);
  }

  function promoteEmp(emp) {
    const available = restRoles.filter(r => !r.inactive && r.id !== emp.roleId);
    if (!available.length) { onUpdate("_toast", "Não há outros cargos ativos disponíveis."); return; }
    const options = available.map((r, i) => `${i+1}. ${r.name} (${r.area}, ${r.points}pt)`).join("\n");
    const choice = window.prompt(`Promover "${emp.name}"\n\nEscolha o novo cargo (digite o número):\n${options}`);
    if (!choice) return;
    const idx = parseInt(choice) - 1;
    if (isNaN(idx) || idx < 0 || idx >= available.length) { window.alert("Opção inválida."); return; }
    const newRole = available[idx];
    const dataStr = window.prompt(`Data efetiva da mudança para "${newRole.name}" (DD/MM/AAAA):`, new Date().toLocaleDateString("pt-BR"));
    if (!dataStr) return;
    const parts = dataStr.split("/");
    if (parts.length !== 3) { window.alert("Data inválida."); return; }
    const [dd,mm,yyyy] = parts;
    const effectiveDate = `${yyyy}-${mm.padStart(2,"0")}-${dd.padStart(2,"0")}`;
    if (isNaN(new Date(effectiveDate+"T12:00:00").getTime())) { window.alert("Data inválida."); return; }
    const reason = window.prompt("Motivo (opcional):") || "";
    const changedBy = isOwner ? "Gestor AppTip" : "Gestor Adm.";
    const oldRole = restRoles.find(r => r.id === emp.roleId);

    if (effectiveDate <= today()) {
      const historyEntry = { fromRoleId: emp.roleId, toRoleId: newRole.id, date: effectiveDate, reason, changedBy };
      const history = [...(emp.roleHistory ?? []), historyEntry];
      if (!window.confirm(`Confirmar mudança de cargo de "${emp.name}"?\n\n${oldRole?.name ?? "—"} → ${newRole.name}\nData: ${dataStr}\n${reason ? "Motivo: " + reason : ""}`)) return;
      onUpdate("employees", employees.map(e => e.id === emp.id ? { ...e, roleId: newRole.id, roleHistory: history } : e));
      onUpdate("_toast", `⬆️ ${emp.name}: ${oldRole?.name ?? "—"} → ${newRole.name}`);
    } else {
      if (!window.confirm(`Agendar mudança de cargo de "${emp.name}"?\n\n${oldRole?.name ?? "—"} → ${newRole.name}\nData efetiva: ${dataStr}\n${reason ? "Motivo: " + reason : ""}\n\nA troca será aplicada automaticamente na data.`)) return;
      const pending = { newRoleId: newRole.id, effectiveDate, reason, changedBy };
      onUpdate("employees", employees.map(e => e.id === emp.id ? { ...e, pendingRoleChange: pending } : e));
      onUpdate("_toast", `📅 Promoção de ${emp.name} agendada para ${dataStr}`);
    }
  }

  function deleteEmp(emp) {
    if (!window.confirm(`Excluir permanentemente "${emp.name}"? Esta ação não pode ser desfeita.`)) return;
    onUpdate("employees", employees.filter(x => x.id !== emp.id));
  }

  function resetPin(emp) {
    const numericPin = (emp.empCode ?? "").replace(/\D/g, "").padStart(4, "0"); // sempre 4 dígitos ex: "0005"
    if (!window.confirm(`Resetar PIN de "${emp.name}"?\n\nO PIN voltará para ${numericPin} e ele será obrigado a trocar no próximo acesso.`)) return;
    onUpdate("employees", employees.map(x => x.id===emp.id ? {...x, pin: numericPin, mustChangePin: true} : x));
    onUpdate("_toast", `🔑 PIN de ${emp.name} resetado para ${numericPin}`);
  }

  const detailEmpObj = detailEmp ? restEmps.find(e => e.id === detailEmp) : null;
  const detailRole = detailEmpObj ? restRoles.find(r => r.id === detailEmpObj.roleId) : null;

  // ── Status badge helper ──
  const statusBadge = (emp) => {
    const isDem = emp.demitidoEm && emp.demitidoEm <= today();
    const isInact = emp.inactive && emp.inactiveFrom && emp.inactiveFrom <= today();
    const hasPending = !!emp.pendingRoleChange;
    if (isDem) return { label:"Demitido", bg:"#e74c3c22", color:"var(--red)" };
    if (isInact) return { label:"Inativo", bg:"#8b5cf622", color:"#8b5cf6" };
    if (hasPending) return { label:"Promoção agendada", bg:"#3b82f622", color:"#3b82f6" };
    return { label:"Ativo", bg:"#10b98122", color:"var(--green)" };
  };

  // ── Detail tab pill style ──
  const dtPill = (tab, active) => ({
    padding:"7px 16px", borderRadius:10, border:`1px solid ${active?"var(--accent)":"var(--border)"}`,
    background:active?"var(--accent)11":"transparent", color:active?"var(--accent)":"var(--text3)",
    cursor:"pointer", fontFamily:"'DM Mono',monospace", fontSize:12, fontWeight:active?700:400
  });

  return (
    <div style={{fontFamily:"'DM Mono',monospace"}}>

      {/* ═══════════════════════ DETAIL VIEW ═══════════════════════ */}
      {detailEmp && detailEmpObj && (() => {
        const emp = detailEmpObj;
        const role = detailRole;
        const empIncidents = (incidents??[]).filter(i => i.restaurantId === rid && (i.employeeIds??[]).includes(emp.id) && !i.deletedAt);
        const empFeedbacks = (feedbacks??[]).filter(f => f.restaurantId === rid && f.employeeId === emp.id && !f.deletedAt);
        const negCount = empIncidents.filter(i => { const t = INCIDENT_TYPES.find(x=>x.id===i.type); return t?.negative; }).length;
        const posCount = empIncidents.filter(i => { const t = INCIDENT_TYPES.find(x=>x.id===i.type); return !t?.negative; }).length;
        const avgStars = empFeedbacks.length > 0 ? (empFeedbacks.reduce((a,f)=>a+(f.stars??0),0)/empFeedbacks.length).toFixed(1) : "—";
        const badge = statusBadge(emp);
        const isDemitido = emp.demitidoEm && emp.demitidoEm <= today();
        const isInactive = emp.inactive && emp.inactiveFrom && emp.inactiveFrom <= today();
        const row = getRow(emp);
        return (
          <div>
            {/* Back */}
            <button onClick={()=>{setDetailEmp(null);setDetailTab("cadastro");setShowIncForm(false);setShowFbForm(false);}} style={{background:"none",border:"none",color:"var(--accent)",cursor:"pointer",fontSize:13,fontFamily:"'DM Mono',monospace",padding:"4px 0",marginBottom:12,display:"flex",alignItems:"center",gap:4}}>
              ← Voltar para equipe
            </button>

            {/* Header card */}
            <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:14,padding:16,marginBottom:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12}}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                    <span style={{fontSize:18,fontWeight:700,color:"var(--text)"}}>{emp.name}</span>
                    <span style={{fontSize:10,padding:"2px 8px",borderRadius:6,background:badge.bg,color:badge.color,fontWeight:700}}>{badge.label}</span>
                    {emp.isProducao && <span style={{fontSize:10,padding:"2px 8px",borderRadius:6,background:"#ec489922",color:"#ec4899",fontWeight:700}}>Produção</span>}
                    {emp.isFreela && <span style={{fontSize:10,padding:"2px 8px",borderRadius:6,background:"#06b6d422",color:"#06b6d4",fontWeight:700}}>Freela</span>}
                  </div>
                  <div style={{fontSize:12,color:"var(--text3)",marginTop:4}}>{role?.name ?? "Sem cargo"} · {role?.area ?? "Sem área"} · {emp.empCode ?? "—"}</div>
                </div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  <div style={{textAlign:"center",padding:"6px 12px",background:"var(--bg3)",borderRadius:10}}>
                    <div style={{fontSize:16,fontWeight:700,color:"var(--red)"}}>{negCount}</div>
                    <div style={{fontSize:9,color:"var(--text3)"}}>Ocorrências</div>
                  </div>
                  <div style={{textAlign:"center",padding:"6px 12px",background:"var(--bg3)",borderRadius:10}}>
                    <div style={{fontSize:16,fontWeight:700,color:"var(--green)"}}>{posCount}</div>
                    <div style={{fontSize:9,color:"var(--text3)"}}>Elogios</div>
                  </div>
                  <div style={{textAlign:"center",padding:"6px 12px",background:"var(--bg3)",borderRadius:10}}>
                    <div style={{fontSize:16,fontWeight:700,color:"#f59e0b"}}>{avgStars}</div>
                    <div style={{fontSize:9,color:"var(--text3)"}}>Avaliação</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Tab pills */}
            <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
              <button onClick={()=>setDetailTab("cadastro")} style={dtPill("cadastro",detailTab==="cadastro")}>Cadastro</button>
              <button onClick={()=>setDetailTab("acoes")} style={dtPill("acoes",detailTab==="acoes")}>Ações</button>
              <button onClick={()=>setDetailTab("trilha")} style={dtPill("trilha",detailTab==="trilha")}>Trilha</button>
            </div>

            {/* ── TAB: Cadastro ── */}
            {detailTab === "cadastro" && (
              <div style={{background:"var(--card-bg)",border:"1px solid var(--border)",borderRadius:12,padding:16}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <div>
                    <label style={{fontSize:10,color:"var(--text3)",fontWeight:700,display:"block",marginBottom:4}}>Nome completo</label>
                    <input value={row.name} onChange={ev=>setField(emp.id,"name",ev.target.value)} style={{...S.input,fontSize:13}}/>
                  </div>
                  <div>
                    <label style={{fontSize:10,color:"var(--text3)",fontWeight:700,display:"block",marginBottom:4}}>CPF</label>
                    {privacyMask
                      ? <div style={{...S.input,fontSize:13,display:"flex",alignItems:"center",color:"var(--text3)"}}>•••.•••.•••-••</div>
                      : <input value={row.cpf||""} onChange={ev=>setField(emp.id,"cpf",maskCpf(ev.target.value))} placeholder="000.000.000-00" style={{...S.input,fontSize:13}} inputMode="numeric"/>
                    }
                  </div>
                  <div>
                    <label style={{fontSize:10,color:"var(--text3)",fontWeight:700,display:"block",marginBottom:4}}>Data de admissão</label>
                    <input type="date" value={row.admission||""} onChange={ev=>setField(emp.id,"admission",ev.target.value)} style={{...S.input,fontSize:13}}/>
                  </div>
                  <div>
                    <label style={{fontSize:10,color:"var(--text3)",fontWeight:700,display:"block",marginBottom:4}}>Cargo</label>
                    <select value={row.roleId||""} onChange={ev=>setField(emp.id,"roleId",ev.target.value)} style={{...S.input,fontSize:13,cursor:"pointer"}}>
                      <option value="">Selecionar…</option>
                      {AREAS.map(a=>(
                        <optgroup key={a} label={a}>
                          {restRoles.filter(r=>r.area===a&&!r.inactive).map(r=><option key={r.id} value={r.id}>{r.name} ({r.points}pt)</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{fontSize:10,color:"var(--text3)",fontWeight:700,display:"block",marginBottom:4}}>Código</label>
                    <div style={{...S.input,fontSize:13,background:"var(--bg3)",color:"var(--accent)",fontWeight:700}}>{emp.empCode ?? "—"}</div>
                  </div>
                  <div>
                    <label style={{fontSize:10,color:"var(--text3)",fontWeight:700,display:"block",marginBottom:4}}>Flags</label>
                    <div style={{display:"flex",gap:8}}>
                      <button onClick={()=>onUpdate("employees",employees.map(x=>x.id===emp.id?{...x,isProducao:!x.isProducao}:x))} style={{padding:"6px 12px",borderRadius:8,border:`1px solid ${emp.isProducao?"#ec4899":"var(--border)"}`,background:emp.isProducao?"#ec489922":"transparent",color:emp.isProducao?"#ec4899":"var(--text3)",cursor:"pointer",fontSize:11,fontFamily:"'DM Mono',monospace"}}>
                        {emp.isProducao ? "🏭 Produção ✓" : "🏭 Produção"}
                      </button>
                      <button onClick={()=>onUpdate("employees",employees.map(x=>x.id===emp.id?{...x,isFreela:!x.isFreela}:x))} style={{padding:"6px 12px",borderRadius:8,border:`1px solid ${emp.isFreela?"#06b6d4":"var(--border)"}`,background:emp.isFreela?"#06b6d422":"transparent",color:emp.isFreela?"#06b6d4":"var(--text3)",cursor:"pointer",fontSize:11,fontFamily:"'DM Mono',monospace"}}>
                        {emp.isFreela ? "🎯 Freela ✓" : "🎯 Freela"}
                      </button>
                    </div>
                  </div>
                </div>
                <div style={{marginTop:14,display:"flex",gap:8}}>
                  <button onClick={()=>saveEmp(emp)} style={{...S.btnPrimary,fontSize:13}}>
                    {saved[emp.id] ? "✓ Salvo" : "Salvar alterações"}
                  </button>
                </div>
              </div>
            )}

            {/* ── TAB: Ações ── */}
            {detailTab === "acoes" && (
              <div style={{background:"var(--card-bg)",border:"1px solid var(--border)",borderRadius:12,padding:16}}>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {/* Promoção */}
                  {!isDemitido && !isInactive && (
                    <button onClick={()=>promoteEmp(emp)} style={{display:"flex",alignItems:"center",gap:8,padding:"12px 16px",borderRadius:10,border:"1px solid #3b82f633",background:"#3b82f609",color:"var(--text)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:13,textAlign:"left"}}>
                      <span style={{fontSize:18}}>⬆️</span>
                      <div><div style={{fontWeight:700,color:"#3b82f6"}}>Promover / Mudar cargo</div><div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>Alterar cargo com data efetiva imediata ou agendada</div></div>
                    </button>
                  )}
                  {emp.pendingRoleChange && (
                    <div style={{padding:"10px 16px",borderRadius:10,background:"#3b82f611",border:"1px solid #3b82f633",fontSize:12,color:"#3b82f6"}}>
                      📅 Promoção agendada → <strong>{restRoles.find(r=>r.id===emp.pendingRoleChange.newRoleId)?.name}</strong> em {new Date(emp.pendingRoleChange.effectiveDate+"T12:00:00").toLocaleDateString("pt-BR")}
                      {emp.pendingRoleChange.reason && <span style={{color:"var(--text3)",marginLeft:8}}>({emp.pendingRoleChange.reason})</span>}
                    </div>
                  )}
                  {/* Demitir */}
                  {!isDemitido && !isInactive && (
                    <button onClick={()=>dismissEmp(emp)} style={{display:"flex",alignItems:"center",gap:8,padding:"12px 16px",borderRadius:10,border:"1px solid #e74c3c33",background:"#e74c3c09",color:"var(--text)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:13,textAlign:"left"}}>
                      <span style={{fontSize:18}}>📋</span>
                      <div><div style={{fontWeight:700,color:"var(--red)"}}>Demitir</div><div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>Registrar desligamento com data</div></div>
                    </button>
                  )}
                  {/* Reverter demissão */}
                  {isDemitido && (
                    <>
                      <div style={{padding:"10px 16px",borderRadius:10,background:"#e74c3c11",border:"1px solid #e74c3c33",fontSize:12,color:"var(--red)"}}>
                        Demitido em {new Date(emp.demitidoEm+"T12:00:00").toLocaleDateString("pt-BR")} por {emp.demitidoPor ?? "—"}
                      </div>
                      <button onClick={()=>undoDismiss(emp)} style={{display:"flex",alignItems:"center",gap:8,padding:"12px 16px",borderRadius:10,border:"1px solid #10b98133",background:"#10b98109",color:"var(--text)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:13,textAlign:"left"}}>
                        <span style={{fontSize:18}}>↩️</span>
                        <div><div style={{fontWeight:700,color:"var(--green)"}}>Reverter demissão</div><div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>Retornar empregado ao status anterior</div></div>
                      </button>
                      {onGenerateDismissalReport && (
                        <button onClick={()=>{
                          // Pre-dismissal checklist (#71)
                          setDismissalCheckEmp(emp);
                          setShowDismissalChecklist(true);
                        }} style={{display:"flex",alignItems:"center",gap:8,padding:"12px 16px",borderRadius:10,border:"1px solid #3b82f633",background:"#3b82f609",color:"var(--text)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:13,textAlign:"left"}}>
                          <span style={{fontSize:18}}>📄</span>
                          <div><div style={{fontWeight:700,color:"#3b82f6"}}>Relatório de desligamento</div><div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>Exportar PDF com dados e gorjetas</div></div>
                        </button>
                      )}
                      {/* VT balance card for dismissed employee (#70) */}
                      {(() => {
                        const demMk2 = emp.demitidoEm?.slice(0,7);
                        if (!demMk2) return null;
                        const [demY2, demM2] = demMk2.split("-").map(Number);
                        const demDay2 = parseInt(emp.demitidoEm?.slice(8,10) ?? "0");
                        const daysInDemMonth2 = new Date(demY2, demM2, 0).getDate();
                        const vtPay2 = vtPayments?.[rid]?.[demMk2];
                        const vtSnap2 = vtPay2?.snapshot?.find(s => s.empId === emp.id);
                        const vtCfg2 = vtConfig?.[rid]?.[emp.id];
                        const rate2 = vtSnap2?.dailyRate ?? vtCfg2?.dailyRate ?? 0;
                        if (rate2 === 0) return null;
                        const schedMap2 = schedules?.[rid]?.[demMk2]?.[emp.id] ?? {};
                        let planned2 = vtSnap2?.plannedDays ?? 0;
                        let worked2 = 0;
                        if (!vtSnap2) {
                          for (let dd = 1; dd <= daysInDemMonth2; dd++) {
                            const ds = `${demY2}-${String(demM2).padStart(2,"0")}-${String(dd).padStart(2,"0")}`;
                            if (!schedMap2[ds] || schedMap2[ds] === "comptrab") planned2++;
                          }
                        }
                        for (let dd = 1; dd < demDay2 && dd <= daysInDemMonth2; dd++) {
                          const ds = `${demY2}-${String(demM2).padStart(2,"0")}-${String(dd).padStart(2,"0")}`;
                          if (!schedMap2[ds] || schedMap2[ds] === "comptrab") worked2++;
                        }
                        const vtPaid2 = round2(rate2 * planned2);
                        const vtOwed2 = round2(rate2 * worked2);
                        const toReturn2 = Math.max(0, round2(vtPaid2 - vtOwed2));
                        // Previous month pending adjust
                        const prevDemDate2 = new Date(demY2, demM2 - 2, 1);
                        const prevDemMk2 = `${prevDemDate2.getFullYear()}-${String(prevDemDate2.getMonth()+1).padStart(2,"0")}`;
                        const prevPay2 = vtPayments?.[rid]?.[prevDemMk2];
                        let pendAdj2 = 0;
                        if (prevPay2?.snapshot) {
                          const ps2 = prevPay2.snapshot.find(s => s.empId === emp.id);
                          if (ps2) {
                            const pLastDay = new Date(prevDemDate2.getFullYear(), prevDemDate2.getMonth()+1, 0).getDate();
                            const pMap = schedules?.[rid]?.[prevDemMk2]?.[emp.id] ?? {};
                            let pActual = 0;
                            for (let dd = 1; dd <= pLastDay; dd++) {
                              const ds = `${prevDemDate2.getFullYear()}-${String(prevDemDate2.getMonth()+1).padStart(2,"0")}-${String(dd).padStart(2,"0")}`;
                              if (!pMap[ds] || pMap[ds] === "comptrab") pActual++;
                            }
                            pendAdj2 = round2((pActual - ps2.plannedDays) * ps2.dailyRate);
                          }
                        }
                        return (
                          <div style={{padding:"12px 16px",borderRadius:10,background:"#10b98109",border:"1px solid #10b98133"}}>
                            <div style={{fontWeight:700,color:"var(--green)",fontSize:12,marginBottom:8}}>{"🚌"} Saldo VT no desligamento</div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,fontSize:11,color:"var(--text2)"}}>
                              <span>VT pago (mês):</span><span style={{textAlign:"right",fontFamily:"'DM Mono',monospace"}}>R$ {vtPaid2.toFixed(2).replace(".",",")}</span>
                              <span>Dias trabalhados:</span><span style={{textAlign:"right",fontFamily:"'DM Mono',monospace"}}>{worked2}d</span>
                              <span>A restituir:</span><span style={{textAlign:"right",fontFamily:"'DM Mono',monospace",color:"var(--red)",fontWeight:700}}>R$ {toReturn2.toFixed(2).replace(".",",")}</span>
                              {pendAdj2 !== 0 && <><span>Ajuste pendente ant.:</span><span style={{textAlign:"right",fontFamily:"'DM Mono',monospace",color:pendAdj2>0?"var(--green)":"var(--red)"}}>R$ {pendAdj2.toFixed(2).replace(".",",")}</span></>}
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  )}
                  {/* Inativar/Reativar */}
                  {!isDemitido && (
                    <button onClick={()=>toggleInactive(emp)} style={{display:"flex",alignItems:"center",gap:8,padding:"12px 16px",borderRadius:10,border:`1px solid ${isInactive?"#10b98133":"#f59e0b33"}`,background:isInactive?"#10b98109":"#f59e0b09",color:"var(--text)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:13,textAlign:"left"}}>
                      <span style={{fontSize:18}}>{isInactive ? "↑" : "↓"}</span>
                      <div><div style={{fontWeight:700,color:isInactive?"var(--green)":"#f59e0b"}}>{isInactive ? "Reativar empregado" : "Inativar empregado"}</div><div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>{isInactive ? "Mover de volta para ativos" : "Mover para inativos temporariamente"}</div></div>
                    </button>
                  )}
                  {/* Reset PIN */}
                  <button onClick={()=>resetPin(emp)} style={{display:"flex",alignItems:"center",gap:8,padding:"12px 16px",borderRadius:10,border:"1px solid #f59e0b33",background:"#f59e0b09",color:"var(--text)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:13,textAlign:"left"}}>
                    <span style={{fontSize:18}}>🔑</span>
                    <div><div style={{fontWeight:700,color:"#f59e0b"}}>Resetar PIN</div><div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>PIN volta para código do empregado, troca obrigatória no próximo acesso</div></div>
                  </button>
                  {/* Excluir */}
                  {isOwner && isInactive && (
                    <button onClick={()=>deleteEmp(emp)} style={{display:"flex",alignItems:"center",gap:8,padding:"12px 16px",borderRadius:10,border:"1px solid #e74c3c33",background:"#e74c3c09",color:"var(--text)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:13,textAlign:"left"}}>
                      <span style={{fontSize:18}}>🗑️</span>
                      <div><div style={{fontWeight:700,color:"var(--red)"}}>Excluir permanentemente</div><div style={{fontSize:11,color:"var(--text3)",marginTop:2}}>Remove o empregado do sistema (irreversível)</div></div>
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ── TAB: Trilha ── */}
            {detailTab === "trilha" && (() => {
              // ── Compute shared data for trilha sections ──
              const admDate = emp.admission ? new Date(emp.admission+"T12:00:00") : null;
              const daysInCompany = admDate ? Math.floor((new Date() - admDate) / 86400000) : 0;
              const areaColor = AREA_COLORS[role?.area] ?? "var(--ac)";
              const myFeedbacksAll = (feedbacks??[]).filter(f => f.restaurantId === rid && f.employeeId === emp.id);
              const myFeedbacks = myFeedbacksAll.filter(f => !f.deletedAt).sort((a,b)=>(b.createdAt??"").localeCompare(a.createdAt??""));
              const latestFb = myFeedbacks[0];
              const lastMeetingDate = latestFb?.meetingDate ? new Date(latestFb.meetingDate+"T12:00:00").toLocaleDateString("pt-BR") : (latestFb?.createdAt ? new Date(latestFb.createdAt).toLocaleDateString("pt-BR") : null);
              const lastRating = latestFb?.rating ? RATING_LABELS[latestFb.rating - 1] : null;
              const lastRatingColor = latestFb?.rating ? RATING_COLORS[latestFb.rating - 1] : "var(--text3)";
              // Faltas 6 meses
              const now2 = new Date();
              const months6 = [];
              for (let i = 0; i < 6; i++) {
                const d = new Date(now2.getFullYear(), now2.getMonth() - i, 1);
                const mKey = monthKey(d.getFullYear(), d.getMonth());
                const lab = d.toLocaleDateString("pt-BR", { month:"short" }).replace(".","");
                const empSched = schedules?.[rid]?.[mKey]?.[emp.id] ?? {};
                const empDel = delays?.[rid]?.[mKey]?.[emp.id] ?? {};
                const faltasI = Object.values(empSched).filter(s => s === DAY_FAULT_U).length;
                const faltasJ = Object.values(empSched).filter(s => s === DAY_FAULT_J).length;
                const delayDays = Object.values(empDel).filter(v => v > 0).length;
                const delayMin = Object.values(empDel).filter(v => v > 0).reduce((s,v) => s+v, 0);
                const hasDays = Object.keys(empSched).length > 0;
                months6.push({ mKey, label:lab, faltasI, faltasJ, delayDays, delayMin, hasDays });
              }
              months6.reverse();
              const totFI = months6.reduce((s,m) => s+m.faltasI, 0);
              const totFJ = months6.reduce((s,m) => s+m.faltasJ, 0);
              const totDelDays = months6.reduce((s,m) => s+m.delayDays, 0);
              const totDelMin = months6.reduce((s,m) => s+m.delayMin, 0);
              // Badges
              const myGoalsAll = (employeeGoals ?? {})[emp.id] ?? [];
              const completedGoals = myGoalsAll.filter(g => g.status === "completed");
              const prevMk = monthKey(new Date(now2.getFullYear(), now2.getMonth()-1, 1).getFullYear(), new Date(now2.getFullYear(), now2.getMonth()-1, 1).getMonth());
              const prevMyDays = schedules?.[rid]?.[prevMk]?.[emp.id] ?? {};
              const prevFaults = Object.values(prevMyDays).filter(s => s === DAY_FAULT_U).length;
              const hasPrevData = Object.keys(prevMyDays).length > 0;
              const badgesNew = [];
              if (daysInCompany >= 365) badgesNew.push({ icon:"🏆", label:"1 Ano", desc:"Completou 1 ano na empresa" });
              else if (daysInCompany >= 180) badgesNew.push({ icon:"⭐", label:"6 Meses", desc:"6 meses de dedicação" });
              else if (daysInCompany >= 90) badgesNew.push({ icon:"🌟", label:"3 Meses", desc:"Primeiros 90 dias concluídos" });
              if ((emp?.roleHistory ?? []).length > 0) badgesNew.push({ icon:"⬆️", label:"Promovido", desc:"Já recebeu uma promoção" });
              if (latestFb?.rating === 5) badgesNew.push({ icon:"💎", label:"Excelência", desc:"Avaliação Excepcional" });
              if (completedGoals.length > 0) badgesNew.push({ icon:"🎯", label:"Objetivo Concluído", desc:`${completedGoals.length} objetivo${completedGoals.length>1?"s":""} finalizado${completedGoals.length>1?"s":""}` });
              if (hasPrevData && prevFaults === 0) badgesNew.push({ icon:"🔥", label:"Sem Faltas", desc:"0 faltas injustificadas no mês anterior" });
              const conhecGoals = completedGoals.filter(g => g.type === "conhecimento" && (g.metas??[]).length > 0 && (g.metas??[]).every(m => m.done));
              if (conhecGoals.length > 0) badgesNew.push({ icon:"📚", label:"Estudioso", desc:"Completou objetivo de conhecimento" });
              // Meeting plans
              const empPlans = (meetingPlans??[]).filter(p => p.restaurantId === rid && (p.employeeIds??[]).includes(emp.id)).sort((a,b)=>a.plannedDate.localeCompare(b.plannedDate));
              const upcomingPlans = empPlans.filter(p => p.plannedDate >= today()).slice(0,3);
              // overduePlan / nextPlan removed (unused)
              // Jornada events
              const jornadaEvents = (() => {
                if (!admDate) return [];
                const events = [];
                events.push({ date: admDate, label: "Admissão", icon: "🚀" });
                (emp.roleHistory ?? []).forEach(rh => {
                  if (rh.date) {
                    const newRole = (roles??restRoles).find(r => r.id === rh.newRoleId);
                    events.push({ date: new Date(rh.date + "T12:00:00"), label: `Promovido a ${newRole?.name ?? "novo cargo"}`, icon: "⬆️" });
                  }
                });
                [[90,"🌟","3 Meses"],[180,"⭐","6 Meses"],[365,"🏆","1 Ano"]].forEach(([days,ic,lb]) => {
                  if (daysInCompany >= days) {
                    const dEv = new Date(admDate.getTime() + days * 86400000);
                    events.push({ date: dEv, label: lb, icon: ic });
                  }
                });
                myFeedbacks.forEach(f => {
                  const isAval = f.meetingType === "avaliação" || (!f.meetingType && f.rating > 0);
                  events.push({ date: new Date(f.meetingDate ? f.meetingDate+"T12:00:00" : f.createdAt), label: isAval ? "Conversa de avaliação" : "Conversa de alinhamento", icon: isAval ? "📋" : "💬", type:"feedback", fb: f });
                });
                // Incidents
                const empIncsAll = (incidents??[]).filter(i => i.restaurantId === rid && (i.employeeIds??[]).includes(emp.id) && !i.deletedAt);
                empIncsAll.forEach(inc => {
                  const incType = INCIDENT_TYPES.find(x => x.id === inc.type);
                  const isNeg = incType?.negative;
                  events.push({ date: new Date(inc.date+"T12:00:00"), label: incType?.label ?? inc.type, icon: isNeg ? "🔴" : "🟢", type:"incident", inc, incNeg: isNeg });
                });
                upcomingPlans.forEach(p => {
                  const isAval = p.type === "avaliação";
                  events.push({ date: new Date(p.plannedDate+"T12:00:00"), label: isAval ? "Avaliação prevista" : "Alinhamento previsto", icon: "📅", future: true });
                });
                completedGoals.forEach(g => {
                  events.push({ date: new Date(g.createdAt), label: `Objetivo: ${g.title}`, icon: "🎯" });
                });
                events.sort((a,b) => a.date - b.date);
                return events;
              })();
              const gradients = [
                "linear-gradient(135deg,#fef3c7,#fde68a)",
                "linear-gradient(135deg,#dbeafe,#bfdbfe)",
                "linear-gradient(135deg,#d1fae5,#a7f3d0)",
                "linear-gradient(135deg,#ede9fe,#ddd6fe)",
                "linear-gradient(135deg,#fee2e2,#fecaca)",
                "linear-gradient(135deg,#ffedd5,#fed7aa)",
                "linear-gradient(135deg,#f0fdf4,#dcfce7)",
                "linear-gradient(135deg,#fdf4ff,#f5d0fe)",
              ];
              return (
              <div>
                {/* ── 1. Card do empregado com métricas ── */}
                <div style={{...S.card,marginBottom:16,padding:"20px"}}>
                  <div style={{display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
                    <div style={{width:56,height:56,borderRadius:28,background:`linear-gradient(135deg,${areaColor}cc,${areaColor})`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,fontWeight:700,color:"#fff",flexShrink:0}}>{(emp.name??"?").charAt(0)}</div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{color:"var(--text)",fontWeight:700,fontSize:18}}>{emp.name}</div>
                      <div style={{color:areaColor,fontSize:13,fontWeight:600}}>{role?.name ?? "—"}</div>
                      <div style={{color:"var(--text3)",fontSize:11}}>{role?.area ?? "—"} · {daysInCompany} dias na empresa{emp.admission ? ` · Admissão ${new Date(emp.admission+"T12:00:00").toLocaleDateString("pt-BR")}` : ""}</div>
                    </div>
                  </div>
                  {/* Mini-métricas */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginTop:14}}>
                    <div style={{padding:"8px 6px",borderRadius:10,background:totFI>0?"#ef444409":"#10b98109",textAlign:"center"}}>
                      <div style={{color:totFI>0?"#ef4444":"#10b981",fontWeight:700,fontSize:18}}>{totFI}</div>
                      <div style={{color:"var(--text3)",fontSize:9}}>Faltas 6m</div>
                    </div>
                    <div style={{padding:"8px 6px",borderRadius:10,background:"var(--border)22",textAlign:"center"}}>
                      <div style={{color:"var(--text)",fontWeight:700,fontSize:12,lineHeight:1.3}}>{lastMeetingDate ?? "—"}</div>
                      <div style={{color:"var(--text3)",fontSize:9}}>Última reunião</div>
                    </div>
                    <div style={{padding:"8px 6px",borderRadius:10,background:lastRating?lastRatingColor+"09":"var(--border)22",textAlign:"center"}}>
                      <div style={{color:lastRatingColor,fontWeight:700,fontSize:12,lineHeight:1.3}}>{lastRating ?? "—"}</div>
                      <div style={{color:"var(--text3)",fontSize:9}}>Última nota</div>
                    </div>
                  </div>
                </div>

                {/* ── Action buttons ── */}
                <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
                  <button onClick={()=>{setShowIncForm(!showIncForm);setShowFbForm(false);}} style={{padding:"8px 16px",borderRadius:10,border:`1px solid ${showIncForm?"var(--accent)":"var(--border)"}`,background:showIncForm?"var(--accent)11":"transparent",color:showIncForm?"var(--accent)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>
                    📋 Ocorrência
                  </button>
                  <button onClick={()=>{setShowFbForm(!showFbForm);setShowIncForm(false);}} style={{padding:"8px 16px",borderRadius:10,border:`1px solid ${showFbForm?"#f59e0b":"var(--border)"}`,background:showFbForm?"#f59e0b11":"transparent",color:showFbForm?"#f59e0b":"var(--text3)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>
                    💬 Reunião
                  </button>
                  <button onClick={async()=>{
                    const dateFrom = window.prompt("Data início (DD/MM/AAAA):", emp.admission ? new Date(emp.admission+"T12:00:00").toLocaleDateString("pt-BR") : "01/01/2026");
                    if (!dateFrom) return;
                    const dateTo = window.prompt("Data fim (DD/MM/AAAA):", new Date().toLocaleDateString("pt-BR"));
                    if (!dateTo) return;
                    const parseDate = (s) => { const p=s.split("/"); return p.length===3?`${p[2]}-${p[1].padStart(2,"0")}-${p[0].padStart(2,"0")}`:null; };
                    const fromISO = parseDate(dateFrom);
                    const toISO = parseDate(dateTo);
                    if (!fromISO || !toISO) { window.alert("Data inválida. Use DD/MM/AAAA."); return; }
                    try {
                      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
                      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
                      const { jsPDF } = window.jspdf;
                      const doc = new jsPDF({ orientation:"portrait", unit:"mm", format:"a4" });
                      const W = doc.internal.pageSize.getWidth();
                      let y = 15;
                      doc.setFontSize(16); doc.setTextColor(30,30,30);
                      doc.text("RELATÓRIO DA TRILHA DO EMPREGADO", W/2, y, {align:"center"}); y += 7;
                      doc.setFontSize(10); doc.setTextColor(100,100,100);
                      doc.text(`Período: ${dateFrom} a ${dateTo} — Gerado em ${new Date().toLocaleDateString("pt-BR")}`, W/2, y, {align:"center"}); y += 10;
                      doc.setFontSize(12); doc.setTextColor(30,30,30); doc.text("DADOS DO EMPREGADO", 14, y); y += 2;
                      doc.autoTable({ startY:y, head:[], body:[["Nome",emp.name],["Cargo",role?.name??"—"],["Área",role?.area??"—"],["Código",emp.empCode??"—"],["Admissão",emp.admission?new Date(emp.admission+"T12:00:00").toLocaleDateString("pt-BR"):"—"],["Status",emp.demitidoEm?`Demitido em ${new Date(emp.demitidoEm+"T12:00:00").toLocaleDateString("pt-BR")}`:emp.inactive?"Inativo":"Ativo"]], theme:"grid", styles:{fontSize:10,cellPadding:3}, columnStyles:{0:{fontStyle:"bold",cellWidth:45}}, margin:{left:14,right:14} });
                      y = doc.lastAutoTable.finalY + 8;
                      const empIncs = (incidents??[]).filter(i => i.restaurantId===rid && (i.employeeIds??[]).includes(emp.id) && !i.deletedAt && i.date>=fromISO && i.date<=toISO);
                      if (empIncs.length > 0) { if (y > 240) { doc.addPage(); y = 15; } doc.setFontSize(12); doc.text("OCORRÊNCIAS", 14, y); y += 2; doc.autoTable({ startY:y, head:[["Data","Tipo","Gravidade","Descrição"]], body:empIncs.sort((a,b)=>a.date.localeCompare(b.date)).map(inc => { const t = INCIDENT_TYPES.find(x=>x.id===inc.type); const sev = SEVERITY_OPTIONS.find(s=>s.id===inc.severity); return [new Date(inc.date+"T12:00:00").toLocaleDateString("pt-BR"),t?.label??inc.type,sev?.label??inc.severity??"—",(inc.description??"").slice(0,80)]; }), theme:"striped", styles:{fontSize:9,cellPadding:2}, headStyles:{fillColor:[59,130,246]}, columnStyles:{3:{cellWidth:70}}, margin:{left:14,right:14} }); y = doc.lastAutoTable.finalY + 8; }
                      const empFbsPdf = (feedbacks??[]).filter(f => f.restaurantId===rid && f.employeeId===emp.id && !f.deletedAt && ((f.meetingDate??f.createdAt??"").slice(0,10))>=fromISO && ((f.meetingDate??f.createdAt??"").slice(0,10))<=toISO);
                      if (empFbsPdf.length > 0) { if (y > 240) { doc.addPage(); y = 15; } doc.setFontSize(12); doc.text("REUNIÕES", 14, y); y += 2; doc.autoTable({ startY:y, head:[["Data","Tipo","Avaliação","Anotações","Pontos Positivos"]], body:empFbsPdf.sort((a,b)=>(a.meetingDate??a.createdAt??"").localeCompare(b.meetingDate??b.createdAt??"")).map(fb => { const isAv = fb.meetingType==="avaliação"||(!fb.meetingType&&fb.rating>0); return [fb.meetingDate?new Date(fb.meetingDate+"T12:00:00").toLocaleDateString("pt-BR"):(fb.createdAt?new Date(fb.createdAt).toLocaleDateString("pt-BR"):"—"),isAv?"Avaliação":"Alinhamento",fb.rating?(RATING_LABELS[fb.rating-1]??"—"):"—",(fb.notes??"").slice(0,50)||(fb.internalNotes??"").slice(0,50),(fb.strengths??"").slice(0,50)]; }), theme:"striped", styles:{fontSize:9,cellPadding:2}, headStyles:{fillColor:[59,130,246]}, margin:{left:14,right:14} }); y = doc.lastAutoTable.finalY + 8; }
                      const roleHist = (emp.roleHistory??[]).filter(rh=>rh.date>=fromISO && rh.date<=toISO);
                      if (roleHist.length > 0) { if (y > 250) { doc.addPage(); y = 15; } doc.setFontSize(12); doc.text("MUDANÇAS DE CARGO", 14, y); y += 2; doc.autoTable({ startY:y, head:[["Data","De","Para","Motivo"]], body:roleHist.map(rh => [new Date(rh.date+"T12:00:00").toLocaleDateString("pt-BR"),(roles??restRoles).find(r=>r.id===rh.fromRoleId)?.name??"—",(roles??restRoles).find(r=>r.id===rh.toRoleId)?.name??"—",rh.reason||"—"]), theme:"striped", styles:{fontSize:9,cellPadding:2}, headStyles:{fillColor:[139,92,246]}, margin:{left:14,right:14} }); y = doc.lastAutoTable.finalY + 8; }
                      if (y > 250) { doc.addPage(); y = 15; } doc.setFontSize(12); doc.text("RESUMO", 14, y); y += 2;
                      const negIncs = empIncs.filter(i => { const t=INCIDENT_TYPES.find(x=>x.id===i.type); return t?.negative; }); const posIncs = empIncs.filter(i => { const t=INCIDENT_TYPES.find(x=>x.id===i.type); return !t?.negative; });
                      doc.autoTable({ startY:y, head:[], body:[["Ocorrências negativas",String(negIncs.length)],["Ocorrências positivas",String(posIncs.length)],["Reuniões realizadas",String(empFbsPdf.length)],["Mudanças de cargo",String(roleHist.length)],["Avaliação média",empFbsPdf.length>0?(empFbsPdf.reduce((a,f)=>a+(f.rating||0),0)/empFbsPdf.length).toFixed(1):"—"]], theme:"grid", styles:{fontSize:10,cellPadding:3}, columnStyles:{0:{fontStyle:"bold",cellWidth:60}}, margin:{left:14,right:14} });
                      const pages = doc.internal.getNumberOfPages(); for (let i=1;i<=pages;i++) { doc.setPage(i); doc.setFontSize(8); doc.setTextColor(150,150,150); doc.text(`AppTip · Trilha de ${emp.name} · ${dateFrom} a ${dateTo} · Página ${i}/${pages}`, W/2, doc.internal.pageSize.getHeight()-8, {align:"center"}); }
                      const safeName = emp.name.replace(/[^a-zA-Z0-9]/g,"_").toLowerCase();
                      setPreviewDoc(doc); setPreviewFileName(`trilha_${safeName}_${fromISO}_${toISO}.pdf`);
                      onUpdate("_toast", `📄 Trilha de ${emp.name} exportada!`);
                    } catch(err) { console.error("Erro ao exportar trilha:", err); onUpdate("_toast", "⚠️ Erro ao exportar: " + (err.message || "desconhecido")); }
                  }} style={{padding:"8px 16px",borderRadius:10,border:"1px solid #3b82f644",background:"transparent",color:"#3b82f6",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>
                    📄 PDF
                  </button>
                </div>
                {showIncForm && <div style={{marginBottom:16}}><IncidentForm restaurantId={rid} employees={restEmps.filter(e=>!e.inactive)} onUpdate={onUpdate} incidents={incidents??[]} currentUser={currentUser} isOwner={isOwner} preSelectedEmpId={emp.id}/></div>}
                {showFbForm && <div style={{marginBottom:16}}><FeedbackForm restaurantId={rid} employees={restEmps.filter(e=>!e.inactive)} roles={restRoles} onUpdate={onUpdate} feedbacks={feedbacks??[]} currentUser={currentUser} isOwner={isOwner} preSelectedEmpId={emp.id} allMeetingPlans={meetingPlans??[]}/></div>}

                {/* Meeting alert removed — info now in Jornada timeline */}

                {/* ── 2. Conquistas / Badges ── */}
                {badgesNew.length > 0 && (
                  <div style={{marginBottom:16}}>
                    <h4 style={{color:"var(--text)",margin:"0 0 10px",fontSize:14}}>🏅 Conquistas</h4>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      {badgesNew.map((b,i) => (
                        <div key={i} style={{borderRadius:12,padding:"14px 12px",background:gradients[i % gradients.length],display:"flex",alignItems:"center",gap:10,boxShadow:"0 1px 3px rgba(0,0,0,0.06)"}}>
                          <div style={{width:40,height:40,borderRadius:20,background:"rgba(255,255,255,0.7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{b.icon}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{color:"#1f2937",fontWeight:700,fontSize:12,lineHeight:1.2}}>{b.label}</div>
                            <div style={{color:"#6b7280",fontSize:10,lineHeight:1.3,marginTop:1}}>{b.desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── 3. Próximas reuniões planejadas ── */}
                {upcomingPlans.length > 0 && (
                  <div style={{marginBottom:16}}>
                    <h4 style={{color:"var(--text)",margin:"0 0 10px",fontSize:14}}>📅 Próximas reuniões</h4>
                    {upcomingPlans.map(p => {
                      const pDate = new Date(p.plannedDate+"T12:00:00");
                      const todayD = new Date(); todayD.setHours(0,0,0,0);
                      const diff = Math.round((pDate - todayD) / 86400000);
                      const isAval = p.type === "avaliação";
                      const pColor = isAval ? "#8b5cf6" : "#3b82f6";
                      return (
                        <div key={p.id} style={{...S.card,padding:"14px 16px",marginBottom:8,display:"flex",alignItems:"center",gap:10,borderLeft:`4px solid ${pColor}`}}>
                          <span style={{fontSize:20}}>📅</span>
                          <div style={{flex:1}}>
                            <div style={{color:"var(--text)",fontWeight:600,fontSize:13}}>{isAval ? "Conversa de avaliação" : "Conversa de alinhamento"}</div>
                            <div style={{color:"var(--text3)",fontSize:12}}>{diff === 0 ? "Hoje" : diff === 1 ? "Amanhã" : `Em ${diff} dia${diff!==1?"s":""}`} · {pDate.toLocaleDateString("pt-BR")}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* ── 4. Objetivos ── */}
                <GoalsManager empId={emp.id} employeeGoals={employeeGoals} roles={roles??restRoles} restaurantId={rid} onUpdate={onUpdate} currentUser={currentUser} isOwner={isOwner} schedules={schedules??{}} feedbacks={feedbacks??[]} employees={employees}/>

                {/* ── 5. Presença & Pontualidade — 6 meses ── */}
                {(() => {
                  const hasAny = totFI > 0 || totFJ > 0 || totDelDays > 0;
                  return (
                    <div style={{...S.card,marginBottom:16,padding:"14px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}>
                        <span style={{fontSize:16}}>📊</span>
                        <span style={{color:"var(--text)",fontWeight:700,fontSize:14}}>Presença & Pontualidade</span>
                        <span style={{color:"var(--text3)",fontSize:11,marginLeft:"auto"}}>últimos 6 meses</span>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
                        <div style={{padding:"10px 8px",borderRadius:10,background:totFI>0?"#ef444411":"#10b98111",textAlign:"center"}}>
                          <div style={{color:totFI>0?"#ef4444":"#10b981",fontWeight:700,fontSize:20}}>{totFI}</div>
                          <div style={{color:"var(--text3)",fontSize:10}}>Faltas injust.</div>
                        </div>
                        <div style={{padding:"10px 8px",borderRadius:10,background:totFJ>0?"#f59e0b11":"#10b98111",textAlign:"center"}}>
                          <div style={{color:totFJ>0?"#f59e0b":"#10b981",fontWeight:700,fontSize:20}}>{totFJ}</div>
                          <div style={{color:"var(--text3)",fontSize:10}}>Faltas just.</div>
                        </div>
                        <div style={{padding:"10px 8px",borderRadius:10,background:totDelDays>0?"#f59e0b11":"#10b98111",textAlign:"center"}}>
                          <div style={{color:totDelDays>0?"#f59e0b":"#10b981",fontWeight:700,fontSize:20}}>{totDelDays}</div>
                          <div style={{color:"var(--text3)",fontSize:10}}>Dias c/ atraso</div>
                          {totDelMin > 0 && <div style={{color:"var(--text3)",fontSize:9}}>{totDelMin}min ({(totDelMin/60).toFixed(1)}h)</div>}
                        </div>
                      </div>
                      {hasAny && (
                        <div style={{overflowX:"auto"}}>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11,fontFamily:"'DM Mono',monospace"}}>
                            <thead><tr>
                              <th style={{textAlign:"left",padding:"4px 6px",borderBottom:"1px solid var(--border)",color:"var(--text3)",fontSize:10,fontWeight:600}}>Mês</th>
                              <th style={{textAlign:"center",padding:"4px 4px",borderBottom:"1px solid var(--border)",color:"#ef4444",fontSize:10,fontWeight:600}}>FI</th>
                              <th style={{textAlign:"center",padding:"4px 4px",borderBottom:"1px solid var(--border)",color:"#f59e0b",fontSize:10,fontWeight:600}}>FJ</th>
                              <th style={{textAlign:"center",padding:"4px 4px",borderBottom:"1px solid var(--border)",color:"#f59e0b",fontSize:10,fontWeight:600}}>Atrasos</th>
                              <th style={{textAlign:"center",padding:"4px 4px",borderBottom:"1px solid var(--border)",color:"var(--text3)",fontSize:10,fontWeight:600}}>Min</th>
                            </tr></thead>
                            <tbody>
                              {months6.map(m => {
                                if (!m.hasDays && m.delayDays === 0) return null;
                                return (
                                  <tr key={m.mKey}>
                                    <td style={{padding:"4px 6px",borderBottom:"1px solid var(--border)22",textTransform:"capitalize",color:"var(--text2)",fontWeight:600}}>{m.label}</td>
                                    <td style={{textAlign:"center",padding:"4px",borderBottom:"1px solid var(--border)22",color:m.faltasI>0?"#ef4444":"var(--text3)",fontWeight:m.faltasI>0?700:400}}>{m.faltasI}</td>
                                    <td style={{textAlign:"center",padding:"4px",borderBottom:"1px solid var(--border)22",color:m.faltasJ>0?"#f59e0b":"var(--text3)",fontWeight:m.faltasJ>0?700:400}}>{m.faltasJ}</td>
                                    <td style={{textAlign:"center",padding:"4px",borderBottom:"1px solid var(--border)22",color:m.delayDays>0?"#f59e0b":"var(--text3)",fontWeight:m.delayDays>0?700:400}}>{m.delayDays}</td>
                                    <td style={{textAlign:"center",padding:"4px",borderBottom:"1px solid var(--border)22",color:"var(--text3)"}}>{m.delayMin>0?m.delayMin:"—"}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {!hasAny && <div style={{textAlign:"center",color:"#10b981",fontSize:12,padding:"8px 0"}}>✅ Nenhuma falta ou atraso nos últimos 6 meses</div>}
                    </div>
                  );
                })()}

                {/* ── 6. Jornada — timeline clicável ── */}
                {jornadaEvents.length > 0 && (
                  <div style={{marginBottom:16}}>
                    <h4 style={{color:"var(--text)",margin:"0 0 12px",fontSize:14}}>🗓️ Jornada</h4>
                    <div style={{position:"relative",paddingLeft:24}}>
                      <div style={{position:"absolute",left:7,top:4,bottom:4,width:2,background:"var(--border)",borderRadius:1}}/>
                      {jornadaEvents.map((ev,i) => {
                        const evId = ev.fb?.id || ev.inc?.id || `ev-${i}`;
                        const isClickable = ev.type === "feedback" || ev.type === "incident";
                        const isExpanded = expandedJornada === evId;
                        const dotColor = ev.future ? "#3b82f6" : ev.type === "incident" ? (ev.incNeg ? "#ef4444" : "#10b981") : ev.type === "feedback" ? "#8b5cf6" : i === jornadaEvents.length-1 ? "var(--ac)" : "var(--border)";
                        const canDeleteFb = !isLider;
                        const canDeleteInc = !isLider;
                        return (
                          <div key={evId} style={{position:"relative",marginBottom:i<jornadaEvents.length-1?4:0}}>
                            <div onClick={isClickable ? ()=>setExpandedJornada(isExpanded ? null : evId) : undefined} style={{display:"flex",alignItems:"flex-start",gap:10,cursor:isClickable?"pointer":"default",padding:"8px 0",borderRadius:8,transition:"background 0.15s"}} onMouseEnter={e=>{if(isClickable)e.currentTarget.style.background="var(--border)22"}} onMouseLeave={e=>{e.currentTarget.style.background="transparent"}}>
                              <div style={{position:"absolute",left:-20,top:11,width:12,height:12,borderRadius:6,background:dotColor,border:"2px solid var(--bg)",flexShrink:0,zIndex:1}}/>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{display:"flex",alignItems:"center",gap:6}}>
                                  <span style={{fontSize:13}}>{ev.icon}</span>
                                  <span style={{color:ev.future?"#3b82f6":"var(--text)",fontSize:12,fontWeight:600,fontStyle:ev.future?"italic":"normal",flex:1}}>{ev.label}</span>
                                  {isClickable && <span style={{color:"var(--text3)",fontSize:10,flexShrink:0}}>{isExpanded ? "▲" : "▼"}</span>}
                                </div>
                                <div style={{color:"var(--text3)",fontSize:10,marginTop:1}}>
                                  {ev.date.toLocaleDateString("pt-BR",{day:"2-digit",month:"short",year:"numeric"})}
                                  {ev.fb?.createdBy ? ` · ${ev.fb.createdBy}` : ""}
                                </div>
                              </div>
                            </div>
                            {/* Expanded feedback detail */}
                            {isExpanded && ev.type === "feedback" && ev.fb && (
                              <div style={{marginLeft:4,marginBottom:8,padding:"10px 14px",borderRadius:10,background:"var(--card-bg)",border:"1px solid var(--border)",borderLeft:`3px solid ${(ev.fb.meetingType==="avaliação"||(!ev.fb.meetingType&&ev.fb.rating>0))?"#8b5cf6":"#3b82f6"}`}}>
                                {ev.fb.rating > 0 && <div style={{marginBottom:6}}><span style={{fontSize:11,padding:"2px 8px",borderRadius:6,background:(RATING_COLORS[ev.fb.rating-1]??"var(--text3)")+"18",color:RATING_COLORS[ev.fb.rating-1]??"var(--text3)",fontWeight:700}}>{RATING_LABELS[ev.fb.rating-1]}</span></div>}
                                {ev.fb.notes && <div style={{fontSize:12,color:"var(--text2)",marginBottom:4}}>{ev.fb.notes}</div>}
                                {ev.fb.strengths && <div style={{fontSize:12,color:"var(--text2)",marginBottom:4}}><strong style={{color:"#10b981"}}>Pontos positivos:</strong> {ev.fb.strengths}</div>}
                                {ev.fb.improvements && <div style={{fontSize:12,color:"var(--text2)",marginBottom:4}}><strong style={{color:"#f59e0b"}}>Melhorias:</strong> {ev.fb.improvements}</div>}
                                {ev.fb.internalNotes && <div style={{fontSize:11,color:"var(--text3)",fontStyle:"italic",marginBottom:4}}>📝 {ev.fb.internalNotes}</div>}
                                {!ev.fb.notes && !ev.fb.strengths && !ev.fb.improvements && !ev.fb.internalNotes && !ev.fb.rating && <div style={{fontSize:11,color:"var(--text3)"}}>Sem anotações registradas</div>}
                                {canDeleteFb && <div style={{marginTop:6,display:"flex",justifyContent:"flex-end"}}><button onClick={(e)=>{
                                  e.stopPropagation();
                                  const dateStr = ev.fb.meetingDate ? new Date(ev.fb.meetingDate+"T12:00:00").toLocaleDateString("pt-BR") : "";
                                  if (!window.confirm(`Excluir reunião de ${dateStr}?\n\nO registro ficará na lixeira por 90 dias.`)) return;
                                  const updated = (feedbacks??[]).map(f => f.id === ev.fb.id ? {...f, deletedAt: new Date().toISOString(), deletedBy: currentUser?.name || (isOwner ? "Gestor AppTip" : "Gestor Adm.")} : f);
                                  onUpdate("feedbacks", updated);
                                  setExpandedJornada(null);
                                }} style={{padding:"3px 10px",borderRadius:6,border:"1px solid var(--red)33",background:"transparent",color:"var(--red)",cursor:"pointer",fontSize:10,fontFamily:"'DM Mono',monospace"}}>🗑️ Excluir</button></div>}
                              </div>
                            )}
                            {/* Expanded incident detail */}
                            {isExpanded && ev.type === "incident" && ev.inc && (
                              <div style={{marginLeft:4,marginBottom:8,padding:"10px 14px",borderRadius:10,background:"var(--card-bg)",border:"1px solid var(--border)",borderLeft:`3px solid ${ev.incNeg?"#ef4444":"#10b981"}`}}>
                                {(() => {
                                  const sev = SEVERITY_OPTIONS.find(s=>s.id===ev.inc.severity);
                                  return sev ? <div style={{marginBottom:4}}><span style={{fontSize:11,padding:"2px 8px",borderRadius:6,background:ev.incNeg?"#ef444418":"#10b98118",color:ev.incNeg?"#ef4444":"#10b981",fontWeight:700}}>{sev.label}</span></div> : null;
                                })()}
                                {ev.inc.description && <div style={{fontSize:12,color:"var(--text2)",marginBottom:4}}>{ev.inc.description}</div>}
                                {ev.inc.action && <div style={{fontSize:12,color:"var(--text2)",marginBottom:4}}><strong style={{color:"var(--ac)"}}>Ação:</strong> {ev.inc.action}</div>}
                                <div style={{fontSize:10,color:"var(--text3)"}}>{ev.inc.createdBy ?? ""}</div>
                                {canDeleteInc && <div style={{marginTop:6,display:"flex",justifyContent:"flex-end"}}><button onClick={(e)=>{
                                  e.stopPropagation();
                                  if (!window.confirm(`Excluir ocorrência?\n\nO registro ficará na lixeira por 90 dias.`)) return;
                                  const updated = (incidents??[]).map(inc => inc.id === ev.inc.id ? {...inc, deletedAt: new Date().toISOString(), deletedBy: currentUser?.name || (isOwner ? "Gestor AppTip" : "Gestor Adm.")} : inc);
                                  onUpdate("incidents", updated);
                                  setExpandedJornada(null);
                                }} style={{padding:"3px 10px",borderRadius:6,border:"1px solid var(--red)33",background:"transparent",color:"var(--red)",cursor:"pointer",fontSize:10,fontFamily:"'DM Mono',monospace"}}>🗑️ Excluir</button></div>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {/* Lixeira de feedbacks e ocorrências */}
                    {(() => {
                      const deletedFbs = myFeedbacksAll.filter(f => f.deletedAt && (Date.now() - new Date(f.deletedAt).getTime()) < 90 * 86400000).sort((a,b) => (b.deletedAt??"").localeCompare(a.deletedAt??""));
                      const deletedIncs = (incidents??[]).filter(i => i.restaurantId === rid && (i.employeeIds??[]).includes(emp.id) && i.deletedAt && (Date.now() - new Date(i.deletedAt).getTime()) < 90 * 86400000);
                      if (deletedFbs.length === 0 && deletedIncs.length === 0) return null;
                      return (
                        <div style={{marginTop:8,padding:"10px 12px",borderRadius:8,background:"var(--red)08",border:"1px solid var(--red)22"}}>
                          <div style={{fontSize:11,color:"var(--red)",fontWeight:700,marginBottom:6}}>🗑️ Lixeira ({deletedFbs.length + deletedIncs.length})</div>
                          {deletedFbs.map(fb => {
                            const daysLeft = Math.max(0, 90 - Math.floor((Date.now() - new Date(fb.deletedAt).getTime()) / 86400000));
                            const dateStr = fb.meetingDate ? new Date(fb.meetingDate+"T12:00:00").toLocaleDateString("pt-BR") : "";
                            return (
                              <div key={fb.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",fontSize:10}}>
                                <span style={{color:"var(--text3)"}}>💬 Reunião {dateStr} — {fb.deletedBy} ({daysLeft}d)</span>
                                <button onClick={()=>{
                                  const updated = (feedbacks??[]).map(f => f.id === fb.id ? (()=>{ const {deletedAt, deletedBy, ...rest} = f; return rest; })() : f);
                                  onUpdate("feedbacks", updated);
                                }} style={{padding:"2px 8px",borderRadius:6,border:"1px solid var(--ac)44",background:"transparent",color:"var(--ac-text)",cursor:"pointer",fontSize:10,fontFamily:"'DM Mono',monospace"}}>Restaurar</button>
                              </div>
                            );
                          })}
                          {deletedIncs.map(inc => {
                            const daysLeft = Math.max(0, 90 - Math.floor((Date.now() - new Date(inc.deletedAt).getTime()) / 86400000));
                            const t = INCIDENT_TYPES.find(x=>x.id===inc.type);
                            return (
                              <div key={inc.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",fontSize:10}}>
                                <span style={{color:"var(--text3)"}}>{t?.negative?"🔴":"🟢"} {t?.label??inc.type} — {inc.deletedBy} ({daysLeft}d)</span>
                                <button onClick={()=>{
                                  const updated = (incidents??[]).map(i => i.id === inc.id ? (()=>{ const {deletedAt, deletedBy, ...rest} = i; return rest; })() : i);
                                  onUpdate("incidents", updated);
                                }} style={{padding:"2px 8px",borderRadius:6,border:"1px solid var(--ac)44",background:"transparent",color:"var(--ac-text)",cursor:"pointer",fontSize:10,fontFamily:"'DM Mono',monospace"}}>Restaurar</button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
              );
            })()}
          </div>
        );
      })()}

      {/* ═══════════════════════ LIST VIEW ═══════════════════════ */}
      {!detailEmp && <>

      {/* Toggle Ativos / Inativos + Novo */}
      <div style={{display:"flex",gap:8,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
        <button onClick={()=>setShowInactive(false)} style={{flex:1,padding:"8px",borderRadius:10,border:`1px solid ${!showInactive?"var(--green)":"var(--border)"}`,background:!showInactive?"#10b98122":"transparent",color:!showInactive?"var(--green)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:13}}>
          Ativos ({activeEmps.length})
        </button>
        <button onClick={()=>setShowInactive(true)} style={{flex:1,padding:"8px",borderRadius:10,border:`1px solid ${showInactive?"#8b5cf6":"var(--border)"}`,background:showInactive?"#8b5cf622":"transparent",color:showInactive?"#8b5cf6":"var(--text3)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:13}}>
          Inativos ({inactiveEmps.length})
        </button>
        {!showInactive && (
          <button onClick={()=>setShowNewForm(!showNewForm)} style={{padding:"8px 14px",borderRadius:10,border:`1px solid ${showNewForm?"var(--accent)":"var(--green)"}`,background:showNewForm?"var(--accent)11":"#10b98122",color:showNewForm?"var(--accent)":"var(--green)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,whiteSpace:"nowrap"}}>
            {showNewForm ? "✕ Fechar" : "+ Novo"}
          </button>
        )}
      </div>

      {/* ── New employee form ── */}
      {showNewForm && !showInactive && (
        <div style={{background:"var(--card-bg)",border:"1px solid var(--green)33",borderRadius:12,padding:16,marginBottom:14}}>
          <div style={{fontSize:13,fontWeight:700,color:"var(--green)",marginBottom:10}}>Novo empregado</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div>
              <label style={{fontSize:10,color:"var(--text3)",fontWeight:700,display:"block",marginBottom:3}}>Nome</label>
              <input value={newRow.name||""} onChange={ev=>setNewRow(p=>({...p,name:ev.target.value}))} placeholder="Nome completo" style={{...S.input,fontSize:13}}/>
            </div>
            <div>
              <label style={{fontSize:10,color:"var(--text3)",fontWeight:700,display:"block",marginBottom:3}}>CPF</label>
              <input value={newRow.cpf||""} onChange={ev=>setNewRow(p=>({...p,cpf:maskCpf(ev.target.value)}))} placeholder="000.000.000-00" style={{...S.input,fontSize:13}} inputMode="numeric"/>
            </div>
            <div>
              <label style={{fontSize:10,color:"var(--text3)",fontWeight:700,display:"block",marginBottom:3}}>Admissão</label>
              <input type="date" value={newRow.admission||""} onChange={ev=>setNewRow(p=>({...p,admission:ev.target.value}))} style={{...S.input,fontSize:13}}/>
            </div>
            <div>
              <label style={{fontSize:10,color:"var(--text3)",fontWeight:700,display:"block",marginBottom:3}}>Cargo</label>
              <select value={newRow.roleId||""} onChange={ev=>setNewRow(p=>({...p,roleId:ev.target.value}))} style={{...S.input,fontSize:13,cursor:"pointer"}}>
                <option value="">Selecionar…</option>
                {AREAS.map(a=>(<optgroup key={a} label={a}>{restRoles.filter(r=>r.area===a&&!r.inactive).map(r=><option key={r.id} value={r.id}>{r.name} ({r.points}pt)</option>)}</optgroup>))}
              </select>
            </div>
          </div>
          <div style={{display:"flex",gap:8,marginTop:12}}>
            <button onClick={()=>{saveNew();setShowNewForm(false);}} disabled={!newRow.name.trim()} style={{...S.btnPrimary,fontSize:13,opacity:newRow.name.trim()?1:0.5}}>Adicionar</button>
            <button onClick={()=>{setShowNewForm(false);setNewRow(blank());}} style={S.btnSecondary}>Cancelar</button>
          </div>
        </div>
      )}

      {/* IA assistant */}
      {!showInactive && (
        <div style={{marginBottom:14}}>
          <button onClick={()=>{setShowAiEmp(!showAiEmp);setAiEmpError("");setAiEmpPreview(null);}}
            style={{...S.btnSecondary,fontSize:12,display:"inline-flex",alignItems:"center",gap:6,padding:"7px 14px",
              background:showAiEmp?"var(--ac-bg)":undefined,borderColor:showAiEmp?"var(--ac)":undefined,color:showAiEmp?"var(--ac-text)":undefined}}>
            ✨ Gerenciar com IA
          </button>
          {showAiEmp && (
            <div style={{marginTop:10,padding:"14px",borderRadius:12,background:"var(--ac-bg)",border:"1px solid var(--ac)33"}}>
              <p style={{color:"var(--text2)",fontSize:13,margin:"0 0 6px",fontWeight:600}}>✨ Assistente de empregados</p>
              <p style={{color:"var(--text3)",fontSize:12,margin:"0 0 6px",lineHeight:1.5}}>Crie, modifique ou inative empregados com linguagem natural.</p>
              <p style={{color:"var(--text3)",fontSize:11,margin:"0 0 10px",fontStyle:"italic"}}>Ex: "Adicionar João Silva como garçom; trocar Maria para barman; inativar Pedro Lima"</p>
              <textarea value={aiEmpInput} onChange={e=>setAiEmpInput(e.target.value)} placeholder="Descreva as alterações aqui..." rows={4} style={{...S.input,resize:"vertical",marginBottom:8,fontSize:13}}/>
              {aiEmpError && <p style={{color:"var(--red)",fontSize:12,margin:"0 0 8px"}}>{aiEmpError}</p>}
              {aiEmpPreview && (
                <div style={{marginBottom:10,padding:"12px",borderRadius:10,background:"var(--card-bg)",border:"1px solid var(--border)"}}>
                  <p style={{color:"var(--text)",fontSize:13,fontWeight:700,margin:"0 0 8px"}}>Pré-visualização:</p>
                  {aiEmpPreview.criar.length > 0 && (<div style={{marginBottom:8}}><span style={{color:"var(--green)",fontSize:11,fontWeight:700}}>+ CRIAR ({aiEmpPreview.criar.length})</span>{aiEmpPreview.criar.map(e=>(<div key={e.id} style={{padding:"6px 8px",marginTop:4,borderRadius:6,background:"#10b98111",fontSize:12,color:"var(--text2)",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:4}}><div><strong>{e.name}</strong><span style={{color:"var(--text3)",marginLeft:6}}>→ {e.roleMatched?<span style={{color:"var(--green)"}}>{e.roleName}</span>:<span style={{color:"var(--red)"}}>{e.roleName} ⚠️</span>}</span>{e.cpf&&<span style={{color:"var(--text3)",marginLeft:6,fontSize:11}}>CPF: {e.cpf}</span>}{e.isProducao&&<span style={{color:"#ec4899",marginLeft:6,fontSize:11}}>🏭</span>}</div><span style={{color:"var(--text3)",fontSize:10,fontFamily:"'DM Mono',monospace"}}>{e.empCode}·PIN:{e.pin}</span></div>))}</div>)}
                  {aiEmpPreview.modificar.length > 0 && (<div style={{marginBottom:8}}><span style={{color:"#3b82f6",fontSize:11,fontWeight:700}}>✏️ MODIFICAR ({aiEmpPreview.modificar.length})</span>{aiEmpPreview.modificar.map(m=>(<div key={m.id} style={{padding:"6px 8px",marginTop:4,borderRadius:6,background:"#3b82f611",fontSize:12,color:"var(--text2)"}}><strong>{m.name}</strong>{m.newRoleName&&<span style={{marginLeft:6}}>{m.oldRoleName}→{m.roleMatched?<span style={{color:"#3b82f6"}}>{m.newRoleName}</span>:<span style={{color:"var(--red)"}}>{m.newRoleName}⚠️</span>}</span>}{m.cpf!==null&&<span style={{color:"var(--text3)",marginLeft:6,fontSize:11}}>CPF:{m.cpf}</span>}{m.producao!==null&&<span style={{color:"#ec4899",marginLeft:6,fontSize:11}}>{m.producao?"🏭+":"🏭−"}</span>}</div>))}</div>)}
                  {aiEmpPreview.inativar.length > 0 && (<div style={{marginBottom:8}}><span style={{color:"#f59e0b",fontSize:11,fontWeight:700}}>⏸ INATIVAR ({aiEmpPreview.inativar.length})</span>{aiEmpPreview.inativar.map(e=>(<div key={e.id} style={{padding:"4px 8px",marginTop:4,borderRadius:6,background:"#f59e0b11",fontSize:12,color:"var(--text2)"}}>{e.name} {e.empCode&&<span style={{color:"var(--text3)",fontSize:10}}>({e.empCode})</span>}</div>))}</div>)}
                  {(aiEmpPreview.criar.some(e=>!e.roleMatched)||aiEmpPreview.modificar.some(m=>!m.roleMatched)) && <p style={{color:"var(--red)",fontSize:11,margin:"0 0 8px"}}>⚠️ Itens com cargo não encontrado ficarão sem cargo.</p>}
                  <div style={{display:"flex",gap:8,marginTop:10}}><button onClick={confirmAiEmpChanges} style={{...S.btnPrimary,flex:1,fontSize:13}}>✅ Confirmar</button><button onClick={()=>setAiEmpPreview(null)} style={S.btnSecondary}>Cancelar</button></div>
                </div>
              )}
              {!aiEmpPreview && (<div style={{display:"flex",gap:8}}><button onClick={handleAiEmpregados} disabled={!aiEmpInput.trim()||aiEmpLoading} style={{...S.btnPrimary,flex:1,fontSize:13,opacity:(!aiEmpInput.trim()||aiEmpLoading)?0.6:1}}>{aiEmpLoading?"✨ Processando...":"✨ Processar"}</button><button onClick={()=>{setShowAiEmp(false);setAiEmpInput("");setAiEmpError("");setAiEmpPreview(null);}} style={S.btnSecondary}>Cancelar</button></div>)}
            </div>
          )}
        </div>
      )}

      {/* Plan limits */}
      {activeCount >= plano.empMax && (
        <div style={{background:"var(--red-bg)",border:"1px solid var(--red)33",borderRadius:12,padding:"14px 16px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
            <div>
              <div style={{color:"var(--red)",fontSize:13,fontWeight:700,marginBottom:2}}>⚠️ Limite do plano atingido — {activeCount}/{plano.empMax}</div>
              <div style={{color:"var(--text3)",fontSize:12}}>Solicite upgrade para adicionar mais.</div>
            </div>
            <button onClick={()=>{
              const PLANOS_LABEL = { p10:"Starter (10)", p20:"Básico (20)", p50:"Profissional (50)", p999:"Enterprise (51-100)", pOrc:"On Demand (+100)" };
              const PROXIMO = { p10:"p20", p20:"p50", p50:"p999", p999:"pOrc" };
              const planoAtual = PLANOS_LABEL[restaurant?.planoId??"p10"] ?? "Starter";
              const planoProx = PLANOS_LABEL[PROXIMO[restaurant?.planoId??"p10"]] ?? "Enterprise";
              const restNome = restaurant?.name ?? "Restaurante";
              if (onUpdate) { onUpdate("notifications", [...(notifications ?? []), { id:Date.now().toString(), restaurantId:rid, type:"upgrade_request", body:`📦 Upgrade — ${restNome}: ${planoAtual} → ${planoProx}. Ativos: ${activeCount}/${plano.empMax}.`, date:new Date().toISOString(), read:false, targetRole:"admin" }]); }
              const msg = encodeURIComponent(`Olá! Sou gestor do restaurante *${restNome}*.\nGostaria de solicitar upgrade do plano:\n• Atual: *${planoAtual}*\n• Desejado: *${planoProx}*\n• Empregados: ${activeCount}/${plano.empMax}\nObrigado!`);
              window.open(`https://wa.me/5511985499821?text=${msg}`, "_blank");
              onUpdate("_toast", "✅ Solicitação enviada!");
            }} style={{padding:"10px 18px",borderRadius:10,border:"none",background:"var(--red)",color:"#fff",fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,whiteSpace:"nowrap"}}>
              📲 Solicitar upgrade
            </button>
          </div>
        </div>
      )}
      {activeCount > 0 && activeCount < plano.empMax && activeCount >= plano.empMax * 0.8 && (
        <div style={{background:"#f59e0b11",border:"1px solid #f59e0b33",borderRadius:10,padding:"8px 14px",marginBottom:12}}>
          <span style={{color:"#f59e0b",fontSize:12}}>⚡ {activeCount}/{plano.empMax} — próximo do limite</span>
        </div>
      )}

      {/* ── Employee cards by area ── */}
      {(() => {
        const groups = {};
        list.forEach(emp => {
          const role = restRoles.find(r=>r.id===emp.roleId);
          const area = role?.area ?? "Sem área";
          if (!groups[area]) groups[area] = [];
          groups[area].push(emp);
        });
        return Object.entries(groups).map(([area, emps]) => (
          <div key={area} style={{marginBottom:14}}>
            <div style={{color:AREA_COLORS[area]??"#888",fontSize:11,fontWeight:700,padding:"8px 8px 4px",borderBottom:`1px solid ${AREA_COLORS[area]??"var(--bg4)"}33`,marginBottom:6,letterSpacing:1}}>
              {area.toUpperCase()} · {emps.length}
            </div>
            {emps.map(emp => {
              const role = restRoles.find(r=>r.id===emp.roleId);
              const badge = statusBadge(emp);
              return (
                <div key={emp.id} onClick={()=>{setDetailEmp(emp.id);setDetailTab("cadastro");}} style={{
                  display:"flex", alignItems:"center", gap:10, padding:"10px 14px", marginBottom:4,
                  background:"var(--card-bg)", borderRadius:10, border:"1px solid var(--border)",
                  cursor:"pointer", transition:"background 0.15s"
                }}
                onMouseEnter={e=>e.currentTarget.style.background="var(--bg2)"}
                onMouseLeave={e=>e.currentTarget.style.background="var(--card-bg)"}>
                  {/* Avatar circle */}
                  <div style={{width:36,height:36,borderRadius:"50%",background:AREA_COLORS[role?.area]??"var(--bg3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:700,color:"#fff",flexShrink:0}}>
                    {(emp.name||"?").charAt(0).toUpperCase()}
                  </div>
                  {/* Info */}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                      <span style={{fontSize:13,fontWeight:700,color:"var(--text)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{emp.name}</span>
                      <span style={{fontSize:9,padding:"1px 6px",borderRadius:4,background:badge.bg,color:badge.color,fontWeight:700}}>{badge.label}</span>
                      {emp.isProducao && <span style={{fontSize:9,padding:"1px 5px",borderRadius:4,background:"#ec489922",color:"#ec4899"}}>Prod</span>}
                      {emp.isFreela && <span style={{fontSize:9,padding:"1px 5px",borderRadius:4,background:"#06b6d422",color:"#06b6d4"}}>Freela</span>}
                    </div>
                    <div style={{fontSize:11,color:"var(--text3)",marginTop:1}}>{role?.name ?? "Sem cargo"}</div>
                  </div>
                  {/* Arrow */}
                  <span style={{color:"var(--text3)",fontSize:16,flexShrink:0}}>›</span>
                </div>
              );
            })}
          </div>
        ));
      })()}
      </>}

      {/* Pre-dismissal checklist modal (#71) */}
      {showDismissalChecklist && dismissalCheckEmp && (() => {
        const dce = dismissalCheckEmp;
        const demMk3 = dce.demitidoEm?.slice(0,7) ?? "";
        const [demY3, demM3] = demMk3 ? demMk3.split("-").map(Number) : [0,0];
        const demDay3 = parseInt(dce.demitidoEm?.slice(8,10) ?? "0");
        const daysInDemMonth3 = demY3 ? new Date(demY3, demM3, 0).getDate() : 0;
        // VT status
        const vtPaid3 = !!vtPayments?.[rid]?.[demMk3];
        // Previous month schedule status
        const prevDem3 = demY3 ? new Date(demY3, demM3 - 2, 1) : null;
        const prevDemMk3 = prevDem3 ? `${prevDem3.getFullYear()}-${String(prevDem3.getMonth()+1).padStart(2,"0")}` : "";
        const prevSchedClosed3 = prevDemMk3 ? scheduleStatus?.[rid]?.[prevDemMk3]?.status === "closed" : false;
        // Current month work days until dismissal
        const schedMap3 = schedules?.[rid]?.[demMk3]?.[dce.id] ?? {};
        let workDays3 = 0;
        for (let dd = 1; dd < demDay3 && dd <= daysInDemMonth3; dd++) {
          const ds = `${demY3}-${String(demM3).padStart(2,"0")}-${String(dd).padStart(2,"0")}`;
          if (!schedMap3[ds] || schedMap3[ds] === "comptrab") workDays3++;
        }
        // Tips check - find last date with tips up to dismissal
        const hasWarnings = !vtPaid3 || !prevSchedClosed3;
        const checks = [
          { label: "VT do mês de demissão", ok: vtPaid3, okText: "Pago", warnText: "Não pago — valores provisórios" },
          { label: "Escala do mês anterior", ok: prevSchedClosed3, okText: "Fechada — ajuste definitivo", warnText: "Não fechada — ajuste provisório" },
          { label: `Dias trabalhados até demissão (${demMk3})`, ok: true, okText: `${workDays3} dias de trabalho computados`, warnText: "" },
        ];
        return (
          <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setShowDismissalChecklist(false)}>
            <div onClick={e=>e.stopPropagation()} style={{background:"var(--bg2)",borderRadius:16,padding:24,maxWidth:480,width:"100%",maxHeight:"80vh",overflowY:"auto",border:"1px solid var(--border)"}}>
              <h3 style={{color:"var(--text)",margin:"0 0 16px",fontSize:16}}>Checklist de desligamento</h3>
              <p style={{color:"var(--text2)",fontSize:13,margin:"0 0 12px"}}>{dce.name} — demissão em {dce.demitidoEm ? new Date(dce.demitidoEm+"T12:00:00").toLocaleDateString("pt-BR") : "—"}</p>
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
                {checks.map((c,i) => (
                  <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderRadius:10,background:c.ok?"#10b98109":"#f59e0b09",border:`1px solid ${c.ok?"#10b98133":"#f59e0b33"}`}}>
                    <span style={{fontSize:16}}>{c.ok ? "\u2705" : "\u26A0\uFE0F"}</span>
                    <div>
                      <div style={{color:"var(--text)",fontSize:12,fontWeight:600}}>{c.label}</div>
                      <div style={{color:c.ok?"var(--green)":"#f59e0b",fontSize:11}}>{c.ok ? c.okText : c.warnText}</div>
                    </div>
                  </div>
                ))}
              </div>
              {hasWarnings && (
                <p style={{color:"#f59e0b",fontSize:11,margin:"0 0 12px"}}>Existem itens pendentes. O relatório pode conter valores provisórios.</p>
              )}
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button onClick={()=>setShowDismissalChecklist(false)} style={S.btnSecondary}>Cancelar</button>
                <button onClick={()=>{
                  setShowDismissalChecklist(false);
                  onGenerateDismissalReport(dce);
                }} style={{...S.btnPrimary,fontSize:13}}>
                  {hasWarnings ? "Gerar mesmo assim" : "Gerar PDF"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {previewDoc && <PDFPreviewModal pdfDoc={previewDoc} fileName={previewFileName} title="Trilha do Empregado" onClose={()=>setPreviewDoc(null)} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// VALE TRANSPORTE TAB
// ═══════════════════════════════════════════════════════════════════
function ValeTransporteTab({ restaurantId, employees, roles, workSchedules, schedules, vtConfig, vtMonthly, vtPayments, onUpdate, currentUser, isOwner, mobileOnly, schedulePrevista, scheduleStatus, scheduleVersions }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const mk = monthKey(year, month);
  const ac = "var(--accent)";
  const [showPayDateModal, setShowPayDateModal] = useState(false);
  const [payDate, setPayDate] = useState(today());
  const [versionWarning, setVersionWarning] = useState(null);

  const restEmps = (employees ?? []).filter(e => e.restaurantId === restaurantId && !e.isFreela && !(e.inactive && e.inactiveFrom && e.inactiveFrom <= today()));
  const restRoles = (roles ?? []).filter(r => r.restaurantId === restaurantId);

  // ── BR currency input helpers ──
  const toBR = (v) => { const n = parseFloat(v); return isNaN(n) || n === 0 ? "" : n.toFixed(2).replace(".", ","); };
  const fromBR = (s) => { if (!s) return 0; return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0; };

  // ── Editable local state ──
  const [localOverrides, setLocalOverrides] = useState({});
  const [localRates, setLocalRates] = useState({}); // display strings in BR format
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const monthData = vtMonthly?.[restaurantId]?.[mk] ?? {};
    const overrides = {};
    Object.entries(monthData).forEach(([empId, v]) => {
      overrides[empId] = { adjustOverride: v.adjustOverride ?? null, adjustDisplay: toBR(v.adjustOverride), manualDiscount: v.manualDiscount ?? 0, discountDisplay: toBR(v.manualDiscount) };
    });
    setLocalOverrides(overrides);

    const rates = {};
    const cfgRest = vtConfig?.[restaurantId] ?? {};
    restEmps.forEach(emp => {
      rates[emp.id] = toBR(cfgRest[emp.id]?.dailyRate ?? 0);
    });
    setLocalRates(rates);
    setDirty(false);
  }, [mk, restaurantId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Previous month payment snapshot ──
  const prevDate = new Date(year, month - 1, 1);
  const prevMk = monthKey(prevDate.getFullYear(), prevDate.getMonth());
  const prevPayment = vtPayments?.[restaurantId]?.[prevMk] ?? null;
  const currentPayment = vtPayments?.[restaurantId]?.[mk] ?? null;

  // ── Count planned working days (alinhado com visual da escala) ──
  function countPlannedDays(empId) {
    const lastDay = new Date(year, month+1, 0).getDate();
    const schedDayMap = schedules?.[restaurantId]?.[mk]?.[empId] ?? {};
    let count = 0;
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      const escalaSt = schedDayMap[dateStr];
      if (!escalaSt || escalaSt === "comptrab") { count++; }
      // off, comp, vac, faultj, faultu, freela = não conta
    }
    return count;
  }

  // ── Count actual working days (for auto-adjust, alinhado com visual) ──
  function countActualDays(empId, targetMk, targetYear, targetMonth) {
    const lastDay = new Date(targetYear, targetMonth+1, 0).getDate();
    const schedDayMap = schedules?.[restaurantId]?.[targetMk]?.[empId] ?? {};
    let count = 0;
    for (let d = 1; d <= lastDay; d++) {
      const dateStr = `${targetYear}-${String(targetMonth+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      const escalaSt = schedDayMap[dateStr];
      if (!escalaSt || escalaSt === "comptrab") { count++; }
    }
    return count;
  }

  function calcAutoAdjust(empId) {
    if (!prevPayment?.snapshot) return 0;
    const prevClosed = scheduleStatus?.[restaurantId]?.[prevMk]?.status === "closed";
    if (!prevClosed) return 0; // adjustment deferred until previous month is closed
    const prevSnap = prevPayment.snapshot.find(s => s.empId === empId);
    if (!prevSnap) return 0;
    const actualDays = countActualDays(empId, prevMk, prevDate.getFullYear(), prevDate.getMonth());
    const diff = actualDays - prevSnap.plannedDays;
    return round2(diff * prevSnap.dailyRate);
  }

  // ── Build rows ──
  const rows = restEmps.map(emp => {
    const role = restRoles.find(r => r.id === emp.roleId);
    const area = role?.area ?? "Outros";
    const dailyRate = fromBR(localRates[emp.id]);
    const plannedDays = countPlannedDays(emp.id);
    const grossVT = round2(dailyRate * plannedDays);
    const suggestedAdjust = calcAutoAdjust(emp.id);
    const overrides = localOverrides[emp.id] ?? {};
    const autoAdjust = overrides.adjustOverride !== null && overrides.adjustOverride !== undefined ? overrides.adjustOverride : suggestedAdjust;
    const manualDiscount = overrides.manualDiscount ?? 0;
    const totalPaid = round2(grossVT + autoAdjust - manualDiscount);
    // Previous month actual days (only when closed)
    const prevClosed = scheduleStatus?.[restaurantId]?.[prevMk]?.status === "closed";
    let prevActualDays = null;
    if (prevClosed && prevPayment?.snapshot) {
      const prevSnap = prevPayment.snapshot.find(s => s.empId === emp.id);
      if (prevSnap) {
        prevActualDays = countActualDays(emp.id, prevMk, prevDate.getFullYear(), prevDate.getMonth());
      }
    }
    return { emp, role, area, dailyRate, plannedDays, grossVT, suggestedAdjust, autoAdjust, manualDiscount, totalPaid, prevActualDays };
  }).sort((a,b) => (a.emp.name??"").localeCompare(b.emp.name??""));

  // ── Group by area ──
  const areaOrder = [...AREAS, "Outros"];
  const byArea = {};
  areaOrder.forEach(a => { byArea[a] = []; });
  rows.forEach(r => { const a = areaOrder.includes(r.area) ? r.area : "Outros"; byArea[a].push(r); });
  const activeAreas = areaOrder.filter(a => byArea[a].length > 0);

  const grandTotal = rows.reduce((s,r) => s + Math.max(0, r.totalPaid), 0);

  // ── Auto-save on blur ──
  function persistAll() {
    const newCfg = { ...(vtConfig ?? {}), [restaurantId]: { ...(vtConfig?.[restaurantId] ?? {}) } };
    Object.entries(localRates).forEach(([empId, rateStr]) => {
      newCfg[restaurantId][empId] = { dailyRate: fromBR(rateStr) };
    });
    onUpdate("vtConfig", newCfg);

    const newMonthly = { ...(vtMonthly ?? {}), [restaurantId]: { ...(vtMonthly?.[restaurantId] ?? {}), [mk]: {} } };
    Object.entries(localOverrides).forEach(([empId, v]) => {
      newMonthly[restaurantId][mk][empId] = { adjustOverride: v.adjustOverride ?? null, manualDiscount: v.manualDiscount ?? 0 };
    });
    onUpdate("vtMonthly", newMonthly);
    setDirty(false);
  }


  // ── Mark as paid (modal flow with date selector) ──
  function openPayModal() {
    setPayDate(today());
    setVersionWarning(null);
    setShowPayDateModal(true);
  }

  function checkVersionAndPay() {
    const chosenDate = payDate;
    const todayStr = today();
    if (chosenDate >= todayStr) {
      // Date is today or future — pay with current values, no version check needed
      confirmPay(chosenDate, false);
      return;
    }
    // Date is in the past — check scheduleVersions for edits between chosenDate and now
    const versions = scheduleVersions?.[restaurantId]?.[mk] ?? [];
    const editsAfterPayDate = versions.filter(v => v.ts && v.ts.slice(0, 10) > chosenDate);
    if (editsAfterPayDate.length > 0) {
      setVersionWarning({
        edits: editsAfterPayDate,
        payDateStr: chosenDate,
        oldestEditSnapshot: editsAfterPayDate[editsAfterPayDate.length - 1]?.snapshot ?? null,
      });
    } else {
      confirmPay(chosenDate, false);
    }
  }

  function confirmPay(chosenDate, useOldSnapshot) {
    if (dirty) persistAll();
    let snapshot;
    if (useOldSnapshot && versionWarning?.oldestEditSnapshot) {
      // Reconstruct rows from the version snapshot closest to the payment date
      const oldSched = versionWarning.oldestEditSnapshot;
      // Build rows using old schedule data but current VT config
      snapshot = rows.map(r => {
        const empDays = oldSched?.[r.emp.id] ? Object.values(oldSched[r.emp.id]).filter(s => s === "work" || s === null || s === undefined).length : r.plannedDays;
        const gross = round2(empDays * r.dailyRate);
        const total = round2(gross + r.autoAdjust - (r.manualDiscount ?? 0));
        return {
          empId: r.emp.id, name: r.emp.name, role: r.role?.name ?? "—", area: r.area,
          dailyRate: r.dailyRate, plannedDays: empDays, grossVT: gross,
          autoAdjust: r.autoAdjust, manualDiscount: r.manualDiscount, totalPaid: Math.max(0, total),
        };
      });
    } else {
      snapshot = rows.map(r => ({
        empId: r.emp.id, name: r.emp.name, role: r.role?.name ?? "—", area: r.area,
        dailyRate: r.dailyRate, plannedDays: r.plannedDays, grossVT: r.grossVT,
        autoAdjust: r.autoAdjust, manualDiscount: r.manualDiscount, totalPaid: Math.max(0, r.totalPaid),
      }));
    }
    const paidAtISO = new Date(chosenDate + "T12:00:00").toISOString();
    const total = useOldSnapshot ? round2(snapshot.reduce((s, r) => s + r.totalPaid, 0)) : round2(grandTotal);
    const newPayments = { ...(vtPayments ?? {}), [restaurantId]: { ...(vtPayments?.[restaurantId] ?? {}), [mk]: { paidAt: paidAtISO, paidBy: currentUser?.name ?? "Gestor Adm.", snapshot, grandTotal: total } } };
    onUpdate("vtPayments", newPayments);
    // Freeze prevista when VT is paid
    if (!schedulePrevista?.[restaurantId]?.[mk]) {
      const frozenPrevista = JSON.parse(JSON.stringify(schedules?.[restaurantId]?.[mk] ?? {}));
      const newPrev = { ...(schedulePrevista ?? {}) };
      if (!newPrev[restaurantId]) newPrev[restaurantId] = {};
      newPrev[restaurantId][mk] = frozenPrevista;
      onUpdate("schedulePrevista", newPrev);
    }
    setShowPayDateModal(false);
    setVersionWarning(null);
    onUpdate("_toast", `💰 VT marcado como pago em ${chosenDate.split("-").reverse().join("/")}!`);
  }

  // ── Export CSV (grouped) ──
  function exportCSV() {
    const header = "Área;Empregado;Cargo;VT Diário;Dias;VT Bruto;Ajuste Mês Ant.;Desconto;Total";
    const csvRows = [];
    activeAreas.forEach(area => {
      const areaRows = byArea[area];
      areaRows.forEach(r => { csvRows.push(`${area};${r.emp.name};${r.role?.name??"—"};${fmtBR(r.dailyRate)};${r.plannedDays};${fmtBR(r.grossVT)};${fmtBR(r.autoAdjust)};${fmtBR(r.manualDiscount)};${fmtBR(Math.max(0,r.totalPaid))}`); });
      const sub = areaRows.reduce((s,r) => s + Math.max(0, r.totalPaid), 0);
      csvRows.push(`${area};;;;;;;Subtotal;${fmtBR(sub)}`);
    });
    csvRows.push(`;;;;;;;;TOTAL;${fmtBR(grandTotal)}`);
    const blob = new Blob(["\uFEFF" + header + "\n" + csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `VT_${mk}.csv`; a.click(); URL.revokeObjectURL(url);
    onUpdate("_toast", "📊 CSV exportado");
  }

  // ── Export PDF (grouped) ──
  function exportPDF() {
    const w = window.open("", "_blank");
    if (!w) { onUpdate("_toast", "⚠️ Permita pop-ups para exportar PDF"); return; }
    const paidInfo = currentPayment ? `<p style="color:green;font-weight:700">✅ Pago em ${new Date(currentPayment.paidAt).toLocaleString("pt-BR")} por ${currentPayment.paidBy}</p>` : `<p style="color:#b45309;font-weight:700">⏳ Ainda não marcado como pago</p>`;
    let tableBody = "";
    activeAreas.forEach(area => {
      const color = AREA_COLORS[area] ?? "#666";
      tableBody += `<tr><td colspan="8" style="background:${color}18;color:${color};font-weight:700;padding:10px 12px;font-size:14px;border-left:4px solid ${color}">${area}</td></tr>`;
      byArea[area].forEach(r => {
        tableBody += `<tr><td>${r.emp.name}</td><td>${r.role?.name??"—"}</td><td style="text-align:right">${fmt(r.dailyRate)}</td><td style="text-align:center">${r.plannedDays}</td><td style="text-align:right">${fmt(r.grossVT)}</td><td style="text-align:right;color:${r.autoAdjust>=0?"green":"#b45309"}">${r.autoAdjust>=0?"+":""}${fmt(r.autoAdjust)}</td><td style="text-align:right;color:#b45309">${r.manualDiscount?"-"+fmt(r.manualDiscount):"—"}</td><td style="text-align:right;font-weight:700">${fmt(Math.max(0,r.totalPaid))}</td></tr>`;
      });
      const sub = byArea[area].reduce((s,r) => s + Math.max(0, r.totalPaid), 0);
      tableBody += `<tr style="background:#f9f9f9"><td colspan="7" style="text-align:right;font-weight:600;font-size:12px;color:${color}">Subtotal ${area}</td><td style="text-align:right;font-weight:700;color:${color}">${fmt(sub)}</td></tr>`;
    });
    tableBody += `<tr style="font-weight:700;background:#e8e8e8"><td colspan="7" style="text-align:right;font-size:15px">TOTAL GERAL</td><td style="text-align:right;font-size:15px">${fmt(grandTotal)}</td></tr>`;
    w.document.write(`<!DOCTYPE html><html><head><title>VT ${mk}</title><style>body{font-family:Arial,sans-serif;margin:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px 12px;font-size:13px}th{background:#f5f5f5;font-weight:700}h1{font-size:20px}</style></head><body><h1>🚌 Vale Transporte — ${monthLabel(year,month)}</h1>${paidInfo}<table><thead><tr><th>Empregado</th><th>Cargo</th><th>VT Diário</th><th>Dias</th><th>VT Bruto</th><th>Ajuste Mês Ant.</th><th>Desconto</th><th>Total</th></tr></thead><tbody>${tableBody}</tbody></table><p style="font-size:11px;color:#999;margin-top:24px">Gerado por AppTip em ${new Date().toLocaleString("pt-BR")}</p></body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 500);
    onUpdate("_toast", "🖨️ PDF pronto para impressão");
  }

  const goMonth = (dir) => { const d = new Date(year, month + dir, 1); setYear(d.getFullYear()); setMonth(d.getMonth()); };

  // ── Render helpers ──
  const inputStyle = { ...S.input, width: mobileOnly ? 80 : 100, textAlign: "right", padding: "8px 10px", fontSize: 14 };
  const cellPad = mobileOnly ? "8px 6px" : "12px 16px";

  // ── BR money input helpers (inline, not a component — avoids focus loss) ──
  const moneyOnChange = (e, setter, empId, field) => {
    const raw = e.target.value.replace(/[^0-9,.\u002D]/g, "");
    if (field === "rate") { setter(prev => ({ ...prev, [empId]: raw })); }
    else if (field === "adjust") { setter(prev => ({ ...prev, [empId]: { ...(prev[empId] ?? {}), adjustOverride: fromBR(raw), adjustDisplay: raw } })); }
    else if (field === "discount") { setter(prev => ({ ...prev, [empId]: { ...(prev[empId] ?? {}), manualDiscount: fromBR(raw), discountDisplay: raw } })); }
    setDirty(true);
  };
  const moneyOnBlur = (e, setter, empId, field) => {
    const n = fromBR(e.target.value);
    const formatted = n ? n.toFixed(2).replace(".", ",") : "";
    if (field === "rate") { setter(prev => ({ ...prev, [empId]: formatted })); }
    else if (field === "adjust") { setter(prev => ({ ...prev, [empId]: { ...(prev[empId] ?? {}), adjustOverride: n || null, adjustDisplay: formatted } })); }
    else if (field === "discount") { setter(prev => ({ ...prev, [empId]: { ...(prev[empId] ?? {}), manualDiscount: n || 0, discountDisplay: formatted } })); }
    if (dirty) persistAll();
  };

  // ── Area section renderer ──
  const renderAreaSection = (area, areaRows) => {
    const areaColor = AREA_COLORS[area] ?? "var(--text3)";
    const areaSubtotal = areaRows.reduce((s,r) => s + Math.max(0, r.totalPaid), 0);

    return (
      <div key={area} style={{ marginBottom: mobileOnly ? 12 : 20 }}>
        {/* Area header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, padding: mobileOnly ? "8px 12px" : "10px 16px", background: `${areaColor}12`, borderRadius: 12, borderLeft: `4px solid ${areaColor}` }}>
          <span style={{ color: areaColor, fontWeight: 700, fontSize: mobileOnly ? 14 : 16 }}>{area}</span>
          <span style={{ color: areaColor, fontWeight: 700, fontSize: mobileOnly ? 14 : 16, fontFamily: "'DM Mono',monospace" }}>{fmt(areaSubtotal)}</span>
        </div>

        {mobileOnly ? (
          /* ── MOBILE: cards ── */
          areaRows.map(r => {
            const adjustColor = r.autoAdjust > 0 ? "#047857" : r.autoAdjust < 0 ? "#b45309" : "var(--text3)";
            return (
              <div key={r.emp.id} style={{ ...S.card, marginBottom: 6, padding: "10px 12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <div>
                    <div style={{ color: "var(--text)", fontWeight: 700, fontSize: 13 }}>{r.emp.name}</div>
                    <div style={{ color: "var(--text3)", fontSize: 10 }}>{r.role?.name ?? "—"} • {r.plannedDays} dias</div>
                  </div>
                  <div style={{ color: "var(--text)", fontWeight: 700, fontSize: 15, fontFamily: "'DM Mono',monospace" }}>{fmt(Math.max(0, r.totalPaid))}</div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
                  <div>
                    <div style={{ color: "var(--text3)", fontSize: 9, marginBottom: 3 }}>VT Diário</div>
                    <input type="text" inputMode="decimal" placeholder="0,00" value={localRates[r.emp.id] ?? ""} onChange={e => moneyOnChange(e, setLocalRates, r.emp.id, "rate")} onBlur={e => moneyOnBlur(e, setLocalRates, r.emp.id, "rate")} style={{ ...inputStyle, width: "100%", padding: "5px 7px", fontSize: 12 }} />
                  </div>
                  <div>
                    <div style={{ color: "var(--text3)", fontSize: 9, marginBottom: 3 }}>Ajuste {r.suggestedAdjust !== 0 && <span style={{ color: adjustColor }}>({r.suggestedAdjust > 0 ? "+" : ""}{fmtBR(r.suggestedAdjust)})</span>}</div>
                    <input type="text" inputMode="decimal" placeholder="0,00" value={localOverrides[r.emp.id]?.adjustDisplay ?? toBR(r.autoAdjust)} onChange={e => moneyOnChange(e, setLocalOverrides, r.emp.id, "adjust")} onBlur={e => moneyOnBlur(e, setLocalOverrides, r.emp.id, "adjust")} style={{ ...inputStyle, width: "100%", padding: "5px 7px", fontSize: 12, color: adjustColor }} />
                  </div>
                  <div>
                    <div style={{ color: "var(--text3)", fontSize: 9, marginBottom: 3 }}>Desconto</div>
                    <input type="text" inputMode="decimal" placeholder="0,00" value={localOverrides[r.emp.id]?.discountDisplay ?? toBR(r.manualDiscount)} onChange={e => moneyOnChange(e, setLocalOverrides, r.emp.id, "discount")} onBlur={e => moneyOnBlur(e, setLocalOverrides, r.emp.id, "discount")} style={{ ...inputStyle, width: "100%", padding: "5px 7px", fontSize: 12 }} />
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          /* ── DESKTOP: table section ── */
          <div style={{ ...S.card, padding: 0, overflow: "auto", marginBottom: 4 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr style={{ background: "var(--bg1)" }}>
                  <th style={{ padding: cellPad, textAlign: "left", color: "var(--text)", fontWeight: 700, borderBottom: "2px solid var(--border)" }}>Empregado</th>
                  <th style={{ padding: cellPad, textAlign: "left", color: "var(--text3)", fontWeight: 600, borderBottom: "2px solid var(--border)" }}>Cargo</th>
                  <th style={{ padding: cellPad, textAlign: "right", color: "var(--text3)", fontWeight: 600, borderBottom: "2px solid var(--border)", width: 110 }}>VT Diário</th>
                  <th style={{ padding: cellPad, textAlign: "center", color: "var(--text3)", fontWeight: 600, borderBottom: "2px solid var(--border)", width: 60 }}>Dias</th>
                  <th style={{ padding: cellPad, textAlign: "right", color: "var(--text3)", fontWeight: 600, borderBottom: "2px solid var(--border)", width: 110 }}>VT Bruto</th>
                  <th style={{ padding: cellPad, textAlign: "center", color: "var(--text3)", fontWeight: 600, borderBottom: "2px solid var(--border)", width: 80 }}>Real (mês ant.)</th>
                  <th style={{ padding: cellPad, textAlign: "right", color: "var(--text3)", fontWeight: 600, borderBottom: "2px solid var(--border)", width: 140 }}>Ajuste Mês Ant.</th>
                  <th style={{ padding: cellPad, textAlign: "right", color: "var(--text3)", fontWeight: 600, borderBottom: "2px solid var(--border)", width: 110 }}>Desconto</th>
                  <th style={{ padding: cellPad, textAlign: "right", color: "var(--text)", fontWeight: 700, borderBottom: "2px solid var(--border)", width: 120 }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {areaRows.map((r, i) => {
                  const adjustColor = r.autoAdjust > 0 ? "#047857" : r.autoAdjust < 0 ? "#b45309" : "var(--text3)";
                  return (
                    <tr key={r.emp.id} style={{ borderBottom: i < areaRows.length - 1 ? "1px solid var(--border)" : "none" }}>
                      <td style={{ padding: cellPad, color: "var(--text)", fontWeight: 600 }}>{r.emp.name}</td>
                      <td style={{ padding: cellPad, color: "var(--text3)" }}>{r.role?.name ?? "—"}</td>
                      <td style={{ padding: cellPad, textAlign: "right" }}>
                        <input type="text" inputMode="decimal" placeholder="0,00" value={localRates[r.emp.id] ?? ""} onChange={e => moneyOnChange(e, setLocalRates, r.emp.id, "rate")} onBlur={e => moneyOnBlur(e, setLocalRates, r.emp.id, "rate")} style={inputStyle} />
                      </td>
                      <td style={{ padding: cellPad, textAlign: "center", color: "var(--text)", fontWeight: 600, fontFamily: "'DM Mono',monospace" }}>{r.plannedDays}</td>
                      <td style={{ padding: cellPad, textAlign: "right", color: "var(--text)", fontFamily: "'DM Mono',monospace" }}>{fmt(r.grossVT)}</td>
                      <td style={{ padding: cellPad, textAlign: "center", color: r.prevActualDays !== null ? "var(--text)" : "var(--text3)", fontFamily: "'DM Mono',monospace", fontSize: 13 }}>{r.prevActualDays !== null ? r.prevActualDays : "—"}</td>
                      <td style={{ padding: cellPad, textAlign: "right" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
                          {r.suggestedAdjust !== 0 && <span style={{ fontSize: 10, color: "var(--text3)" }} title="Sugerido pelo sistema">({r.suggestedAdjust > 0 ? "+" : ""}{fmtBR(r.suggestedAdjust)})</span>}
                          <input type="text" inputMode="decimal" placeholder="0,00" value={localOverrides[r.emp.id]?.adjustDisplay ?? toBR(r.autoAdjust)} onChange={e => moneyOnChange(e, setLocalOverrides, r.emp.id, "adjust")} onBlur={e => moneyOnBlur(e, setLocalOverrides, r.emp.id, "adjust")} style={{ ...inputStyle, color: adjustColor }} />
                        </div>
                      </td>
                      <td style={{ padding: cellPad, textAlign: "right" }}>
                        <input type="text" inputMode="decimal" placeholder="0,00" value={localOverrides[r.emp.id]?.discountDisplay ?? toBR(r.manualDiscount)} onChange={e => moneyOnChange(e, setLocalOverrides, r.emp.id, "discount")} onBlur={e => moneyOnBlur(e, setLocalOverrides, r.emp.id, "discount")} style={inputStyle} />
                      </td>
                      <td style={{ padding: cellPad, textAlign: "right", fontWeight: 700, fontSize: 15, fontFamily: "'DM Mono',monospace", color: r.totalPaid < 0 ? "var(--red)" : "var(--text)" }}>{fmt(Math.max(0, r.totalPaid))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <h3 style={{ color: "var(--text)", margin: 0, fontSize: mobileOnly ? 16 : 20 }}>🚌 Vale Transporte</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={exportCSV} style={{ ...S.btnSecondary, fontSize: 12, padding: "6px 14px" }}>📊 CSV</button>
          <button onClick={exportPDF} style={{ ...S.btnSecondary, fontSize: 12, padding: "6px 14px" }}>🖨️ PDF</button>
        </div>
      </div>

      {/* Month selector */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button onClick={() => goMonth(-1)} style={{ ...S.btnSecondary, padding: "6px 12px", fontSize: 16 }}>◀</button>
        <span style={{ color: "var(--text)", fontWeight: 700, fontSize: mobileOnly ? 14 : 16, textTransform: "capitalize" }}>{monthLabel(year, month)}</span>
        <button onClick={() => goMonth(1)} style={{ ...S.btnSecondary, padding: "6px 12px", fontSize: 16 }}>▶</button>
      </div>

      {/* Payment status */}
      {currentPayment && (
        <div style={{ ...S.card, background: "#10b98118", borderColor: "#10b98133", marginBottom: 16, padding: "14px 20px" }}>
          <div style={{ color: "#047857", fontWeight: 700, fontSize: 14 }}>✅ Pago em {new Date(currentPayment.paidAt).toLocaleString("pt-BR")} por {currentPayment.paidBy}</div>
          <div style={{ color: "#047857", fontSize: 12, marginTop: 4 }}>Total pago: {fmt(currentPayment.grandTotal)}</div>
        </div>
      )}

      {prevPayment && (
        <div style={{ ...S.card, background: "#3b82f618", borderColor: "#3b82f633", marginBottom: 16, padding: "12px 20px" }}>
          <div style={{ color: "#2563eb", fontWeight: 600, fontSize: 13 }}>ℹ️ Ajustes calculados a partir do pagamento de {new Date(prevPayment.paidAt).toLocaleDateString("pt-BR")}</div>
        </div>
      )}
      {prevPayment && !(scheduleStatus?.[restaurantId]?.[prevMk]?.status === "closed") && (
        <div style={{background:"#f59e0b15",border:"1px solid #f59e0b44",borderRadius:10,padding:"10px 16px",marginBottom:12,display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:16}}>{"⚠️"}</span>
          <span style={{color:"#f59e0b",fontSize:12}}>
            {prevMk} ainda não fechado — o ajuste automático de {prevMk} será aplicado quando o mês for fechado.
          </span>
        </div>
      )}
      {!prevPayment && (
        <div style={{ ...S.card, background: "#f59e0b18", borderColor: "#f59e0b33", marginBottom: 16, padding: "12px 20px" }}>
          <div style={{ color: "#b45309", fontWeight: 600, fontSize: 13 }}>⚠️ Mês anterior sem pagamento registrado — ajustes automáticos indisponíveis</div>
        </div>
      )}

      {/* Area sections */}
      {activeAreas.map(area => renderAreaSection(area, byArea[area]))}

      {/* Grand total */}
      <div style={{ ...S.card, background: "var(--bg1)", padding: mobileOnly ? "14px 16px" : "16px 24px", marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "var(--text)", fontWeight: 700, fontSize: mobileOnly ? 14 : 16 }}>TOTAL GERAL</span>
          <span style={{ color: ac, fontWeight: 700, fontSize: mobileOnly ? 20 : 24, fontFamily: "'DM Mono',monospace" }}>{fmt(grandTotal)}</span>
        </div>
      </div>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
        <button onClick={openPayModal} style={{ ...S.btn, background: currentPayment ? "#10b981" : "#2563eb", color: "#fff", fontWeight: 700, padding: "12px 24px", fontSize: 14 }}>
          {currentPayment ? "🔄 Remarcar como Pago" : "💰 Marcar como Pago"}
        </button>
      </div>

      {restEmps.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: "var(--text3)" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🚌</div>
          <div style={{ fontSize: 15 }}>Nenhum empregado cadastrado</div>
        </div>
      )}

      {/* ── Modal: selecionar data do pagamento ── */}
      {showPayDateModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }} onClick={() => { setShowPayDateModal(false); setVersionWarning(null); }}>
          <div style={{ background: "var(--bg)", borderRadius: 16, padding: 28, maxWidth: 440, width: "90%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }} onClick={e => e.stopPropagation()}>
            {!versionWarning ? (
              <>
                <h3 style={{ margin: "0 0 6px", color: "var(--text)", fontSize: 18 }}>💰 Marcar como Pago</h3>
                <p style={{ color: "var(--text2)", fontSize: 13, margin: "0 0 18px", lineHeight: 1.5 }}>Os valores serão congelados como referência para o cálculo de ajuste do próximo mês.</p>
                <label style={{ display: "block", color: "var(--text2)", fontSize: 13, marginBottom: 6 }}>Data do pagamento:</label>
                <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} style={{ ...S.input, fontSize: 15, padding: "10px 14px", marginBottom: 18, width: "100%", boxSizing: "border-box" }} />
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button onClick={() => { setShowPayDateModal(false); setVersionWarning(null); }} style={{ ...S.btn, padding: "10px 20px" }}>Cancelar</button>
                  <button onClick={checkVersionAndPay} style={{ ...S.btn, background: "#2563eb", color: "#fff", fontWeight: 700, padding: "10px 20px" }}>Confirmar</button>
                </div>
              </>
            ) : (
              <>
                <h3 style={{ margin: "0 0 6px", color: "#b45309", fontSize: 18 }}>⚠️ Edições encontradas após a data</h3>
                <p style={{ color: "var(--text2)", fontSize: 13, margin: "0 0 12px", lineHeight: 1.5 }}>
                  A escala foi editada <strong>{versionWarning.edits.length}×</strong> após {versionWarning.payDateStr.split("-").reverse().join("/")}. Qual versão dos valores deseja usar?
                </p>
                <div style={{ background: "var(--bg1)", borderRadius: 10, padding: 12, marginBottom: 16, maxHeight: 150, overflowY: "auto", fontSize: 12, color: "var(--text2)" }}>
                  {versionWarning.edits.map((e, i) => (
                    <div key={i} style={{ padding: "4px 0", borderBottom: i < versionWarning.edits.length - 1 ? "1px solid var(--border)" : "none" }}>
                      📝 {new Date(e.ts).toLocaleString("pt-BR")} — {e.author} ({e.reason})
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <button onClick={() => confirmPay(versionWarning.payDateStr, true)} style={{ ...S.btn, background: "#f59e0b", color: "#fff", fontWeight: 700, padding: "12px 16px", fontSize: 13, textAlign: "left" }}>
                    📋 Usar valores da data do pagamento ({versionWarning.payDateStr.split("-").reverse().join("/")})
                  </button>
                  <button onClick={() => confirmPay(versionWarning.payDateStr, false)} style={{ ...S.btn, background: "#2563eb", color: "#fff", fontWeight: 700, padding: "12px 16px", fontSize: 13, textAlign: "left" }}>
                    📊 Usar valores atuais (com as edições recentes)
                  </button>
                  <button onClick={() => { setVersionWarning(null); }} style={{ ...S.btn, padding: "10px 16px", fontSize: 13 }}>← Voltar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TRILHA DO EMPREGADO — Components
// ═══════════════════════════════════════════════════════════════════

const INCIDENT_TYPES = [
  { id:"advertencia_verbal", label:"Advertência verbal", negative:true },
  { id:"advertencia_escrita", label:"Advertência escrita", negative:true },
  { id:"desentendimento", label:"Desentendimento", negative:true },
  { id:"dano_material", label:"Dano material", negative:true },
  { id:"indisciplina", label:"Indisciplina", negative:true },
  { id:"elogio_formal", label:"Elogio formal", negative:false },
  { id:"destaque_positivo", label:"Destaque positivo", negative:false },
  { id:"outro", label:"Outro", negative:true },
];
const SEVERITY_OPTIONS = [
  { id:"leve", label:"Leve", color:"#f59e0b" },
  { id:"media", label:"Média", color:"#f97316" },
  { id:"grave", label:"Grave", color:"#e74c3c" },
];

// EmpTimeline removed — replaced by interactive Jornada in trilha tab


function IncidentForm({ restaurantId, employees, onUpdate, incidents, currentUser, isOwner, preSelectedEmpId }) {
  const restEmps = employees.filter(e => e.restaurantId === restaurantId && !(e.inactive && e.inactiveFrom && e.inactiveFrom <= today()));
  const [selectedEmps, setSelectedEmps] = useState(preSelectedEmpId ? [preSelectedEmpId] : []);
  const [type, setType] = useState("");
  const [severity, setSeverity] = useState("");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(today());

  const typeObj = INCIDENT_TYPES.find(t => t.id === type);
  const needsSeverity = typeObj?.negative ?? true;

  function handleSubmit() {
    if (selectedEmps.length === 0) { window.alert("Selecione ao menos um empregado."); return; }
    if (!type) { window.alert("Selecione o tipo de ocorrência."); return; }
    if (needsSeverity && !severity) { window.alert("Selecione a gravidade."); return; }
    if (!description.trim()) { window.alert("Descreva a ocorrência."); return; }
    const inc = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      restaurantId,
      employeeIds: selectedEmps,
      type,
      severity: needsSeverity ? severity : null,
      description: description.trim(),
      date,
      createdAt: new Date().toISOString(),
      createdBy: isOwner ? "Gestor AppTip" : (currentUser?.name ?? "Gestor Adm."),
      createdById: currentUser?.id ?? null,
      visibility: "internal",
    };
    onUpdate("incidents", [...(incidents ?? []), inc]);
    setSelectedEmps([]); setType(""); setSeverity(""); setDescription(""); setDate(today());
  }

  const formBorderColor = typeObj ? (typeObj.negative ? "#e74c3c33" : "#10b98133") : "var(--border)";
  const formBgColor = typeObj ? (typeObj.negative ? "#e74c3c06" : "#10b98106") : undefined;
  const formHeaderColor = typeObj ? (typeObj.negative ? "var(--red)" : "var(--green)") : "var(--text)";
  const formTitle = typeObj ? (typeObj.negative ? "🚨 Registrar ocorrência negativa" : "🌟 Registrar ocorrência positiva") : "Registrar ocorrência";

  return (
    <div style={{...S.card, padding:"18px 20px", border:`1px solid ${formBorderColor}`, background:formBgColor, transition:"all 0.2s"}}>
      <h4 style={{color:formHeaderColor,margin:"0 0 14px",fontSize:15,fontWeight:700}}>{formTitle}</h4>
      <div style={{marginBottom:12}}>
        <label style={S.label}>Empregados envolvidos</label>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,maxHeight:120,overflowY:"auto",padding:4}}>
          {restEmps.map(emp => (
            <label key={emp.id} style={{display:"flex",alignItems:"center",gap:4,fontSize:12,color:"var(--text2)",cursor:"pointer",padding:"4px 8px",borderRadius:6,border:`1px solid ${selectedEmps.includes(emp.id)?"var(--ac)":"var(--border)"}`,background:selectedEmps.includes(emp.id)?"var(--ac-bg,#d4a01711)":"transparent"}}>
              <input type="checkbox" checked={selectedEmps.includes(emp.id)} onChange={()=>setSelectedEmps(prev=>prev.includes(emp.id)?prev.filter(x=>x!==emp.id):[...prev,emp.id])} style={{accentColor:"var(--ac)"}}/>
              {emp.name}
            </label>
          ))}
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
        <div>
          <label style={S.label}>Tipo</label>
          <select value={type} onChange={e=>setType(e.target.value)} style={S.input}>
            <option value="">Selecionar...</option>
            <optgroup label="⚠️ Negativas">
              {INCIDENT_TYPES.filter(t=>t.negative).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </optgroup>
            <optgroup label="🌟 Positivas">
              {INCIDENT_TYPES.filter(t=>!t.negative).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </optgroup>
          </select>
        </div>
        <div>
          <label style={S.label}>Data</label>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} style={S.input}/>
        </div>
      </div>
      {needsSeverity && type && (
        <div style={{marginBottom:12}}>
          <label style={S.label}>Gravidade</label>
          <div style={{display:"flex",gap:8}}>
            {SEVERITY_OPTIONS.map(s => (
              <button key={s.id} onClick={()=>setSeverity(s.id)} style={{flex:1,padding:"8px",borderRadius:8,border:`1px solid ${severity===s.id?s.color:s.color+"44"}`,background:severity===s.id?s.color+"22":"transparent",color:s.color,cursor:"pointer",fontWeight:severity===s.id?700:500,fontSize:13,fontFamily:"'DM Sans',sans-serif"}}>{s.label}</button>
            ))}
          </div>
        </div>
      )}
      <div style={{marginBottom:14}}>
        <label style={S.label}>Descrição</label>
        <textarea value={description} onChange={e=>setDescription(e.target.value)} rows={3} placeholder="Descreva a ocorrência em detalhes..." style={{...S.input,resize:"vertical"}}/>
      </div>
      <button onClick={handleSubmit} style={{...S.btnPrimary,width:"auto",padding:"10px 24px",background:typeObj?(typeObj.negative?"var(--red)":"var(--green)"):undefined}}>
        {typeObj ? (typeObj.negative ? "🚨 Registrar ocorrência" : "🌟 Registrar elogio") : "Registrar ocorrência"}
      </button>
    </div>
  );
}

const RATING_LABELS = ["Abaixo do esperado","Em desenvolvimento","Atende","Supera","Excepcional"];
const RATING_COLORS = ["#ef4444","#f97316","#eab308","#3b82f6","#10b981"];

const GOAL_TYPES = [
  { value: "manter", label: "Manter no cargo", icon: "🏠", color: "#10b981" },
  { value: "subir",  label: "Subir de cargo",  icon: "⬆️", color: "#3b82f6" },
  { value: "conhecimento", label: "Aprofundar conhecimento", icon: "📚", color: "#8b5cf6" },
  { value: "personalizado", label: "Personalizado", icon: "✏️", color: "#f59e0b" },
];
const MATERIAL_TYPES = [
  { value: "livro", label: "Livro", icon: "📖" },
  { value: "video", label: "Vídeo", icon: "🎬" },
  { value: "curso", label: "Curso", icon: "🎓" },
  { value: "pratica", label: "Prática", icon: "🔧" },
  { value: "link", label: "Link", icon: "🔗" },
];

const AUTO_META_RULES = [
  { id: "zero_faltas_inj", label: "0 faltas injustificadas no mês", check: (empId, schedules, rid) => {
    const now = new Date();
    const mk = monthKey(now.getFullYear(), now.getMonth());
    const days = schedules?.[rid]?.[mk]?.[empId] ?? {};
    return Object.values(days).filter(s => s === DAY_FAULT_U).length === 0;
  }},
  { id: "zero_faltas_tot", label: "0 faltas (todas) no mês", check: (empId, schedules, rid) => {
    const now = new Date();
    const mk = monthKey(now.getFullYear(), now.getMonth());
    const days = schedules?.[rid]?.[mk]?.[empId] ?? {};
    return Object.values(days).filter(s => s === DAY_FAULT_U || s === DAY_FAULT_J).length === 0;
  }},
  { id: "feedback_excepcional", label: "Avaliação Excepcional no último feedback", check: (empId, _s, _r, feedbacks, rid) => {
    const myFbs = (feedbacks ?? []).filter(f => f.employeeId === empId && f.restaurantId === rid && !f.deletedAt).sort((a,b)=>(b.createdAt??"").localeCompare(a.createdAt??""));
    return myFbs[0]?.rating === 5;
  }},
  { id: "90_dias", label: "90 dias na empresa", check: (empId, _s, _r, _f, _rid, employees) => {
    const emp = (employees ?? []).find(e => e.id === empId);
    if (!emp?.admission) return false;
    return Math.floor((new Date() - new Date(emp.admission+"T12:00:00")) / 86400000) >= 90;
  }},
];

function GoalsManager({ empId, employeeGoals, roles, restaurantId, onUpdate, currentUser, isOwner, schedules, feedbacks, employees }) {
  const [showForm, setShowForm] = useState(false);
  const [goalType, setGoalType] = useState("manter");
  const [goalTitle, setGoalTitle] = useState("");
  const [goalTopic, setGoalTopic] = useState("");
  const [goalTargetRoleId, setGoalTargetRoleId] = useState("");
  const [showMaterialForm, setShowMaterialForm] = useState(null); // goalId
  const [matTitle, setMatTitle] = useState("");
  const [matLink, setMatLink] = useState("");
  const [matType, setMatType] = useState("link");
  const [showMetaForm, setShowMetaForm] = useState(null); // goalId
  const [metaTitle, setMetaTitle] = useState("");
  const [metaAutoRule, setMetaAutoRule] = useState("");

  const restRoles = (roles ?? []).filter(r => r.restaurantId === restaurantId && !r.inactive);
  const goals = (employeeGoals?.[empId] ?? []).filter(g => g.status !== "cancelled");
  const activeGoals = goals.filter(g => g.status === "active");
  const completedGoals = goals.filter(g => g.status === "completed");

  function saveGoals(newGoals) {
    const updated = { ...(employeeGoals ?? {}), [empId]: newGoals };
    onUpdate("employeeGoals", updated);
  }

  function addGoal() {
    let title = "";
    if (goalType === "manter") title = "Manter no cargo";
    else if (goalType === "subir") {
      const tRole = restRoles.find(r => r.id === goalTargetRoleId);
      title = tRole ? `Subir para ${tRole.name}` : "Subir de cargo";
    } else if (goalType === "conhecimento") title = goalTopic.trim() || "Aprofundar conhecimento";
    else title = goalTitle.trim() || "Objetivo personalizado";

    const newGoal = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      type: goalType,
      title,
      targetRoleId: goalType === "subir" ? goalTargetRoleId || null : null,
      topic: goalType === "conhecimento" ? goalTopic.trim() : null,
      materials: [],
      metas: [],
      createdAt: new Date().toISOString(),
      createdBy: isOwner ? "Gestor AppTip" : (currentUser?.name ?? "Gestor Adm."),
      status: "active",
    };
    saveGoals([...(employeeGoals?.[empId] ?? []), newGoal]);
    setShowForm(false); setGoalTitle(""); setGoalTopic(""); setGoalTargetRoleId("");
  }

  function toggleGoalStatus(goalId) {
    const all = [...(employeeGoals?.[empId] ?? [])];
    const idx = all.findIndex(g => g.id === goalId);
    if (idx < 0) return;
    all[idx] = { ...all[idx], status: all[idx].status === "active" ? "completed" : "active" };
    saveGoals(all);
  }

  function removeGoal(goalId) {
    if (!window.confirm("Remover este objetivo?")) return;
    const all = [...(employeeGoals?.[empId] ?? [])];
    const idx = all.findIndex(g => g.id === goalId);
    if (idx < 0) return;
    all[idx] = { ...all[idx], status: "cancelled" };
    saveGoals(all);
  }

  function addMaterial(goalId) {
    if (!matTitle.trim()) return;
    const all = [...(employeeGoals?.[empId] ?? [])];
    const idx = all.findIndex(g => g.id === goalId);
    if (idx < 0) return;
    const mat = { id: `m${Date.now()}`, title: matTitle.trim(), link: matLink.trim() || null, type: matType };
    all[idx] = { ...all[idx], materials: [...(all[idx].materials ?? []), mat] };
    saveGoals(all);
    setMatTitle(""); setMatLink(""); setShowMaterialForm(null);
  }

  function removeMaterial(goalId, matId) {
    const all = [...(employeeGoals?.[empId] ?? [])];
    const idx = all.findIndex(g => g.id === goalId);
    if (idx < 0) return;
    all[idx] = { ...all[idx], materials: (all[idx].materials ?? []).filter(m => m.id !== matId) };
    saveGoals(all);
  }

  function addMeta(goalId) {
    if (metaAutoRule) {
      const rule = AUTO_META_RULES.find(r => r.id === metaAutoRule);
      if (!rule) return;
      const meta = { id: `t${Date.now()}`, title: rule.label, done: false, doneAt: null, doneBy: null, autoCheck: true, autoCheckRule: metaAutoRule };
      const all = [...(employeeGoals?.[empId] ?? [])];
      const idx = all.findIndex(g => g.id === goalId);
      if (idx < 0) return;
      all[idx] = { ...all[idx], metas: [...(all[idx].metas ?? []), meta] };
      saveGoals(all);
      setMetaAutoRule(""); setShowMetaForm(null);
      return;
    }
    if (!metaTitle.trim()) return;
    const all = [...(employeeGoals?.[empId] ?? [])];
    const idx = all.findIndex(g => g.id === goalId);
    if (idx < 0) return;
    const meta = { id: `t${Date.now()}`, title: metaTitle.trim(), done: false, doneAt: null, doneBy: null, autoCheck: false, autoCheckRule: null };
    all[idx] = { ...all[idx], metas: [...(all[idx].metas ?? []), meta] };
    saveGoals(all);
    setMetaTitle(""); setMetaAutoRule(""); setShowMetaForm(null);
  }

  function toggleMeta(goalId, metaId) {
    const all = [...(employeeGoals?.[empId] ?? [])];
    const idx = all.findIndex(g => g.id === goalId);
    if (idx < 0) return;
    all[idx] = { ...all[idx], metas: (all[idx].metas ?? []).map(m =>
      m.id === metaId ? { ...m, done: !m.done, doneAt: !m.done ? new Date().toISOString() : null, doneBy: !m.done ? (currentUser?.name ?? "Gestor Adm.") : null } : m
    )};
    saveGoals(all);
  }


  function removeMeta(goalId, metaId) {
    const all = [...(employeeGoals?.[empId] ?? [])];
    const idx = all.findIndex(g => g.id === goalId);
    if (idx < 0) return;
    all[idx] = { ...all[idx], metas: (all[idx].metas ?? []).filter(m => m.id !== metaId) };
    saveGoals(all);
  }

  function renderGoalCard(goal) {
    const typeInfo = GOAL_TYPES.find(t => t.value === goal.type) ?? GOAL_TYPES[3];
    const metas = goal.metas ?? [];
    const doneMetas = metas.filter(m => {
      if (m.autoCheck && m.autoCheckRule) {
        const rule = AUTO_META_RULES.find(r => r.id === m.autoCheckRule);
        return rule ? rule.check(empId, schedules, restaurantId, feedbacks, restaurantId, employees) : m.done;
      }
      return m.done;
    }).length;
    const progressPct = metas.length > 0 ? Math.round((doneMetas / metas.length) * 100) : 0;
    const isCompleted = goal.status === "completed";

    return (
      <div key={goal.id} style={{...S.card, marginBottom: 12, padding: "14px 16px", opacity: isCompleted ? 0.7 : 1, borderLeft: `4px solid ${typeInfo.color}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
              <span style={{fontSize:16}}>{typeInfo.icon}</span>
              <span style={{color:"var(--text)",fontWeight:700,fontSize:14}}>{goal.title}</span>
              {isCompleted && <span style={{fontSize:10,background:"#10b98122",color:"#10b981",padding:"2px 8px",borderRadius:8,fontWeight:600}}>Concluído</span>}
            </div>
            <div style={{color:"var(--text3)",fontSize:11}}>
              {typeInfo.label} · Criado em {new Date(goal.createdAt).toLocaleDateString("pt-BR")} por {goal.createdBy}
            </div>
          </div>
          <div style={{display:"flex",gap:4}}>
            <button onClick={()=>toggleGoalStatus(goal.id)} title={isCompleted?"Reabrir":"Concluir"} style={{background:"none",border:"none",cursor:"pointer",fontSize:16,padding:2}}>{isCompleted?"🔄":"✅"}</button>
            <button onClick={()=>removeGoal(goal.id)} title="Remover" style={{background:"none",border:"none",cursor:"pointer",fontSize:16,padding:2}}>🗑️</button>
          </div>
        </div>

        {/* Progress bar */}
        {metas.length > 0 && (
          <div style={{marginBottom:10}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
              <span style={{color:"var(--text3)",fontSize:11}}>Progresso</span>
              <span style={{color:typeInfo.color,fontSize:11,fontWeight:700}}>{doneMetas}/{metas.length} ({progressPct}%)</span>
            </div>
            <div style={{height:6,borderRadius:3,background:"var(--border)",overflow:"hidden"}}>
              <div style={{height:"100%",borderRadius:3,background:typeInfo.color,width:`${progressPct}%`,transition:"width 0.3s"}}/>
            </div>
          </div>
        )}

        {/* Metas checklist */}
        {metas.length > 0 && (
          <div style={{marginBottom:8}}>
            {metas.map(meta => {
              const isAuto = meta.autoCheck && meta.autoCheckRule;
              const autoRule = isAuto ? AUTO_META_RULES.find(r => r.id === meta.autoCheckRule) : null;
              const autoResult = autoRule ? autoRule.check(empId, schedules, restaurantId, feedbacks, restaurantId, []) : false;
              const isDone = isAuto ? autoResult : meta.done;
              return (
              <div key={meta.id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid var(--border)22",flexWrap:"wrap"}}>
                {isAuto ? (
                  <span style={{fontSize:14,padding:0,lineHeight:1}}>{isDone?"✅":"⏳"}</span>
                ) : (
                  <button onClick={()=>toggleMeta(goal.id, meta.id)} title="Confirmação do gestor" style={{background:"none",border:"none",cursor:"pointer",fontSize:14,padding:0,lineHeight:1}}>{isDone?"☑️":"⬜"}</button>
                )}
                <span style={{flex:1,color:isDone?"var(--text3)":"var(--text)",fontSize:12,textDecoration:isDone?"line-through":"none"}}>{meta.title}</span>
                {isAuto && <span style={{fontSize:9,color:"#8b5cf6",background:"#8b5cf611",padding:"1px 6px",borderRadius:4}}>auto</span>}
                {!isAuto && meta.employeeMarked && !isDone && <span style={{fontSize:9,color:"#f59e0b",background:"#f59e0b11",padding:"1px 6px",borderRadius:4}}>empregado concluiu em {meta.employeeDoneAt ? new Date(meta.employeeDoneAt).toLocaleDateString("pt-BR") : "—"}</span>}
                {!isAuto && isDone && meta.doneAt && <span style={{color:"var(--text3)",fontSize:9}}>✓ {new Date(meta.doneAt).toLocaleDateString("pt-BR")}</span>}
                <button onClick={()=>removeMeta(goal.id, meta.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:10,color:"var(--text3)",padding:0}}>✕</button>
              </div>
              );
            })}
          </div>
        )}
        {showMetaForm === goal.id ? (
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:8}}>
            <div style={{display:"flex",gap:6}}>
              <input value={metaTitle} onChange={e=>{setMetaTitle(e.target.value);setMetaAutoRule("");}} placeholder="Meta manual..." style={{...S.input,flex:1,fontSize:12,padding:"6px 10px"}} onKeyDown={e=>e.key==="Enter"&&addMeta(goal.id)}/>
              <button onClick={()=>addMeta(goal.id)} style={{...S.btn,fontSize:11,padding:"6px 12px",background:typeInfo.color,color:"#fff",fontWeight:600}}>+</button>
              <button onClick={()=>{setShowMetaForm(null);setMetaTitle("");setMetaAutoRule("");}} style={{...S.btn,fontSize:11,padding:"6px 10px"}}>✕</button>
            </div>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontSize:10,color:"#8b5cf6",fontWeight:600,whiteSpace:"nowrap"}}>ou automática:</span>
              <select value={metaAutoRule} onChange={e=>{setMetaAutoRule(e.target.value);if(e.target.value)setMetaTitle("");}} style={{...S.input,flex:1,fontSize:11,padding:"5px 8px"}}>
                <option value="">Selecionar regra...</option>
                {AUTO_META_RULES.map(r=><option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
              {metaAutoRule && <button onClick={()=>addMeta(goal.id)} style={{...S.btn,fontSize:11,padding:"5px 10px",background:"#8b5cf6",color:"#fff",fontWeight:600}}>+</button>}
            </div>
          </div>
        ) : (
          <button onClick={()=>{setShowMetaForm(goal.id);setMetaTitle("");setMetaAutoRule("");}} style={{background:"none",border:"none",color:typeInfo.color,cursor:"pointer",fontSize:11,fontWeight:600,padding:"2px 0",marginBottom:6}}>+ Adicionar meta</button>
        )}

        {/* Materials */}
        {(goal.materials ?? []).length > 0 && (
          <div style={{marginBottom:6}}>
            <div style={{color:"var(--text3)",fontSize:10,fontWeight:600,marginBottom:4}}>📎 Material de apoio</div>
            {goal.materials.map(mat => {
              const mtIcon = MATERIAL_TYPES.find(t=>t.value===mat.type)?.icon ?? "📋";
              return (
                <div key={mat.id} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 0",fontSize:12}}>
                  <span>{mtIcon}</span>
                  {mat.link ? <a href={mat.link} target="_blank" rel="noreferrer" style={{color:"#3b82f6",flex:1}}>{mat.title}</a> : <span style={{color:"var(--text)",flex:1}}>{mat.title}</span>}
                  <button onClick={()=>removeMaterial(goal.id, mat.id)} style={{background:"none",border:"none",cursor:"pointer",fontSize:10,color:"var(--text3)",padding:0}}>✕</button>
                </div>
              );
            })}
          </div>
        )}
        {showMaterialForm === goal.id ? (
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:4}}>
            <select value={matType} onChange={e=>setMatType(e.target.value)} style={{...S.input,width:90,fontSize:11,padding:"5px 8px"}}>
              {MATERIAL_TYPES.map(t=><option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
            </select>
            <input value={matTitle} onChange={e=>setMatTitle(e.target.value)} placeholder="Título" style={{...S.input,flex:1,fontSize:11,padding:"5px 8px",minWidth:100}}/>
            <input value={matLink} onChange={e=>setMatLink(e.target.value)} placeholder="Link (opcional)" style={{...S.input,flex:1,fontSize:11,padding:"5px 8px",minWidth:100}}/>
            <button onClick={()=>addMaterial(goal.id)} style={{...S.btn,fontSize:11,padding:"5px 10px",background:typeInfo.color,color:"#fff",fontWeight:600}}>+</button>
            <button onClick={()=>{setShowMaterialForm(null);setMatTitle("");setMatLink("");}} style={{...S.btn,fontSize:11,padding:"5px 10px"}}>✕</button>
          </div>
        ) : (
          <button onClick={()=>{setShowMaterialForm(goal.id);setMatTitle("");setMatLink("");}} style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:11,padding:"2px 0"}}>+ Material de apoio</button>
        )}
      </div>
    );
  }

  return (
    <div style={{marginBottom:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <h4 style={{color:"var(--text)",margin:0,fontSize:15,fontWeight:700}}>🎯 Objetivos</h4>
        <button onClick={()=>setShowForm(!showForm)} style={{...S.btn,fontSize:12,padding:"6px 14px",background:showForm?"var(--accent)11":"transparent",color:showForm?"var(--accent)":"var(--text3)",border:`1px solid ${showForm?"var(--accent)":"var(--border)"}`}}>
          {showForm ? "✕ Fechar" : "+ Novo objetivo"}
        </button>
      </div>

      {showForm && (
        <div style={{...S.card,padding:"16px",marginBottom:12}}>
          <label style={S.label}>Tipo de objetivo</label>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
            {GOAL_TYPES.map(t => (
              <button key={t.value} onClick={()=>setGoalType(t.value)} style={{
                padding:"8px 14px",fontSize:12,fontWeight:goalType===t.value?700:500,
                border:`2px solid ${goalType===t.value?t.color:"var(--border)"}`,borderRadius:8,cursor:"pointer",
                background:goalType===t.value?t.color+"18":"var(--bg)",color:goalType===t.value?t.color:"var(--text2)",
              }}>{t.icon} {t.label}</button>
            ))}
          </div>

          {goalType === "subir" && (
            <div style={{marginBottom:12}}>
              <label style={S.label}>Cargo-alvo</label>
              <select value={goalTargetRoleId} onChange={e=>setGoalTargetRoleId(e.target.value)} style={S.input}>
                <option value="">Selecionar cargo...</option>
                {restRoles.map(r => <option key={r.id} value={r.id}>{r.name} ({r.area})</option>)}
              </select>
            </div>
          )}
          {goalType === "conhecimento" && (
            <div style={{marginBottom:12}}>
              <label style={S.label}>Tema</label>
              <input value={goalTopic} onChange={e=>setGoalTopic(e.target.value)} placeholder="Ex: Vinhos italianos, Atendimento VIP..." style={S.input}/>
            </div>
          )}
          {goalType === "personalizado" && (
            <div style={{marginBottom:12}}>
              <label style={S.label}>Título do objetivo</label>
              <input value={goalTitle} onChange={e=>setGoalTitle(e.target.value)} placeholder="Ex: Melhorar comunicação com equipe" style={S.input}/>
            </div>
          )}
          <button onClick={addGoal} style={{...S.btnPrimary,width:"auto",padding:"10px 20px"}}>Criar objetivo</button>
        </div>
      )}

      {activeGoals.length === 0 && !showForm && (
        <div style={{textAlign:"center",padding:24,color:"var(--text3)"}}>
          <div style={{fontSize:32,marginBottom:8}}>🎯</div>
          <div style={{fontSize:13}}>Nenhum objetivo ativo</div>
        </div>
      )}

      {activeGoals.map(g => renderGoalCard(g))}

      {completedGoals.length > 0 && (
        <details style={{marginTop:8}}>
          <summary style={{color:"var(--text3)",fontSize:12,cursor:"pointer",marginBottom:8}}>Objetivos concluídos ({completedGoals.length})</summary>
          {completedGoals.map(g => renderGoalCard(g))}
        </details>
      )}
    </div>
  );
}

function MeetingPlannerSection({ restaurantId, employees, roles, areas, meetingPlans, allMeetingPlans, feedbacks, onUpdate, currentUser, isOwner, mobileOnly }) {
  const [showForm, setShowForm] = useState(false);
  const [planType, setPlanType] = useState("alinhamento");
  const [planDate, setPlanDate] = useState("");
  const [planNote, setPlanNote] = useState("");
  const [selectedAreas, setSelectedAreas] = useState([]);
  const [selectedEmps, setSelectedEmps] = useState([]);

  const toggleArea = (area) => {
    const areaEmps = employees.filter(e => { const r = roles.find(rl => rl.id === e.roleId); return r?.area === area; }).map(e => e.id);
    if (selectedAreas.includes(area)) {
      setSelectedAreas(prev => prev.filter(a => a !== area));
      setSelectedEmps(prev => prev.filter(id => !areaEmps.includes(id)));
    } else {
      setSelectedAreas(prev => [...prev, area]);
      setSelectedEmps(prev => [...new Set([...prev, ...areaEmps])]);
    }
  };

  const toggleEmp = (empId) => {
    setSelectedEmps(prev => prev.includes(empId) ? prev.filter(id => id !== empId) : [...prev, empId]);
  };

  function handleCreatePlan() {
    if (!planDate) { window.alert("Informe a data prevista."); return; }
    if (selectedEmps.length === 0) { window.alert("Selecione ao menos um participante."); return; }
    const plan = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      restaurantId,
      type: planType,
      employeeIds: [...selectedEmps],
      plannedDate: planDate,
      note: planNote.trim(),
      createdBy: isOwner ? "Gestor AppTip" : (currentUser?.name ?? "Gestor Adm."),
      createdAt: new Date().toISOString(),
      completedFeedbackIds: {},
    };
    onUpdate("meetingPlans", [...(allMeetingPlans ?? []), plan]);
    setPlanDate(""); setPlanNote(""); setSelectedAreas([]); setSelectedEmps([]); setShowForm(false);
  }

  function handleDeletePlan(planId) {
    if (!window.confirm("Excluir esta reunião planejada?")) return;
    onUpdate("meetingPlans", (allMeetingPlans ?? []).filter(p => p.id !== planId));
  }

  // Determine status for each employee in a plan
  function getEmpStatus(plan, empId) {
    if (plan.completedFeedbackIds?.[empId]) return "realizada";
    // Check if there's a matching feedback (same employee, same type, date within ±7 days)
    const fb = (feedbacks ?? []).find(f => {
      if (f.employeeId !== empId || f.deletedAt) return false;
      const fbType = f.meetingType || (f.rating > 0 ? "avaliação" : "alinhamento");
      if (fbType !== plan.type) return false;
      const fbDate = f.meetingDate || f.createdAt?.slice(0,10);
      if (!fbDate) return false;
      const diff = Math.abs(new Date(fbDate+"T12:00:00") - new Date(plan.plannedDate+"T12:00:00"));
      return diff < 7 * 86400000;
    });
    if (fb) return "realizada";
    if (plan.plannedDate < today()) return "atrasada";
    return "pendente";
  }

  const typeColor = planType === "avaliação" ? "#8b5cf6" : "#3b82f6";

  // Group plans by month
  const grouped = {};
  meetingPlans.forEach(p => {
    const mk = p.plannedDate?.slice(0,7) ?? "sem-data";
    if (!grouped[mk]) grouped[mk] = [];
    grouped[mk].push(p);
  });

  return (
    <div>
      {/* New plan button */}
      <button onClick={()=>setShowForm(!showForm)} style={{...S.btnPrimary,marginBottom:16,fontSize:13,padding:"10px 20px",background:showForm?"var(--red)":"#3b82f6",borderColor:showForm?"var(--red)":"#3b82f6"}}>
        {showForm ? "✕ Cancelar" : "+ Planejar reunião"}
      </button>

      {/* Form */}
      {showForm && (
        <div style={{...S.card,padding:"18px 20px",marginBottom:20,border:`1px solid ${typeColor}22`}}>
          <h4 style={{color:"var(--text)",margin:"0 0 14px",fontSize:15,fontWeight:700}}>Nova reunião</h4>
          {/* Type toggle */}
          <div style={{display:"flex",gap:6,marginBottom:14}}>
            {[["alinhamento","💬 Alinhamento","#3b82f6"],["avaliação","📋 Avaliação","#8b5cf6"]].map(([val,lbl,col]) => (
              <button key={val} onClick={()=>setPlanType(val)} style={{
                flex:1,padding:"10px",borderRadius:10,border:`2px solid ${planType===val?col:"var(--border)"}`,
                background:planType===val?col+"14":"transparent",color:planType===val?col:"var(--text3)",
                cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:planType===val?700:400
              }}>{lbl}</button>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
            <div>
              <label style={S.label}>Data prevista</label>
              <input type="date" value={planDate} onChange={e=>setPlanDate(e.target.value)} style={S.input}/>
            </div>
            <div>
              <label style={S.label}>Observação <span style={{fontWeight:400,color:"var(--text3)"}}>(opcional)</span></label>
              <input value={planNote} onChange={e=>setPlanNote(e.target.value)} placeholder="Ex: Fechamento trimestral" style={S.input}/>
            </div>
          </div>
          {/* Area selector */}
          <label style={S.label}>Participantes</label>
          <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
            {areas.map(area => {
              const active = selectedAreas.includes(area);
              const col = AREA_COLORS[area] ?? "#888";
              return (
                <button key={area} onClick={()=>toggleArea(area)} style={{
                  padding:"6px 14px",borderRadius:20,border:`1px solid ${active?col:"var(--border)"}`,
                  background:active?col+"22":"transparent",color:active?col:"var(--text3)",
                  cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:active?700:400
                }}>{area}</button>
              );
            })}
          </div>
          {/* Employee chips */}
          {selectedAreas.length > 0 && (
            <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:14,maxHeight:160,overflowY:"auto",padding:4}}>
              {employees.filter(e => {
                const r = roles.find(rl => rl.id === e.roleId);
                return selectedAreas.includes(r?.area);
              }).map(emp => {
                const active = selectedEmps.includes(emp.id);
                return (
                  <button key={emp.id} onClick={()=>toggleEmp(emp.id)} style={{
                    padding:"4px 10px",borderRadius:8,border:`1px solid ${active?"var(--ac)":"var(--border)"}`,
                    background:active?"var(--ac-bg,#d4a01711)":"transparent",color:active?"var(--ac)":"var(--text3)",
                    cursor:"pointer",fontSize:11,fontFamily:"'DM Mono',monospace",fontWeight:active?600:400
                  }}>{active ? "✓ " : ""}{emp.name}</button>
                );
              })}
            </div>
          )}
          {selectedEmps.length > 0 && <div style={{fontSize:11,color:"var(--text3)",marginBottom:10}}>{selectedEmps.length} participante{selectedEmps.length!==1?"s":""} selecionado{selectedEmps.length!==1?"s":""}</div>}
          <button onClick={handleCreatePlan} style={{...S.btnPrimary,width:"auto",padding:"10px 24px",background:typeColor,borderColor:typeColor}}>Criar reunião</button>
        </div>
      )}

      {/* Plans list grouped by month */}
      {Object.keys(grouped).length === 0 && !showForm && (
        <div style={{...S.card,textAlign:"center",padding:40}}>
          <div style={{fontSize:36,marginBottom:12}}>📅</div>
          <p style={{color:"var(--text3)",fontSize:14}}>Nenhuma reunião planejada ainda.</p>
          <p style={{color:"var(--text3)",fontSize:12}}>Clique em "+ Planejar reunião" para começar.</p>
        </div>
      )}
      {Object.entries(grouped).sort(([a],[b])=>b.localeCompare(a)).map(([mk, plans]) => {
        const [y,m] = mk.split("-");
        const monthName = new Date(parseInt(y), parseInt(m)-1, 15).toLocaleDateString("pt-BR", {month:"long", year:"numeric"});
        return (
          <div key={mk} style={{marginBottom:20}}>
            <h4 style={{color:"var(--text)",fontSize:14,fontWeight:700,margin:"0 0 10px",textTransform:"capitalize"}}>{monthName}</h4>
            {plans.map(plan => {
              const pColor = plan.type === "avaliação" ? "#8b5cf6" : "#3b82f6";
              const pIcon = plan.type === "avaliação" ? "📋" : "💬";
              const totalEmps = (plan.employeeIds ?? []).length;
              const doneCount = (plan.employeeIds ?? []).filter(eid => getEmpStatus(plan, eid) === "realizada").length;
              const lateCount = (plan.employeeIds ?? []).filter(eid => getEmpStatus(plan, eid) === "atrasada").length;
              const dateStr = plan.plannedDate ? new Date(plan.plannedDate+"T12:00:00").toLocaleDateString("pt-BR") : "—";
              const isPast = plan.plannedDate < today();
              return (
                <div key={plan.id} style={{...S.card,padding:"14px 16px",marginBottom:8,border:`1px solid ${isPast && doneCount < totalEmps ? "#f59e0b33" : pColor+"22"}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{fontSize:16}}>{pIcon}</span>
                      <span style={{color:pColor,fontWeight:700,fontSize:13}}>Conversa de {plan.type}</span>
                      <span style={{color:"var(--text3)",fontSize:11}}>— {dateStr}</span>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      <span style={{fontSize:10,color:doneCount===totalEmps?"#10b981":lateCount>0?"#f59e0b":"var(--text3)",fontWeight:700}}>
                        {doneCount}/{totalEmps} {doneCount===totalEmps?"✓":""}
                      </span>
                      <button onClick={()=>handleDeletePlan(plan.id)} style={{padding:"2px 6px",borderRadius:6,border:"1px solid var(--red)33",background:"transparent",color:"var(--red)",cursor:"pointer",fontSize:9,fontFamily:"'DM Mono',monospace"}}>✕</button>
                    </div>
                  </div>
                  {plan.note && <div style={{fontSize:11,color:"var(--text3)",marginBottom:8,fontStyle:"italic"}}>{plan.note}</div>}
                  <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                    {(plan.employeeIds ?? []).map(eid => {
                      const emp = employees.find(e => e.id === eid);
                      const status = getEmpStatus(plan, eid);
                      const sColor = status === "realizada" ? "#10b981" : status === "atrasada" ? "#f59e0b" : "var(--text3)";
                      const sIcon = status === "realizada" ? "✓" : status === "atrasada" ? "⏰" : "○";
                      return (
                        <span key={eid} style={{fontSize:10,padding:"3px 8px",borderRadius:6,border:`1px solid ${sColor}33`,background:sColor+"08",color:sColor,fontWeight:status==="realizada"?700:400}}>
                          {sIcon} {emp?.name?.split(" ")[0] ?? eid}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function FeedbackForm({ restaurantId, employees, roles, onUpdate, feedbacks, currentUser, isOwner, preSelectedEmpId, allMeetingPlans }) {
  const restEmps = employees.filter(e => e.restaurantId === restaurantId && !(e.inactive && e.inactiveFrom && e.inactiveFrom <= today()));
  const [empId, setEmpId] = useState(preSelectedEmpId ?? "");
  const [meetingType, setMeetingType] = useState("alinhamento");
  const [meetingDate, setMeetingDate] = useState(today());
  const [notes, setNotes] = useState("");
  const [rating, setRating] = useState(0);
  const [strengths, setStrengths] = useState("");
  const [improvements, setImprovements] = useState("");
  const [otherNotes, setOtherNotes] = useState("");
  const [showNextSuggestion, setShowNextSuggestion] = useState(false);
  const [suggestedNextDate, setSuggestedNextDate] = useState("");
  const [lastRegisteredEmpId, setLastRegisteredEmpId] = useState("");

  const isAvaliacao = meetingType === "avaliação";

  function handleSubmit() {
    if (!empId) { window.alert("Selecione um empregado."); return; }
    if (!meetingDate) { window.alert("Informe a data da reunião."); return; }
    if (isAvaliacao && rating < 1) { window.alert("Selecione a avaliação."); return; }
    const fb = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      restaurantId,
      employeeId: empId,
      meetingType,
      meetingDate,
      notes: notes.trim(),
      // Campos de avaliação (só preenchidos quando é avaliação)
      rating: isAvaliacao ? rating : null,
      strengths: isAvaliacao ? strengths.trim() : "",
      improvements: isAvaliacao ? improvements.trim() : "",
      internalNotes: isAvaliacao ? otherNotes.trim() : "",
      // Compatibilidade — preencher quarter/year automaticamente
      quarter: Math.ceil((new Date(meetingDate+"T12:00:00").getMonth()+1)/3),
      year: new Date(meetingDate+"T12:00:00").getFullYear(),
      nextFeedbackDate: null,
      goal: "",
      targetRoleId: null,
      devChecklist: [],
      createdAt: new Date().toISOString(),
      createdBy: isOwner ? "Gestor AppTip" : (currentUser?.name ?? "Gestor Adm."),
    };
    onUpdate("feedbacks", [...(feedbacks ?? []), fb]);
    // Suggest next meeting
    const daysAhead = isAvaliacao ? 90 : 15;
    const nextD = new Date(meetingDate+"T12:00:00");
    nextD.setDate(nextD.getDate() + daysAhead);
    setSuggestedNextDate(nextD.toISOString().slice(0,10));
    setLastRegisteredEmpId(empId);
    setShowNextSuggestion(true);
    setEmpId(""); setRating(0); setStrengths(""); setImprovements(""); setOtherNotes(""); setNotes(""); setMeetingDate(today());
  }

  function handleCreateNextPlan() {
    if (!suggestedNextDate || !lastRegisteredEmpId) return;
    const plan = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      restaurantId,
      type: meetingType || "alinhamento",
      employeeIds: [lastRegisteredEmpId],
      plannedDate: suggestedNextDate,
      note: "Sugestão automática",
      createdBy: isOwner ? "Gestor AppTip" : (currentUser?.name ?? "Gestor Adm."),
      createdAt: new Date().toISOString(),
      completedFeedbackIds: {},
    };
    onUpdate("meetingPlans", [...(allMeetingPlans ?? []), plan]);
    setShowNextSuggestion(false);
  }

  const typeColor = isAvaliacao ? "#8b5cf6" : "#3b82f6";

  return (
    <div style={{...S.card, padding:"18px 20px", border:`1px solid ${typeColor}22`}}>
      <h4 style={{color:"var(--text)",margin:"0 0 14px",fontSize:15,fontWeight:700}}>Registrar reunião</h4>
      {/* Tipo toggle */}
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {[["alinhamento","💬 Alinhamento","#3b82f6"],["avaliação","📋 Avaliação","#8b5cf6"]].map(([val,lbl,col]) => (
          <button key={val} onClick={()=>setMeetingType(val)} style={{
            flex:1,padding:"10px",borderRadius:10,border:`2px solid ${meetingType===val?col:"var(--border)"}`,
            background:meetingType===val?col+"14":"transparent",color:meetingType===val?col:"var(--text3)",
            cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:meetingType===val?700:400,transition:"all 0.15s"
          }}>{lbl}</button>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
        <div>
          <label style={S.label}>Empregado</label>
          <select value={empId} onChange={e=>setEmpId(e.target.value)} style={S.input}>
            <option value="">Selecionar...</option>
            {restEmps.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
          </select>
        </div>
        <div>
          <label style={S.label}>Data da reunião</label>
          <input type="date" value={meetingDate} onChange={e=>setMeetingDate(e.target.value)} style={S.input}/>
        </div>
      </div>
      <div style={{marginBottom:12}}>
        <label style={S.label}>Anotações / pauta</label>
        <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={2} placeholder="O que foi conversado..." style={{...S.input,resize:"vertical"}}/>
      </div>
      {isAvaliacao && <>
        <div style={{marginBottom:14}}>
          <label style={S.label}>Avaliação</label>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {RATING_LABELS.map((label, i) => {
              const val = i + 1;
              const active = rating === val;
              const color = RATING_COLORS[i];
              return (
                <button key={val} onClick={()=>setRating(val)} style={{
                  padding:"8px 14px",fontSize:12,fontWeight:active?700:500,border:`2px solid ${active?color:"var(--border)"}`,
                  borderRadius:8,cursor:"pointer",background:active?color+"18":"var(--bg)",color:active?color:"var(--text2)",
                  transition:"all 0.15s",lineHeight:1.2,
                }}>{label}</button>
              );
            })}
          </div>
        </div>
        <div style={{marginBottom:12}}>
          <label style={S.label}>Pontos positivos</label>
          <textarea value={strengths} onChange={e=>setStrengths(e.target.value)} rows={2} placeholder="O que o empregado faz bem..." style={{...S.input,resize:"vertical"}}/>
        </div>
        <div style={{marginBottom:12}}>
          <label style={S.label}>Pontos a melhorar</label>
          <textarea value={improvements} onChange={e=>setImprovements(e.target.value)} rows={2} placeholder="Onde pode evoluir..." style={{...S.input,resize:"vertical"}}/>
        </div>
        <div style={{marginBottom:12}}>
          <label style={S.label}>Notas internas</label>
          <textarea value={otherNotes} onChange={e=>setOtherNotes(e.target.value)} rows={2} placeholder="Observações adicionais..." style={{...S.input,resize:"vertical"}}/>
        </div>
      </>}
      <button onClick={handleSubmit} style={{...S.btnPrimary,width:"auto",padding:"10px 24px",background:typeColor,borderColor:typeColor}}>
        {isAvaliacao ? "Registrar avaliação" : "Registrar alinhamento"}
      </button>
      {/* Suggestion to plan next meeting */}
      {showNextSuggestion && (
        <div style={{marginTop:12,padding:"12px 14px",borderRadius:10,border:"1px solid #10b98133",background:"#10b98108"}}>
          <div style={{fontSize:12,color:"#10b981",fontWeight:700,marginBottom:6}}>✓ Reunião registrada!</div>
          <div style={{fontSize:11,color:"var(--text2)",marginBottom:8}}>
            Agendar próxima para <strong>{new Date(suggestedNextDate+"T12:00:00").toLocaleDateString("pt-BR")}</strong>?
          </div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={handleCreateNextPlan} style={{padding:"6px 14px",borderRadius:8,border:"1px solid #10b98144",background:"#10b98118",color:"#10b981",cursor:"pointer",fontSize:11,fontFamily:"'DM Mono',monospace",fontWeight:700}}>Sim, agendar</button>
            <input type="date" value={suggestedNextDate} onChange={e=>setSuggestedNextDate(e.target.value)} style={{...S.input,fontSize:11,padding:"4px 8px",maxWidth:140}}/>
            <button onClick={()=>setShowNextSuggestion(false)} style={{padding:"6px 10px",borderRadius:8,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",cursor:"pointer",fontSize:11,fontFamily:"'DM Mono',monospace"}}>Não</button>
          </div>
        </div>
      )}
    </div>
  );
}


// ── Gamified Employee Trail View ──
function EmpTrilhaView({ empId, employees, roles, schedules, incidents, feedbacks, devChecklists, restaurantId, onUpdate, employeeGoals, meetingPlans }) {
  const emp = employees.find(e => e.id === empId);
  const role = emp ? roles.find(r => r.id === emp.roleId) : null;
  const admDate = emp?.admission ? new Date(emp.admission+"T12:00:00") : null;
  const daysInCompany = admDate ? Math.floor((new Date() - admDate) / 86400000) : 0;

  // Latest feedback
  const myFeedbacks = (feedbacks ?? []).filter(f => f.restaurantId === restaurantId && f.employeeId === empId && !f.deletedAt).sort((a,b)=>(b.createdAt??"").localeCompare(a.createdAt??""));
  const latestFb = myFeedbacks[0];
  // targetRole removed — goals system replaces it

  // Incidents are fully internal — employee sees nothing
  // const positiveIncidents = []; // removed: ocorrências são internas

  // (badges calculados mais abaixo como badgesNew)

  // Schedule metrics — mês anterior para badge "Sem Faltas"
  const now = new Date();
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const mk = monthKey(prevMonthDate.getFullYear(), prevMonthDate.getMonth());
  const ridSchedules = schedules?.[restaurantId] ?? {};
  const myDays = ridSchedules[mk]?.[empId] ?? {};
  const myFaults = Object.values(myDays).filter(s => s === DAY_FAULT_U).length;
  const hasPrevMonthData = Object.keys(myDays).length > 0;

  // Badges — tempo de casa NÃO cumulativo (só o maior)
  const badgesNew = [];
  if (daysInCompany >= 365) badgesNew.push({ icon:"🏆", label:"1 Ano", desc:"Completou 1 ano na empresa" });
  else if (daysInCompany >= 180) badgesNew.push({ icon:"⭐", label:"6 Meses", desc:"6 meses de dedicação" });
  else if (daysInCompany >= 90) badgesNew.push({ icon:"🌟", label:"3 Meses", desc:"Primeiros 90 dias concluídos" });
  // Mérito
  if ((emp?.roleHistory ?? []).length > 0) badgesNew.push({ icon:"⬆️", label:"Promovido", desc:"Já recebeu uma promoção" });
  if (latestFb?.rating === 5) badgesNew.push({ icon:"💎", label:"Excelência", desc:"Avaliação Excepcional" });
  const myGoalsAll = (employeeGoals ?? {})[empId] ?? [];
  const completedGoals = myGoalsAll.filter(g => g.status === "completed");
  if (completedGoals.length > 0) badgesNew.push({ icon:"🎯", label:"Objetivo Concluído", desc:`${completedGoals.length} objetivo${completedGoals.length>1?"s":""} finalizado${completedGoals.length>1?"s":""}` });
  if (hasPrevMonthData && myFaults === 0) badgesNew.push({ icon:"🔥", label:"Sem Faltas", desc:"0 faltas injustificadas no mês anterior" });
  const conhecGoals = completedGoals.filter(g => g.type === "conhecimento" && (g.metas??[]).length > 0 && (g.metas??[]).every(m => m.done));
  if (conhecGoals.length > 0) badgesNew.push({ icon:"📚", label:"Estudioso", desc:"Completou objetivo de conhecimento" });

  // Próximo feedback agendado
  const nextFbInfo = (() => {
    const empFbs = (feedbacks ?? []).filter(f => f.restaurantId === restaurantId && f.employeeId === empId && !f.deletedAt && f.nextFeedbackDate).sort((a,b) => (b.createdAt??"").localeCompare(a.createdAt??""));
    return empFbs[0]?.nextFeedbackDate ?? null;
  })();

  // Jornada timeline — eventos mês a mês desde admissão
  const jornadaEvents = (() => {
    if (!admDate) return [];
    const events = [];
    // Admissão
    events.push({ date: admDate, label: "Admissão", icon: "🚀" });
    // Promoções
    (emp.roleHistory ?? []).forEach(rh => {
      if (rh.date) {
        const newRole = roles.find(r => r.id === rh.newRoleId);
        events.push({ date: new Date(rh.date + "T12:00:00"), label: `Promovido a ${newRole?.name ?? "novo cargo"}`, icon: "⬆️" });
      }
    });
    // Marcos de tempo
    [[90,"🌟","3 Meses"],[180,"⭐","6 Meses"],[365,"🏆","1 Ano"]].forEach(([days,ic,lb]) => {
      if (daysInCompany >= days) {
        const d = new Date(admDate.getTime() + days * 86400000);
        events.push({ date: d, label: lb, icon: ic });
      }
    });
    // Reuniões — texto genérico, sem nota/avaliação
    (feedbacks ?? []).filter(f => f.restaurantId === restaurantId && f.employeeId === empId && !f.deletedAt && f.createdAt).forEach(f => {
      const isAval = f.meetingType === "avaliação" || (!f.meetingType && f.rating > 0);
      events.push({ date: new Date(f.meetingDate ? f.meetingDate+"T12:00:00" : f.createdAt), label: isAval ? "Conversa de avaliação realizada" : "Conversa de alinhamento realizada", icon: isAval ? "📋" : "💬" });
    });
    // Reuniões planejadas futuras
    (meetingPlans ?? []).filter(p => p.restaurantId === restaurantId && (p.employeeIds ?? []).includes(empId) && p.plannedDate >= today()).forEach(p => {
      const isAval = p.type === "avaliação";
      events.push({ date: new Date(p.plannedDate+"T12:00:00"), label: isAval ? "Conversa de avaliação prevista" : "Conversa de alinhamento prevista", icon: "📅", future: true });
    });
    // Objetivos concluídos
    myGoalsAll.filter(g => g.status === "completed").forEach(g => {
      events.push({ date: new Date(g.createdAt), label: `Objetivo: ${g.title}`, icon: "🎯" });
    });
    events.sort((a,b) => a.date - b.date);
    return events;
  })();

  // Empregado marca meta como concluída (self-assessment)
  function empToggleMeta(goalId, metaId) {
    const all = [...(employeeGoals?.[empId] ?? [])];
    const idx = all.findIndex(g => g.id === goalId);
    if (idx < 0) return;
    all[idx] = { ...all[idx], metas: (all[idx].metas ?? []).map(m =>
      m.id === metaId ? { ...m, employeeMarked: !m.employeeMarked, employeeDoneAt: !m.employeeMarked ? new Date().toISOString() : null } : m
    )};
    const updated = { ...(employeeGoals ?? {}), [empId]: all };
    onUpdate("employeeGoals", updated);
  }

  if (!emp) return <p style={{color:"var(--text3)",textAlign:"center"}}>Empregado não encontrado.</p>;

  const activeGoals = myGoalsAll.filter(g => g.status === "active");

  return (
    <div>
      {/* Card do empregado — sem barra de progresso */}
      <div style={{...S.card,marginBottom:16,padding:"20px"}}>
        <div style={{display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
          <div style={{width:56,height:56,borderRadius:28,background:"linear-gradient(135deg,#d4a017,#f59e0b)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,fontWeight:700,color:"#fff",flexShrink:0}}>{(emp.name??"?").charAt(0)}</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{color:"var(--text)",fontWeight:700,fontSize:18}}>{emp.name}</div>
            <div style={{color:"var(--ac)",fontSize:13,fontWeight:600}}>{role?.name ?? "—"}</div>
            <div style={{color:"var(--text3)",fontSize:11}}>{role?.area ?? "—"} · {daysInCompany} dias na empresa</div>
          </div>
        </div>
      </div>

      {/* Seus Objetivos — em destaque */}
      {activeGoals.length > 0 && (
        <div style={{marginBottom:16}}>
          <h4 style={{color:"var(--text)",margin:"0 0 12px",fontSize:14}}>🎯 Seus Objetivos</h4>
          {activeGoals.map(goal => {
            const typeInfo = GOAL_TYPES.find(t => t.value === goal.type) ?? GOAL_TYPES[3];
            const metas = goal.metas ?? [];
            const doneMetas = metas.filter(m => {
              if (m.autoCheck && m.autoCheckRule) {
                const rule = AUTO_META_RULES.find(r => r.id === m.autoCheckRule);
                return rule ? rule.check(empId, schedules, restaurantId, feedbacks, restaurantId, employees) : m.done;
              }
              return m.done;
            }).length;
            const pct = metas.length > 0 ? Math.round((doneMetas / metas.length) * 100) : 0;
            const materials = goal.materials ?? [];

            return (
              <div key={goal.id} style={{...S.card,marginBottom:10,padding:"14px 16px",borderLeft:`4px solid ${typeInfo.color}`}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <span style={{fontSize:18}}>{typeInfo.icon}</span>
                  <div style={{flex:1}}>
                    <div style={{color:"var(--text)",fontWeight:700,fontSize:14}}>{goal.title}</div>
                    <div style={{color:"var(--text3)",fontSize:11}}>{typeInfo.label}</div>
                  </div>
                </div>

                {metas.length > 0 && (
                  <>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                      <span style={{color:"var(--text3)",fontSize:11}}>Progresso</span>
                      <span style={{color:typeInfo.color,fontSize:11,fontWeight:700}}>{pct}%</span>
                    </div>
                    <div style={{height:6,borderRadius:3,background:"var(--border)",overflow:"hidden",marginBottom:8}}>
                      <div style={{height:"100%",borderRadius:3,background:typeInfo.color,width:`${pct}%`,transition:"width 0.3s"}}/>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",gap:2,marginBottom:8}}>
                      {metas.map(meta => {
                        const isAuto = meta.autoCheck && meta.autoCheckRule;
                        const autoRule = isAuto ? AUTO_META_RULES.find(r => r.id === meta.autoCheckRule) : null;
                        const gestorDone = isAuto ? (autoRule ? autoRule.check(empId, schedules, restaurantId, feedbacks, restaurantId, employees) : meta.done) : meta.done;
                        const empMarked = meta.employeeMarked;
                        const fullyDone = gestorDone;
                        return (
                          <div key={meta.id} style={{padding:"6px 0",borderBottom:"1px solid var(--border)11"}}>
                            <div style={{display:"flex",alignItems:"center",gap:8}}>
                              {isAuto ? (
                                <span style={{fontSize:13}}>{gestorDone?"✅":"⏳"}</span>
                              ) : (
                                <button onClick={()=>!fullyDone && empToggleMeta(goal.id, meta.id)} style={{background:"none",border:"none",cursor:fullyDone?"default":"pointer",fontSize:13,padding:0,lineHeight:1,opacity:fullyDone?1:undefined}}>
                                  {fullyDone ? "✅" : empMarked ? "🟡" : "⬜"}
                                </button>
                              )}
                              <span style={{color:fullyDone?"var(--text3)":"var(--text)",fontSize:12,textDecoration:fullyDone?"line-through":"none",flex:1}}>{meta.title}</span>
                            </div>
                            {!isAuto && empMarked && !fullyDone && (
                              <div style={{marginLeft:21,marginTop:2,fontSize:10,color:"#f59e0b",fontStyle:"italic"}}>
                                Concluída por você em {meta.employeeDoneAt ? new Date(meta.employeeDoneAt).toLocaleDateString("pt-BR") : "—"} · aguardando confirmação do gestor
                              </div>
                            )}
                            {fullyDone && meta.doneAt && (
                              <div style={{marginLeft:21,marginTop:2,fontSize:10,color:"var(--green)"}}>
                                Confirmada em {new Date(meta.doneAt).toLocaleDateString("pt-BR")}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}

                {materials.length > 0 && (
                  <div>
                    <div style={{color:"var(--text3)",fontSize:10,fontWeight:600,marginBottom:4}}>📎 Material de apoio</div>
                    {materials.map(mat => {
                      const mtIcon = MATERIAL_TYPES.find(t=>t.value===mat.type)?.icon ?? "📋";
                      return (
                        <div key={mat.id} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 0",fontSize:12}}>
                          <span>{mtIcon}</span>
                          {mat.link ? <a href={mat.link} target="_blank" rel="noreferrer" style={{color:"#3b82f6"}}>{mat.title}</a> : <span style={{color:"var(--text)"}}>{mat.title}</span>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Próximas reuniões planejadas */}
      {(() => {
        const upcoming = (meetingPlans ?? []).filter(p => p.restaurantId === restaurantId && (p.employeeIds ?? []).includes(empId) && p.plannedDate >= today()).sort((a,b)=>a.plannedDate.localeCompare(b.plannedDate)).slice(0,3);
        if (upcoming.length === 0 && nextFbInfo) {
          // Fallback: old nextFbDate from legacy feedbacks
          const nfd = new Date(nextFbInfo + "T00:00:00");
          const todayD = new Date(); todayD.setHours(0,0,0,0);
          const diff = Math.round((nfd - todayD) / 86400000);
          return (
            <div style={{...S.card,marginBottom:16,padding:"14px 16px",display:"flex",alignItems:"center",gap:10,borderLeft:"4px solid #3b82f6"}}>
              <span style={{fontSize:20}}>📅</span>
              <div>
                <div style={{color:"var(--text)",fontWeight:600,fontSize:13}}>Próxima reunião</div>
                <div style={{color:"var(--text3)",fontSize:12}}>{diff <= 0 ? `Agendada para ${nfd.toLocaleDateString("pt-BR")}` : `Em ${diff} dia${diff!==1?"s":""} · ${nfd.toLocaleDateString("pt-BR")}`}</div>
              </div>
            </div>
          );
        }
        if (upcoming.length === 0) return null;
        return (
          <div style={{marginBottom:16}}>
            {upcoming.map(p => {
              const pDate = new Date(p.plannedDate+"T12:00:00");
              const todayD = new Date(); todayD.setHours(0,0,0,0);
              const diff = Math.round((pDate - todayD) / 86400000);
              const isAval = p.type === "avaliação";
              const pColor = isAval ? "#8b5cf6" : "#3b82f6";
              return (
                <div key={p.id} style={{...S.card,padding:"14px 16px",marginBottom:8,display:"flex",alignItems:"center",gap:10,borderLeft:`4px solid ${pColor}`}}>
                  <span style={{fontSize:20}}>📅</span>
                  <div>
                    <div style={{color:"var(--text)",fontWeight:600,fontSize:13}}>
                      {isAval ? "Conversa de avaliação prevista" : "Conversa de alinhamento prevista"}
                    </div>
                    <div style={{color:"var(--text3)",fontSize:12}}>
                      {diff === 0 ? "Hoje" : diff === 1 ? "Amanhã" : `Em ${diff} dia${diff!==1?"s":""}`} · {pDate.toLocaleDateString("pt-BR")}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Conquistas */}
      {badgesNew.length > 0 && (
        <div style={{marginBottom:16}}>
          <h4 style={{color:"var(--text)",margin:"0 0 10px",fontSize:14}}>🏅 Conquistas</h4>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {badgesNew.map((b,i) => {
              const gradients = [
                "linear-gradient(135deg,#fef3c7,#fde68a)", // gold
                "linear-gradient(135deg,#dbeafe,#bfdbfe)", // blue
                "linear-gradient(135deg,#d1fae5,#a7f3d0)", // green
                "linear-gradient(135deg,#ede9fe,#ddd6fe)", // purple
                "linear-gradient(135deg,#fee2e2,#fecaca)", // red
                "linear-gradient(135deg,#ffedd5,#fed7aa)", // orange
                "linear-gradient(135deg,#f0fdf4,#dcfce7)", // lime
                "linear-gradient(135deg,#fdf4ff,#f5d0fe)", // pink
              ];
              return (
                <div key={i} style={{borderRadius:12,padding:"14px 12px",background:gradients[i % gradients.length],display:"flex",alignItems:"center",gap:10,boxShadow:"0 1px 3px rgba(0,0,0,0.06)"}}>
                  <div style={{width:40,height:40,borderRadius:20,background:"rgba(255,255,255,0.7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{b.icon}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{color:"#1f2937",fontWeight:700,fontSize:12,lineHeight:1.2}}>{b.label}</div>
                    <div style={{color:"#6b7280",fontSize:10,lineHeight:1.3,marginTop:1}}>{b.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Sua Jornada — timeline mês a mês */}
      {jornadaEvents.length > 0 && (
        <div style={{marginBottom:16}}>
          <h4 style={{color:"var(--text)",margin:"0 0 12px",fontSize:14}}>🗓️ Sua Jornada</h4>
          <div style={{position:"relative",paddingLeft:24}}>
            {/* Linha vertical */}
            <div style={{position:"absolute",left:7,top:4,bottom:4,width:2,background:"var(--border)",borderRadius:1}}/>
            {jornadaEvents.map((ev,i) => (
              <div key={i} style={{position:"relative",marginBottom:i<jornadaEvents.length-1?12:0,display:"flex",alignItems:"flex-start",gap:10}}>
                {/* Dot */}
                <div style={{position:"absolute",left:-20,top:3,width:12,height:12,borderRadius:6,background:i===jornadaEvents.length-1?"var(--ac)":"var(--border)",border:"2px solid var(--bg)",flexShrink:0,zIndex:1}}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:13}}>{ev.icon}</span>
                    <span style={{color:"var(--text)",fontSize:12,fontWeight:600}}>{ev.label}</span>
                  </div>
                  <div style={{color:"var(--text3)",fontSize:10,marginTop:1}}>
                    {ev.date.toLocaleDateString("pt-BR",{month:"short",year:"numeric"})}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RestaurantPanel({ restaurant, restaurants, employees, roles, tips, splits, schedules, onUpdate, perms, isOwner, data, currentUser, privacyMask, mobileOnly }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const mk = monthKey(year, month);
  const rid = restaurant.id;

  // Privacy: mascarar dados quando ativo (admin vendo restaurante com privacyMode)
  const pFmt = privacyMask ? () => "R$ ••••,••" : fmt;
  const pText = privacyMask ? () => "••••••••••••••••" : (v => v);

  const curSplit  = splits?.[rid]?.[mk] ?? DEFAULT_SPLIT;
  const monthTips = tips.filter(t => t.restaurantId === rid && t.monthKey === mk);
  const tipDates  = [...new Set(monthTips.map(t => t.date))].sort();
  const totalNet   = monthTips.reduce((a, t) => a + t.myNet, 0);
  const totalTax   = monthTips.reduce((a, t) => a + t.myTax, 0);

  const managerAreas = perms.managerAreas ?? [];
  const isLider = managerAreas.length > 0;
  const allRestEmps = employees.filter(e => e.restaurantId === rid && !(e.inactive && e.inactiveFrom && e.inactiveFrom <= today()));
  // For schedule: include dismissed employees whose dismissal month matches the viewed month
  const allSchedEmps = employees.filter(e => e.restaurantId === rid && (
    !(e.inactive && e.inactiveFrom && e.inactiveFrom <= today()) ||
    (e.demitidoEm && e.demitidoEm.slice(0,7) === mk)
  ));
  const restRoles = roles.filter(r => r.restaurantId === rid);
  const restEmps  = isLider
    ? allRestEmps.filter(e => { const role = restRoles.find(r => r.id === e.roleId); return role && managerAreas.includes(role.area); })
    : allRestEmps;
  const schedEmps = isLider
    ? allSchedEmps.filter(e => { const role = restRoles.find(r => r.id === e.roleId); return role && managerAreas.includes(role.area); })
    : allSchedEmps;

  // forms
  const [tipRows, setTipRows]   = useState([{date:today(),total:"",note:""}]);
  // showRecalc removido — recalcular agora fica na coluna de confirmação semanal
  const [splitForm, setSplitForm]         = useState(null);
  const [schedArea, setSchedArea]           = useState("Todos");
  const [showVacForm, setShowVacForm]       = useState(false);
  const [showSchedHistory, setShowSchedHistory] = useState(false);
  // Ponto import
  const [showPontoImport, setShowPontoImport] = useState(false);
  const [pontoLoading, setPontoLoading] = useState(false);
  const [pontoError, setPontoError] = useState("");
  const [pontoPreview, setPontoPreview] = useState(null); // { scheduleChanges, incidents, unmatchedNames, totalSchedChanges, summary, matchedSummary }
  const [pontoResolutions, setPontoResolutions] = useState({}); // { _key: { action:"ignore"|"link"|"create", linkedEmpId, newRoleId } }
  const [pontoMissingReasons, setPontoMissingReasons] = useState({}); // { empId: "ferias_licenca"|"demitido"|"erro_ponto"|"outro_sistema"|"ignorar" }
  const [pontoSystem, setPontoSystem] = useState("solides");
  // Delay (atraso) batch form
  const [showDelayForm, setShowDelayForm] = useState(false);
  const [delayEmpId, setDelayEmpId] = useState("");
  const [delayInputs, setDelayInputs] = useState({}); // { "day": minutes }
  // Schedule view mode: "vigente" shows effective (with local edits), "prevista" shows saved only
  const [schedViewMode, setSchedViewMode] = useState("vigente");
  // Month close / reopen confirmation
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showReopenConfirm, setShowReopenConfirm] = useState(false);
  const [closeDelta, setCloseDelta] = useState(null);
  const [closeVtImpact, setCloseVtImpact] = useState(null);
  // Ponto summary for post-import dashboard
  const [pontoSummary, setPontoSummary] = useState(null);
  // Local schedule edits — accumulated before saving as new version
  const [schedLocalEdits, setSchedLocalEdits] = useState(null); // null = no pending edits, object = pending edits overlay
  const schedDirty = schedLocalEdits !== null;
  // Effective schedule month: saved data + local edits overlay
  const effectiveMonth = (() => {
    const base = { ...(schedules?.[rid]?.[mk] ?? {}) };
    if (schedLocalEdits) {
      Object.entries(schedLocalEdits).forEach(([eid, dayMap]) => {
        base[eid] = { ...(base[eid] ?? {}), ...dayMap };
        Object.entries(base[eid]).forEach(([dt, val]) => { if (val === null) delete base[eid][dt]; });
      });
    }
    return base;
  })();
  // The "prevista" view is the frozen snapshot, falling back to current schedules
  const previstaMonth = data?.schedulePrevista?.[rid]?.[mk] ?? schedules?.[rid]?.[mk] ?? {};
  // Displayed schedule depends on view mode
  const displayedMonth = schedViewMode === "prevista" ? previstaMonth : effectiveMonth;
  // Month status from scheduleStatus
  const monthStatus = data?.scheduleStatus?.[rid]?.[mk]?.status ?? "open";
  const monthClosed = monthStatus === "closed";
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewFileName, setPreviewFileName] = useState("");
  const [showTipHistory, setShowTipHistory]     = useState(false);
  const [vacEmpId, setVacEmpId]             = useState("");
  const [vacFrom, setVacFrom]               = useState("");
  const [vacTo, setVacTo]                   = useState("");
  function calcWeekForToday(y, m) {
    const now = new Date();
    const isCurrentMonth = now.getFullYear() === y && now.getMonth() === m;
    if (!isCurrentMonth) return 0;
    const todayDay = now.getDate();
    const daysInM = new Date(y, m + 1, 0).getDate();
    let wk = 0, d = 1;
    while (d <= daysInM) {
      const wd0 = new Date(y, m, d).getDay();
      let weekEnd = d + (6 - wd0);
      weekEnd = Math.min(weekEnd, daysInM);
      if (todayDay >= d && todayDay <= weekEnd) return wk;
      d = weekEnd + 1; wk++;
    }
    return 0;
  }
  const [weekIdx, setWeekIdx] = useState(() => calcWeekForToday(now.getFullYear(), now.getMonth()));

  const [showExport, setShowExport]       = useState(false);

  // DP gestor management
  const [dpMgrModal, setDpMgrModal] = useState(false);
  const [dpMgrEdit, setDpMgrEdit]   = useState(null);
  const [dpMgrForm, setDpMgrForm]   = useState({name:"",cpf:"",pin:"",restaurantIds:[rid],perms:{tips:true,schedule:true},isDP:false,profile:"custom",areas:[]});

  // Config local state — unified deferred save for ALL config settings
  const [localConfig, setLocalConfig] = useState(null); // null = clean, object = pending changes
  const configDirty = localConfig !== null;

  function getLocalRest() {
    if (!localConfig) return { ...restaurant };
    return { ...restaurant, ...localConfig };
  }
  function patchConfig(patch) {
    setLocalConfig(prev => ({ ...(prev ?? {}), ...patch }));
  }

  const localRest = getLocalRest();
  function getTabsConfig(key) { return (localRest.tabsConfig ?? {})[key] !== false; }
  function getTabsGestor(key) { return (localRest.tabsGestor ?? {})[key] !== false; }

  function toggleAdminTab(key) {
    const cur = { ...(localRest.tabsConfig ?? {}) };
    const novoValor = !(cur[key] !== false);
    cur[key] = novoValor;
    const tabFaqMap = { dp:"__dp__", comunicados:"__comunicados__" };
    const faqId = tabFaqMap[key];
    const curGestor = { ...(localRest.tabsGestor ?? {}) };
    if (faqId) curGestor.faqAuto = { ...(curGestor.faqAuto ?? {}), [faqId]: novoValor };
    patchConfig({ tabsConfig: cur, tabsGestor: curGestor });
  }
  function toggleGestorTab(key) {
    const cur = { ...(localRest.tabsGestor ?? {}) };
    const novoValor = !(cur[key] !== false);
    cur[key] = novoValor;
    const tabFaqMap = { dp:"__dp__", comunicados:"__comunicados__" };
    const faqId = tabFaqMap[key];
    if (faqId) cur.faqAuto = { ...(cur.faqAuto ?? {}), [faqId]: novoValor };
    patchConfig({ tabsGestor: cur });
  }
  function saveConfig() {
    if (!localConfig) return;
    const updated = restaurants.map(r => r.id === rid ? { ...r, ...localConfig } : r);
    onUpdate("restaurants", updated);
    setLocalConfig(null);
    onUpdate("_toast", "✅ Configurações salvas!");
  }
  function discardConfig() { setLocalConfig(null); }


  // calcTipForDate agora aceita currentTips para evitar stale closure em batch
  function calcTipForDate(date, totalVal, noteVal, currentTips) {
    const allTips = currentTips ?? tips;
    const total = parseFloat(totalVal);
    if (!total || isNaN(total) || total <= 0) return { count: 0, updatedTips: allTips };
    if (restaurant.serviceStartDate && date < restaurant.serviceStartDate) { alert(`Não é possível lançar gorjeta antes da data de vigência (${new Date(restaurant.serviceStartDate+"T12:00:00").toLocaleDateString("pt-BR")})`); return { count: 0, updatedTips: allTips }; }
    const td = new Date(date + "T12:00:00");
    const tKey = monthKey(td.getFullYear(), td.getMonth());
    const taxRate = restaurant.taxRate ?? TAX;
    const totalTaxAmt = total * taxRate;
    const toDistribute = total - totalTaxAmt;
    const mode = restaurant.divisionMode ?? MODE_AREA_POINTS;
    const empDayStatus = (empId) => { const m = schedules?.[rid]?.[tKey]?.[empId] ?? {}; return m[date]; };
    const activeEmps = restEmps.filter(emp => {
      const r = restRoles.find(r => r.id === emp.roleId);
      if (!r) return false;
      if (emp.isFreela) return false;
      const admDate = emp.admission || DEFAULT_ADMISSION();
      if (admDate > date) return false;
      if (emp.inactive && emp.inactiveFrom && emp.inactiveFrom <= date) return false;
      if (emp.demitidoEm && emp.demitidoEm <= date) return false;
      const status = empDayStatus(emp.id);
      if (status === DAY_VACATION || status === DAY_FREELA) return false;
      if (emp.isProducao) return true;
      if (!status || status === DAY_COMP || status === DAY_COMP_TRAB) return true;
      if (status === DAY_FAULT_J || status === DAY_FAULT_U) return false;
      if (status === DAY_OFF) return false;
      return true;
    }).map(emp => { const r = restRoles.find(r => r.id === emp.roleId); return { ...emp, points: parseFloat(r?.points) || 0, area: r?.area ?? "Salão" }; });
    const newTips = [];
    try {
      if (mode === MODE_GLOBAL_POINTS) {
        const totalPoints = activeEmps.reduce((a,e)=>a+e.points,0);
        if (!totalPoints) return { count: 0, updatedTips: allTips };
        activeEmps.forEach(emp => { const g=round2(total*(emp.points/totalPoints)),tx=round2(totalTaxAmt*(emp.points/totalPoints)); newTips.push({id:`${Date.now()}-${emp.id}-${Math.random().toString(36).slice(2,6)}`,restaurantId:rid,employeeId:emp.id,date,monthKey:tKey,poolTotal:total,areaPool:toDistribute,area:emp.area??"—",myShare:g,myTax:tx,myNet:round2(g-tx),note:noteVal,taxRate}); });
      } else {
        const tSplit = splits?.[rid]?.[tKey] ?? DEFAULT_SPLIT;
        const byArea = {}; AREAS.forEach(a=>{byArea[a]=[];}); activeEmps.forEach(emp=>{if(emp.area)byArea[emp.area].push(emp);});
        AREAS.forEach(area => { const emps=byArea[area],tp=emps.reduce((a,e)=>a+e.points,0); if(!tp)return; const ap=round2(toDistribute*(tSplit[area]/100)); emps.forEach(emp=>{const g=round2(total*(tSplit[area]/100)*(emp.points/tp)),tx=round2(totalTaxAmt*(tSplit[area]/100)*(emp.points/tp));newTips.push({id:`${Date.now()}-${emp.id}-${Math.random().toString(36).slice(2,6)}`,restaurantId:rid,employeeId:emp.id,date,monthKey:tKey,poolTotal:total,areaPool:ap,area,myShare:g,myTax:tx,myNet:round2(g-tx),note:noteVal,taxRate});}); });
      }
    } catch (err) {
      onUpdate("_toast", "⚠️ Erro no cálculo de gorjeta: " + (err.message || "desconhecido"));
      return { count: 0, updatedTips: allTips };
    }
    // Remove existing tips for this date before adding new ones (supports re-launch)
    const tipsWithoutDate = allTips.filter(t => !(t.restaurantId === rid && t.date === date));
    const updatedTips = [...tipsWithoutDate, ...newTips];
    return { count: newTips.length, updatedTips };
  }


  function recalcTipDay(date, currentTips) {
    const allTips = currentTips ?? tips;
    // Find existing tips for this date
    const existing = allTips.filter(t => t.restaurantId === rid && t.date === date);
    if (!existing.length) return 0;
    const poolTotal = existing[0].poolTotal;
    const noteVal   = existing[0].note ?? "";
    const taxRate   = restaurant.taxRate ?? TAX;
    const td        = new Date(date + "T12:00:00");
    const tKey      = monthKey(td.getFullYear(), td.getMonth());
    const totalTaxAmt = poolTotal * taxRate;
    const toDistribute = poolTotal - totalTaxAmt;
    const mode = restaurant.divisionMode ?? MODE_AREA_POINTS;

    const daySchedule = schedules?.[rid]?.[tKey] ?? {};
    const empDayStatus = (empId) => {
      const empDayMap = daySchedule[empId] ?? {};
      return empDayMap[date];
    };

    const allRestEmps = employees.filter(e =>
      e.restaurantId === rid &&
      !(e.inactive && e.inactiveFrom && e.inactiveFrom <= date)
    );

    const activeEmps = allRestEmps.filter(emp => {
      const r = restRoles.find(r => r.id === emp.roleId);
      if (!r || r.noTip) return false;
      if (emp.isFreela) return false; // freela nunca entra na gorjeta
      if (emp.admission && emp.admission > date) return false;
      if (emp.demitidoEm && emp.demitidoEm <= date) return false; // demitido = não entra
      const status = empDayStatus(emp.id);
      if (status === DAY_VACATION) return false; // férias = ninguém entra, nem produção
      if (status === DAY_FREELA) return false; // freela no dia = não entra
      if (emp.isProducao) return true; // produção entra em todos os outros dias
      if (!status) return true; // trabalho = entra
      if (status === DAY_COMP || status === DAY_COMP_TRAB) return true; // compensação (folga ou trabalho) = entra
      if (status === DAY_FAULT_J || status === DAY_FAULT_U) return false; // faltas = nao entra
      return false; // demais: folga = nao entra
    }).map(emp => ({
      ...emp,
      points: parseFloat(restRoles.find(r => r.id === emp.roleId)?.points) || 0,
      area: restRoles.find(r => r.id === emp.roleId)?.area,
    }));

    const newTips = [];
    if (mode === MODE_GLOBAL_POINTS) {
      const totalPoints = activeEmps.reduce((a, e) => a + e.points, 0);
      if (!totalPoints) return 0;
      activeEmps.forEach(emp => {
        const myGross = poolTotal * (emp.points / totalPoints);
        const myTaxShare = totalTaxAmt * (emp.points / totalPoints);
        newTips.push({ id: `${Date.now()}-${emp.id}-${Math.random().toString(36).slice(2,6)}`, restaurantId: rid, employeeId: emp.id, date, monthKey: tKey, poolTotal, areaPool: toDistribute, area: emp.area ?? "—", myShare: myGross, myTax: myTaxShare, myNet: myGross - myTaxShare, note: noteVal, taxRate });
      });
    } else {
      const tSplit = splits?.[rid]?.[tKey] ?? DEFAULT_SPLIT;
      const empsByArea = {};
      AREAS.forEach(a => { empsByArea[a] = []; });
      activeEmps.forEach(emp => { if (emp.area) empsByArea[emp.area].push(emp); });
      AREAS.forEach(area => {
        const emps = empsByArea[area];
        const totalPoints = emps.reduce((a, e) => a + e.points, 0);
        if (!totalPoints) return;
        const areaPool = toDistribute * (tSplit[area] / 100);
        emps.forEach(emp => {
          const myGross = poolTotal * (tSplit[area] / 100) * (emp.points / totalPoints);
          const myTaxShare = totalTaxAmt * (tSplit[area] / 100) * (emp.points / totalPoints);
          newTips.push({ id: `${Date.now()}-${emp.id}-${Math.random().toString(36).slice(2,6)}`, restaurantId: rid, employeeId: emp.id, date, monthKey: tKey, poolTotal, areaPool, area, myShare: myGross, myTax: myTaxShare, myNet: myGross - myTaxShare, note: noteVal, taxRate });
        });
      });
    }
    // Remove old tips for this date and add new ones
    const remaining = allTips.filter(t => !(t.restaurantId === rid && t.date === date));
    const updatedTips = [...remaining, ...newTips];
    return { count: newTips.length, updatedTips };
  }

  function saveSplit() {
    const total = AREAS.reduce((a, k) => a + parseFloat(splitForm[k] || 0), 0);
    if (Math.abs(total - 100) > 0.01) { alert("Os percentuais devem somar 100%."); return; }
    const newSplit = Object.fromEntries(AREAS.map(a => [a, parseFloat(splitForm[a])]));
    const updatedRestSplits = { ...(splits?.[rid] ?? {}), [mk]: newSplit };

    // Ask if they want to apply to future months too
    const applyFuture = window.confirm("Deseja aplicar esses percentuais também para os próximos meses?");
    if (applyFuture) {
      // Apply to 12 future months from current
      const [cy, cm] = mk.split("-").map(Number);
      for (let i = 1; i <= 12; i++) {
        const fm = cm - 1 + i;
        const fy = cy + Math.floor(fm / 12);
        const fmIdx = fm % 12;
        const fmk = `${fy}-${String(fmIdx + 1).padStart(2, "0")}`;
        updatedRestSplits[fmk] = { ...newSplit };
      }
    }

    onUpdate("splits", { ...splits, [rid]: updatedRestSplits });
    setSplitForm(null);
  }

  const areaEmps = schedArea === "Todos"
    ? schedEmps.slice().sort((a,b) => {
        const aA = restRoles.find(r=>r.id===a.roleId)?.area ?? "z";
        const bA = restRoles.find(r=>r.id===b.roleId)?.area ?? "z";
        return aA.localeCompare(bA) || a.name.localeCompare(b.name);
      })
    : schedEmps.filter(e => restRoles.find(r => r.id === e.roleId)?.area === schedArea);
  const dim = new Date(year, month + 1, 0).getDate();

  const ac = "var(--ac)";
  const canTips  = perms.tips     || isOwner;
  const canSched = perms.schedule || isOwner;
  const isDP     = perms.isDP === true;

  // Abas opcionais — admin autoriza via tabsConfig, gestor escolhe via tabsGestor
  const adminAutoriza = (key) => restaurant.tabsConfig?.[key] !== false;
  const gestorAtivou  = (key) => restaurant.tabsGestor?.[key] !== false;
  const tabVisible    = (key) => adminAutoriza(key) && (isOwner || gestorAtivou(key));

  const inboxUnread = ((data?.notifications??[]).filter(n=>n.restaurantId===rid&&!n.read&&!n.deleted&&n.targetRole!=="admin"&&n.type!=="upgrade_request").length + (data?.dpMessages??[]).filter(m=>m.restaurantId===rid&&!m.read&&!m.deleted).length);

  // Líder Operacional: acesso restrito a Dashboard + Escala + Horários + Equipe
  // ── Grouped tabs ──
  const TAB_GROUPS = isLider ? [
    { id:"equipe", label:"👥 Equipe", icon:"👥", tabs: [
      ["employees","Pessoas"],
      ["reunioes","Reuniões"],
    ].filter(Boolean) },
    { id:"operacao", label:"📅 Operação", icon:"📅", tabs: [
      canSched && ["schedule","Escala"],
      ["horarios","Horários"],
    ].filter(Boolean) },
  ] : [
    { id:"operacao", label:"💰 Operação", icon:"💰", tabs: [
      canTips && ["dashboard","Dashboard"],
      canTips && ["tips","Gorjetas"],
      canSched && ["schedule","Escala"],
      (isOwner || (perms.vt !== false && tabVisible("vt"))) && ["vt","Vale Transporte"],
    ].filter(Boolean) },
    { id:"equipe", label:"👥 Equipe", icon:"👥", tabs: [
      (isOwner || tabVisible("roles")) && ["roles","Cargos"],
      (isOwner || canTips || tabVisible("employees")) && ["employees","Pessoas"],
      (isOwner || canTips || tabVisible("employees")) && ["reunioes","Reuniões"],
      (isOwner || tabVisible("horarios")) && ["horarios","Horários"],
    ].filter(Boolean) },
    { id:"comunicacao", label:"📢 Comunicação", icon:"📢", tabs: [
      (isOwner || tabVisible("comunicados")) && ["comunicados","Comunicados"],
      (isOwner || tabVisible("faq")) && ["faq","FAQ"],
      (isOwner || tabVisible("dp")) && ["dp","Fale com DP"],
      isDP && ["notificacoes",`Caixa${inboxUnread>0?` (${inboxUnread})`:""}`],
    ].filter(Boolean) },
    { id:"config", label:"⚙️ Config", icon:"⚙️", tabs: [
      (canTips || isOwner) && ["config","Configurações"],
      isDP && ["dp_gestores","Gestores"],
    ].filter(Boolean) },
  ].filter(g => g.tabs.length > 0);

  // Mobile: restrict to dashboard, schedule, horarios, employees, reunioes, notificacoes
  const MOBILE_ALLOWED = ["dashboard","schedule","horarios","employees","reunioes","notificacoes"];
  const TAB_GROUPS_FINAL = mobileOnly
    ? TAB_GROUPS.map(g => ({ ...g, tabs: g.tabs.filter(([id]) => MOBILE_ALLOWED.includes(id)) })).filter(g => g.tabs.length > 0)
    : TAB_GROUPS;

  // Flat TABS for backward compatibility
  const TABS = TAB_GROUPS_FINAL.flatMap(g => g.tabs.map(([id,lbl]) => [id,lbl]));

  const defaultGroup = isLider ? "equipe" : "operacao";
  const [tabGroup, setTabGroup] = useState(defaultGroup);
  const [tab, setTab] = useState(isLider ? "employees" : "dashboard");
  const activeGroup = TAB_GROUPS_FINAL.find(g => g.id === tabGroup) ?? TAB_GROUPS_FINAL[0];

  function switchGroup(gid) {
    const g = TAB_GROUPS_FINAL.find(x => x.id === gid);
    if (!g || g.tabs.length === 0) return;
    setTabGroup(gid);
    // If current tab is already in this group, keep it
    if (g.tabs.some(([id]) => id === tab)) return;
    setTab(g.tabs[0][0]);
  }

  // Reset de aba — só Admin AppTip (isOwner)
  function resetTab(tabKey, tabLabel, getSnapshot) {
    if (!isOwner) return;
    if (!window.confirm(`Resetar "${tabLabel}"?\n\nOs dados ficam na lixeira por 90 dias e podem ser restaurados.`)) return;
    const snapshot = getSnapshot();
    const entry = {
      id: Date.now().toString(),
      restaurantId: rid,
      restaurantName: restaurant.name,
      tabKey,
      tabLabel,
      snapshot,
      deletedAt: new Date().toISOString(),
    };
    const trash = data?.trash ?? { restaurants:[], managers:[], employees:[], tabData:[] };
    onUpdate("trash", { ...trash, tabData: [...(trash.tabData??[]), entry] });
    return true; // indica que pode prosseguir com o reset
  }

  // --- Gorjetas dirty check & save helper ---
  const tipsDirty = tipRows.some(r => {
    const v = parseBR(r.total);
    const dayTips = (tips ?? []).filter(t => t.restaurantId === rid && t.date === r.date);
    const isLaunched = dayTips.length > 0;
    const launchedPool = isLaunched ? dayTips[0].poolTotal : null;
    return (v > 0 && !isNaN(v) && !isLaunched) || (isLaunched && launchedPool != null && v > 0 && !isNaN(v) && v !== launchedPool);
  });

  function parseBR(v) { if (typeof v === "number") return v; return parseFloat(String(v).replace(/\./g,"").replace(",",".")); }

  function saveTipRows() {
    const dirtyRows = tipRows.filter(r => {
      const v = parseBR(r.total);
      if (!v || isNaN(v) || v <= 0) return false;
      const dayTips = (tips ?? []).filter(t => t.restaurantId === rid && t.date === r.date);
      const isLaunched = dayTips.length > 0;
      const launchedPool = isLaunched ? dayTips[0].poolTotal : null;
      return !isLaunched || (launchedPool != null && v !== launchedPool);
    });
    if (!dirtyRows.length) { onUpdate("_toast","⚠️ Nenhum dia com valor alterado para salvar."); return; }
    let count = 0, currentTips = tips;
    dirtyRows.forEach(row => {
      const result = calcTipForDate(row.date, parseBR(row.total), row.note ?? "", currentTips);
      count += result.count;
      currentTips = result.updatedTips;
    });
    if (count > 0) {
      // Snapshot pré-save das gorjetas do mês
      const preSnapT = snapshotTipsMonth(tips, rid, mk);
      saveVersion("tips", rid, mk, data?.tipVersions, preSnapT, currentUser?.name || (isOwner?"Gestor AppTip":"Gestor Adm."), `Salvar gorjetas (${dirtyRows.length} dia${dirtyRows.length>1?"s":""})`, onUpdate, true);
      onUpdate("tips", currentTips);
      setTipRows([]);
      onUpdate("_toast", `✅ ${dirtyRows.length} dia${dirtyRows.length>1?"s":""} salvo${dirtyRows.length>1?"s":""}! (${count} empregados)`);
    } else {
      const sampleDate = dirtyRows[0]?.date ?? "?";
      const admCount = restEmps.filter(e => e.admission && e.admission > sampleDate).length;
      const noRoleCount = restEmps.filter(e => !restRoles.find(r => r.id === e.roleId)).length;
      const freelaCount = restEmps.filter(e => e.isFreela).length;
      let reason = `Total ${restEmps.length} empregados. `;
      if (admCount > 0) reason += `${admCount} com admissão após ${new Date(sampleDate+"T12:00:00").toLocaleDateString("pt-BR")}. `;
      if (noRoleCount > 0) reason += `${noRoleCount} sem cargo. `;
      if (freelaCount > 0) reason += `${freelaCount} freela. `;
      reason += "Corrija as datas de admissão dos empregados se necessário.";
      onUpdate("_toast","⚠️ " + reason);
    }
  }

  function discardTipRows() { setTipRows([]); }

  return (
    <div style={{ fontFamily:"'DM Sans',sans-serif" }}>
      {/* Tab groups — row 1: group pills */}
      <div style={{ display:"flex", gap:4, padding:"8px 12px 0", background:"var(--header-bg)", overflowX:"auto", scrollbarWidth:"none", WebkitOverflowScrolling:"touch" }}>
        {TAB_GROUPS_FINAL.map(g => (
          <button key={g.id} onClick={() => switchGroup(g.id)}
            style={{ padding:"7px 14px", background:tabGroup===g.id?ac:"transparent", border:"none", borderRadius:20, color:tabGroup===g.id?"#fff":"var(--text3)", cursor:"pointer", fontSize:13, fontFamily:"'DM Sans',sans-serif", fontWeight:tabGroup===g.id?700:500, whiteSpace:"nowrap", flexShrink:0, transition:"all .15s" }}>
            {g.label}
          </button>
        ))}
      </div>
      {/* Tab groups — row 2: sub-tab pills */}
      <div style={{ display:"flex", borderBottom:"1px solid var(--border)", background:"var(--header-bg)", overflowX:"auto", scrollbarWidth:"none", WebkitOverflowScrolling:"touch" }}>
        {(activeGroup?.tabs??[]).map(([id, lbl]) => (
          <button key={id} onClick={() => {
            if (tab === "config" && id !== "config" && configDirty) {
              const action = window.confirm("Você tem alterações não salvas nas configurações.\n\nDeseja salvar antes de sair?");
              if (action) { saveConfig(); }
              else { discardConfig(); }
            }
            if (tab === "tips" && id !== "tips" && tipsDirty) {
              const action = window.confirm("Você tem gorjetas não salvas.\n\nDeseja salvar antes de sair?");
              if (action) { saveTipRows(); }
              else { discardTipRows(); }
            }
            if (tab === "schedule" && id !== "schedule" && schedDirty) {
              const action = window.confirm("Você tem edições na escala não salvas.\n\nDeseja salvar como nova versão antes de sair?");
              if (action) {
                if (!data?.schedulePrevista?.[rid]?.[mk]) {
                  const frozenPrevista = JSON.parse(JSON.stringify(schedules?.[rid]?.[mk] ?? {}));
                  const newPrev = { ...(data?.schedulePrevista ?? {}) };
                  if (!newPrev[rid]) newPrev[rid] = {};
                  newPrev[rid][mk] = frozenPrevista;
                  onUpdate("schedulePrevista", newPrev);
                }
                const preSnap = snapshotSchedulesMonth(schedules, rid, mk);
                saveVersion("schedules", rid, mk, data?.scheduleVersions, preSnap, currentUser?.name || (isOwner?"Gestor AppTip":"Gestor Adm."), "Edição manual", onUpdate, true);
                let newMonth = { ...(schedules?.[rid]?.[mk] ?? {}) };
                Object.entries(schedLocalEdits).forEach(([eid, dayEdits]) => {
                  const empMap = { ...(newMonth[eid] ?? {}) };
                  Object.entries(dayEdits).forEach(([dt, val]) => {
                    if (val === null) delete empMap[dt]; else empMap[dt] = val;
                  });
                  newMonth[eid] = empMap;
                });
                onUpdate("schedules", { ...schedules, [rid]: { ...(schedules?.[rid]??{}), [mk]: newMonth } });
              }
              setSchedLocalEdits(null);
            }
            setTab(id);
          }}
            style={{ padding:"11px 16px", background:"none", border:"none", borderBottom:`2px solid ${tab===id?ac:"transparent"}`, color:tab===id?ac:"var(--text3)", cursor:"pointer", fontSize:13, fontFamily:"'DM Sans',sans-serif", fontWeight:tab===id?700:500, whiteSpace:"nowrap", flexShrink:0 }}>
            {lbl}
          </button>
        ))}
      </div>

      {/* Botão voltar ao Dashboard no mobile */}
      {mobileOnly && tab !== "dashboard" && (
        <button onClick={()=>{
          if (tab === "schedule" && schedDirty) {
            const action = window.confirm("Você tem edições na escala não salvas.\n\nDeseja salvar como nova versão antes de sair?");
            if (action) {
              // Freeze prevista on first adjustment
              if (!data?.schedulePrevista?.[rid]?.[mk]) {
                const frozenPrevista = JSON.parse(JSON.stringify(schedules?.[rid]?.[mk] ?? {}));
                const newPrev = { ...(data?.schedulePrevista ?? {}) };
                if (!newPrev[rid]) newPrev[rid] = {};
                newPrev[rid][mk] = frozenPrevista;
                onUpdate("schedulePrevista", newPrev);
              }
              const preSnap = snapshotSchedulesMonth(schedules, rid, mk);
              saveVersion("schedules", rid, mk, data?.scheduleVersions, preSnap, currentUser?.name || (isOwner?"Gestor AppTip":"Gestor Adm."), "Edição manual", onUpdate, true);
              let newMonth = { ...(schedules?.[rid]?.[mk] ?? {}) };
              Object.entries(schedLocalEdits).forEach(([eid, dayEdits]) => {
                const empMap = { ...(newMonth[eid] ?? {}) };
                Object.entries(dayEdits).forEach(([dt, val]) => { if (val === null) delete empMap[dt]; else empMap[dt] = val; });
                newMonth[eid] = empMap;
              });
              onUpdate("schedules", { ...schedules, [rid]: { ...(schedules?.[rid]??{}), [mk]: newMonth } });
            }
            setSchedLocalEdits(null);
          }
          setTab("dashboard");
        }} style={{display:"flex",alignItems:"center",gap:6,padding:"10px 16px",background:"none",border:"none",borderBottom:"1px solid var(--border)",color:"var(--ac-text,var(--ac))",cursor:"pointer",fontSize:13,fontWeight:600,fontFamily:"'DM Sans',sans-serif",width:"100%"}}>
          ← Dashboard
        </button>
      )}

      <div style={{ padding:mobileOnly?"12px 10px":"20px 24px", maxWidth:1100, margin:"0 auto" }}>
        {["dashboard","tips","schedule"].includes(tab) && (
          <div style={{ marginBottom: 20 }}><MonthNav year={year} month={month} onChange={(y,m)=>{
            if (tab === "schedule" && schedDirty) {
              const action = window.confirm("Você tem edições na escala não salvas.\n\nDeseja salvar como nova versão antes de mudar de mês?");
              if (action) {
                // Freeze prevista on first adjustment
                if (!data?.schedulePrevista?.[rid]?.[mk]) {
                  const frozenPrevista = JSON.parse(JSON.stringify(schedules?.[rid]?.[mk] ?? {}));
                  const newPrev = { ...(data?.schedulePrevista ?? {}) };
                  if (!newPrev[rid]) newPrev[rid] = {};
                  newPrev[rid][mk] = frozenPrevista;
                  onUpdate("schedulePrevista", newPrev);
                }
                const preSnap = snapshotSchedulesMonth(schedules, rid, mk);
                saveVersion("schedules", rid, mk, data?.scheduleVersions, preSnap, currentUser?.name || (isOwner?"Gestor AppTip":"Gestor Adm."), "Edição manual", onUpdate, true);
                let newMonth2 = { ...(schedules?.[rid]?.[mk] ?? {}) };
                Object.entries(schedLocalEdits).forEach(([eid, dayEdits]) => {
                  const empMap = { ...(newMonth2[eid] ?? {}) };
                  Object.entries(dayEdits).forEach(([dt, val]) => { if (val === null) delete empMap[dt]; else empMap[dt] = val; });
                  newMonth2[eid] = empMap;
                });
                onUpdate("schedules", { ...schedules, [rid]: { ...(schedules?.[rid]??{}), [mk]: newMonth2 } });
              }
              setSchedLocalEdits(null);
            }
            setYear(y);setMonth(m);setWeekIdx(calcWeekForToday(y,m));
          }} /></div>
        )}

        {/* Banner de privacidade */}
        {privacyMask && (
          <div style={{background:"#f59e0b15",border:"1px solid #f59e0b44",borderRadius:12,padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:18}}>🔒</span>
            <div>
              <div style={{color:"#f59e0b",fontSize:13,fontWeight:700}}>Modo Privacidade ativo</div>
              <div style={{color:"var(--text3)",fontSize:12}}>Valores de gorjeta, CPFs e mensagens estão ocultos para o administrador.</div>
            </div>
          </div>
        )}

        {/* DASHBOARD */}
        {tab === "dashboard" && (() => {
          const dim = new Date(year, month+1, 0).getDate();
          const todayStr = today();
          const isCurrentMonth = todayStr.startsWith(`${year}-${String(month+1).padStart(2,"0")}`);

          // — Gorjetas —
          const tipPoolTotal = [...new Set(monthTips.map(t=>t.date))].reduce((s,d)=>{
            const dt = monthTips.filter(t=>t.date===d);
            return s + (dt[0]?.poolTotal ?? 0);
          }, 0);
          const diasLancados = [...new Set(monthTips.map(t=>t.date))].length;
          const restNoTipDays = (data?.noTipDays?.[rid] ?? []).filter(d=>d.startsWith(`${year}-${String(month+1).padStart(2,"0")}`));
          const diasResolvidos = diasLancados + restNoTipDays.length;
          const limitDay = isCurrentMonth ? parseInt(todayStr.slice(-2)) : dim;
          let diasUteisPassados = 0;
          for (let d=1; d<=limitDay; d++) {
            const wd = new Date(`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}T12:00:00`).getDay();
            if (wd!==0 && wd!==6) diasUteisPassados++;
          }
          const diasSemLancamento = Math.max(0, diasUteisPassados - diasResolvidos);

          // — Pendências —
          const semCargo = restEmps.filter(e=>!restRoles.find(r=>r.id===e.roleId)).length;
          const semHorario = restEmps.filter(e=>!(data?.workSchedules?.[rid]?.[e.id]?.length)).length;
          const schedMonth = schedules?.[rid]?.[mk] ?? {};
          let totalFaltasU = 0;
          restEmps.forEach(emp => { Object.values(schedMonth[emp.id]??{}).forEach(v=>{ if(v===DAY_FAULT_U) totalFaltasU++; }); });
          const dpNaoLidas = (data?.dpMessages??[]).filter(m=>m.restaurantId===rid&&!m.read&&!m.deleted).length;
          const commsSemCiencia = (data?.communications??[]).filter(c=>
            c.restaurantId===rid && !c.autoSchedule && !c.deleted &&
            restEmps.some(e=>!(data?.commAcks??{})[`${c.id}_${e.id}`])
          ).length;

          const alerts = [];
          if (!isLider && diasSemLancamento > 0)
            alerts.push({ icon:"💸", color:"#f59e0b", msg:`${diasSemLancamento} dia${diasSemLancamento>1?"s":""} útil${diasSemLancamento>1?"eis":""} sem gorjeta lançada`, tab:"tips" });
          if (semCargo > 0)
            alerts.push({ icon:"👤", color:"var(--red)", msg:`${semCargo} empregado${semCargo>1?"s":""} sem cargo definido`, tab:"employees" });
          if (semHorario > 0)
            alerts.push({ icon:"🕐", color:"#8b5cf6", msg:`${semHorario} empregado${semHorario>1?"s":""} sem horário cadastrado`, tab:"horarios" });
          if (totalFaltasU > 0)
            alerts.push({ icon:"⚠️", color:"var(--red)", msg:`${totalFaltasU} falta${totalFaltasU>1?"s":""} injustificada${totalFaltasU>1?"s":""} este mês`, tab:"schedule" });
          if (dpNaoLidas > 0)
            alerts.push({ icon:"💬", color:"#3b82f6", msg:`${dpNaoLidas} mensagem${dpNaoLidas>1?"ns":""} não lida${dpNaoLidas>1?"s":""} no Fale com DP`, tab:"dp" });
          if (commsSemCiencia > 0)
            alerts.push({ icon:"📢", color:"#f59e0b", msg:`${commsSemCiencia} comunicado${commsSemCiencia>1?"s":""} aguardando ciência`, tab:"comunicados" });

          // — Mensagens / Notificações recentes —
          const recentDp = (data?.dpMessages??[])
            .filter(m=>m.restaurantId===rid&&!m.deleted)
            .sort((a,b)=>b.date.localeCompare(a.date))
            .slice(0,4);
          const recentNotifs = (data?.notifications??[])
            .filter(n=>n.restaurantId===rid&&!n.deleted)
            .sort((a,b)=>b.date.localeCompare(a.date))
            .slice(0,3);
          const CATS = { sugestao:"💡", elogio:"👏", reclamacao:"⚠️", denuncia:"🚨" };

          // — Resumo do dia —
          const todayTips = monthTips.filter(t => t.date === todayStr);
          const gorjetaHoje = todayTips.length > 0 ? todayTips[0].poolTotal : null;
          const escalaHoje = schedules?.[rid]?.[mk] ?? {};
          const teamToday = { work:[], off:[], vacation:[], comp:[], comptrab:[], faultJ:[], faultU:[], freela:[] };
          restEmps.forEach(e => {
            const status = (escalaHoje[e.id] ?? {})[todayStr];
            const role = restRoles.find(r => r.id === e.roleId);
            const sched = data?.workSchedules?.[rid]?.[e.id];
            const currentSched = sched?.[sched.length-1];
            const dayIdx = new Date(todayStr+"T12:00:00").getDay();
            const dayData = currentSched?.days?.[dayIdx];
            const parts = (e.name??"").split(" ").filter(Boolean);
            const shortName = parts.length > 1 ? `${parts[0]} ${parts[parts.length-1]}` : parts[0] ?? "";
            const entry = { name: shortName, role: role?.name, area: role?.area, in: dayData?.in, out: dayData?.out, break: dayData?.break, hasSchedule: !!currentSched && dayData?.active !== false, isProducao: !!e.isProducao, isFreela: !!e.isFreela };
            if (status === DAY_OFF) teamToday.off.push(entry);
            else if (status === DAY_FREELA) teamToday.freela.push(entry);
            else if (status === DAY_VACATION) teamToday.vacation.push(entry);
            else if (status === DAY_COMP) teamToday.comp.push(entry);
            else if (status === DAY_COMP_TRAB) teamToday.comptrab.push(entry);
            else if (status === DAY_FAULT_J) teamToday.faultJ.push(entry);
            else if (status === DAY_FAULT_U) teamToday.faultU.push(entry);
            else teamToday.work.push(entry);
          });
          const trabalhando = teamToday.work.length + teamToday.comptrab.length;

          return (
            <div>
              {/* Resumo do dia — só no mês atual */}
              {isCurrentMonth && (
                <div style={{...S.card, marginBottom:14, background:"var(--ac-bg)", border:"1px solid var(--ac)22"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <span style={{color:"var(--ac-text)",fontWeight:700,fontSize:mobileOnly?14:16}}>📅 Hoje — {new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}</span>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:isLider?"1fr":"repeat(3,1fr)",gap:8}}>
                    <div style={{background:"var(--card-bg)",borderRadius:10,padding:"10px 6px",textAlign:"center"}}>
                      <div style={{fontSize:18,marginBottom:2}}>👥</div>
                      <div style={{color:"var(--text)",fontWeight:700,fontSize:16}}>{trabalhando}</div>
                      <div style={{color:"var(--text3)",fontSize:9,marginTop:2}}>trabalhando</div>
                    </div>
                    {!isLider && (
                    <div style={{background:"var(--card-bg)",borderRadius:10,padding:"10px 6px",textAlign:"center"}}>
                      <div style={{fontSize:18,marginBottom:2}}>💸</div>
                      <div style={{color: gorjetaHoje!==null?"var(--green)":"var(--text3)", fontWeight:700,fontSize:gorjetaHoje!==null?13:12}}>
                        {gorjetaHoje !== null ? pFmt(gorjetaHoje) : "—"}
                      </div>
                      <div style={{color:"var(--text3)",fontSize:9,marginTop:2}}>gorjeta</div>
                    </div>
                    )}
                    {!isLider && (
                    <div style={{background:"var(--card-bg)",borderRadius:10,padding:"10px 6px",textAlign:"center"}}>
                      <div style={{fontSize:18,marginBottom:2}}>{diasSemLancamento>0?"⚠️":"✅"}</div>
                      <div style={{color:diasSemLancamento>0?"#f59e0b":"var(--green)",fontWeight:700,fontSize:14}}>
                        {diasSemLancamento>0 ? `${diasSemLancamento}d` : "Ok"}
                      </div>
                      <div style={{color:"var(--text3)",fontSize:9,marginTop:2}}>pendência</div>
                    </div>
                    )}
                  </div>
                  {!isLider && gorjetaHoje === null && isCurrentMonth && !mobileOnly && (
                    <button onClick={()=>setTab("tips")}
                      style={{...S.btnPrimary, width:"100%", marginTop:10, padding:"10px", fontSize:13}}>
                      💸 Lançar gorjeta de hoje
                    </button>
                  )}
                </div>
              )}

              {/* Equipe hoje — detalhamento por área */}
              {isCurrentMonth && teamToday.work.length + teamToday.comptrab.length + teamToday.off.length + teamToday.vacation.length + teamToday.freela.length > 0 && (() => {
                // Separate workers by area, production, and off-duty
                const byArea = {};
                AREAS.forEach(a => { byArea[a] = []; });
                const prodSection = [];
                teamToday.work.forEach(e => {
                  if (e.isProducao) prodSection.push(e);
                  else if (e.area && byArea[e.area]) byArea[e.area].push(e);
                  else if (e.area) { byArea[e.area] = byArea[e.area] || []; byArea[e.area].push(e); }
                });
                // Folga por comp goes into off section
                teamToday.comp.forEach(e => {
                  if (e.isProducao) prodSection.push({...e, isComp:true});
                  else if (e.area && byArea[e.area]) byArea[e.area].push({...e, isComp:true});
                });
                // Trabalho por comp goes into working section
                teamToday.comptrab.forEach(e => {
                  if (e.isProducao) prodSection.push({...e, isCompTrab:true});
                  else if (e.area && byArea[e.area]) byArea[e.area].push({...e, isCompTrab:true});
                });
                // Freela-day employees go to their area with badge
                teamToday.freela.forEach(e => {
                  if (e.isProducao) prodSection.push({...e, isFreelaDia:true});
                  else if (e.area && byArea[e.area]) byArea[e.area].push({...e, isFreelaDia:true});
                });
                const offSection = [...teamToday.off.map(e=>({...e,isFolga:true})), ...teamToday.vacation.map(e=>({...e,isVac:true})), ...teamToday.faultJ.map(e=>({...e,isFJ:true})), ...teamToday.faultU.map(e=>({...e,isFU:true}))];

                const EmpLine = ({e,i,color}) => (
                  <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:"1px solid var(--border)",fontSize:12}}>
                    <div style={{minWidth:0}}>
                      <span style={{color:"var(--text2)",fontWeight:500}}>{e.name}</span>
                      {e.isProducao && <span style={{fontSize:10,marginLeft:3}} title="Produção">🏭</span>}
                      {e.isFreela && <span style={{fontSize:10,marginLeft:3}} title="Freela">🎯</span>}
                      {e.isComp && <span style={{fontSize:9,marginLeft:4,color:"#3b82f6"}}>folga comp.</span>}
                      {e.isCompTrab && <span style={{fontSize:9,marginLeft:4,color:"#0ea5e9"}}>trab. comp.</span>}
                      {e.isFreelaDia && <span style={{fontSize:9,marginLeft:4,color:"#06b6d4"}}>freela</span>}
                      {e.isVac && <span style={{fontSize:9,marginLeft:4,color:"#8b5cf6"}}>férias</span>}
                      {e.isFJ && <span style={{fontSize:9,marginLeft:4,color:"#f59e0b"}}>falta just.</span>}
                      {e.isFU && <span style={{fontSize:9,marginLeft:4,color:"var(--red)"}}>falta inj.</span>}
                      {e.role && <span style={{color:"var(--text3)",fontSize:10,marginLeft:4}}>{e.role}</span>}
                    </div>
                    {e.hasSchedule && e.in && e.out
                      ? <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                          <span style={{color:color||"var(--green)",fontSize:10,fontFamily:"'DM Mono',monospace",fontWeight:600}}>{e.in}–{e.out}</span>
                          {e.break > 0 && <span style={{color:"var(--text3)",fontSize:9,background:"var(--bg2)",padding:"1px 5px",borderRadius:6}}>{e.break}min</span>}
                        </div>
                      : <span style={{color:"var(--text3)",fontSize:9,fontStyle:"italic"}}>sem horário</span>
                    }
                  </div>
                );

                return (
                  <div style={{...S.card,marginBottom:14}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                      <span style={{color:"var(--text)",fontWeight:700,fontSize:mobileOnly?14:16}}>👥 Equipe hoje <span style={{color:"var(--text3)",fontWeight:400,fontSize:mobileOnly?11:12}}>({new Date().toLocaleDateString("pt-BR")})</span></span>
                      <button onClick={()=>setTab("schedule")} style={{...S.btnSecondary,fontSize:12,padding:"6px 14px"}}>Escala →</button>
                    </div>
                    {/* Áreas */}
                    {AREAS.map(area => byArea[area].length > 0 && (
                      <div key={area} style={{marginBottom:10}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:mobileOnly?"6px 10px":"8px 14px",background:`${AREA_COLORS[area]??"var(--green)"}12`,borderRadius:10,borderLeft:`4px solid ${AREA_COLORS[area]??"var(--green)"}`,marginBottom:6}}>
                          <span style={{color:AREA_COLORS[area]??"var(--green)",fontSize:mobileOnly?12:13,fontWeight:700}}>{area}</span>
                          <span style={{color:AREA_COLORS[area]??"var(--green)",fontSize:mobileOnly?11:12,fontWeight:600}}>{byArea[area].length}</span>
                        </div>
                        {byArea[area].map((e,i) => <EmpLine key={i} e={e} i={i} color={AREA_COLORS[area]} />)}
                      </div>
                    ))}
                    {/* Produção */}
                    {prodSection.length > 0 && (
                      <div style={{marginBottom:10}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:mobileOnly?"6px 10px":"8px 14px",background:"#ec489912",borderRadius:10,borderLeft:"4px solid #ec4899",marginBottom:6}}>
                          <span style={{color:"#ec4899",fontSize:mobileOnly?12:13,fontWeight:700}}>🏭 Produção</span>
                          <span style={{color:"#ec4899",fontSize:mobileOnly?11:12,fontWeight:600}}>{prodSection.length}</span>
                        </div>
                        {prodSection.map((e,i) => <EmpLine key={i} e={e} i={i} color="#ec4899" />)}
                      </div>
                    )}
                    {/* Folga / Férias / Faltas */}
                    {offSection.length > 0 && (
                      <div style={{marginBottom:4}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:mobileOnly?"6px 10px":"8px 14px",background:"var(--bg1)",borderRadius:10,borderLeft:"4px solid var(--text3)",marginBottom:6}}>
                          <span style={{color:"var(--text3)",fontSize:mobileOnly?12:13,fontWeight:700}}>Folga / Ausentes</span>
                          <span style={{color:"var(--text3)",fontSize:mobileOnly?11:12,fontWeight:600}}>{offSection.length}</span>
                        </div>
                        {offSection.map((e,i) => (
                          <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:"1px solid var(--border)",fontSize:12}}>
                            <div style={{minWidth:0}}>
                              <span style={{color:"var(--text3)",fontWeight:500}}>{e.name}</span>
                              {e.role && <span style={{color:"var(--text3)",fontSize:10,marginLeft:4,opacity:0.7}}>{e.role}</span>}
                              {e.isVac && <span style={{fontSize:9,marginLeft:4,color:"#8b5cf6",background:"#8b5cf622",padding:"1px 5px",borderRadius:4}}>férias</span>}
                              {e.isFJ && <span style={{fontSize:9,marginLeft:4,color:"#f59e0b",background:"#f59e0b22",padding:"1px 5px",borderRadius:4}}>falta just.</span>}
                              {e.isFU && <span style={{fontSize:9,marginLeft:4,color:"var(--red)",background:"#ef444422",padding:"1px 5px",borderRadius:4}}>falta inj.</span>}
                              {e.isFolga && <span style={{fontSize:9,marginLeft:4,color:"var(--red)",background:"#ef444422",padding:"1px 5px",borderRadius:4}}>folga</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {!isLider && (
              <div style={{...S.card, marginBottom:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <span style={{color:"var(--text)",fontWeight:700,fontSize:mobileOnly?14:16}}>💸 Gorjetas — {monthLabel(year,month)}</span>
                  {!mobileOnly && <button onClick={()=>setTab("tips")} style={{...S.btnSecondary,fontSize:12,padding:"6px 14px"}}>Ver tudo →</button>}
                </div>
                <div style={{display:"grid",gridTemplateColumns:mobileOnly?"1fr 1fr":"1fr 1fr 1fr 1fr",gap:mobileOnly?6:8}}>
                  {[
                    ["Pool total",    pFmt(tipPoolTotal || 0), "var(--text)"],
                    ["Retenção",      pFmt(totalTax || 0),     "var(--red)"],
                    ["Distribuído",   pFmt(totalNet || 0),     ac],
                    ["Dias preenchidos", `${diasLancados}/${dim}`, diasLancados===dim?"var(--green)":diasLancados>=diasUteisPassados?"var(--green)":"#f59e0b"],
                  ].map(([lbl,val,col])=>(
                    <div key={lbl} style={{background:"var(--bg1)",borderRadius:10,padding:mobileOnly?"8px 6px":"10px 8px",textAlign:"center"}}>
                      <div style={{color:"var(--text3)",fontSize:mobileOnly?8:9,marginBottom:3,lineHeight:1.2}}>{lbl}</div>
                      <div style={{color:col,fontWeight:700,fontSize:mobileOnly?12:13}}>{val}</div>
                    </div>
                  ))}
                </div>
                {(restaurant.divisionMode ?? MODE_AREA_POINTS) === MODE_AREA_POINTS && totalNet > 0 && (
                  <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:5}}>
                    {AREAS.map(a=>{
                      const aNet = monthTips.filter(t=>t.area===a).reduce((s,t)=>s+t.myNet,0);
                      if(!aNet) return null;
                      return (
                        <div key={a} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 10px",borderLeft:`3px solid ${AREA_COLORS[a]}`,background:`${AREA_COLORS[a]}08`,borderRadius:"0 8px 8px 0"}}>
                          <span style={{color:AREA_COLORS[a],fontSize:12,minWidth:70,fontWeight:700}}>{a}</span>
                          <div style={{flex:1,background:"var(--bg2)",borderRadius:4,height:6,overflow:"hidden"}}>
                            <div style={{width:`${(aNet/totalNet)*100}%`,height:"100%",background:AREA_COLORS[a],borderRadius:4}}/>
                          </div>
                          <span style={{color:"var(--text2)",fontSize:12,minWidth:80,textAlign:"right",fontFamily:"'DM Mono',monospace",fontWeight:600}}>{pFmt(aNet)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              )}

              {/* Pendências */}
              {alerts.length > 0 ? (
                <div style={{...S.card,marginBottom:14,border:"1px solid var(--red)33",background:"#fef2f2"}}>
                  <span style={{color:"var(--red)",fontWeight:700,fontSize:mobileOnly?14:16,display:"block",marginBottom:10}}>⚡ Pendências</span>
                  {alerts.map((a,i)=>(
                    <div key={i} onClick={()=>setTab(a.tab)} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",borderRadius:8,cursor:"pointer",marginBottom:4,background:"#fff",border:`1px solid ${a.color}33`}}>
                      <span style={{fontSize:15}}>{a.icon}</span>
                      <span style={{color:"var(--text2)",fontSize:13,flex:1}}>{a.msg}</span>
                      <span style={{color:a.color,fontSize:12,fontWeight:700}}>→</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{...S.card,marginBottom:14,border:"1px solid var(--green)33",background:"#f0fdf4",textAlign:"center",padding:"14px"}}>
                  <span style={{fontSize:22}}>✅</span>
                  <p style={{color:"var(--green)",fontSize:13,margin:"4px 0 0",fontWeight:600}}>Tudo em dia!</p>
                  <p style={{color:"var(--text3)",fontSize:11,margin:"2px 0 0"}}>Nenhuma pendência para {monthLabel(year,month)}</p>
                </div>
              )}

              {/* Mensagens e Notificações recentes */}
              {(recentDp.length > 0 || recentNotifs.length > 0) && (
                <div style={{...S.card,marginBottom:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <span style={{color:"var(--text)",fontWeight:700,fontSize:mobileOnly?14:16}}>📬 Recentes</span>
                    <button onClick={()=>setTab("notificacoes")} style={{...S.btnSecondary,fontSize:12,padding:"6px 14px"}}>Ver tudo →</button>
                  </div>
                  {recentDp.map(m=>(
                    <div key={m.id} style={{display:"flex",gap:10,padding:"8px 0",borderBottom:"1px solid var(--border)",alignItems:"flex-start"}}>
                      <span style={{fontSize:14,flexShrink:0}}>{CATS[m.category]??"💬"}</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",justifyContent:"space-between",gap:6}}>
                          <span style={{color:m.read?"var(--text3)":"var(--text)",fontSize:12,fontWeight:m.read?400:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.empName}</span>
                          <span style={{color:"var(--text3)",fontSize:10,flexShrink:0}}>{new Date(m.date).toLocaleDateString("pt-BR")}</span>
                        </div>
                        <p style={{color:"var(--text3)",fontSize:11,margin:"2px 0 0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{pText(m.body)}</p>
                      </div>
                      {!m.read && <span style={{background:"#3b82f6",borderRadius:4,padding:"1px 5px",fontSize:9,color:"var(--text)",fontWeight:700,flexShrink:0}}>Novo</span>}
                    </div>
                  ))}
                  {recentNotifs.map(n=>(
                    <div key={n.id} style={{display:"flex",gap:10,padding:"8px 0",borderBottom:"1px solid var(--border)",alignItems:"flex-start"}}>
                      <span style={{fontSize:14,flexShrink:0}}>📋</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",justifyContent:"space-between",gap:6}}>
                          <span style={{color:n.read?"var(--text3)":"var(--text)",fontSize:12,fontWeight:n.read?400:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{pText(n.body?.split("\n")[0]?.replace("📋 ",""))}</span>
                          <span style={{color:"var(--text3)",fontSize:10,flexShrink:0}}>{new Date(n.date).toLocaleDateString("pt-BR")}</span>
                        </div>
                      </div>
                      {!n.read && <span style={{background:"#f59e0b",borderRadius:4,padding:"1px 5px",fontSize:9,color:"var(--text)",fontWeight:700,flexShrink:0}}>Novo</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* Ações rápidas — só no desktop */}
              {!mobileOnly && <div style={{...S.card}}>
                <span style={{color:"var(--text)",fontWeight:700,fontSize:mobileOnly?14:16,display:"block",marginBottom:10}}>⚡ Ações rápidas</span>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {[
                    ["💸 Lançar gorjeta", "tips"],
                    ["📅 Ver escala",     "schedule"],
                    ["👥 Equipe",         "employees"],
                    ["📢 Comunicados",    "comunicados"],
                  ].filter(([,t])=>TABS.some(tb=>tb[0]===t)).map(([lbl,t])=>(
                    <button key={t} onClick={()=>setTab(t)} style={{padding:"10px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg1)",color:"var(--text2)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12,textAlign:"left",fontWeight:500}}>
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>}
            </div>
          );
        })()}

        {/* GORJETAS */}
        {tab === "tips" && (
          <div>
            {/* Header */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12,marginBottom:16}}>
              <h3 style={{color:"var(--text)",margin:0,fontSize:mobileOnly?16:20}}>💸 Gorjetas</h3>
              {canTips && <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {(isOwner || isDP) && (() => {
                  const vCount = (data?.tipVersions?.[rid]?.[mk] ?? []).length;
                  return (
                    <button onClick={()=>setShowTipHistory(true)}
                      title="Ver e restaurar versões anteriores das gorjetas deste mês"
                      style={{...S.btnSecondary,fontSize:12,color:"var(--ac-text)",borderColor:"var(--ac)44"}}>
                      🕐 Histórico{vCount>0?` (${vCount})`:""}
                    </button>
                  );
                })()}
                {isOwner && <button onClick={()=>{
                  const ok = resetTab("tips","Gorjetas",()=>({tips:tips.filter(t=>t.restaurantId===rid), splits:splits?.[rid]}));
                  if(ok){ onUpdate("tips",tips.filter(t=>t.restaurantId!==rid)); onUpdate("_toast","🗑️ Gorjetas enviadas para a lixeira"); }
                }} style={{...S.btnSecondary,fontSize:12,color:"var(--red)",borderColor:"var(--red)44"}}>🗑️ Resetar gorjetas</button>}
                <button onClick={() => setShowExport(true)} style={{ ...S.btnSecondary, fontSize: 12, color: ac, borderColor: ac }}>📤 Exportar</button>
              </div>}
            </div>

            {/* Modal de histórico das gorjetas */}
            {showTipHistory && (
              <VersionHistoryModal
                title={`🕐 Histórico de Gorjetas — ${monthLabel(year, month)}`}
                versions={data?.tipVersions?.[rid]?.[mk]}
                onClose={()=>setShowTipHistory(false)}
                onRestore={(v)=>{
                  // Salva estado atual como nova versão
                  const curSnap = snapshotTipsMonth(tips, rid, mk);
                  saveVersion("tips", rid, mk, data?.tipVersions, curSnap, currentUser?.name || (isOwner?"Gestor AppTip":"Gestor Adm."), `Antes de restaurar "${v.reason}"`, onUpdate, true);
                  // Aplica versão restaurada: remove tips atuais desse mês e adiciona os do snapshot
                  const otherTips = (tips ?? []).filter(t => !(t.restaurantId === rid && t.monthKey === mk));
                  const restoredTips = [...otherTips, ...((v.snapshot ?? []).map(t => ({...t})))];
                  onUpdate("tips", restoredTips);
                  setShowTipHistory(false);
                  onUpdate("_toast", `♻️ Gorjetas restauradas para "${v.reason}" (${fmtRelTime(v.ts)})`);
                }}
              />
            )}
            {/* Botão salvar gorjetas — sticky no topo quando há alterações */}
            {tipsDirty && (
              <div style={{position:"sticky",top:0,zIndex:50,marginBottom:16}}>
                <div style={{background:"var(--card-bg)",border:"2px solid var(--ac)",borderRadius:14,padding:"14px 18px",boxShadow:"0 4px 20px rgba(0,0,0,0.15)"}}>
                  <p style={{color:ac,fontSize:13,fontWeight:700,margin:"0 0 10px"}}>⚠️ Gorjetas não salvas</p>
                  <div style={{display:"flex",gap:10}}>
                    <button onClick={saveTipRows} style={{...S.btnPrimary,flex:1,padding:"12px",fontSize:14,fontWeight:700}}>Salvar Gorjetas</button>
                    <button onClick={discardTipRows} style={{...S.btnSecondary,padding:"12px 16px",fontSize:13}}>Descartar</button>
                  </div>
                </div>
              </div>
            )}

            {/* Layout 2 colunas: Lançamento + Confirmação */}
            <div style={{display:"grid",gridTemplateColumns: mobileOnly ? "1fr" : "1fr 1fr",gap:20,marginBottom:24}}>

            {/* COLUNA ESQUERDA: Lançamento de gorjeta */}
            <div style={{ ...S.card }}>
              <p style={{color:ac,fontSize:14,fontWeight:700,margin:"0 0 12px"}}>💸 Lançamento Diário</p>
              {(() => {
                const daysInMonth = new Date(year, month+1, 0).getDate();
                const noTipDays = data?.noTipDays?.[rid] ?? [];

                const allDays = Array.from({length: daysInMonth}, (_, i) => {
                  const d = i+1;
                  return `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                });

                const setNoTip = (date, checked) => {
                  const updated = { ...(data?.noTipDays??{}), [rid]: checked ? [...noTipDays.filter(d=>d!==date), date] : noTipDays.filter(d=>d!==date) };
                  onUpdate("noTipDays", updated);
                  if (checked) setTipRows(prev => prev.filter(r => r.date !== date));
                };

                return (
                  <div>
                    {/* Cabeçalho */}
                    <div style={{display:"grid",gridTemplateColumns:"40px 1fr 48px 36px",gap:4,padding:"0 6px 4px",marginBottom:2}}>
                      {["","Valor (R$)","S/gorj",""].map((h,i)=>(
                        <div key={i} style={{color:"var(--text3)",fontSize:10,fontWeight:700,textAlign:i>=2?"center":"left"}}>{h}</div>
                      ))}
                    </div>

                    {allDays.map(date => {
                      const isNoTip    = noTipDays.includes(date);
                      const dayTips    = monthTips.filter(t => t.date === date);
                      const isLaunched = dayTips.length > 0;
                      const launchedPool = isLaunched ? dayTips[0].poolTotal : null;

                      const localRow = tipRows.find(r => r.date === date);
                      const displayVal = localRow ? localRow.total : (launchedPool != null ? String(launchedPool).replace(".",",") : "");
                      const val = parseBR(displayVal);
                      const hasVal = val > 0 && !isNaN(val);
                      const isDirty = localRow && ((isLaunched && launchedPool != null && hasVal && val !== launchedPool) || (!isLaunched && hasVal));

                      const weekday  = new Date(date+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"short"});
                      const isWeekend = [0,6].includes(new Date(date+"T12:00:00").getDay());
                      const isBeforeVigencia = restaurant.serviceStartDate && date < restaurant.serviceStartDate;

                      let bg = "var(--card-bg)", border = "var(--border)";
                      if      (isBeforeVigencia)            { bg = "var(--bg3)"; border = "var(--border)"; }
                      else if (isNoTip)                     { bg = "#f5f0ff"; border = "#6366f133"; }
                      else if (isDirty)                     { bg = "#fffbeb"; border = "#f59e0b44"; }
                      else if (isLaunched)                  { bg = "#f0fdf4"; border = "#10b98133"; }

                      if (isBeforeVigencia) return (
                        <div key={date} style={{display:"grid",gridTemplateColumns:"40px 1fr",gap:4,padding:"5px 6px",marginBottom:3,borderRadius:10,background:bg,border:`1px solid ${border}`,alignItems:"center",opacity:0.4}}>
                          <div style={{textAlign:"center"}}>
                            <div style={{color:"var(--text3)",fontSize:13,fontWeight:700}}>{parseInt(date.slice(-2))}</div>
                            <div style={{color:"var(--text3)",fontSize:9}}>{weekday}</div>
                          </div>
                          <div style={{color:"var(--text3)",fontSize:11}}>🔒 Antes da vigência</div>
                        </div>
                      );

                      return (
                        <div key={date} style={{display:"grid",gridTemplateColumns:"40px 1fr 48px 36px",gap:4,padding:"5px 6px",marginBottom:3,borderRadius:10,background:bg,border:`1px solid ${border}`,alignItems:"center"}}>

                          {/* Data */}
                          <div style={{textAlign:"center"}}>
                            <div style={{color:isWeekend?"#f59e0b":isNoTip?"#818cf8":isLaunched&&!isDirty?"var(--green)":isDirty?"#f59e0b":"var(--text3)",fontSize:13,fontWeight:700}}>{parseInt(date.slice(-2))}</div>
                            <div style={{color:"var(--text3)",fontSize:9}}>{weekday}</div>
                          </div>

                          {/* Valor */}
                          {privacyMask && isLaunched && !isDirty ? (
                            <div style={{...S.input, fontSize:14, padding:"8px 10px", background:"#e8faf0", color:"var(--green)", borderColor:"#10b98133", display:"flex", alignItems:"center"}}>
                              ••••,••
                            </div>
                          ) : (
                            <input
                              type="text" inputMode="decimal"
                              value={isNoTip ? "" : displayVal}
                              disabled={isNoTip}
                              onChange={e=>{ const raw = e.target.value.replace(/[^0-9.,]/g,""); setTipRows(prev => { const without = prev.filter(r => r.date !== date); return [...without, { date, total: raw, note: "" }]; }); }}
                              placeholder="0,00"
                              style={{...S.input, fontSize:14, padding:"8px 10px",
                                background:  isNoTip?"#f5f0ff" : isDirty?"#fef9e7" : isLaunched?"#e8faf0" : "var(--bg2)",
                                color:       isNoTip?"#6366f1" : isDirty?"#f59e0b" : isLaunched?"var(--green)" : "var(--text)",
                                borderColor: isNoTip?"transparent" : isDirty?"#f59e0b44" : isLaunched?"#10b98133" : "var(--border)",
                                cursor:      isNoTip?"not-allowed" : "text",
                              }}
                            />
                          )}

                          {/* Checkbox sem gorjeta */}
                          <label style={{display:"flex",justifyContent:"center",alignItems:"center",cursor:isLaunched?"default":"pointer",userSelect:"none",opacity:isLaunched?0.3:1}}>
                            <input type="checkbox" checked={isNoTip} disabled={isLaunched}
                              onChange={e=>setNoTip(date, e.target.checked)}
                              style={{width:18,height:18,cursor:isLaunched?"default":"pointer",accentColor:"#6366f1"}} />
                          </label>

                          {/* Status */}
                          <div style={{display:"flex",justifyContent:"center",alignItems:"center"}}>
                            {isLaunched && !isDirty && <span style={{color:"var(--green)",fontSize:14}}>✓</span>}
                            {isDirty && <span style={{color:"#f59e0b",fontSize:12}}>●</span>}
                            {isLaunched && (
                              <button onClick={()=>{
                                if(!window.confirm(`Zerar gorjeta de ${fmtDate(date)}?\n\n⚠️ Um backup será salvo no Histórico — você pode restaurar depois.`)) return;
                                const preSnap = snapshotTipsMonth(tips, rid, mk);
                                saveVersion("tips", rid, mk, data?.tipVersions, preSnap, currentUser?.name || (isOwner?"Gestor AppTip":"Gestor Adm."), `Remover gorjeta de ${fmtDate(date)}`, onUpdate, true);
                                onUpdate("tips",tips.filter(t=>!(t.restaurantId===rid&&t.date===date)));
                                setTipRows(prev=>prev.filter(r=>r.date!==date));
                                onUpdate("_toast",`🗑️ ${fmtDate(date)}: removido`);
                              }} style={{padding:"2px 5px",borderRadius:6,border:"none",background:"transparent",color:"var(--red)",cursor:"pointer",fontSize:10,marginLeft:2}}>
                                ✕
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>

            {/* COLUNA DIREITA: Confirmação semanal */}
            {(isDP || isOwner) ? (() => {
              const weeks = getWeeksInMonth(year, month);
              const ridApprovals = data?.tipApprovals?.[rid] ?? {};
              const pendingCount = weeks.filter(w => !ridApprovals[w.monday]).length;
              return (
                <div style={{...S.card, border: pendingCount > 0 ? "2px solid #f59e0b" : "2px solid var(--ac)33"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                    <p style={{color:ac,fontSize:14,fontWeight:700,margin:0}}>✅ Confirmação</p>
                    {pendingCount > 0 ? (
                      <span style={{background:"#f59e0b22",color:"#f59e0b",padding:"3px 10px",borderRadius:8,fontSize:11,fontWeight:700}}>{pendingCount} pendente{pendingCount>1?"s":""}</span>
                    ) : (
                      <span style={{background:"var(--ac)11",color:ac,padding:"3px 10px",borderRadius:8,fontSize:11,fontWeight:700}}>Tudo confirmado</span>
                    )}
                  </div>
                  <p style={{color:"var(--text3)",fontSize:11,marginBottom:12,lineHeight:1.5}}>Confirme cada semana para liberar os valores no extrato do empregado.</p>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {weeks.map(w => {
                      const approval = ridApprovals[w.monday];
                      const weekTips = monthTips.filter(t => { const day = parseInt(t.date.split("-")[2]); return w.daysInMonth.includes(day); });
                      const weekTotal = weekTips.reduce((s,t) => s + (t.myNet ?? 0), 0);
                      const weekEmps = new Set(weekTips.map(t => t.employeeId)).size;
                      const weekDates = [...new Set(weekTips.map(t => t.date))].sort();
                      const fmtDay = (ds) => { const [,mm,dd] = ds.split("-"); return `${dd}/${mm}`; };
                      return (
                        <div key={w.monday} style={{padding:"10px 12px",borderRadius:10,background:approval?"var(--ac)06":"var(--bg2)",border:`1px solid ${approval?"var(--ac)33":"var(--border)"}`}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                            <div style={{fontWeight:700,fontSize:13,color:"var(--text)"}}>{fmtDay(w.monday)} — {fmtDay(w.sunday)}</div>
                            {approval && <span style={{fontSize:9,color:ac,fontWeight:600}}>✓</span>}
                          </div>
                          <div style={{fontSize:11,color:"var(--text3)",marginBottom:6}}>{weekTips.length} lanç. · {weekEmps} emp. · Líq. R$ {weekTotal.toFixed(2)}</div>
                          {approval && <div style={{fontSize:10,color:"var(--text3)",marginBottom:6}}>Por {approval.approvedByName} em {new Date(approval.approvedAt).toLocaleDateString("pt-BR")} {new Date(approval.approvedAt).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</div>}
                          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                            {approval ? (<>
                              <button onClick={() => {
                                if (weekDates.length === 0) { onUpdate("_toast","Nenhum lançamento nesta semana para recalcular."); return; }
                                let total=0, currentTips=tips;
                                const preSnap = snapshotTipsMonth(tips, rid, mk);
                                weekDates.forEach(d => { const r=recalcTipDay(d,currentTips); total+=r.count; currentTips=r.updatedTips; });
                                if(total>0){
                                  saveVersion("tips", rid, mk, data?.tipVersions, preSnap, currentUser?.name || (isOwner?"Gestor AppTip":"Gestor Adm."), `Recalcular semana ${fmtDay(w.monday)}—${fmtDay(w.sunday)}`, onUpdate, true);
                                  onUpdate("tips",currentTips);
                                }
                                // Re-confirm after recalc
                                const upd = { ...(data?.tipApprovals ?? {}) };
                                upd[rid] = { ...(upd[rid] ?? {}), [w.monday]: { approvedAt: new Date().toISOString(), approvedBy: currentUser?.id || "admin", approvedByName: currentUser?.name || (isOwner ? "Gestor AppTip" : "Gestor Adm.") } };
                                onUpdate("tipApprovals", upd);
                                onUpdate("_toast",`🔄 Semana recalculada: ${total} empregados atualizados`);
                              }} style={{padding:"5px 10px",borderRadius:8,border:"1px solid #f59e0b44",background:"transparent",color:"#f59e0b",cursor:"pointer",fontSize:11,fontFamily:"'DM Mono',monospace"}}>🔄 Recalcular</button>
                              <button onClick={() => {
                                if (!window.confirm(`Desconfirmar a semana ${fmtDay(w.monday)} — ${fmtDay(w.sunday)}?\n\nOs valores desta semana serão ocultados do extrato do empregado.`)) return;
                                const updated = { ...(data?.tipApprovals ?? {}) };
                                const ridObj = { ...(updated[rid] ?? {}) };
                                delete ridObj[w.monday];
                                updated[rid] = ridObj;
                                onUpdate("tipApprovals", updated);
                              }} style={{padding:"5px 10px",borderRadius:8,border:"1px solid var(--red)33",background:"transparent",color:"var(--red)",cursor:"pointer",fontSize:11,fontFamily:"'DM Mono',monospace"}}>Desconfirmar</button>
                            </>) : (
                              <button onClick={() => {
                                const updated = { ...(data?.tipApprovals ?? {}) };
                                updated[rid] = { ...(updated[rid] ?? {}), [w.monday]: { approvedAt: new Date().toISOString(), approvedBy: currentUser?.id || "admin", approvedByName: currentUser?.name || (isOwner ? "Gestor AppTip" : "Gestor Adm.") } };
                                onUpdate("tipApprovals", updated);
                              }} style={{...S.btnPrimary,fontSize:11,padding:"5px 12px"}}>Confirmar ✅</button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })() : <div/>}

            </div>{/* Fecha grid 2 colunas */}

            {/* Divisão por dia — largura total */}
            {tipDates.length === 0 && <p style={{ color: "var(--text3)", textAlign: "center" }}>Nenhum lançamento neste mês.</p>}
            {tipDates.map(d => {
              const dT = monthTips.filter(t => t.date === d);
              return (
                <div key={d} style={{ ...S.card, marginBottom: 10 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",marginBottom:10 }}>
                    <span style={{color:"var(--text2)"}}>{fmtDate(d)}</span>
                    <div style={{textAlign:"right"}}><div style={{color:"var(--text)",fontSize:12}}>Pool: {pFmt(dT[0]?.poolTotal)}</div><div style={{color:ac,fontSize:12}}>Dist: {pFmt(dT.reduce((a,t)=>a+t.myNet,0))}</div></div>
                  </div>
                  {AREAS.map(a => {
                    const aT = dT.filter(t => t.area === a);
                    if (!aT.length) return null;
                    return (
                      <div key={a} style={{borderTop:"1px solid var(--border)",paddingTop:8,marginTop:8}}>
                        <div style={{marginBottom:4}}><AreaBadge area={a} /></div>
                        {aT.map(t => {
                          const emp = restEmps.find(e => e.id === t.employeeId);
                          return (
                            <div key={t.id} style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",fontSize:12,padding:"4px 0",flexWrap:"wrap",gap:"2px 12px"}}>
                              <span style={{color:"var(--text2)",minWidth:80,flex:"1 1 auto"}}>{emp?.name??"—"}</span>
                              <div style={{display:"flex",gap:8,flexShrink:0,fontSize:11}}>
                                <span style={{color:"var(--text)"}}>{pFmt(t.myShare)}</span>
                                <span style={{color:"var(--red)"}}>-{pFmt(t.myTax)}</span>
                                <span style={{color:ac,fontWeight:700}}>{pFmt(t.myNet)}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                  <button onClick={()=>{
                    const ids=new Set(dT.map(t=>t.id));
                    const preSnap = snapshotTipsMonth(tips, rid, mk);
                    saveVersion("tips", rid, mk, data?.tipVersions, preSnap, currentUser?.name || (isOwner?"Gestor AppTip":"Gestor Adm."), `Remover lançamento (${fmtDate(dT[0]?.date)})`, onUpdate, true);
                    onUpdate("tips",tips.filter(t=>!ids.has(t.id)));
                    onUpdate("_toast","Lançamento removido.");
                  }} style={{marginTop:10,background:"none",border:"1px solid #e74c3c33",borderRadius:8,color:"var(--red)",cursor:"pointer",fontSize:12,padding:"4px 12px",fontFamily:"'DM Mono',monospace"}}>Remover lançamento</button>
                </div>
              );
            })}
          </div>
        )}

        {/* EQUIPE */}
        {tab === "employees" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12,marginBottom:16}}>
              <h3 style={{color:"var(--text)",margin:0,fontSize:mobileOnly?16:20}}>👥 Equipe</h3>
              {isOwner && <button onClick={()=>{
                const emps = employees.filter(e=>e.restaurantId===rid);
                const ok = resetTab("employees","Equipe",()=>({employees:emps}));
                if(ok){ onUpdate("employees",employees.filter(e=>e.restaurantId!==rid)); onUpdate("_toast","🗑️ Equipe enviada para a lixeira"); }
              }} style={{...S.btnSecondary,fontSize:12,color:"var(--red)",borderColor:"var(--red)44"}}>🗑️ Resetar</button>}
            </div>
            <EmployeeSpreadsheet
              restEmps={employees.filter(e => e.restaurantId === rid)}
              restRoles={restRoles} rid={rid}
              employees={employees} onUpdate={onUpdate} restCode={restaurant.shortCode}
              isOwner={isOwner} restaurant={restaurant}
              notifications={data?.notifications??[]}
              privacyMask={privacyMask}
              incidents={data?.incidents??[]} feedbacks={data?.feedbacks??[]}
              devChecklists={data?.devChecklists??{}} schedules={data?.schedules??{}}
              currentUser={currentUser} isLider={isLider} mobileOnly={mobileOnly} roles={roles}
              vtPayments={data?.vtPayments??{}} vtConfig={data?.vtConfig??{}} scheduleStatus={data?.scheduleStatus??{}}
              employeeGoals={data?.employeeGoals??{}}
              delays={data?.delays??{}}
              meetingPlans={data?.meetingPlans??[]}
              onGenerateDismissalReport={async (emp) => {
                try {
                  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
                  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
                  const { jsPDF } = window.jspdf;
                  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
                  const role = restRoles.find(r => r.id === emp.roleId);
                  const demDate = emp.demitidoEm;
                  const admDate = emp.admission || "—";
                  const W = doc.internal.pageSize.getWidth();
                  const H = doc.internal.pageSize.getHeight();
                  const mx = 12; // margin x
                  const cw = W - mx * 2; // content width
                  const f2 = v => { const n = parseFloat(v) || 0; return `R$ ${n.toFixed(2).replace(".",",").replace(/\B(?=(\d{3})+(?!\d))/g,".")}`; };
                  const fmtDate = d => d && d !== "—" ? new Date(d+"T12:00:00").toLocaleDateString("pt-BR") : "—";
                  let y = 0;

                  // ── Accent bar at top ──
                  doc.setFillColor(37, 99, 235);
                  doc.rect(0, 0, W, 4, "F");

                  // ── Header ──
                  y = 12;
                  doc.setFontSize(15);
                  doc.setTextColor(37, 99, 235);
                  doc.setFont(undefined, "bold");
                  doc.text("RELATÓRIO DE DESLIGAMENTO", mx, y);
                  doc.setFontSize(9);
                  doc.setTextColor(120, 120, 120);
                  doc.setFont(undefined, "normal");
                  doc.text(`${restaurant.name}  ·  ${new Date().toLocaleDateString("pt-BR")}`, mx, y + 5);

                  // AppTip logo text right-aligned
                  doc.setFontSize(10);
                  doc.setTextColor(37, 99, 235);
                  doc.setFont(undefined, "bold");
                  doc.text("AppTip", W - mx, y, { align: "right" });
                  doc.setFont(undefined, "normal");
                  y += 10;

                  // Thin separator line
                  doc.setDrawColor(220, 220, 220);
                  doc.setLineWidth(0.3);
                  doc.line(mx, y, W - mx, y);
                  y += 5;

                  // ── Section 1: Employee data (2-column compact layout) ──
                  doc.setFontSize(9);
                  doc.setTextColor(37, 99, 235);
                  doc.setFont(undefined, "bold");
                  doc.text("DADOS DO EMPREGADO", mx, y);
                  doc.setFont(undefined, "normal");
                  y += 1;

                  const empFields = [
                    ["Nome", emp.name], ["CPF", emp.cpf || "—"],
                    ["Código", emp.empCode || "—"], ["Cargo", role?.name || "—"],
                    ["Área", role?.area || "—"], ["Admissão", fmtDate(admDate)],
                    ["Demissão", fmtDate(demDate)], ["Demitido por", emp.demitidoPor || "—"],
                  ];
                  doc.autoTable({
                    startY: y,
                    head: [],
                    body: [
                      [empFields[0][0], empFields[0][1], empFields[1][0], empFields[1][1]],
                      [empFields[2][0], empFields[2][1], empFields[3][0], empFields[3][1]],
                      [empFields[4][0], empFields[4][1], empFields[5][0], empFields[5][1]],
                      [empFields[6][0], empFields[6][1], empFields[7][0], empFields[7][1]],
                    ],
                    theme: "plain",
                    styles: { fontSize: 8, cellPadding: {top:1.5,bottom:1.5,left:2,right:2}, textColor: [50,50,50] },
                    columnStyles: {
                      0: { fontStyle: "bold", cellWidth: 24, textColor: [100,100,100] },
                      1: { cellWidth: cw/2 - 24 },
                      2: { fontStyle: "bold", cellWidth: 24, textColor: [100,100,100] },
                      3: { cellWidth: cw/2 - 24 },
                    },
                    margin: { left: mx, right: mx },
                    tableLineColor: [230,230,230],
                    tableLineWidth: 0.2,
                  });
                  y = doc.lastAutoTable.finalY + 5;

                  // ── Section 2: Gorjetas summary ──
                  doc.setFontSize(9);
                  doc.setTextColor(37, 99, 235);
                  doc.setFont(undefined, "bold");
                  doc.text("GORJETAS — RESUMO MENSAL", mx, y);
                  doc.setFont(undefined, "normal");
                  y += 1;

                  const empTips = tips.filter(t => t.restaurantId === rid && t.employeeId === emp.id);
                  const tipsByMonth = {};
                  empTips.forEach(t => {
                    if (!tipsByMonth[t.monthKey]) tipsByMonth[t.monthKey] = [];
                    tipsByMonth[t.monthKey].push(t);
                  });
                  const sortedMonths = Object.keys(tipsByMonth).sort();

                  let grandBruto = 0, grandDed = 0, grandLiq = 0;
                  const tipSummaryRows = [];
                  sortedMonths.forEach(smk => {
                    const monthTips = tipsByMonth[smk].sort((a,b) => a.date.localeCompare(b.date));
                    const mBruto = monthTips.reduce((s,t) => s + (t.myShare ?? 0), 0);
                    const mDed = monthTips.reduce((s,t) => s + (t.myTax ?? 0), 0);
                    const mLiq = monthTips.reduce((s,t) => s + (t.myNet ?? 0), 0);
                    grandBruto += mBruto; grandDed += mDed; grandLiq += mLiq;
                    tipSummaryRows.push([smk, `${monthTips.length}d`, f2(mBruto), f2(mDed), f2(mLiq)]);
                  });

                  const valColW = (cw - 22 - 14) / 3; // equal width for Bruto/Dedução/Líquido
                  doc.autoTable({
                    startY: y,
                    head: [["Mês", "Dias", "Bruto", "Dedução", "Líquido"]],
                    body: tipSummaryRows,
                    theme: "striped",
                    styles: { fontSize: 7.5, cellPadding: { top: 1.5, bottom: 1.5, left: 3, right: 3 } },
                    headStyles: { fillColor: [37,99,235], fontSize: 7.5, cellPadding: { top: 2, bottom: 2, left: 3, right: 3 } },
                    columnStyles: {
                      0: { cellWidth: 22 },
                      1: { cellWidth: 14, halign: "center" },
                      2: { cellWidth: valColW, halign: "right" },
                      3: { cellWidth: valColW, halign: "right" },
                      4: { cellWidth: valColW, halign: "right" },
                    },
                    alternateRowStyles: { fillColor: [245, 247, 250] },
                    margin: { left: mx, right: mx },
                  });
                  y = doc.lastAutoTable.finalY + 5;

                  // ── Section 3: Day-by-day detail (last month, compact 2-col if > 16 days) ──
                  if (sortedMonths.length > 0) {
                    const lastMk = sortedMonths[sortedMonths.length - 1];
                    const lastTips = tipsByMonth[lastMk].sort((a,b) => a.date.localeCompare(b.date));
                    doc.setFontSize(9);
                    doc.setTextColor(37, 99, 235);
                    doc.setFont(undefined, "bold");
                    doc.text(`DETALHAMENTO DIA A DIA — ${lastMk}`, mx, y);
                    doc.setFont(undefined, "normal");
                    y += 1;

                    if (lastTips.length <= 16) {
                      // Single compact table
                      const ddColW = 22;
                      const ddValW = (cw - ddColW) / 4;
                      doc.autoTable({
                        startY: y,
                        head: [["Data", "Bruto", "Dedução", "Penalidade", "Líquido"]],
                        body: lastTips.map(t => [
                          fmtDate(t.date),
                          f2(t.myShare), f2(t.myTax),
                          t.penalty ? `-${f2(t.penalty)}` : "—", f2(t.myNet),
                        ]),
                        theme: "striped",
                        styles: { fontSize: 6.5, cellPadding: { top: 1, bottom: 1, left: 2, right: 2 } },
                        headStyles: { fillColor: [100,116,139], fontSize: 6.5, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 } },
                        columnStyles: {
                          0: { cellWidth: ddColW },
                          1: { cellWidth: ddValW, halign: "right" },
                          2: { cellWidth: ddValW, halign: "right" },
                          3: { cellWidth: ddValW, halign: "right" },
                          4: { cellWidth: ddValW, halign: "right" },
                        },
                        alternateRowStyles: { fillColor: [248,249,250] },
                        margin: { left: mx, right: mx },
                      });
                      y = doc.lastAutoTable.finalY + 5;
                    } else {
                      // Split into 2 side-by-side tables for compactness
                      const half = Math.ceil(lastTips.length / 2);
                      const col1 = lastTips.slice(0, half);
                      const col2 = lastTips.slice(half);
                      const colW = (cw - 4) / 2;
                      const dcW = 20;
                      const dvW = (colW - dcW) / 2;
                      const colStyles = { fontSize: 6.5, cellPadding: { top: 0.8, bottom: 0.8, left: 1.5, right: 1.5 } };
                      const colHead = { fillColor: [100,116,139], fontSize: 6.5, cellPadding: { top: 1.2, bottom: 1.2, left: 1.5, right: 1.5 } };
                      const mkBody = arr => arr.map(t => [fmtDate(t.date), f2(t.myShare), f2(t.myNet)]);
                      const dColStyles = { 0: { cellWidth: dcW }, 1: { cellWidth: dvW, halign: "right" }, 2: { cellWidth: dvW, halign: "right" } };

                      doc.autoTable({
                        startY: y,
                        head: [["Data", "Bruto", "Líquido"]],
                        body: mkBody(col1),
                        theme: "striped",
                        styles: colStyles,
                        headStyles: colHead,
                        columnStyles: dColStyles,
                        alternateRowStyles: { fillColor: [248,249,250] },
                        margin: { left: mx, right: W - mx - colW },
                        tableWidth: colW,
                      });
                      const y1 = doc.lastAutoTable.finalY;

                      doc.autoTable({
                        startY: y,
                        head: [["Data", "Bruto", "Líquido"]],
                        body: mkBody(col2),
                        theme: "striped",
                        styles: colStyles,
                        headStyles: colHead,
                        columnStyles: dColStyles,
                        alternateRowStyles: { fillColor: [248,249,250] },
                        margin: { left: mx + colW + 4, right: mx },
                        tableWidth: colW,
                      });
                      y = Math.max(y1, doc.lastAutoTable.finalY) + 5;
                    }
                  }

                  // ── Section 4: VT Restitution ──
                  doc.setFontSize(9);
                  doc.setTextColor(37, 99, 235);
                  doc.setFont(undefined, "bold");
                  doc.text("RESTITUIÇÃO DE VALE TRANSPORTE", mx, y);
                  doc.setFont(undefined, "normal");
                  y += 1;

                  const demMk = demDate.slice(0,7);
                  const [demY, demM] = demMk.split("-").map(Number);
                  const demDay = parseInt(demDate.slice(8,10));
                  const daysInDemMonth = new Date(demY, demM, 0).getDate();

                  const vtSnap = data?.vtPayments?.[rid]?.[demMk]?.snapshot?.find(s => s.empId === emp.id);
                  const vtConf = data?.vtConfig?.[rid]?.[emp.id];
                  const dailyRate = vtSnap?.dailyRate ?? vtConf?.dailyRate ?? 0;
                  const schedDayMap = schedules?.[rid]?.[demMk]?.[emp.id] ?? {};

                  let plannedFullMonth = vtSnap?.plannedDays ?? 0;
                  let workedUntilDismissal = 0;
                  if (!vtSnap) {
                    for (let d = 1; d <= daysInDemMonth; d++) {
                      const dateStr = `${demY}-${String(demM).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                      const escalaSt = schedDayMap[dateStr];
                      if (!escalaSt || escalaSt === "comptrab") plannedFullMonth++;
                    }
                  }
                  for (let d = 1; d < demDay && d <= daysInDemMonth; d++) {
                    const dateStr = `${demY}-${String(demM).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                    const escalaSt = schedDayMap[dateStr];
                    if (!escalaSt || escalaSt === "comptrab") workedUntilDismissal++;
                  }

                  const vtPaidMonth = dailyRate * plannedFullMonth;
                  const vtOwed = dailyRate * workedUntilDismissal;
                  const vtToReturn = Math.max(0, vtPaidMonth - vtOwed);

                  const prevDemDate = new Date(demY, demM - 2, 1);
                  const prevDemMk = monthKey(prevDemDate.getFullYear(), prevDemDate.getMonth());
                  const prevDemPayment = data?.vtPayments?.[rid]?.[prevDemMk];
                  let pendingAdjust = 0;
                  if (prevDemPayment?.snapshot) {
                    const prevSnap = prevDemPayment.snapshot.find(s => s.empId === emp.id);
                    if (prevSnap) {
                      const prevLastDay = new Date(prevDemDate.getFullYear(), prevDemDate.getMonth()+1, 0).getDate();
                      const prevSchedMap = schedules?.[rid]?.[prevDemMk]?.[emp.id] ?? {};
                      let prevActual = 0;
                      for (let d = 1; d <= prevLastDay; d++) {
                        const dateStr = `${prevDemDate.getFullYear()}-${String(prevDemDate.getMonth()+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                        const st = prevSchedMap[dateStr];
                        if (!st || st === "comptrab") prevActual++;
                      }
                      pendingAdjust = round2((prevActual - prevSnap.plannedDays) * prevSnap.dailyRate);
                    }
                  }

                  const vtFinalReturn = Math.max(0, vtToReturn - pendingAdjust);
                  const labelW = 30;
                  const vtValW = (cw - labelW * 3) / 3;
                  const vtRows = [
                    ["VT diário", f2(dailyRate), "Dias planejados", String(plannedFullMonth), "Dias até demissão", String(workedUntilDismissal)],
                    ["VT pago (mês)", f2(vtPaidMonth), "VT devido", f2(vtOwed), pendingAdjust !== 0 ? "Ajuste ant." : "", pendingAdjust !== 0 ? f2(pendingAdjust) : ""],
                  ];

                  doc.autoTable({
                    startY: y,
                    head: [],
                    body: vtRows,
                    theme: "plain",
                    styles: { fontSize: 7.5, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 }, textColor: [60,60,60] },
                    columnStyles: {
                      0: { fontStyle: "bold", textColor: [100,100,100], cellWidth: labelW },
                      1: { cellWidth: vtValW, halign: "right" },
                      2: { fontStyle: "bold", textColor: [100,100,100], cellWidth: labelW },
                      3: { cellWidth: vtValW, halign: "right" },
                      4: { fontStyle: "bold", textColor: [100,100,100], cellWidth: labelW },
                      5: { cellWidth: vtValW, halign: "right" },
                    },
                    margin: { left: mx, right: mx },
                  });
                  y = doc.lastAutoTable.finalY + 5;

                  // ── Section 5: Summary highlight boxes ──
                  doc.setDrawColor(220, 220, 220);
                  doc.setLineWidth(0.3);
                  doc.line(mx, y, W - mx, y);
                  y += 4;
                  doc.setFontSize(9);
                  doc.setTextColor(37, 99, 235);
                  doc.setFont(undefined, "bold");
                  doc.text("RESUMO FINANCEIRO", mx, y);
                  doc.setFont(undefined, "normal");
                  y += 4;

                  const boxH = 9;
                  const boxGap = 3;
                  const boxW = (cw - boxGap) / 2;

                  // Row 1: Gorjeta Bruta + Dedução
                  doc.setFillColor(219, 234, 254); // light blue
                  doc.roundedRect(mx, y, boxW, boxH, 1.5, 1.5, "F");
                  doc.setFontSize(7);
                  doc.setTextColor(37, 99, 235);
                  doc.setFont(undefined, "bold");
                  doc.text("GORJETA BRUTA TOTAL", mx + 3, y + 3.5);
                  doc.setFontSize(9);
                  doc.text(f2(grandBruto), mx + boxW - 3, y + 3.5, { align: "right" });
                  doc.setFont(undefined, "normal");

                  const bx12 = mx + boxW + boxGap;
                  doc.setFillColor(254, 226, 226); // light red
                  doc.roundedRect(bx12, y, boxW, boxH, 1.5, 1.5, "F");
                  doc.setFontSize(7);
                  doc.setTextColor(185, 28, 28);
                  doc.setFont(undefined, "bold");
                  const taxPct = (restaurant.taxRate ?? 0.33) * 100;
                  doc.text(`DEDUÇÃO TOTAL GORJETA (${taxPct.toFixed(0)}%)`, bx12 + 3, y + 3.5);
                  doc.setFontSize(9);
                  doc.text(f2(grandDed), bx12 + boxW - 3, y + 3.5, { align: "right" });
                  doc.setFont(undefined, "normal");
                  y += boxH + boxGap;

                  // Row 2: Gorjeta Líquida + VT a Restituir
                  doc.setFillColor(209, 250, 229); // light green
                  doc.roundedRect(mx, y, boxW, boxH, 1.5, 1.5, "F");
                  doc.setFontSize(7);
                  doc.setTextColor(5, 150, 105);
                  doc.setFont(undefined, "bold");
                  doc.text("GORJETA LÍQUIDA TOTAL", mx + 3, y + 3.5);
                  doc.setFontSize(9);
                  doc.text(f2(grandLiq), mx + boxW - 3, y + 3.5, { align: "right" });
                  doc.setFont(undefined, "normal");

                  const bx22 = mx + boxW + boxGap;
                  doc.setFillColor(254, 243, 199); // warm yellow
                  doc.roundedRect(bx22, y, boxW, boxH, 1.5, 1.5, "F");
                  doc.setFontSize(7);
                  doc.setTextColor(180, 83, 9);
                  doc.setFont(undefined, "bold");
                  doc.text("VT A RESTITUIR", bx22 + 3, y + 3.5);
                  doc.setFontSize(9);
                  doc.setTextColor(220, 50, 50);
                  doc.text(f2(vtFinalReturn), bx22 + boxW - 3, y + 3.5, { align: "right" });
                  doc.setFont(undefined, "normal");
                  y += boxH + 6;

                  // ── Footer: accent bar + text ──
                  doc.setFillColor(37, 99, 235);
                  doc.rect(0, H - 3, W, 3, "F");
                  doc.setFontSize(7);
                  doc.setTextColor(150,150,150);
                  doc.text(`AppTip  ·  Relatório de Desligamento  ·  ${emp.name}  ·  ${fmtDate(demDate)}`, W/2, H - 6, { align: "center" });

                  const safeName = emp.name.replace(/[^a-zA-Z0-9]/g,"_").toLowerCase();
                  setPreviewDoc(doc); setPreviewFileName(`relatorio_desligamento_${safeName}_${demDate}.pdf`);
                  onUpdate("_toast", `📄 Relatório de ${emp.name} exportado!`);
                } catch (err) {
                  console.error("Erro ao gerar relatório:", err);
                  onUpdate("_toast", "⚠️ Erro ao gerar relatório: " + (err.message || "desconhecido"));
                }
              }}
            />
          </div>
        )}

        {/* REUNIÕES — Planejamento de reuniões */}
        {tab === "reunioes" && (() => {
          const restEmps = employees.filter(e => e.restaurantId === rid && !e.inactive);
          const areas = [...new Set(restRoles.map(r => r.area).filter(Boolean))];
          const plans = (data?.meetingPlans ?? []).filter(p => p.restaurantId === rid).sort((a,b) => (b.plannedDate??"").localeCompare(a.plannedDate??""));
          // Form state via refs is not possible in this inline pattern, so we use a sub-component approach
          // We'll render a self-contained section
          return (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12,marginBottom:16}}>
                <h3 style={{color:"var(--text)",margin:0,fontSize:mobileOnly?16:20}}>📅 Reuniões</h3>
              </div>
              <MeetingPlannerSection
                restaurantId={rid}
                employees={restEmps}
                roles={restRoles}
                areas={areas}
                meetingPlans={plans}
                allMeetingPlans={data?.meetingPlans ?? []}
                feedbacks={data?.feedbacks ?? []}
                onUpdate={onUpdate}
                currentUser={currentUser}
                isOwner={isOwner}
                mobileOnly={mobileOnly}
              />
            </div>
          );
        })()}

        {/* CARGOS (super only) */}
        {tab === "roles" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12,marginBottom:16}}>
              <h3 style={{color:"var(--text)",margin:0,fontSize:mobileOnly?16:20}}>🏷️ Cargos</h3>
              {isOwner && <button onClick={()=>{
                const ok = resetTab("roles","Cargos",()=>({roles:roles.filter(r=>r.restaurantId===rid)}));
                if(ok){ onUpdate("roles",roles.filter(r=>r.restaurantId!==rid)); onUpdate("_toast","🗑️ Cargos enviados para a lixeira"); }
              }} style={{...S.btnSecondary,fontSize:12,color:"var(--red)",borderColor:"var(--red)44"}}>🗑️ Resetar</button>}
            </div>
            <RoleSpreadsheet
              restRoles={restRoles} rid={rid}
              roles={roles} employees={employees} onUpdate={onUpdate}
            />
          </div>
        )}

        {/* ESCALA */}
        {tab === "schedule" && (
          <div>
            {/* Header */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12,marginBottom:schedDirty?8:16}}>
              <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <h3 style={{color:"var(--text)",margin:0,fontSize:mobileOnly?16:20}}>📅 Escala — {monthLabel(year,month)}</h3>
                {monthClosed && <span style={{fontSize:11,padding:"3px 10px",borderRadius:6,background:"var(--red)22",color:"var(--red)",fontWeight:700}}>Mes fechado</span>}
                {(() => { const vtPaidInfo = data?.vtPayments?.[rid]?.[mk]; return vtPaidInfo ? <span style={{fontSize:11,padding:"3px 10px",borderRadius:6,background:"#10b98122",color:"var(--green)",fontWeight:700}}>VT pago em {new Date(vtPaidInfo.paidAt).toLocaleDateString("pt-BR")}</span> : null; })()}
                <div style={{display:"flex",borderRadius:6,overflow:"hidden",border:"1px solid var(--border)"}}>
                  {["vigente","prevista"].map(mode => (
                    <button key={mode} onClick={()=>setSchedViewMode(mode)}
                      style={{padding:"4px 12px",fontSize:11,fontWeight:schedViewMode===mode?700:500,border:"none",background:schedViewMode===mode?"var(--ac)22":"transparent",color:schedViewMode===mode?"var(--ac)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                      {mode === "vigente" ? "Vigente" : "Prevista"}
                    </button>
                  ))}
                </div>
              </div>
              {isOwner && !mobileOnly && <button onClick={()=>{
                if (schedDirty && !window.confirm("Você tem edições não salvas. Deseja descartar e resetar?")) return;
                const ok = resetTab("schedule","Escala",()=>({schedules:schedules?.[rid]}));
                if(ok){ const s={...schedules}; delete s[rid]; onUpdate("schedules",s); setSchedLocalEdits(null); onUpdate("_toast","🗑️ Escala enviada para a lixeira"); }
              }} style={{...S.btnSecondary,fontSize:12,color:"var(--red)",borderColor:"var(--red)44"}}>🗑️ Reset</button>}
            </div>
            {/* Pending edits banner */}
            {schedDirty && (
              <div style={{background:"#f59e0b15",border:"1px solid #f59e0b44",borderRadius:10,padding:mobileOnly?"10px 12px":"12px 16px",marginBottom:12,display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,flexWrap:"wrap"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:16}}>✏️</span>
                  <span style={{color:"#f59e0b",fontSize:mobileOnly?12:13,fontWeight:600}}>Edições pendentes</span>
                  <span style={{color:"var(--text3)",fontSize:mobileOnly?10:11}}>— salve para criar nova versão</span>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>{
                    // Freeze prevista on first adjustment
                    if (!data?.schedulePrevista?.[rid]?.[mk]) {
                      const frozenPrevista = JSON.parse(JSON.stringify(schedules?.[rid]?.[mk] ?? {}));
                      const newPrev = { ...(data?.schedulePrevista ?? {}) };
                      if (!newPrev[rid]) newPrev[rid] = {};
                      newPrev[rid][mk] = frozenPrevista;
                      onUpdate("schedulePrevista", newPrev);
                    }
                    // Save as new version
                    const preSnap = snapshotSchedulesMonth(schedules, rid, mk);
                    saveVersion("schedules", rid, mk, data?.scheduleVersions, preSnap, currentUser?.name || (isOwner?"Gestor AppTip":"Gestor Adm."), "Edição manual", onUpdate, true);
                    // Record adjustments for Phase 2
                    const adjAuthor = currentUser?.name || (isOwner?"Gestor AppTip":"Gestor Adm.");
                    const adjTimestamp = new Date().toISOString();
                    const newAdjs = [];
                    Object.entries(schedLocalEdits).forEach(([eid, dayEdits]) => {
                      Object.entries(dayEdits).forEach(([dt, val]) => {
                        const fromVal = schedules?.[rid]?.[mk]?.[eid]?.[dt] ?? "";
                        newAdjs.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`, empId: eid, date: dt, from: fromVal, to: val ?? "", author: adjAuthor, timestamp: adjTimestamp });
                      });
                    });
                    if (newAdjs.length > 0) {
                      const curAdjs = { ...(data?.scheduleAdjustments ?? {}) };
                      if (!curAdjs[rid]) curAdjs[rid] = {};
                      curAdjs[rid][mk] = [...(curAdjs[rid][mk] ?? []), ...newAdjs];
                      onUpdate("scheduleAdjustments", curAdjs);
                    }
                    // Apply local edits to schedules
                    let newMonth = { ...(schedules?.[rid]?.[mk] ?? {}) };
                    Object.entries(schedLocalEdits).forEach(([eid, dayEdits]) => {
                      const empMap = { ...(newMonth[eid] ?? {}) };
                      Object.entries(dayEdits).forEach(([dt, val]) => {
                        if (val === null) delete empMap[dt]; else empMap[dt] = val;
                      });
                      newMonth[eid] = empMap;
                    });
                    onUpdate("schedules", {
                      ...schedules,
                      [rid]: { ...(schedules?.[rid]??{}), [mk]: newMonth }
                    });
                    setSchedLocalEdits(null);
                    onUpdate("_toast", "✅ Escala salva como nova versão");
                  }} style={{...S.btnPrimary,fontSize:mobileOnly?11:12,padding:mobileOnly?"8px 14px":"8px 18px",fontWeight:700}}>
                    💾 {mobileOnly?"Salvar":"Salvar nova versão"}
                  </button>
                  <button onClick={()=>{
                    if (window.confirm("Descartar todas as edições pendentes?")) setSchedLocalEdits(null);
                  }} style={{...S.btnSecondary,fontSize:mobileOnly?11:12,padding:mobileOnly?"8px 10px":"8px 14px"}}>
                    Descartar
                  </button>
                </div>
              </div>
            )}
            {/* Area filter */}
            <div style={{marginBottom:12}}>
              <PillBar options={["Todos", ...AREAS]} value={schedArea} onChange={setSchedArea}/>
            </div>
            <div style={{display:"flex",gap:mobileOnly?4:8,flexWrap:"wrap",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
              <div style={{display:"flex",gap:mobileOnly?4:8,flexWrap:"wrap"}}>

                {/* Pre-fill contract days off */}
                <button onClick={()=>{
                  const emps = areaEmps;
                  if (!emps.length) return;
                  const mesNome = monthLabel(year, month);
                  if (!window.confirm(`Aplicar folgas do contrato em ${mesNome}?\n\nIsso vai:\n• Marcar como Folga todos os dias do contrato\n• Remover folgas marcadas em dias que NÃO são de folga no contrato\n\nOutros status (férias, faltas, compensações) não serão alterados.`)) return;
                  const daysInMonth = new Date(year, month+1, 0).getDate();
                  let added = 0, removed = 0;
                  const bulkEdits = {};
                  emps.forEach(emp => {
                    const empScheds = data?.workSchedules?.[rid]?.[emp.id] ?? [];
                    const currentSched = empScheds[empScheds.length - 1];
                    if (!currentSched) return;
                    const folgaDays = new Set([0,1,2,3,4,5,6].filter(d => !currentSched.days[d]));
                    const empDayMap = { ...(effectiveMonth[emp.id] ?? {}) };
                    const empEdits = {};
                    for (let d = 1; d <= daysInMonth; d++) {
                      const date = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                      const weekday = new Date(date+"T12:00:00").getDay();
                      const current = empDayMap[date];
                      if (folgaDays.has(weekday)) {
                        if (!current) { empEdits[date] = DAY_OFF; added++; }
                      } else {
                        if (current === DAY_OFF) { empEdits[date] = null; removed++; }
                      }
                    }
                    if (Object.keys(empEdits).length) bulkEdits[emp.id] = empEdits;
                  });
                  if (Object.keys(bulkEdits).length) {
                    setSchedLocalEdits(prev => {
                      const edits = prev ? { ...prev } : {};
                      Object.entries(bulkEdits).forEach(([eid, dayMap]) => {
                        edits[eid] = { ...(edits[eid] ?? {}), ...dayMap };
                      });
                      return edits;
                    });
                  }
                  const parts = [];
                  if (added) parts.push(`${added} folga(s) adicionada(s)`);
                  if (removed) parts.push(`${removed} folga(s) removida(s) fora do contrato`);
                  onUpdate("_toast", parts.length ? `✅ ${parts.join(" · ")} — salve para confirmar` : "Escala já está de acordo com o contrato");
                }} style={{...S.btnSecondary,fontSize:mobileOnly?11:12,color:"var(--red)",borderColor:"var(--red)44",whiteSpace:"nowrap"}}>
                  {mobileOnly?"📅 Folgas":"📅 Folgas do contrato"}
                </button>
                {/* Reiniciar escala */}
                <button onClick={()=>{
                  const mesNome = monthLabel(year, month);
                  const n = areaEmps.length;
                  if (!n) return;
                  if (!window.confirm(`Reiniciar escala de ${mesNome}?\n\nTodos os ${n} empregado(s) ${schedArea==="Todos"?"":"da área "+schedArea+" "}voltarão ao status "Trabalho" em todos os dias.\n\nIsso remove folgas, freelas, férias, faltas e compensações do mês.\n\nSalve a escala para confirmar a alteração.`)) return;
                  // Accumulate reset as local edits — null each existing day status
                  const resetEdits = {};
                  areaEmps.forEach(emp => {
                    const empDayMap = effectiveMonth[emp.id] ?? {};
                    const empNulls = {};
                    Object.keys(empDayMap).forEach(date => { empNulls[date] = null; });
                    if (Object.keys(empNulls).length) resetEdits[emp.id] = empNulls;
                  });
                  if (Object.keys(resetEdits).length) {
                    setSchedLocalEdits(prev => {
                      const edits = prev ? { ...prev } : {};
                      Object.entries(resetEdits).forEach(([eid, dayMap]) => {
                        edits[eid] = { ...(edits[eid] ?? {}), ...dayMap };
                      });
                      return edits;
                    });
                  }
                  onUpdate("_toast", `🔄 Escala de ${mesNome} reiniciada para ${n} empregado(s) — salve para confirmar`);
                }} style={{...S.btnSecondary,fontSize:mobileOnly?11:12,color:"var(--red)",borderColor:"var(--red)44",whiteSpace:"nowrap"}}>
                  {mobileOnly?"🔄 Reiniciar":"🔄 Reiniciar escala"}
                </button>

                {/* Marcar férias */}
                <button onClick={()=>{setShowVacForm(!showVacForm);setVacEmpId("");setVacFrom("");setVacTo("");}}
                  style={{...S.btnSecondary,fontSize:mobileOnly?11:12,border:`1px solid ${showVacForm?"#8b5cf6":"#8b5cf644"}`,background:showVacForm?"#8b5cf622":"transparent",color:"#8b5cf6",whiteSpace:"nowrap"}}>
                  {mobileOnly?"🏖️ Férias":"🏖️ Marcar férias"}
                </button>

                {/* Importar folha de ponto */}
                <button onClick={()=>{if(monthClosed)return;setShowPontoImport(!showPontoImport);setPontoError("");setPontoPreview(null);setPontoResolutions({});setPontoMissingReasons({});}}
                  disabled={monthClosed}
                  style={{...S.btnSecondary,fontSize:mobileOnly?11:12,border:`1px solid ${showPontoImport?"var(--ac)":"var(--ac)"}`,background:showPontoImport?"var(--ac)22":"transparent",color:"var(--ac)",whiteSpace:"nowrap",opacity:monthClosed?0.4:1}}>
                  {mobileOnly?"📄 Ponto":"📄 Importar ponto"}
                </button>

                {/* Registrar atrasos */}
                <button onClick={()=>{setShowDelayForm(!showDelayForm);setDelayEmpId("");setDelayInputs({});}}
                  style={{...S.btnSecondary,fontSize:mobileOnly?11:12,border:`1px solid ${showDelayForm?"#f59e0b":"#f59e0b44"}`,background:showDelayForm?"#f59e0b22":"transparent",color:"#f59e0b",whiteSpace:"nowrap"}}>
                  {mobileOnly?"⏰ Atrasos":"⏰ Registrar atrasos"}
                </button>

                {/* Histórico — só Admin e DP */}
                {(isOwner || isDP) && (() => {
                  const vCount = (data?.scheduleVersions?.[rid]?.[mk] ?? []).length;
                  return (
                    <button onClick={()=>setShowSchedHistory(true)}
                      title="Ver e restaurar versões anteriores desta escala"
                      style={{...S.btnSecondary,fontSize:mobileOnly?11:12,color:"var(--ac-text)",borderColor:"var(--ac)44",whiteSpace:"nowrap"}}>
                      🕐 Histórico{vCount>0?` (${vCount})`:""}
                    </button>
                  );
                })()}

                {/* Fechar / Reabrir mês */}
                {(isOwner || isDP) && !monthClosed && (
                  <button onClick={()=>{
                    const hasPonto = !!(data?.scheduleStatus?.[rid]?.[mk]?.lastPontoImport);
                    if (!hasPonto && !window.confirm("Nenhum ponto importado para este mes. Deseja fechar mesmo assim?")) return;
                    // Phase 4: compute delta and show confirm modal
                    const curSched = effectiveMonth;
                    const prevSched = schedules?.[rid]?.[mk] ?? {};
                    const daysInM = new Date(year, month + 1, 0).getDate();
                    const delta = {};
                    schedEmps.forEach(emp => {
                      let prevWork = 0, curWork = 0;
                      for (let d = 1; d <= daysInM; d++) {
                        const dt = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                        const isDem = emp.demitidoEm && dt >= emp.demitidoEm;
                        if (isDem) continue;
                        const ps = prevSched[emp.id]?.[dt];
                        const cs = curSched[emp.id]?.[dt];
                        if (!ps || ps === "comptrab") prevWork++;
                        if (!cs || cs === "comptrab") curWork++;
                      }
                      if (prevWork !== curWork) {
                        delta[emp.id] = { name: emp.name, prevWork, curWork, diff: curWork - prevWork };
                      }
                    });
                    // Compute VT impact
                    const vtPayment = data?.vtPayments?.[rid]?.[mk];
                    const vtImpact = {};
                    if (vtPayment?.snapshot) {
                      const daysInM2 = new Date(year, month + 1, 0).getDate();
                      vtPayment.snapshot.forEach(snap => {
                        let actualDays = 0;
                        for (let d2 = 1; d2 <= daysInM2; d2++) {
                          const dt2 = `${year}-${String(month+1).padStart(2,"0")}-${String(d2).padStart(2,"0")}`;
                          const emp2 = schedEmps.find(e => e.id === snap.empId);
                          if (emp2?.demitidoEm && dt2 >= emp2.demitidoEm) continue;
                          const cs2 = effectiveMonth[snap.empId]?.[dt2];
                          if (!cs2 || cs2 === "comptrab") actualDays++;
                        }
                        if (actualDays !== snap.plannedDays) {
                          vtImpact[snap.empId] = { name: snap.name, plannedDays: snap.plannedDays, actualDays, diff: actualDays - snap.plannedDays, dailyRate: snap.dailyRate, adjustValue: parseFloat(((actualDays - snap.plannedDays) * snap.dailyRate).toFixed(2)) };
                        }
                      });
                    }
                    setCloseVtImpact(Object.keys(vtImpact).length > 0 ? vtImpact : null);
                    if (Object.keys(delta).length > 0 || Object.keys(vtImpact).length > 0) {
                      setCloseDelta(Object.keys(delta).length > 0 ? delta : null);
                      setShowCloseConfirm(true);
                    } else {
                      // No delta, close directly
                      const newStatus = { ...(data?.scheduleStatus ?? {}) };
                      if (!newStatus[rid]) newStatus[rid] = {};
                      newStatus[rid][mk] = { ...(newStatus[rid][mk] ?? {}), status: "closed", closedAt: new Date().toISOString(), closedBy: currentUser?.name || "Gestor AppTip" };
                      onUpdate("scheduleStatus", newStatus);
                      onUpdate("_toast", "Mes fechado com sucesso");
                    }
                  }}
                    style={{...S.btnSecondary,fontSize:mobileOnly?11:12,color:"var(--green)",borderColor:"var(--green)44",whiteSpace:"nowrap"}}>
                    {mobileOnly ? "Fechar" : "Fechar Mes"}
                  </button>
                )}
                {monthClosed && (isOwner || isDP) && (
                  <button onClick={()=>setShowReopenConfirm(true)}
                    style={{...S.btnSecondary,fontSize:mobileOnly?11:12,color:"#f59e0b",borderColor:"#f59e0b44",whiteSpace:"nowrap"}}>
                    Reabrir
                  </button>
                )}
              </div>

              {/* Month close confirmation modal — Phase 4 */}
              {showCloseConfirm && (
                <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setShowCloseConfirm(false)}>
                  <div onClick={e=>e.stopPropagation()} style={{background:"var(--bg2)",borderRadius:16,padding:24,maxWidth:520,width:"100%",maxHeight:"80vh",overflowY:"auto",border:"1px solid var(--border)"}}>
                    <h3 style={{color:"var(--text)",margin:"0 0 12px",fontSize:16}}>Confirmar fechamento do mes</h3>
                    <p style={{color:"var(--text2)",fontSize:13,margin:"0 0 12px"}}>Foram detectadas diferencas entre a escala prevista e a vigente:</p>
                    <div style={{maxHeight:300,overflowY:"auto",marginBottom:16}}>
                      {closeDelta && Object.entries(closeDelta).map(([empId, d]) => (
                        <div key={empId} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",borderRadius:8,background:"var(--bg1)",marginBottom:4,border:"1px solid var(--border)"}}>
                          <span style={{color:"var(--text)",fontSize:13,fontWeight:600}}>{d.name}</span>
                          <div style={{display:"flex",gap:12,alignItems:"center"}}>
                            <span style={{color:"var(--text3)",fontSize:12}}>Antes: {d.prevWork}d</span>
                            <span style={{color:"var(--text3)",fontSize:10}}>-&gt;</span>
                            <span style={{color:d.diff>0?"var(--green)":"var(--red)",fontSize:12,fontWeight:700}}>Depois: {d.curWork}d ({d.diff>0?"+":""}{d.diff})</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p style={{color:"#f59e0b",fontSize:12,margin:"0 0 16px"}}>As gorjetas serao recalculadas com base na escala vigente.</p>
                    {closeVtImpact && Object.keys(closeVtImpact).length > 0 && (
                      <div style={{marginTop:12}}>
                        <p style={{color:"var(--text)",fontSize:13,fontWeight:700,marginBottom:8}}>Impacto no VT</p>
                        {Object.entries(closeVtImpact).map(([empId, v]) => (
                          <div key={empId} style={{display:"flex",justifyContent:"space-between",padding:"6px 12px",borderRadius:8,background:v.adjustValue>0?"#10b98109":"#e74c3c09",border:`1px solid ${v.adjustValue>0?"#10b98133":"#e74c3c33"}`,marginBottom:4}}>
                            <span style={{color:"var(--text)",fontSize:12}}>{v.name}</span>
                            <span style={{fontSize:12,color:v.adjustValue>0?"var(--green)":"var(--red)",fontWeight:700}}>
                              {v.plannedDays}d pago {"\u2192"} {v.actualDays}d real = {v.adjustValue>0?"+":""}R$ {Math.abs(v.adjustValue).toFixed(2).replace(".",",")}
                            </span>
                          </div>
                        ))}
                        <p style={{color:"var(--text3)",fontSize:11,marginTop:6}}>Esses ajustes serão aplicados no próximo ciclo de VT.</p>
                      </div>
                    )}
                    <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                      <button onClick={()=>setShowCloseConfirm(false)} style={S.btnSecondary}>Cancelar</button>
                      <button onClick={()=>{
                        // Close the month and persist
                        const newStatus = { ...(data?.scheduleStatus ?? {}) };
                        if (!newStatus[rid]) newStatus[rid] = {};
                        newStatus[rid][mk] = { ...(newStatus[rid][mk] ?? {}), status: "closed", closedAt: new Date().toISOString(), closedBy: currentUser?.name || "Gestor AppTip" };
                        onUpdate("scheduleStatus", newStatus);
                        // Save effective schedule as the final schedule
                        const finalMonth = { ...effectiveMonth };
                        onUpdate("schedules", { ...schedules, [rid]: { ...(schedules?.[rid] ?? {}), [mk]: finalMonth } });
                        setSchedLocalEdits(null);
                        setShowCloseConfirm(false);
                        setCloseDelta(null);
                        setCloseVtImpact(null);
                        onUpdate("_toast", "Mes fechado e gorjetas ajustadas");
                      }} style={{...S.btnPrimary,fontSize:13}}>
                        Confirmar e fechar
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Reopen confirmation modal */}
              {showReopenConfirm && (
                <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.6)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={()=>setShowReopenConfirm(false)}>
                  <div onClick={e=>e.stopPropagation()} style={{background:"var(--bg2)",borderRadius:16,padding:24,maxWidth:480,width:"100%",border:"1px solid #f59e0b44"}}>
                    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
                      <span style={{fontSize:24}}>⚠️</span>
                      <h3 style={{color:"#f59e0b",margin:0,fontSize:16}}>Reabrir escala fechada</h3>
                    </div>
                    <p style={{color:"var(--text2)",fontSize:13,margin:"0 0 14px",lineHeight:1.6}}>
                      Ao reabrir a escala de <strong>{monthLabel(year, month)}</strong>, as edições voltarão a ser permitidas. Considere as seguintes consequências:
                    </p>
                    <div style={{background:"#f59e0b08",border:"1px solid #f59e0b22",borderRadius:10,padding:14,marginBottom:16}}>
                      <div style={{fontSize:12,color:"var(--text2)",lineHeight:1.8}}>
                        <div style={{marginBottom:8,display:"flex",gap:8}}><span>📊</span><span><strong>Gorjetas não serão recalculadas automaticamente.</strong> Se a escala for alterada, será necessário recalcular manualmente na aba Gorjeta.</span></div>
                        <div style={{marginBottom:8,display:"flex",gap:8}}><span>🚌</span><span><strong>Ajustes de VT já foram processados.</strong> Alterações na escala não desfazem ajustes de vale-transporte já aplicados ao fechar.</span></div>
                        <div style={{display:"flex",gap:8}}><span>👁️</span><span><strong>Semanas já confirmadas continuam visíveis</strong> para empregados que têm acesso à gorjeta.</span></div>
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                      <button onClick={()=>setShowReopenConfirm(false)} style={S.btnSecondary}>Cancelar</button>
                      <button onClick={()=>{
                        const newStatus = { ...(data?.scheduleStatus ?? {}) };
                        if (!newStatus[rid]) newStatus[rid] = {};
                        newStatus[rid][mk] = { ...(newStatus[rid][mk] ?? {}), status: "open", closedAt: null, closedBy: null };
                        onUpdate("scheduleStatus", newStatus);
                        setShowReopenConfirm(false);
                        onUpdate("_toast", "Mês reaberto com sucesso");
                      }} style={{...S.btnPrimary,fontSize:13,background:"#f59e0b",borderColor:"#f59e0b"}}>
                        Reabrir mês
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Modal de histórico da escala */}
              {showSchedHistory && (
                <VersionHistoryModal
                  title={`🕐 Histórico da Escala — ${monthLabel(year, month)}`}
                  versions={data?.scheduleVersions?.[rid]?.[mk]}
                  onClose={()=>setShowSchedHistory(false)}
                  onRestore={(v)=>{
                    // Salva o estado atual como nova versão (pra poder desfazer o restore)
                    const curSnap = snapshotSchedulesMonth(schedules, rid, mk);
                    saveVersion("schedules", rid, mk, data?.scheduleVersions, curSnap, currentUser?.name || (isOwner?"Gestor AppTip":"Gestor Adm."), `Antes de restaurar "${v.reason}"`, onUpdate, true);
                    // Aplica a versão restaurada
                    const newSched = JSON.parse(JSON.stringify(schedules ?? {}));
                    if (!newSched[rid]) newSched[rid] = {};
                    newSched[rid][mk] = JSON.parse(JSON.stringify(v.snapshot ?? {}));
                    onUpdate("schedules", newSched);
                    setSchedLocalEdits(null);
                    setShowSchedHistory(false);
                    onUpdate("_toast", `♻️ Escala restaurada para "${v.reason}" (${fmtRelTime(v.ts)})`);
                  }}
                />
              )}

              {/* PDF export — à direita (desktop only) */}
              {!mobileOnly && <button onClick={async () => {
                  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
                  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
                  const { jsPDF } = window.jspdf;
                  const doc = new jsPDF({ orientation:"landscape", unit:"mm", format:"a4" });
                  const daysInMonth = new Date(year, month+1, 0).getDate();
                  const PDF_STATUS_COLORS = {
                    work: [39,174,96],
                    off:  [231,76,60],
                    freela:[6,182,212],
                    comp: [59,130,246],
                    comptrab:[14,165,233],
                    vac:  [139,92,246],
                    faultj:[245,158,11],
                    faultu:[180,30,30],
                  };

                  doc.setFontSize(11);
                  doc.setTextColor(30,30,30);
                  doc.text(`Escala — ${schedArea} — ${monthLabel(year,month)} — ${restaurant.name}`, 14, 12);

                  const legend = [
                    ["T  Trabalho", PDF_STATUS_COLORS.work],
                    ["F  Folga", PDF_STATUS_COLORS.off],
                    ["FL  Freela", PDF_STATUS_COLORS.freela],
                    ["FC  Folga Comp.", PDF_STATUS_COLORS.comp],
                    ["TC  Trab. Comp.", PDF_STATUS_COLORS.comptrab],
                    ["FÉR  Férias", PDF_STATUS_COLORS.vac],
                    ["FJ  Falta Just.", PDF_STATUS_COLORS.faultj],
                    ["FI  Falta Injust.", PDF_STATUS_COLORS.faultu],
                  ];
                  let lx = 14;
                  legend.forEach(([lbl, col]) => {
                    doc.setFillColor(...col);
                    doc.rect(lx, 15, 3, 3, "F");
                    doc.setFontSize(6);
                    doc.setTextColor(30,30,30);
                    doc.text(lbl, lx+4, 17.5);
                    lx += 38;
                  });

                  const head = [["Empregado", ...Array.from({length:daysInMonth},(_,i)=>String(i+1)), "T"]];
                  const areasToExport = schedArea === "Todos" ? AREAS.filter(a => areaEmps.some(e => { const r = restRoles.find(x=>x.id===e.roleId); return r?.area === a; })) : [schedArea];

                  function buildAreaBody(empsForArea) {
                    return empsForArea.map(emp => {
                      const role = restRoles.find(r=>r.id===emp.roleId);
                      const dayMap = effectiveMonth[emp.id] ?? {};
                      let workDays = 0;
                      const dayCells = Array.from({length:daysInMonth},(_,i)=>{
                        const k = `${year}-${String(month+1).padStart(2,"0")}-${String(i+1).padStart(2,"0")}`;
                        const s = dayMap[k];
                        if(!s) { workDays++; return "T"; }
                        return STATUS_SHORT[s] ?? "";
                      });
                      return [`${emp.name}\n${role?.name??""}`, ...dayCells, String(workDays)];
                    });
                  }

                  const drawTable = (body, startY, empsForArea) => {
                    doc.autoTable({
                      head, body,
                      startY,
                      styles: { fontSize: 6, cellPadding: 1.2, halign:"center", textColor:[255,255,255], lineColor:[180,180,180], lineWidth:0.1 },
                      headStyles: { fillColor:[40,40,40], textColor:[220,220,220], fontStyle:"bold", fontSize:6 },
                      columnStyles: { 0: { halign:"left", cellWidth:30, fontSize:6.5, textColor:[30,30,30] } },
                      didDrawCell: (data) => {
                        if(data.section==="body" && data.column.index > 0 && data.column.index <= daysInMonth) {
                          const dayIdx = data.column.index - 1;
                          const emp = empsForArea[data.row.index];
                          if(!emp) return;
                          const k = `${year}-${String(month+1).padStart(2,"0")}-${String(dayIdx+1).padStart(2,"0")}`;
                          const s = (effectiveMonth[emp.id] ?? {})[k];
                          const {x,y,width,height} = data.cell;
                          const color = !s ? PDF_STATUS_COLORS.work : PDF_STATUS_COLORS[s];
                          const label = !s ? "T" : (STATUS_SHORT[s] ?? "");
                          if(color) {
                            doc.setFillColor(...color);
                            doc.rect(x,y,width,height,"F");
                            doc.setTextColor(255,255,255);
                            doc.setFontSize(5);
                            doc.text(label, x+width/2, y+height/2+1.2, {align:"center"});
                          }
                        }
                        if(data.section==="body" && data.column.index === daysInMonth+1) {
                          const {x,y,width,height} = data.cell;
                          doc.setFillColor(40,40,40);
                          doc.rect(x,y,width,height,"F");
                          doc.setTextColor(245,200,66);
                          doc.setFontSize(6);
                          doc.text(data.cell.text[0]??"", x+width/2, y+height/2+1.2, {align:"center"});
                        }
                      },
                      theme: "grid",
                    });
                    return doc.lastAutoTable.finalY;
                  };

                  let curY = 21;
                  areasToExport.forEach((area, aIdx) => {
                    const empsForArea = schedArea === "Todos"
                      ? areaEmps.filter(e => { const r = restRoles.find(x=>x.id===e.roleId); return r?.area === area; })
                      : areaEmps;
                    if (empsForArea.length === 0) return;
                    if (schedArea === "Todos") {
                      if (aIdx > 0 && curY > 170) { doc.addPage(); curY = 12; }
                      doc.setFontSize(9);
                      doc.setTextColor(60,60,60);
                      doc.text(`▸ ${area.toUpperCase()} (${empsForArea.length})`, 14, curY + 2);
                      curY += 5;
                    }
                    const body = buildAreaBody(empsForArea);
                    curY = drawTable(body, curY, empsForArea) + 4;
                  });

                  setPreviewDoc(doc); setPreviewFileName(`escala_${schedArea}_${year}_${String(month+1).padStart(2,"0")}.pdf`);
                }} style={{padding:"8px 12px",borderRadius:10,border:"1px solid var(--border)",background:"transparent",color:"var(--text2)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12,whiteSpace:"nowrap"}}>
                📄 Exportar PDF
              </button>}
            </div>

            {/* Legend */}
            <div style={{display:"flex",gap:mobileOnly?0:8,flexWrap:mobileOnly?"nowrap":"wrap",justifyContent:mobileOnly?"space-between":"flex-start",marginBottom:12}}>
              {[["var(--green)","T","Trabalho"],["var(--red)","F","Folga"],["#06b6d4","FL","Freela"],["#3b82f6","FC","Folga Comp."],["#0ea5e9","TC","Trab. Comp."],["#8b5cf6","Fér","Férias"],["#f59e0b","FJ","F.Just."],["var(--red)","FI","F.Inj."]].map(([c,s,l])=>(
                <div key={s} style={{display:"flex",alignItems:"center",gap:mobileOnly?1:3,flexShrink:0}}>
                  <div style={{width:mobileOnly?14:20,height:mobileOnly?14:16,borderRadius:3,background:c+"33",border:`1px solid ${c}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <span style={{color:c,fontSize:mobileOnly?7:9,fontWeight:700}}>{s}</span>
                  </div>
                  {!mobileOnly && <span style={{color:"var(--text3)",fontSize:10,fontFamily:"'DM Mono',monospace"}}>{l}</span>}
                </div>
              ))}
            </div>

            {/* ═══ Importar folha de ponto ═══ */}
            {showPontoImport && (
              <div style={{...S.card,marginBottom:14,border:"1px solid var(--ac)44",background:"var(--ac)06"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <span style={{fontSize:18}}>📄</span>
                  <div>
                    <div style={{color:"var(--ac)",fontWeight:700,fontSize:14}}>Importar folha de ponto</div>
                    <div style={{color:"var(--text3)",fontSize:11}}>Upload do PDF da folha de ponto — compara automaticamente com a escala e detecta divergências</div>
                  </div>
                </div>

                {!pontoPreview && (
                  <div>
                    {/* System selector */}
                    <div style={{marginBottom:10,display:"flex",alignItems:"center",gap:8}}>
                      <label style={{color:"var(--text3)",fontSize:12,fontWeight:500}}>Sistema de ponto:</label>
                      <select value={pontoSystem} onChange={e=>setPontoSystem(e.target.value)}
                        style={{...S.input,width:"auto",fontSize:12,padding:"5px 10px"}}>
                        {PONTO_SYSTEMS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    </div>

                    <input type="file" accept=".pdf" id="ponto-upload" style={{display:"none"}} onChange={async(e)=>{
                      const file = e.target.files?.[0];
                      if (!file) return;
                      setPontoLoading(true); setPontoError(""); setPontoPreview(null);
                      try {
                        // 1. Extract text from PDF using pdf.js
                        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
                        window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
                        const arrayBuf = await file.arrayBuffer();
                        const pdfDoc = await window.pdfjsLib.getDocument({data:arrayBuf}).promise;
                        let fullText = "";
                        for (let p = 1; p <= pdfDoc.numPages; p++) {
                          const page = await pdfDoc.getPage(p);
                          const content = await page.getTextContent();
                          // Group items by Y position to reconstruct lines
                          const lineMap = {};
                          for (const item of content.items) {
                            if (!item.str.trim()) continue;
                            // transform[5] is the Y position (inverted: higher = top)
                            const y = Math.round(item.transform[5]);
                            if (!lineMap[y]) lineMap[y] = [];
                            lineMap[y].push({ x: item.transform[4], text: item.str });
                          }
                          // Sort Y positions descending (top to bottom in PDF)
                          const sortedYs = Object.keys(lineMap).map(Number).sort((a, b) => b - a);
                          for (const y of sortedYs) {
                            // Sort items left to right within the line
                            const items = lineMap[y].sort((a, b) => a.x - b.x);
                            fullText += items.map(it => it.text).join(" ") + "\n";
                          }
                        }
                        if (!fullText.trim() || fullText.trim().length < 20) {
                          setPontoError("PDF parece ser uma imagem escaneada (sem texto selecionável). Use PDFs com texto digital.");
                          setPontoLoading(false);
                          return;
                        }

                        // 2. Parse PDF based on selected system
                        let parsed;
                        if (pontoSystem === "solides") {
                          parsed = parseSolidesPDF(fullText, year, month);
                        } else {
                          setPontoError(`Parser para "${pontoSystem}" ainda não implementado.`);
                          setPontoLoading(false);
                          return;
                        }

                        if (parsed.error) {
                          setPontoError(parsed.error);
                          setPontoLoading(false);
                          return;
                        }

                        if (!parsed.employees || parsed.employees.length === 0) {
                          setPontoError("Nenhum empregado encontrado no PDF. Verifique se o formato é compatível com o sistema selecionado.");
                          setPontoLoading(false);
                          return;
                        }

                        // 3. Compare against system schedule
                        const preview = comparePontoVsSchedule(parsed.employees, schedEmps, effectiveMonth, mk, restRoles);
                        setPontoPreview(preview);

                        // Init resolutions for unmatched names
                        if (preview.unmatchedNames.length > 0) {
                          const init = {};
                          preview.unmatchedNames.forEach(u => { init[u._key] = { action:"ignore", linkedEmpId:null, newRoleId:"" }; });
                          setPontoResolutions(init);
                        } else {
                          setPontoResolutions({});
                        }
                      } catch(err) {
                        console.error("[Ponto Import]", err);
                        setPontoError(err.message || "Erro ao processar PDF.");
                      } finally {
                        setPontoLoading(false);
                        e.target.value = "";
                      }
                    }}/>
                    <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                      <button onClick={()=>document.getElementById("ponto-upload").click()} disabled={pontoLoading}
                        style={{...S.btnPrimary,fontSize:13,opacity:pontoLoading?0.6:1}}>
                        {pontoLoading ? "⏳ Processando..." : "📎 Selecionar PDF da folha de ponto"}
                      </button>
                      <button onClick={()=>{setShowPontoImport(false);setPontoError("");setPontoPreview(null);setPontoResolutions({});}} style={S.btnSecondary}>Cancelar</button>
                    </div>
                    {pontoError && <p style={{color:"var(--red)",fontSize:12,margin:"8px 0 0"}}>{pontoError}</p>}
                    <p style={{color:"var(--text3)",fontSize:11,margin:"8px 0 0"}}>O PDF precisa ter texto selecionável (não escaneado). Será comparado com a escala de {monthLabel(year,month)}.</p>
                  </div>
                )}

                {pontoPreview && (
                  <div>
                    {/* Summary */}
                    <div style={{background:"var(--bg1)",borderRadius:8,padding:"10px 14px",marginBottom:12}}>
                      <p style={{color:"var(--text)",fontSize:13,margin:0,lineHeight:1.5}}>{pontoPreview.summary}</p>
                    </div>

                    {/* Matched employees */}
                    {pontoPreview.matchedSummary?.length > 0 && (
                      <details style={{marginBottom:12,fontSize:12}}>
                        <summary style={{color:"var(--text3)",cursor:"pointer",fontSize:11}}>👥 Empregados identificados ({pontoPreview.matchedSummary.length})</summary>
                        <div style={{marginTop:6,display:"flex",flexWrap:"wrap",gap:4}}>
                          {pontoPreview.matchedSummary.map(m => (
                            <span key={m.empId} style={{fontSize:10,padding:"3px 8px",borderRadius:4,background:"var(--bg2)",border:"1px solid var(--border)",color:"var(--text2)"}}>
                              {m.pdfName !== m.sysName ? `${m.pdfName} → ${m.sysName}` : m.sysName}
                            </span>
                          ))}
                        </div>
                      </details>
                    )}

                    {/* Schedule changes */}
                    {pontoPreview.totalSchedChanges > 0 && (
                      <div style={{marginBottom:12}}>
                        <div style={{color:"#3b82f6",fontSize:12,fontWeight:700,marginBottom:6}}>📅 Alterações na escala ({pontoPreview.totalSchedChanges})</div>
                        {Object.entries(pontoPreview.scheduleChanges).map(([empId, days]) => {
                          const emp = schedEmps.find(e=>e.id===empId);
                          if (!emp) return null;
                          const STATUS_LABELS = {off:"Folga",faultu:"Falta Injust.",faultj:"Falta Just.",vac:"Férias",comp:"Folga Comp.",comptrab:"Trab. Comp.",freela:"Freela","":"Trabalho"};
                          return (
                            <div key={empId} style={{padding:"8px 12px",borderRadius:8,background:"#3b82f609",border:"1px solid #3b82f622",marginBottom:4}}>
                              <div style={{fontWeight:700,fontSize:12,color:"var(--text)",marginBottom:4}}>{emp.name}</div>
                              <div style={{display:"flex",flexWrap:"wrap",gap:4}}>
                                {Object.entries(days).map(([date, newStatus]) => {
                                  const oldStatus = effectiveMonth[empId]?.[date] ?? "";
                                  return (
                                    <div key={date} style={{fontSize:10,padding:"3px 8px",borderRadius:4,background:"var(--bg2)",border:"1px solid var(--border)"}}>
                                      <span style={{color:"var(--text3)"}}>{new Date(date+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</span>
                                      <span style={{color:"var(--red)",marginLeft:4}}>{STATUS_LABELS[oldStatus]??"Trabalho"}</span>
                                      <span style={{color:"var(--text3)",margin:"0 3px"}}>→</span>
                                      <span style={{color:"#3b82f6",fontWeight:700}}>{STATUS_LABELS[newStatus]??newStatus}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Incidents */}
                    {pontoPreview.incidents.length > 0 && (
                      <div style={{marginBottom:12}}>
                        <div style={{color:"var(--red)",fontSize:12,fontWeight:700,marginBottom:6}}>🚨 Ocorrências detectadas ({pontoPreview.incidents.length})</div>
                        {pontoPreview.incidents.map((inc, i) => {
                          const sevColor = {leve:"#f59e0b",media:"#f97316",grave:"#e74c3c"}[inc.severity] ?? "#888";
                          const typeLabel = {atraso:"⏰ Atraso",saida_antecipada:"🚪 Saída antecipada",hora_extra:"⏱️ Hora extra",faultu:"❌ Falta injust.",faultj:"⚠️ Falta just."}[inc.type] ?? inc.type;
                          return (
                            <div key={i} style={{padding:"8px 12px",borderRadius:8,background:"#e74c3c09",border:"1px solid #e74c3c22",marginBottom:4,display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                              <div>
                                <span style={{fontWeight:700,fontSize:12,color:"var(--text)"}}>{inc.empName}</span>
                                <span style={{color:"var(--text3)",fontSize:11,marginLeft:6}}>{new Date(inc.date+"T12:00:00").toLocaleDateString("pt-BR")}</span>
                                <span style={{fontSize:10,marginLeft:6,color:"var(--text3)"}}>{typeLabel}</span>
                                <div style={{color:"var(--text2)",fontSize:12,marginTop:2}}>{inc.description}</div>
                              </div>
                              <span style={{fontSize:9,padding:"2px 6px",borderRadius:4,background:sevColor+"22",color:sevColor,fontWeight:700,whiteSpace:"nowrap",flexShrink:0}}>{inc.severity}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Unmatched names */}
                    {pontoPreview.unmatchedNames?.length > 0 && (
                      <div style={{marginBottom:12}}>
                        <div style={{color:"#f59e0b",fontSize:12,fontWeight:700,marginBottom:6}}>⚠️ Empregados não identificados ({pontoPreview.unmatchedNames.length})</div>
                        <p style={{color:"var(--text3)",fontSize:11,margin:"0 0 8px"}}>Esses nomes do PDF não foram encontrados no cadastro. Escolha o que fazer com cada um:</p>
                        {pontoPreview.unmatchedNames.map(u => {
                          const res = pontoResolutions[u._key] ?? { action:"ignore" };
                          const schedCount = Object.keys(u.scheduleChanges).length;
                          const incCount = u.incidents.length;
                          return (
                            <div key={u._key} style={{padding:"10px 14px",borderRadius:8,background:"#f59e0b09",border:"1px solid #f59e0b22",marginBottom:6}}>
                              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                                <span style={{fontWeight:700,fontSize:13,color:"var(--text)"}}>{u.name}</span>
                                <span style={{fontSize:10,color:"var(--text3)"}}>
                                  {schedCount > 0 && `${schedCount} dia(s)`}{schedCount > 0 && incCount > 0 && " · "}{incCount > 0 && `${incCount} ocorrência(s)`}
                                  {schedCount === 0 && incCount === 0 && "sem alterações"}
                                </span>
                              </div>
                              {/* Action selector */}
                              <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:res.action !== "ignore" ? 8 : 0}}>
                                {["ignore","link","create"].map(act => {
                                  const labels = {ignore:"Ignorar",link:"Vincular a existente",create:"Criar novo"};
                                  const active = res.action === act;
                                  return (
                                    <button key={act} onClick={()=>setPontoResolutions(prev=>({...prev,[u._key]:{...prev[u._key],action:act}}))}
                                      style={{padding:"4px 10px",borderRadius:6,fontSize:11,border:`1px solid ${active?"var(--ac)":"var(--border)"}`,background:active?"var(--ac)22":"transparent",color:active?"var(--ac)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                                      {labels[act]}
                                    </button>
                                  );
                                })}
                              </div>
                              {/* Link to existing */}
                              {res.action === "link" && (
                                <select value={res.linkedEmpId||""} onChange={e=>setPontoResolutions(prev=>({...prev,[u._key]:{...prev[u._key],linkedEmpId:e.target.value}}))}
                                  style={{...S.input,fontSize:12,padding:"6px 10px"}}>
                                  <option value="">Selecione o empregado...</option>
                                  {schedEmps.map(emp => <option key={emp.id} value={emp.id}>{emp.name} — {restRoles.find(r=>r.id===emp.roleId)?.name??"—"}</option>)}
                                </select>
                              )}
                              {/* Create new — pick role */}
                              {res.action === "create" && (
                                <select value={res.newRoleId||""} onChange={e=>setPontoResolutions(prev=>({...prev,[u._key]:{...prev[u._key],newRoleId:e.target.value}}))}
                                  style={{...S.input,fontSize:12,padding:"6px 10px"}}>
                                  <option value="">Selecione o cargo...</option>
                                  {restRoles.filter(r=>!r.inactive).map(r => <option key={r.id} value={r.id}>{r.name} — {r.area}</option>)}
                                </select>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Missing from ponto — system employees not found in PDF */}
                    {pontoPreview.missingFromPonto?.length > 0 && (
                      <div style={{marginBottom:12}}>
                        <div style={{color:"#6366f1",fontSize:12,fontWeight:700,marginBottom:6}}>📋 Empregados do sistema ausentes no PDF ({pontoPreview.missingFromPonto.length})</div>
                        <p style={{color:"var(--text3)",fontSize:11,margin:"0 0 8px"}}>Estes empregados estão ativos no sistema mas não apareceram na folha de ponto. Justifique cada um:</p>
                        {pontoPreview.missingFromPonto.map(m => {
                          const role = restRoles.find(r=>r.id===m.roleId);
                          const reason = pontoMissingReasons[m.empId] ?? "ignorar";
                          return (
                            <div key={m.empId} style={{padding:"10px 14px",borderRadius:8,background:"#6366f109",border:"1px solid #6366f122",marginBottom:6,display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
                              <div>
                                <span style={{fontWeight:700,fontSize:13,color:"var(--text)"}}>{m.empName}</span>
                                {role && <span style={{color:"var(--text3)",fontSize:11,marginLeft:6}}>{role.name}</span>}
                              </div>
                              <select value={reason} onChange={e=>setPontoMissingReasons(prev=>({...prev,[m.empId]:e.target.value}))}
                                style={{...S.input,fontSize:11,padding:"4px 8px",maxWidth:200,cursor:"pointer"}}>
                                <option value="ignorar">Ignorar</option>
                                <option value="ferias_licenca">Ferias/Licenca</option>
                                <option value="demitido">Demitido no periodo</option>
                                <option value="erro_ponto">Erro no ponto</option>
                                <option value="outro_sistema">Outro sistema</option>
                              </select>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {pontoPreview.totalSchedChanges === 0 && pontoPreview.incidents.length === 0 && (pontoPreview.unmatchedNames?.length??0) === 0 && (pontoPreview.missingFromPonto?.length??0) === 0 && (
                      <p style={{color:"var(--green)",fontSize:13,textAlign:"center",padding:16}}>✅ Nenhuma diferença encontrada entre o ponto e a escala prevista.</p>
                    )}

                    {/* Actions */}
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      {(pontoPreview.totalSchedChanges > 0 || pontoPreview.incidents.length > 0 || pontoPreview.unmatchedNames?.some(u => {const r = pontoResolutions[u._key]; return r && r.action !== "ignore";})) && (
                        <button onClick={()=>{
                          // Validate unmatched resolutions
                          const hasInvalidLink = pontoPreview.unmatchedNames?.some(u => {
                            const r = pontoResolutions[u._key];
                            return r?.action === "link" && !r.linkedEmpId;
                          });
                          const hasInvalidCreate = pontoPreview.unmatchedNames?.some(u => {
                            const r = pontoResolutions[u._key];
                            return r?.action === "create" && !r.newRoleId;
                          });
                          if (hasInvalidLink) { setPontoError("Selecione o empregado para vincular."); return; }
                          if (hasInvalidCreate) { setPontoError("Selecione o cargo para criar o novo empregado."); return; }
                          setPontoError("");

                          // 0. Process unmatched resolutions — create new employees and collect extra changes
                          let updatedEmployees = [...employees];
                          const extraSchedChanges = {};
                          const extraIncidents = [];
                          let createdCount = 0;
                          let linkedCount = 0;

                          (pontoPreview.unmatchedNames ?? []).forEach(u => {
                            const res = pontoResolutions[u._key];
                            if (!res || res.action === "ignore") return;

                            let targetEmpId = null;

                            if (res.action === "link") {
                              targetEmpId = res.linkedEmpId;
                              linkedCount++;
                            } else if (res.action === "create") {
                              // Create new employee
                              const restCode = restaurant.shortCode || "XXX";
                              const seq = nextEmpSeq(updatedEmployees, restCode);
                              const empCode = makeEmpCode(restCode, seq);
                              const pin = String(seq).padStart(4, "0");
                              const newEmp = {
                                id: Date.now().toString() + Math.random().toString(36).slice(2,4),
                                name: u.name,
                                cpf: "",
                                admission: today(),
                                roleId: res.newRoleId,
                                restaurantId: rid,
                                empCode,
                                pin
                              };
                              updatedEmployees = [...updatedEmployees, newEmp];
                              targetEmpId = newEmp.id;
                              createdCount++;
                            }

                            if (targetEmpId) {
                              // Merge schedule changes
                              if (Object.keys(u.scheduleChanges).length > 0) {
                                extraSchedChanges[targetEmpId] = { ...(extraSchedChanges[targetEmpId]??{}), ...u.scheduleChanges };
                              }
                              // Merge incidents
                              u.incidents.forEach(inc => {
                                extraIncidents.push({ ...inc, empId: targetEmpId });
                              });
                            }
                          });

                          // Save new employees if any were created
                          if (createdCount > 0) {
                            onUpdate("employees", updatedEmployees);
                          }

                          // 1. Apply schedule changes as local edits (matched + unmatched)
                          const allSchedChanges = { ...pontoPreview.scheduleChanges, ...extraSchedChanges };
                          if (Object.keys(allSchedChanges).length > 0) {
                            setSchedLocalEdits(prev => {
                              const edits = prev ? {...prev} : {};
                              Object.entries(allSchedChanges).forEach(([eid, dayMap]) => {
                                edits[eid] = { ...(edits[eid]??{}), ...dayMap };
                              });
                              return edits;
                            });
                          }

                          // 2. Create incidents (matched + unmatched)
                          const allNewIncidents = [
                            ...pontoPreview.incidents,
                            ...extraIncidents
                          ];
                          if (allNewIncidents.length > 0) {
                            const newIncs = allNewIncidents.map(inc => ({
                              id: `${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
                              restaurantId: rid,
                              employeeIds: [inc.empId],
                              type: inc.type === "atraso" ? "outro" : inc.type === "saida_antecipada" ? "outro" : inc.type === "hora_extra" ? "destaque_positivo" : inc.type === "faultu" ? "indisciplina" : inc.type === "faultj" ? "outro" : inc.type,
                              severity: inc.severity || "leve",
                              description: `[Importado do ponto] ${inc.description}`,
                              date: inc.date,
                              createdAt: new Date().toISOString(),
                              createdBy: isOwner ? "Gestor AppTip" : (currentUser?.name ?? "Gestor Adm."),
                              createdById: currentUser?.id ?? null,
                              visibility: "internal",
                            }));
                            onUpdate("incidents", [...(data?.incidents??[]), ...newIncs]);
                          }

                          const parts = [];
                          const totalSched = Object.values(allSchedChanges).reduce((s,d) => s + Object.keys(d).length, 0);
                          if (totalSched > 0) parts.push(`${totalSched} dia(s) atualizados na escala`);
                          if (allNewIncidents.length > 0) parts.push(`${allNewIncidents.length} ocorrência(s) registrada(s)`);
                          if (createdCount > 0) parts.push(`${createdCount} empregado(s) criado(s)`);
                          if (linkedCount > 0) parts.push(`${linkedCount} empregado(s) vinculado(s)`);
                          // Phase 5: Build and persist import summary
                          const faltaCount = allNewIncidents.filter(i=>i.type==="faultu"||i.type==="faultj").length;
                          const atrasoCount = allNewIncidents.filter(i=>i.type==="atraso").length;
                          const heCount = allNewIncidents.filter(i=>i.type==="hora_extra").length;
                          const saidaCount = allNewIncidents.filter(i=>i.type==="saida_antecipada").length;
                          const importSummary = {
                            matchedCount: pontoPreview.matchedSummary?.length ?? 0,
                            totalPdf: (pontoPreview.matchedSummary?.length ?? 0) + (pontoPreview.unmatchedNames?.length ?? 0),
                            totalSystem: schedEmps.length,
                            faltas: faltaCount,
                            atrasos: atrasoCount,
                            horasExtras: heCount,
                            saidasAntecipadas: saidaCount,
                            schedChanges: totalSched,
                            incidents: allNewIncidents.map(i => ({ empId: i.empId, empName: i.empName, type: i.type, date: i.date, description: i.description, severity: i.severity })),
                            missingFromPonto: (pontoPreview.missingFromPonto ?? []).map(m => ({ empId: m.empId, empName: m.empName, reason: pontoMissingReasons[m.empId] ?? "ignorar" })),
                            importedAt: new Date().toISOString(),
                          };
                          setPontoSummary(importSummary);

                          // Phase 6: Append to import history + update scheduleStatus
                          const historyEntry = {
                            date: new Date().toISOString(),
                            system: pontoSystem,
                            matchedCount: importSummary.matchedCount,
                            totalPdf: importSummary.totalPdf,
                            user: currentUser?.name || (isOwner ? "Gestor AppTip" : "Gestor Adm."),
                            incidents: allNewIncidents.length,
                            schedChanges: totalSched,
                          };
                          const newSchedStatus = { ...(data?.scheduleStatus ?? {}) };
                          if (!newSchedStatus[rid]) newSchedStatus[rid] = {};
                          newSchedStatus[rid][mk] = {
                            ...(newSchedStatus[rid][mk] ?? {}),
                            lastPontoImport: new Date().toISOString(),
                            pontoSystem: pontoSystem,
                            missingFromPonto: importSummary.missingFromPonto,
                            lastImportSummary: importSummary,
                            importHistory: [...(newSchedStatus[rid][mk]?.importHistory ?? []), historyEntry],
                          };
                          onUpdate("scheduleStatus", newSchedStatus);

                          onUpdate("_toast", `✅ Ponto importado — ${parts.join(" · ")}${totalSched > 0 ? " — salve a escala para confirmar" : ""}`);
                          setPontoPreview(null);
                          setPontoResolutions({});
                          setPontoMissingReasons({});
                          setShowPontoImport(false);
                        }} style={{...S.btnPrimary,fontSize:13}}>
                          ✅ Aplicar alterações
                        </button>
                      )}
                      <button onClick={()=>setPontoPreview(null)} style={S.btnSecondary}>Reprocessar</button>
                      <button onClick={()=>{setPontoPreview(null);setPontoResolutions({});setShowPontoImport(false);}} style={{...S.btnSecondary,color:"var(--red)",borderColor:"var(--red)44"}}>Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Phase 5: Post-import dashboard */}
            {pontoSummary && !showPontoImport && (
              <div style={{...S.card,marginBottom:14,border:"1px solid var(--ac)44"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <span style={{color:"var(--ac)",fontWeight:700,fontSize:14}}>Resumo da importacao do ponto</span>
                  <button onClick={()=>setPontoSummary(null)} style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:16,padding:0}}>x</button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(100px,1fr))",gap:8,marginBottom:12}}>
                  {[
                    {label:"Identificados",value:`${pontoSummary.matchedCount}/${pontoSummary.totalPdf}`,color:"var(--green)"},
                    {label:"Faltas",value:pontoSummary.faltas,color:"var(--red)"},
                    {label:"Atrasos",value:pontoSummary.atrasos,color:"#f59e0b"},
                    {label:"Horas extras",value:pontoSummary.horasExtras,color:"#3b82f6"},
                    {label:"Saidas antecipadas",value:pontoSummary.saidasAntecipadas,color:"#f97316"},
                    {label:"Alteracoes escala",value:pontoSummary.schedChanges,color:"var(--ac)"},
                  ].map((item,i)=>(
                    <div key={i} style={{background:"var(--bg1)",borderRadius:8,padding:"10px 12px",textAlign:"center"}}>
                      <div style={{color:item.color,fontSize:18,fontWeight:700}}>{item.value}</div>
                      <div style={{color:"var(--text3)",fontSize:10,marginTop:2}}>{item.label}</div>
                    </div>
                  ))}
                </div>
                {pontoSummary.incidents?.length > 0 && (
                  <details style={{marginBottom:8}}>
                    <summary style={{color:"var(--text2)",cursor:"pointer",fontSize:12}}>Detalhes por empregado ({[...new Set(pontoSummary.incidents.map(i=>i.empId))].length} empregados)</summary>
                    <div style={{marginTop:8}}>
                      {[...new Set(pontoSummary.incidents.map(i=>i.empId))].map(empId => {
                        const empIncs = pontoSummary.incidents.filter(i=>i.empId===empId);
                        const empName = empIncs[0]?.empName ?? empId;
                        return (
                          <details key={empId} style={{marginBottom:4}}>
                            <summary style={{color:"var(--text)",fontSize:12,fontWeight:600,cursor:"pointer"}}>{empName} ({empIncs.length} ocorrencia(s))</summary>
                            <div style={{marginLeft:12,marginTop:4}}>
                              {empIncs.map((inc,i) => (
                                <div key={i} style={{fontSize:11,color:"var(--text2)",padding:"2px 0"}}>
                                  <span style={{color:"var(--text3)"}}>{new Date(inc.date+"T12:00:00").toLocaleDateString("pt-BR",{day:"2-digit",month:"2-digit"})}</span>
                                  <span style={{marginLeft:6}}>{inc.description}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  </details>
                )}
              </div>
            )}

            {/* Phase 6: Import history link */}
            {(() => {
              const history = data?.scheduleStatus?.[rid]?.[mk]?.importHistory;
              if (!history || history.length === 0) return null;
              return (
                <details style={{marginBottom:14}}>
                  <summary style={{color:"var(--ac)",cursor:"pointer",fontSize:12,fontWeight:600}}>Historico de importacoes ({history.length})</summary>
                  <div style={{marginTop:8,display:"flex",flexDirection:"column",gap:4}}>
                    {history.slice().reverse().map((h,i) => (
                      <div key={i} style={{background:"var(--bg1)",borderRadius:8,padding:"8px 12px",border:"1px solid var(--border)",fontSize:12}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <span style={{color:"var(--text)",fontWeight:600}}>{new Date(h.date).toLocaleDateString("pt-BR")} {new Date(h.date).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})}</span>
                          <span style={{color:"var(--text3)",fontSize:11}}>{h.system}</span>
                        </div>
                        <div style={{color:"var(--text2)",fontSize:11,marginTop:4}}>
                          {h.matchedCount}/{h.totalPdf} identificados, {h.incidents} ocorrencia(s), {h.schedChanges} alteracao(oes) — por {h.user}
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              );
            })()}

            {/* Formulário de atrasos em lote */}
            {showDelayForm && (
              <div style={{...S.card,marginBottom:14,border:"1px solid #f59e0b44"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                  <span style={{fontSize:16}}>⏰</span>
                  <span style={{fontWeight:700,color:"var(--text)",fontSize:14}}>Registrar atrasos — {monthLabel(year, month)}</span>
                </div>
                <div style={{marginBottom:12}}>
                  <label style={S.label}>Empregado</label>
                  <select value={delayEmpId} onChange={e=>{
                    setDelayEmpId(e.target.value);
                    // Pre-fill with existing delays for this employee
                    const existing = data?.delays?.[rid]?.[mk]?.[e.target.value] ?? {};
                    setDelayInputs({...existing});
                  }} style={{...S.input,fontSize:13}}>
                    <option value="">Selecionar...</option>
                    {schedEmps.filter(e=>!e.inactive).sort((a,b)=>a.name.localeCompare(b.name)).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                {delayEmpId && (() => {
                  const dim = new Date(year, month + 1, 0).getDate();
                  const empSched = schedules?.[rid]?.[mk]?.[delayEmpId] ?? {};
                  const workDays = [];
                  for (let d = 1; d <= dim; d++) {
                    const dk = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                    const st = empSched[dk];
                    // Only show days that are work days (not off, vacation, etc.)
                    if (!st || st === "T" || st === DAY_COMP_TRAB) workDays.push({ day: d, dk });
                  }
                  const totalMin = Object.values(delayInputs).reduce((s,v) => s + (parseInt(v)||0), 0);
                  const totalCount = Object.values(delayInputs).filter(v => (parseInt(v)||0) > 0).length;
                  return (
                    <div>
                      <div style={{color:"var(--text3)",fontSize:11,marginBottom:8}}>Informe os minutos de atraso em cada dia trabalhado. Dias sem valor serão ignorados.</div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill, minmax(120px, 1fr))",gap:6,marginBottom:12}}>
                        {workDays.map(({day, dk}) => {
                          const val = delayInputs[String(day)] ?? "";
                          const dayName = new Date(year, month, day).toLocaleDateString("pt-BR",{weekday:"short"}).replace(".","");
                          return (
                            <div key={day} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 8px",borderRadius:8,background:val&&parseInt(val)>0?"#f59e0b11":"var(--bg1)"}}>
                              <span style={{color:"var(--text2)",fontSize:11,fontWeight:600,minWidth:50}}>{String(day).padStart(2,"0")} {dayName}</span>
                              <input type="number" min="0" max="480" value={val} placeholder="min"
                                onChange={e => setDelayInputs(prev => ({...prev, [String(day)]: e.target.value}))}
                                style={{...S.input,width:55,fontSize:12,padding:"4px 6px",textAlign:"center"}}/>
                            </div>
                          );
                        })}
                      </div>
                      {totalCount > 0 && (
                        <div style={{marginBottom:10,padding:"8px 12px",borderRadius:8,background:"#f59e0b11",color:"#f59e0b",fontSize:12,fontWeight:600}}>
                          {totalCount} dia{totalCount!==1?"s":""} com atraso · {totalMin} min total ({(totalMin/60).toFixed(1)}h)
                        </div>
                      )}
                      <button onClick={() => {
                        // Clean inputs — remove zeros and empty
                        const cleaned = {};
                        Object.entries(delayInputs).forEach(([d, v]) => {
                          const mins = parseInt(v) || 0;
                          if (mins > 0) cleaned[d] = mins;
                        });
                        const allDelays = { ...(data?.delays ?? {}) };
                        if (!allDelays[rid]) allDelays[rid] = {};
                        if (!allDelays[rid][mk]) allDelays[rid][mk] = {};
                        allDelays[rid][mk][delayEmpId] = cleaned;
                        onUpdate("delays", allDelays);
                        setShowDelayForm(false);
                        setDelayEmpId("");
                        setDelayInputs({});
                      }} style={{...S.btnPrimary,background:"#f59e0b",fontSize:12,padding:"8px 20px"}}>
                        Salvar atrasos
                      </button>
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Formulário de férias */}
            {showVacForm && (
              <div style={{...S.card,marginBottom:14,border:"1px solid #8b5cf644"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
                  <span style={{fontSize:14}}>🏖️</span>
                  <span style={{color:"#8b5cf6",fontWeight:700,fontSize:14}}>Marcar Férias</span>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  <div>
                    <label style={S.label}>Empregado</label>
                    <select value={vacEmpId} onChange={e=>setVacEmpId(e.target.value)} style={{...S.input,cursor:"pointer"}}>
                      <option value="">Selecione...</option>
                      {areaEmps.sort((a,b)=>a.name.localeCompare(b.name)).map(e => (
                        <option key={e.id} value={e.id}>{e.name}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div>
                      <label style={S.label}>Data início</label>
                      <input type="date" value={vacFrom} onChange={e=>setVacFrom(e.target.value)} style={S.input}/>
                    </div>
                    <div>
                      <label style={S.label}>Data fim</label>
                      <input type="date" value={vacTo} onChange={e=>setVacTo(e.target.value)} style={S.input}/>
                    </div>
                  </div>
                  {vacEmpId && vacFrom && vacTo && vacFrom <= vacTo && (()=>{
                    const d1 = new Date(vacFrom+"T12:00:00"), d2 = new Date(vacTo+"T12:00:00");
                    const dias = Math.round((d2 - d1) / (1000*60*60*24)) + 1;
                    return <p style={{color:"#8b5cf6",fontSize:12,margin:0}}>→ {dias} dia(s) de férias para {areaEmps.find(e=>e.id===vacEmpId)?.name}</p>;
                  })()}
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>{
                      if (!vacEmpId || !vacFrom || !vacTo || vacFrom > vacTo) return;
                      const emp = areaEmps.find(e => e.id === vacEmpId);
                      if (!emp) return;
                      // Accumulate vacation days in local edits
                      const vacEdits = {};
                      let count = 0;
                      const cur = new Date(vacFrom+"T12:00:00");
                      const end = new Date(vacTo+"T12:00:00");
                      while (cur <= end) {
                        const dateStr = cur.toISOString().slice(0,10);
                        if (dateStr.slice(0,7) === `${year}-${String(month+1).padStart(2,"0")}`) {
                          vacEdits[dateStr] = DAY_VACATION;
                          count++;
                        }
                        cur.setDate(cur.getDate() + 1);
                      }
                      setSchedLocalEdits(prev => {
                        const edits = prev ? { ...prev } : {};
                        edits[vacEmpId] = { ...(edits[vacEmpId] ?? {}), ...vacEdits };
                        return edits;
                      });
                      setShowVacForm(false);
                      onUpdate("_toast", `🏖️ ${count} dia(s) de férias marcados para ${emp.name} — salve para confirmar`);
                    }} disabled={!vacEmpId||!vacFrom||!vacTo||vacFrom>vacTo}
                      style={{...S.btnPrimary,background:"#8b5cf6",flex:1,opacity:(!vacEmpId||!vacFrom||!vacTo||vacFrom>vacTo)?0.5:1}}>
                      Confirmar férias
                    </button>
                    <button onClick={()=>setShowVacForm(false)} style={S.btnSecondary}>Cancelar</button>
                  </div>
                </div>
              </div>
            )}

            {areaEmps.length === 0 && <p style={{color:"var(--text3)",textAlign:"center"}}>Nenhum empregado {schedArea === "Todos" ? "cadastrado" : "nesta área"}.</p>}

            {areaEmps.length > 0 && (() => {
              const daysInMonth = dim;

              function cycleStatus(empId, dateStr) {
                if (monthClosed) return; // Month is closed, no editing allowed
                if (restaurant.serviceStartDate && dateStr < restaurant.serviceStartDate) return;
                const empDayMap = effectiveMonth[empId] ?? {};
                const cur = empDayMap[dateStr];
                const idx = DAY_CYCLE.indexOf(cur);
                const next = idx === DAY_CYCLE.length - 1 ? null : DAY_CYCLE[idx + 1];
                // Accumulate in local edits (not saved to Firestore yet)
                setSchedLocalEdits(prev => {
                  const edits = prev ? { ...prev } : {};
                  if (!edits[empId]) edits[empId] = {};
                  if (next === null) edits[empId][dateStr] = null; // null = mark for deletion
                  else edits[empId][dateStr] = next;
                  return edits;
                });
              }

              /* ——— MOBILE: Visão Semanal ——— */
              if (mobileOnly) {
                // Gera semanas do mês
                const weeks = [];
                let d = 1;
                while (d <= daysInMonth) {
                  const weekDays = [];
                  for (let i = 0; i < 7 && d <= daysInMonth; i++) {
                    const date = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                    const wd = new Date(date+"T12:00:00").getDay();
                    // Primeira semana: preenche dias anteriores com null
                    if (weeks.length === 0 && weekDays.length === 0 && wd > 0) {
                      for (let p = 0; p < wd; p++) weekDays.push(null);
                    }
                    weekDays.push({ day: d, date, wd });
                    d++;
                    // Se caiu no sábado, quebra semana
                    if (wd === 6) break;
                  }
                  // Preenche final da semana com null
                  while (weekDays.length < 7) weekDays.push(null);
                  weeks.push(weekDays);
                }
                const safeWeek = Math.min(weekIdx, weeks.length - 1);
                const curWeek = weeks[safeWeek] || [];
                const validDays = curWeek.filter(Boolean);
                const rangeLabel = validDays.length ? `${validDays[0].day} — ${validDays[validDays.length-1].day}` : "";

                return (
                  <div>
                    {/* Navegação de semana */}
                    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12,padding:"0 4px"}}>
                      <button onClick={()=>setWeekIdx(Math.max(0, safeWeek-1))} disabled={safeWeek===0}
                        aria-label="Semana anterior"
                        style={{background:"none",border:"1px solid var(--border)",borderRadius:8,padding:"6px 12px",color:safeWeek===0?"var(--text3)":"var(--text)",cursor:safeWeek===0?"default":"pointer",fontSize:14}}>
                        ◀
                      </button>
                      <div style={{textAlign:"center"}}>
                        <div style={{color:"var(--text)",fontWeight:700,fontSize:13,fontFamily:"'DM Sans',sans-serif"}}>Semana {safeWeek+1} de {weeks.length}</div>
                        <div style={{color:"var(--text3)",fontSize:11}}>Dias {rangeLabel}</div>
                      </div>
                      <button onClick={()=>setWeekIdx(Math.min(weeks.length-1, safeWeek+1))} disabled={safeWeek>=weeks.length-1}
                        aria-label="Próxima semana"
                        style={{background:"none",border:"1px solid var(--border)",borderRadius:8,padding:"6px 12px",color:safeWeek>=weeks.length-1?"var(--text3)":"var(--text)",cursor:safeWeek>=weeks.length-1?"default":"pointer",fontSize:14}}>
                        ▶
                      </button>
                    </div>

                    {/* Header dos dias da semana */}
                    <div style={{display:"grid",gridTemplateColumns:"80px repeat(7,1fr)",gap:2,marginBottom:4,padding:"0 2px"}}>
                      <div></div>
                      {["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].map((dl,i)=>(
                        <div key={dl} style={{textAlign:"center",color:i===0||i===6?"#f59e0b":"var(--text3)",fontSize:9,fontWeight:700,fontFamily:"'DM Mono',monospace",padding:"2px 0"}}>
                          <div>{dl}</div>
                          <div style={{fontSize:10,color:"var(--text2)"}}>{curWeek[i]?.day ?? ""}</div>
                        </div>
                      ))}
                    </div>

                    {/* Grid de empregados */}
                    {areaEmps.map((emp, ei) => {
                      const role = restRoles.find(r=>r.id===emp.roleId);
                      const dayMap = displayedMonth[emp.id] ?? {};
                      const empDelays = data?.delays?.[rid]?.[mk]?.[emp.id] ?? {};
                      const curArea = role?.area;
                      const prevEmp = areaEmps[ei-1];
                      const prevArea = prevEmp ? restRoles.find(r=>r.id===prevEmp.roleId)?.area : null;
                      const showAreaHeader = schedArea === "Todos" && curArea !== prevArea;

                      return (
                        <div key={emp.id}>
                          {showAreaHeader && (
                            <div style={{padding:"8px 4px 4px",marginTop:ei>0?8:0}}>
                              <span style={{color:AREA_COLORS[curArea]??"#888",fontSize:10,fontWeight:700,letterSpacing:1}}>{(curArea??"").toUpperCase()}</span>
                            </div>
                          )}
                          <div style={{display:"grid",gridTemplateColumns:"80px repeat(7,1fr)",gap:2,padding:"4px 2px",background:ei%2===0?"var(--bg1)":"var(--bg2)",borderRadius:6,marginBottom:2}}>
                            {/* Nome do empregado */}
                            <div style={{display:"flex",flexDirection:"column",justifyContent:"center",padding:"2px 4px",minWidth:0}}>
                              <div style={{color:"var(--text)",fontSize:10,fontWeight:600,lineHeight:1.2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{emp.name.split(" ")[0]}</div>
                              <div style={{color:"var(--text3)",fontSize:8,lineHeight:1.1}}>{role?.name}</div>
                            </div>
                            {/* 7 dias da semana */}
                            {curWeek.map((slot, di) => {
                              if (!slot) return <div key={di} style={{minHeight:36}}></div>;
                              const isDem = emp.demitidoEm && slot.date >= emp.demitidoEm;
                              const status = isDem ? null : dayMap[slot.date];
                              const color = isDem ? "#6b7280" : (STATUS_COLORS[status] ?? "var(--green)");
                              const label = isDem ? "DEM" : (STATUS_SHORT[status] ?? "T");
                              const locked = isDem || monthClosed || (restaurant.serviceStartDate && slot.date < restaurant.serviceStartDate);
                              const dayNum = slot.date ? String(parseInt(slot.date.slice(-2))) : null;
                              const delayMin = dayNum ? (empDelays[dayNum] || 0) : 0;
                              return (
                                <div key={di} onClick={()=>!locked && cycleStatus(emp.id, slot.date)}
                                  title={delayMin > 0 ? `Atraso: ${delayMin} min` : undefined}
                                  style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:36,borderRadius:6,cursor:locked?"not-allowed":"pointer",background:isDem?"#6b728022":(status?color+"22":"transparent"),border:`1px solid ${isDem?"#6b728044":(delayMin>0?"#f59e0b":(status?color+"44":"var(--border)"))}`,opacity:locked?0.35:1,position:"relative"}}>
                                  <span style={{color:locked?"var(--text3)":color,fontSize:isDem?9:11,fontWeight:700}}>{restaurant.serviceStartDate && !isDem && slot.date < restaurant.serviceStartDate?"🔒":label}</span>
                                  {delayMin > 0 && <span style={{position:"absolute",top:0,right:1,fontSize:6,color:"#f59e0b",fontWeight:800}}>⏰</span>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              }

              /* ——— DESKTOP: Tabela completa ——— */
              return (
                <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
                  <table style={{borderCollapse:"collapse",fontFamily:"'DM Mono',monospace",fontSize:11,width:"100%",tableLayout:"fixed"}}>
                    <colgroup>
                      <col style={{width:110,minWidth:110}}/>
                      {Array.from({length:daysInMonth},(_,i)=><col key={i} style={{width:26,minWidth:22}}/>)}
                      <col style={{width:30,minWidth:28}}/>
                      <col style={{width:30,minWidth:28}}/>
                    </colgroup>
                    <thead>
                      <tr>
                        <th style={{position:"sticky",left:0,background:"var(--card-bg)",zIndex:2,padding:"6px 6px",textAlign:"left",color:"var(--text3)",fontSize:10,borderBottom:"1px solid var(--border)",whiteSpace:"nowrap"}}>
                          Empregado
                        </th>
                        {Array.from({length:daysInMonth},(_,i)=>{
                          const d = i+1;
                          const date = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                          const wd = new Date(date+"T12:00:00").getDay();
                          const isWe = wd===0||wd===6;
                          return (
                            <th key={d} style={{padding:"2px 0",textAlign:"center",color:isWe?"#f59e0b":"#555",fontSize:8,borderBottom:"1px solid var(--border)"}}>
                              <div>{d}</div>
                              <div style={{fontSize:7}}>{["D","S","T","Q","Q","S","S"][wd]}</div>
                            </th>
                          );
                        })}
                        <th style={{position:"sticky",right:30,background:"var(--card-bg)",zIndex:2,padding:"4px 2px",textAlign:"center",color:"var(--green)",fontSize:9,borderBottom:"1px solid var(--border)",borderLeft:"1px solid var(--border)"}}>T</th>
                        <th style={{position:"sticky",right:0,background:"var(--card-bg)",zIndex:2,padding:"4px 2px",textAlign:"center",color:"var(--red)",fontSize:9,borderBottom:"1px solid var(--border)",borderLeft:"1px solid var(--border)"}}>F</th>
                      </tr>
                    </thead>
                    <tbody>
                      {areaEmps.map((emp,ei) => {
                        const role = restRoles.find(r=>r.id===emp.roleId);
                        const dayMap = displayedMonth[emp.id] ?? {};
                        const empDelaysD = data?.delays?.[rid]?.[mk]?.[emp.id] ?? {};
                        // Contagem alinhada com o visual: sem status = "•" = trabalho
                        let workC=0, offC=0;
                        for (let dd = 1; dd <= daysInMonth; dd++) {
                          const dateStr2 = `${year}-${String(month+1).padStart(2,"0")}-${String(dd).padStart(2,"0")}`;
                          const isDem2 = emp.demitidoEm && dateStr2 >= emp.demitidoEm;
                          if (isDem2) continue;
                          const st = dayMap[dateStr2];
                          if (!st || st === DAY_COMP_TRAB) { workC++; }
                          else { offC++; }
                        }

                        const prevEmp = areaEmps[ei-1];
                        const prevArea = prevEmp ? restRoles.find(r=>r.id===prevEmp.roleId)?.area : null;
                        const curArea = role?.area;
                        const showAreaHeader = schedArea === "Todos" && curArea !== prevArea;

                        const rows = [];
                        if (showAreaHeader) {
                          rows.push(
                            <tr key={`area-${curArea}`}>
                              <td colSpan={daysInMonth + 3} style={{padding:"8px 10px 4px",background:"var(--bg5)",borderTop:"1px solid var(--border)",borderBottom:"1px solid var(--border)"}}>
                                <span style={{color:AREA_COLORS[curArea]??"#888",fontSize:10,fontWeight:700,letterSpacing:1}}>{(curArea??"").toUpperCase()}</span>
                              </td>
                            </tr>
                          );
                        }
                        rows.push(
                          <tr key={emp.id} style={{background:ei%2===0?"var(--bg1)":"var(--bg2)"}}>
                            <td style={{position:"sticky",left:0,background:ei%2===0?"var(--bg1)":"var(--bg2)",zIndex:1,padding:"4px 6px",borderRight:"1px solid var(--border)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                              <div style={{color:"var(--text)",fontSize:10,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{emp.name}</div>
                              <div style={{color:"var(--text3)",fontSize:8,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{role?.name}</div>
                            </td>
                            {Array.from({length:daysInMonth},(_,i)=>{
                              const d = i+1;
                              const date = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                              const isDem = emp.demitidoEm && date >= emp.demitidoEm;
                              const status = isDem ? null : dayMap[date];
                              const color = isDem ? "#6b7280" : (STATUS_COLORS[status] ?? "var(--green)");
                              const label = isDem ? "D" : (STATUS_SHORT[status] ?? "•");
                              const wd = new Date(date+"T12:00:00").getDay();
                              const isWe = wd===0||wd===6;
                              const locked = isDem || monthClosed || (restaurant.serviceStartDate && date < restaurant.serviceStartDate);
                              const dDelayMin = empDelaysD[String(d)] || 0;
                              return (
                                <td key={d} onClick={()=>!isDem && cycleStatus(emp.id, date)}
                                  title={dDelayMin > 0 ? `Atraso: ${dDelayMin} min` : undefined}
                                  style={{textAlign:"center",padding:"2px 0",cursor:locked?"not-allowed":"pointer",background:isDem?"#6b728022":(locked?"var(--bg3)":(status?color+"22":(isWe?"var(--bg3)":"transparent"))),borderRight:`1px solid ${dDelayMin>0?"#f59e0b":"var(--border)"}`,opacity:locked?0.35:1,position:"relative"}}>
                                  <span style={{color:locked?"var(--text3)":color,fontSize:isDem?7:(status?8:10),fontWeight:isDem||status?700:400}}>{!isDem&&restaurant.serviceStartDate&&date<restaurant.serviceStartDate?"🔒":label}</span>
                                  {dDelayMin > 0 && <span style={{position:"absolute",bottom:0,right:0,fontSize:5,color:"#f59e0b",lineHeight:1}}>⏰</span>}
                                </td>
                              );
                            })}
                            <td style={{position:"sticky",right:30,background:ei%2===0?"var(--bg1)":"var(--bg2)",zIndex:1,textAlign:"center",color:"var(--green)",fontSize:10,fontWeight:700,padding:"3px 2px",borderLeft:"1px solid var(--border)"}}>{workC}</td>
                            <td style={{position:"sticky",right:0,background:ei%2===0?"var(--bg1)":"var(--bg2)",zIndex:1,textAlign:"center",color:"var(--red)",fontSize:10,padding:"3px 2px",borderLeft:"1px solid var(--border)"}}>{offC}</td>
                          </tr>
                        );
                        return rows;
                      })}
                    </tbody>
                  </table>
                </div>
              );
            })()}
          </div>
        )}

        {/* COMUNICADOS */}
        {tab === "comunicados" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12,marginBottom:16}}>
              <h3 style={{color:"var(--text)",margin:0,fontSize:mobileOnly?16:20}}>📢 Comunicados</h3>
              {isOwner && <button onClick={()=>{
                const comms = (data?.communications??[]).filter(c=>c.restaurantId===rid);
                const ok = resetTab("comunicados","Comunicados",()=>({communications:comms}));
                if(ok){ onUpdate("communications",(data?.communications??[]).filter(c=>c.restaurantId!==rid)); onUpdate("_toast","🗑️ Comunicados enviados para a lixeira"); }
              }} style={{...S.btnSecondary,fontSize:12,color:"var(--red)",borderColor:"var(--red)44"}}>🗑️ Resetar</button>}
            </div>
            {privacyMask ? (
              <div style={{...S.card,textAlign:"center",padding:40}}>
                <div style={{fontSize:36,marginBottom:12}}>🔒</div>
                <p style={{color:"var(--text3)",fontSize:14}}>Conteúdo dos comunicados oculto pelo modo privacidade.</p>
              </div>
            ) : (
              <ComunicadosManagerTab
                restaurantId={rid} communications={data?.communications ?? []}
                commAcks={data?.commAcks ?? {}} employees={employees}
                onUpdate={onUpdate} currentManagerName={currentUser?.name ?? "Gestor Adm."}
                isOwner={isOwner} trash={data?.trash}
              />
            )}
          </div>
        )}

        {/* FAQ */}
        {tab === "faq" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12,marginBottom:16}}>
              <h3 style={{color:"var(--text)",margin:0,fontSize:mobileOnly?16:20}}>❓ FAQ</h3>
              {isOwner && <button onClick={()=>{
                const faqRest = data?.faq?.[rid];
                const ok = resetTab("faq","FAQ",()=>({faq:faqRest}));
                if(ok){ const f={...data?.faq}; delete f[rid]; onUpdate("faq",f); onUpdate("_toast","🗑️ FAQ enviado para a lixeira"); }
              }} style={{...S.btnSecondary,fontSize:12,color:"var(--red)",borderColor:"var(--red)44"}}>🗑️ Resetar</button>}
            </div>

            {/* FAQs automáticas — expansíveis e com toggle */}
            {(()=>{
              // eslint-disable-next-line no-unused-vars
              const ac = "var(--ac)";
              const splitType = (localRest.divisionMode ?? MODE_AREA_POINTS) === MODE_AREA_POINTS ? "area" : "points";
              const taxRate = localRest.taxRate ?? 0.33;
              const taxLabel = taxRate===0.20?"20% (Simples Nacional)":"33% (Lucro Real/Presumido)";
              const restRolesCom = (data?.roles??[]).filter(r=>r.restaurantId===rid&&!r.inactive&&!r.noTip);
              const restRolesSem = (data?.roles??[]).filter(r=>r.restaurantId===rid&&!r.inactive&&r.noTip);
              const totalPts = restRolesCom.reduce((s,r)=>s+(parseFloat(r.points)||0),0);
              const now2 = new Date();
              const mk2 = `${now2.getFullYear()}-${String(now2.getMonth()+1).padStart(2,"0")}`;
              const curSplit2 = splits?.[rid]?.[mk2] ?? DEFAULT_SPLIT;
              const EX = 1000;
              const fmtR2 = n=>n.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});

              const FAQS_AUTO = [
                {
                  id:"__gorjeta__",
                  tabKey: null,
                  q:"💸 Como é calculada a gorjeta?",
                  a: splitType==="area"
                    ? `Modo atual: Área + Pontos\nA gorjeta total do dia é primeiro dividida pelo percentual de cada área. Depois, dentro de cada área, é dividida pelos pontos dos cargos presentes.\n\nDedução aplicada: ${taxLabel}\n\nPasso a passo:\n1. Gestor lança o valor total do dia\n2. Sistema separa o valor por área conforme os percentuais configurados (${AREAS.map(a=>`${a} ${curSplit2[a]??0}%`).join(", ")})\n3. Dentro de cada área, soma os pontos de quem trabalhou\n4. Divide o valor da área pelos pontos → valor por ponto da área\n5. Multiplica pelos pontos do cargo → bruto\n6. Deduz ${(taxRate*100).toFixed(0)}% → líquido\n\nExemplo (gorjeta R$${fmtR2(EX)}):\n• Salão recebe ${curSplit2["Salão"]??0}% → R$${fmtR2(EX*(curSplit2["Salão"]??0)/100)}\n• Cargo com 6pt de ${totalPts>0?totalPts:"X"}pt na área → bruto proporcional\n• Após ${(taxRate*100).toFixed(0)}% → líquido`
                    : `Modo atual: Pontos Global\nA gorjeta total do dia é somada e dividida diretamente pelos pontos de todos os empregados do restaurante que trabalharam, sem separação por área.\n\nDedução aplicada: ${taxLabel}\n\nPasso a passo:\n1. Gestor lança o valor total do dia\n2. Sistema soma os pontos de todos que trabalharam (total: ${totalPts}pt)\n3. Divide o total pelos pontos → valor por ponto\n4. Multiplica pelos pontos do cargo → bruto\n5. Deduz ${(taxRate*100).toFixed(0)}% → líquido\n\nExemplo (gorjeta R$${fmtR2(EX)}, ${totalPts}pt totais):\n• Valor por ponto: R$${totalPts>0?fmtR2(EX/totalPts):"—"}\n• Cargo com 6pt → R$${totalPts>0?fmtR2(EX/totalPts*6):"—"} bruto → R$${totalPts>0?fmtR2(EX/totalPts*6*(1-taxRate)):"—"} líquido`,
                },
                {
                  id:"__sistema__",
                  tabKey: null,
                  q: splitType==="area"?"🏢 Como funciona a divisão por área e pontos?":"📊 Como funciona a tabela de pontos?",
                  a: splitType==="area" ? (()=>{
                    const AREAS2=["Bar","Cozinha","Salão","Limpeza"];
                    const ativas=AREAS2.filter(a=>(curSplit2[a]??0)>0);
                    const linhas=ativas.map(a=>{
                      const pct=curSplit2[a]??0;
                      const cargos=restRolesCom.filter(r=>r.area===a);
                      const pts=cargos.reduce((s,r)=>s+(parseFloat(r.points)||0),0);
                      return `${a} — ${pct}%\n${cargos.map(r=>`   • ${r.name}: ${r.points}pt`).join("\n")}\n   Total: ${pts}pt`;
                    }).join("\n\n");
                    return `Sistema atual: Área + Pontos\n\nO valor total da gorjeta do dia é primeiro dividido pelo percentual configurado de cada área. Depois, dentro de cada área, o valor é dividido pelos pontos dos cargos dos empregados presentes.\n\nDistribuição por área:\n${linhas}${restRolesSem.length>0?"\n\nCargos sem gorjeta: "+restRolesSem.map(r=>r.name).join(", "):""}`;
                  })() : (()=>{
                    const linhas=restRolesCom.sort((a,b)=>(parseFloat(b.points)||0)-(parseFloat(a.points)||0)).map(r=>{
                      const pct=totalPts>0?((parseFloat(r.points)||0)/totalPts*100).toFixed(1):"0";
                      return `• ${r.name}: ${r.points}pt (${pct}%)`;
                    }).join("\n");
                    return `Sistema atual: Pontos Global\n\nTodos os pontos de todos os empregados do restaurante que trabalharam no dia são somados. O valor total da gorjeta é dividido por essa soma, e cada empregado recebe proporcionalmente aos pontos do seu cargo. Não há separação por área.\n\nTabela de cargos (${totalPts}pt total):\n${linhas}${restRolesSem.length>0?"\n\nCargos sem gorjeta: "+restRolesSem.map(r=>r.name).join(", "):""}`;
                  })(),
                },
                { id:"__escala__", tabKey:null, q:"📅 Como funciona a escala e por que ela importa?", a:"A escala registra a presença em cada dia e define quem recebe gorjeta.\n\nRecebe gorjeta: trabalhando normalmente ou compensação (C).\nNÃO recebe: folga, freela (FL), falta injustificada (F) + penalidade, falta justificada (FJ), atestado (A), férias (V).\n\nExceções:\n• Produção (🏭): recebe gorjeta todos os dias, exceto férias. Penalidade com percentuais distintos para cada tipo de falta.\n• Freela (🎯): nunca participa do rateio de gorjeta.\n• Status Freela no dia: empregado presente mas sem gorjeta naquele dia.\n\nNenhum empregado recebe gorjeta durante férias, incluindo os de produção." },
                { id:"__producao__", tabKey:null, q:`🏭 O que é empregado de produção?`, a:`Empregados marcados como "Produção" têm regras especiais de gorjeta:\n\n1. Recebem gorjeta TODOS os dias (trabalhando, folga, compensação, etc.)\n2. NÃO recebem gorjeta durante férias — assim como qualquer outro empregado\n3. A distribuição segue os pontos do cargo normalmente\n4. Penalidade por falta injustificada: ${localRest.producaoPenaltyU??6.66}% do pool mensal por dia\n5. Penalidade por falta justificada: ${localRest.producaoPenaltyJ??3.33}% do pool mensal por dia\n\nExemplo: pool mensal de R$10.000, 2 faltas injustificadas (${localRest.producaoPenaltyU??6.66}%) + 1 justificada (${localRest.producaoPenaltyJ??3.33}%) → desconto de ${((localRest.producaoPenaltyU??6.66)*2+(localRest.producaoPenaltyJ??3.33))}% = R$${fmtR2(10000*((localRest.producaoPenaltyU??6.66)*2+(localRest.producaoPenaltyJ??3.33))/100)}\n\nO status de produção é definido pelo gestor na aba Equipe, usando o ícone 🏭 ao lado do cargo. Pode ser atribuído a empregados de qualquer área.` },
                { id:"__freela__", tabKey:null, q:"🎯 O que é empregado freela?", a:"Empregados marcados como 'Freela' são colaboradores esporádicos que cobrem a equipe:\n\n1. Aparecem normalmente na escala\n2. Nunca participam do rateio de gorjeta\n3. Cargo e área são atribuídos normalmente\n\nAlém do flag no cadastro, existe o status 'Freela' (FL) na escala: marca um empregado regular como presente sem gorjeta naquele dia (ex: veio cobrir na folga).\n\nDefina o flag na aba Equipe usando o ícone 🎯 ao lado do cargo." },
                { id:"__dp__", tabKey:"dp", q:"💬 Para que serve o Fale com DP?", a:"Canal direto com o DP. Use para: dúvidas trabalhistas, atestados, documentos, sugestões, elogios e denúncias anônimas. O gestor do DP responde pelo app." },
                { id:"__comunicados__", tabKey:"comunicados", q:"📢 Como funcionam os comunicados?", a:"Avisos enviados pelo gestor para a equipe. O empregado recebe notificação, lê e confirma com \"Li e entendi\". O gestor acompanha quem confirmou." },
                { id:"__pin__", tabKey:null, q:"🔐 O que é o PIN e como trocar?", a:"O PIN é a senha de 4 dígitos numéricos. Para login: ID de empregado (ex: LBZ0005) ou CPF + PIN. Para trocar o PIN, solicite ao gestor que faça o reset." },
              ];

              // Estado local simulado via dataset (sem useState fora de componente)
              return (
                <div style={{padding:"16px 16px 0"}}>
                  <div style={{padding:"14px",borderRadius:12,background:"var(--ac-bg)",border:"1px solid var(--ac)33",marginBottom:16}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                      <span style={{fontSize:14}}>📐</span>
                      <span style={{color:"var(--ac-text)",fontWeight:700,fontSize:13}}>FAQs automáticas do sistema</span>
                    </div>
                    <p style={{color:"var(--text2)",fontSize:12,margin:"0 0 12px",lineHeight:1.5}}>
                      Geradas automaticamente com as regras do restaurante. Aparecem na seção "Regras do sistema" do FAQ do empregado. Use o toggle para mostrar ou ocultar cada uma.
                    </p>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {FAQS_AUTO.map((item) => {
                        // Admin controla via tabsConfig, Gestor via tabsGestor
                        const adminBloqueou = item.tabKey ? restaurant?.tabsConfig?.[item.tabKey] === false : false;
                        const gestorOcultou = item.tabKey ? restaurant?.tabsGestor?.[item.tabKey] === false : false;
                        const faqAutoOk = restaurant?.tabsGestor?.faqAuto?.[item.id] !== false;
                        // Se admin bloqueou aba → sempre oculto, sem toggle
                        // Se gestor ocultou aba → oculto, sem toggle
                        // Caso contrário → segue faqAutoOk
                        const abaOk = !adminBloqueou && !gestorOcultou;
                        const visivel = abaOk && faqAutoOk;
                        return (
                          <details key={item.id} style={{borderRadius:10,background:"var(--card-bg)",border:`1px solid ${visivel?"var(--ac)22":"var(--border)"}`,overflow:"hidden",opacity:visivel?1:0.6}}>
                            <summary style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",cursor:"pointer",listStyle:"none",gap:8}}>
                              <span style={{fontSize:13,fontWeight:600,color:visivel?"var(--text)":"var(--text3)",flex:1}}>{item.q}</span>
                              <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
                                {adminBloqueou && <span style={{fontSize:10,color:"var(--text3)",background:"var(--bg2)",padding:"2px 7px",borderRadius:10,border:"1px solid var(--border)"}}>aba bloqueada pelo admin</span>}
                                {!adminBloqueou && gestorOcultou && <span style={{fontSize:10,color:"var(--text3)",background:"var(--bg2)",padding:"2px 7px",borderRadius:10,border:"1px solid var(--border)"}}>aba oculta nas configurações</span>}
                                {abaOk && (
                                  <button onClick={e=>{
                                    e.preventDefault(); e.stopPropagation();
                                    const cur = restaurant?.tabsGestor?.faqAuto ?? {};
                                    const updated = restaurants.map(r=>r.id===rid?{...r,tabsGestor:{...(r.tabsGestor??{}),faqAuto:{...cur,[item.id]:!faqAutoOk}}}:r);
                                    onUpdate("restaurants",updated);
                                  }} style={{padding:"3px 10px",borderRadius:20,border:"none",background:visivel?"var(--green)":"var(--border)",color:visivel?"#fff":"var(--text3)",fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:11,whiteSpace:"nowrap"}}>
                                    {visivel?"👁 Exibindo":"🚫 Oculto"}
                                  </button>
                                )}
                                <span style={{color:"var(--text3)",fontSize:12}}>▾</span>
                              </div>
                            </summary>
                            <div style={{padding:"10px 12px 12px",color:"var(--text2)",fontSize:12,lineHeight:1.7,borderTop:"1px solid var(--ac)22",whiteSpace:"pre-wrap",fontFamily:"'DM Mono',monospace"}}>
                              {item.a}
                            </div>
                          </details>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })()}

            <FaqManagerTab restaurantId={rid} faq={data?.faq ?? {}} onUpdate={onUpdate} restaurant={restaurant} />
          </div>
        )}

        {/* FALE COM DP */}
        {tab === "dp" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12,marginBottom:16}}>
              <h3 style={{color:"var(--text)",margin:0,fontSize:mobileOnly?16:20}}>💬 Fale com DP</h3>
              {isOwner && <button onClick={()=>{
                const msgs = (data?.dpMessages??[]).filter(m=>m.restaurantId===rid);
                const ok = resetTab("dp","Fale com DP",()=>({dpMessages:msgs}));
                if(ok){ onUpdate("dpMessages",(data?.dpMessages??[]).filter(m=>m.restaurantId!==rid)); onUpdate("_toast","🗑️ Mensagens DP enviadas para a lixeira"); }
              }} style={{...S.btnSecondary,fontSize:12,color:"var(--red)",borderColor:"var(--red)44"}}>🗑️ Resetar</button>}
            </div>
            {privacyMask ? (
              <div style={{...S.card,textAlign:"center",padding:40}}>
                <div style={{fontSize:36,marginBottom:12}}>🔒</div>
                <p style={{color:"var(--text3)",fontSize:14}}>Mensagens do DP ocultas pelo modo privacidade.</p>
              </div>
            ) : (
              <DpManagerTab restaurantId={rid} dpMessages={data?.dpMessages ?? []} onUpdate={onUpdate} isOwner={isOwner} />
            )}
          </div>
        )}

        {/* HORARIOS */}
        {tab === "horarios" && (
          <div>
            <WorkScheduleManagerTab restaurantId={rid} employees={employees} roles={roles} workSchedules={data?.workSchedules??{}} notifications={data?.notifications??[]} managers={data?.managers??[]} currentManagerName={currentUser?.name ?? (isOwner?"Gestor AppTip":"Gestor Adm.")} onUpdate={onUpdate} communications={data?.communications??[]} isOwner={isOwner} mobileOnly={mobileOnly} />
          </div>
        )}

        {/* VALE TRANSPORTE */}
        {tab === "vt" && (
          <ValeTransporteTab restaurantId={rid} employees={employees} roles={roles} workSchedules={data?.workSchedules??{}} schedules={data?.schedules??{}} vtConfig={data?.vtConfig??{}} vtMonthly={data?.vtMonthly??{}} vtPayments={data?.vtPayments??{}} onUpdate={onUpdate} currentUser={currentUser} isOwner={isOwner} mobileOnly={mobileOnly} schedulePrevista={data?.schedulePrevista??{}} scheduleStatus={data?.scheduleStatus??{}} scheduleVersions={data?.scheduleVersions??{}} />
        )}

        {/* TRILHA — integrada na aba Equipe */}

        {/* NOTIFICAÇÕES */}
        {tab === "notificacoes" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12,marginBottom:16}}>
              <h3 style={{color:"var(--text)",margin:0,fontSize:mobileOnly?16:20}}>📬 Notificações</h3>
            </div>
          {privacyMask ? (
            <div style={{...S.card,textAlign:"center",padding:40,margin:20}}>
              <div style={{fontSize:36,marginBottom:12}}>🔒</div>
              <p style={{color:"var(--text3)",fontSize:14}}>Notificações ocultas pelo modo privacidade.</p>
            </div>
          ) : (
            <NotificacoesTab restaurantId={rid} dpMessages={data?.dpMessages??[]} notifications={data?.notifications??[]} onUpdate={onUpdate} />
          )}
          </div>
        )}


        {/* GESTORES (DP) */}
        {tab === "dp_gestores" && isDP && (() => {
          const managers = data?.managers ?? [];
          const myId = currentUser?.id;
          // eslint-disable-next-line no-unused-vars
          const myRestIds = currentUser?.restaurantIds ?? [];
          const restMgrs = managers.filter(m => (m.restaurantIds??[]).includes(rid) && m.id !== myId);
          const canEdit = (m) => m.createdBy === myId;

          return (
            <div style={{padding:"24px",maxWidth:700,margin:"0 auto"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
                <div>
                  <h3 style={{color:"var(--text)",fontSize:16,fontWeight:700,margin:"0 0 4px"}}>Gestores do restaurante</h3>
                  <p style={{color:"var(--text3)",fontSize:12,margin:0}}>Crie e gerencie gestores para este restaurante</p>
                </div>
                <button onClick={()=>{
                  setDpMgrEdit(null);
                  setDpMgrForm({name:"",cpf:"",pin:"",restaurantIds:[rid],perms:{tips:true,schedule:true},isDP:false,profile:"custom",areas:[]});
                  setDpMgrModal(true);
                }} style={{...S.btnPrimary,width:"auto",padding:"10px 20px"}}>+ Novo Gestor</button>
              </div>

              {restMgrs.length === 0 && (
                <div style={{...S.card,textAlign:"center",padding:40}}>
                  <div style={{fontSize:36,marginBottom:12}}>👔</div>
                  <p style={{color:"var(--text3)",fontSize:14}}>Nenhum outro gestor neste restaurante.</p>
                </div>
              )}

              {restMgrs.map(m => {
                const profileLabel = m.profile==="dp"?"📬 Gestor Adm.":m.profile==="lider"?"👔 Líder Op.":"⚙️ Custom";
                const mine = canEdit(m);
                return (
                  <div key={m.id} style={{...S.card,marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center",gap:12}}>
                    <div>
                      <div style={{color:"var(--text)",fontWeight:700,fontSize:14}}>{m.name}</div>
                      <div style={{color:"var(--text3)",fontSize:11}}>
                        {profileLabel}
                        {m.profile==="lider" && (m.areas??[]).length>0 && ` · ${m.areas.join(", ")}`}
                        {m.cpf && ` · ${privacyMask ? "•••.•••.•••-••" : m.cpf}`}
                      </div>
                      {!mine && <div style={{color:"var(--text3)",fontSize:10,marginTop:2,fontStyle:"italic"}}>Criado pelo admin</div>}
                    </div>
                    {mine && (
                      <div style={{display:"flex",gap:6,flexShrink:0,flexWrap:"wrap"}}>
                        <button onClick={()=>{
                          const cpfDigits = (m.cpf??"").replace(/\D/g,"");
                          if (cpfDigits.length < 4) { onUpdate("_toast","⚠️ CPF inválido — não foi possível gerar PIN automático"); return; }
                          const newPin = cpfDigits.slice(0,4);
                          if(!window.confirm(`Resetar PIN de "${m.name}"?\n\nO PIN voltará para ${newPin} (4 primeiros dígitos do CPF) e ele será obrigado a trocar no próximo acesso.`)) return;
                          onUpdate("managers", managers.map(x=>x.id===m.id?{...x,pin:newPin,mustChangePin:true}:x));
                          onUpdate("_toast",`🔑 PIN de ${m.name} resetado para ${newPin}`);
                        }} title="Resetar PIN para os 4 primeiros dígitos do CPF" style={{...S.btnSecondary,fontSize:11,padding:"5px 10px"}}>🔑 Resetar PIN</button>
                        <button onClick={()=>{
                          setDpMgrEdit(m.id);
                          setDpMgrForm({name:m.name,cpf:m.cpf??"",pin:m.pin??"",restaurantIds:m.restaurantIds??[],perms:m.perms??{tips:true,schedule:true},isDP:m.isDP??false,profile:m.profile??"custom",areas:m.areas??[]});
                          setDpMgrModal(true);
                        }} style={{...S.btnSecondary,fontSize:11,padding:"5px 12px"}}>Editar</button>
                        <button onClick={()=>{
                          if(!window.confirm(`Excluir gestor "${m.name}"?`)) return;
                          onUpdate("managers",managers.filter(x=>x.id!==m.id));
                          onUpdate("_toast",`🗑️ ${m.name} excluído`);
                        }} style={{...S.btnSecondary,fontSize:11,padding:"5px 10px",color:"var(--red)",borderColor:"var(--red)44"}}>✕</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Modal novo gestor (DP) */}
        {dpMgrModal && isDP && (
          <Modal title={dpMgrEdit?"Editar Gestor":"Novo Gestor"} onClose={()=>setDpMgrModal(false)} wide>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {/* Puxar da equipe */}
              {!dpMgrEdit && (() => {
                const restEmpsList = restEmps.filter(e => !e.inactive);
                if (restEmpsList.length === 0) return null;
                return (
                  <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 14px"}}>
                    <label style={{...S.label,margin:0}}>👥 Puxar dados de um empregado da equipe</label>
                    <p style={{color:"var(--text3)",fontSize:11,margin:"4px 0 8px"}}>Selecione para pré-preencher nome e CPF. O empregado continua ativo na equipe.</p>
                    <select onChange={e => { const emp = restEmpsList.find(x => x.id === e.target.value); if (!emp) return; setDpMgrForm(f => ({...f, name: emp.name, cpf: emp.cpf ?? ""})); }} style={{...S.input,cursor:"pointer"}} defaultValue="">
                      <option value="" disabled>Selecionar empregado...</option>
                      {restEmpsList.sort((a,b)=>a.name.localeCompare(b.name)).map(e => { const role = restRoles.find(r => r.id === e.roleId); return <option key={e.id} value={e.id}>{e.name}{role ? ` — ${role.name}` : ""}{e.cpf ? ` (${e.cpf})` : ""}</option>; })}
                    </select>
                  </div>
                );
              })()}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label style={S.label}>Nome completo</label><input value={dpMgrForm.name} onChange={e=>setDpMgrForm({...dpMgrForm,name:e.target.value})} style={S.input}/></div>
                <div><label style={S.label}>CPF *</label><input value={dpMgrForm.cpf} onChange={e=>setDpMgrForm({...dpMgrForm,cpf:maskCpf(e.target.value)})} placeholder="000.000.000-00" style={S.input} inputMode="numeric"/></div>
              </div>
              {dpMgrEdit
                ? <div><label style={S.label}>PIN (4 dígitos)</label><input type="password" value={dpMgrForm.pin} onChange={e=>setDpMgrForm({...dpMgrForm,pin:e.target.value})} maxLength={4} inputMode="numeric" style={S.input}/></div>
                : <div style={{padding:"8px 12px",borderRadius:8,background:"var(--bg2)",border:"1px solid var(--border)",fontSize:12,color:"var(--text3)"}}> PIN inicial = 4 primeiros dígitos do CPF. No primeiro acesso o gestor será solicitado a trocar.</div>
              }

              {/* Perfil */}
              <div>
                <label style={S.label}>Perfil do gestor</label>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {[
                    {id:"dp",icon:"📬",title:"Gestor Administrativo",desc:"Acesso completo: gorjetas, escala, cargos, equipe, comunicados, FAQ, DP e notificações."},
                    {id:"lider",icon:"👔",title:"Líder Operacional",desc:"Acesso apenas à escala e horários da(s) sua(s) área(s)."},
                    {id:"custom",icon:"⚙️",title:"Personalizado",desc:"Escolha as permissões manualmente."},
                  ].map(p=>{
                    const on = dpMgrForm.profile === p.id;
                    return (
                      <button key={p.id} onClick={()=>{
                        const presets = {
                          dp: {perms:{tips:true,schedule:true,roles:true,employees:true,comunicados:true,faq:true,dp:true,horarios:true},isDP:true,areas:[]},
                          lider: {perms:{tips:false,schedule:true,roles:false,employees:false,comunicados:false,faq:false,dp:false,horarios:true,vt:false},isDP:false},
                          custom: {isDP:dpMgrForm.isDP},
                        };
                        setDpMgrForm(f=>({...f,...presets[p.id],profile:p.id,areas:p.id==="lider"?f.areas:[]}));
                      }}
                        style={{width:"100%",padding:"12px 14px",borderRadius:10,border:`1px solid ${on?ac:"var(--border)"}`,background:on?"var(--ac-bg)":"transparent",color:on?"var(--ac-text)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,textAlign:"left",display:"flex",alignItems:"center",gap:10}}>
                        <span style={{fontSize:18}}>{p.icon}</span>
                        <div>
                          <div style={{fontWeight:700}}>{on?"✓ ":""}{p.title}</div>
                          <div style={{fontSize:11,opacity:0.7,marginTop:2}}>{p.desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Áreas Líder */}
              {dpMgrForm.profile === "lider" && (
                <div>
                  <label style={S.label}>Áreas do líder</label>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {AREAS.map(a=>{
                      const on = (dpMgrForm.areas??[]).includes(a);
                      return <button key={a} onClick={()=>setDpMgrForm(f=>({...f,areas:on?f.areas.filter(x=>x!==a):[...(f.areas??[]),a]}))}
                        style={{padding:"8px 16px",borderRadius:20,border:`1px solid ${on?AREA_COLORS[a]??"#555":"var(--border)"}`,background:on?(AREA_COLORS[a]??"#555")+"22":"transparent",color:on?AREA_COLORS[a]??"var(--text)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:on?700:400}}>
                        {on?"✓ ":""}{a}
                      </button>;
                    })}
                  </div>
                  {(dpMgrForm.areas??[]).length===0 && <p style={{color:"var(--red)",fontSize:11,marginTop:6}}>Selecione pelo menos uma área.</p>}
                </div>
              )}

              {/* Custom perms */}
              {dpMgrForm.profile === "custom" && (
                <div>
                  <label style={S.label}>Permissões</label>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    {[["tips","💸 Gorjetas"],["schedule","📅 Escala"],["roles","🏷️ Cargos"],["employees","👥 Equipe"],["comunicados","📢 Comunicados"],["faq","❓ FAQ"],["dp","💬 Fale c/ DP"],["horarios","🕐 Horários"],["vt","🚌 Vale Transporte"]].map(([k,lbl])=>{
                      const on = dpMgrForm.perms?.[k] !== false;
                      return (
                        <button key={k} onClick={()=>setDpMgrForm({...dpMgrForm,perms:{...dpMgrForm.perms,[k]:!on}})}
                          style={{padding:"10px",borderRadius:10,border:`1px solid ${on?"var(--green)":"var(--border)"}`,background:on?"var(--green-bg)":"transparent",color:on?"var(--green)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,textAlign:"left"}}>
                          {on?"✓":"○"} {lbl}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Restaurantes */}
              {(currentUser?.restaurantIds??[]).length > 1 && (
                <div>
                  <label style={S.label}>Restaurantes com acesso</label>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {restaurants.filter(r=>(currentUser?.restaurantIds??[]).includes(r.id)).map(r=>{
                      const sel = (dpMgrForm.restaurantIds??[]).includes(r.id);
                      return (
                        <button key={r.id} onClick={()=>setDpMgrForm(f=>({...f,restaurantIds:sel?f.restaurantIds.filter(x=>x!==r.id):[...(f.restaurantIds??[]),r.id]}))}
                          style={{padding:"10px 14px",borderRadius:10,border:`1px solid ${sel?ac:"var(--border)"}`,background:sel?"var(--ac-bg)":"transparent",color:sel?"var(--ac-text)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,textAlign:"left"}}>
                          {sel?"✓":"○"} {r.name} {r.id===rid?"(atual)":""}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <button onClick={()=>{
                if(!dpMgrForm.name.trim()) { onUpdate("_toast","⚠️ Nome é obrigatório"); return; }
                const cpfDigits = (dpMgrForm.cpf??"").replace(/\D/g,"");
                if(cpfDigits.length<11) { onUpdate("_toast","⚠️ CPF é obrigatório (11 dígitos)"); return; }
                if(dpMgrForm.profile==="lider"&&(dpMgrForm.areas??[]).length===0) { onUpdate("_toast","⚠️ Selecione pelo menos uma área"); return; }
                const managers = data?.managers ?? [];
                const isNew = !dpMgrEdit;
                const pin = isNew ? cpfDigits.slice(0,4) : (dpMgrForm.pin || cpfDigits.slice(0,4));
                const m = { ...dpMgrForm, pin, id: dpMgrEdit ?? Date.now().toString(), createdBy: currentUser?.id, ...(isNew ? {mustChangePin:true} : {}) };
                onUpdate("managers", dpMgrEdit ? managers.map(x=>x.id===dpMgrEdit?{...x,...m}:x) : [...managers,m]);
                setDpMgrModal(false);
                onUpdate("_toast", dpMgrEdit?"✅ Gestor atualizado":"✅ Gestor criado");
              }} style={S.btnPrimary}>{dpMgrEdit?"Salvar":"Criar Gestor"}</button>
            </div>
          </Modal>
        )}

        {/* CONFIG */}
        {tab === "config" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12,marginBottom:16}}>
              <h3 style={{color:"var(--text)",margin:0,fontSize:mobileOnly?16:20}}>⚙️ Configurações</h3>
            </div>
            {/* Salvar / Descartar configurações — topo fixo */}
            {configDirty && (
              <div style={{position:"sticky",top:0,zIndex:50,marginBottom:16}}>
                <div style={{background:"var(--card-bg)",border:"2px solid var(--ac)",borderRadius:14,padding:"14px 18px",boxShadow:"0 4px 20px rgba(0,0,0,0.15)"}}>
                  <p style={{color:"var(--ac)",fontSize:13,fontWeight:700,margin:"0 0 10px"}}>⚠️ Alterações não salvas</p>
                  <div style={{display:"flex",gap:10}}>
                    <button onClick={saveConfig} style={{...S.btnPrimary,flex:1,padding:"12px",fontSize:14,fontWeight:700}}>Salvar Configurações</button>
                    <button onClick={discardConfig} style={{...S.btnSecondary,padding:"12px 16px",fontSize:13}}>Descartar</button>
                  </div>
                </div>
              </div>
            )}
            {/* Abas opcionais — só supergestor */}
            {isOwner && (
              <div style={{...S.card,marginBottom:20}}>
                <p style={{color:ac,fontSize:14,fontWeight:700,margin:"0 0 4px"}}>📋 Abas autorizadas pelo Admin</p>
                <p style={{color:"var(--text3)",fontSize:12,marginBottom:14}}>Define quais abas o restaurante pode usar. O gestor pode escolher quais exibir dentro das autorizadas.</p>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {[
                    ["roles",       "🏷️ Cargos"],
                    ["employees",   "👥 Equipe"],
                    ["horarios",    "🕐 Horários"],
                    ["faq",         "❓ FAQ"],
                    ["comunicados", "📢 Comunicados"],
                    ["dp",          "💬 Fale com DP"],
                  ].map(([key, label]) => {
                    const isOn = getTabsConfig(key);
                    return (
                      <div key={key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"var(--bg1)",borderRadius:10,border:`1px solid ${isOn?"#10b98133":"var(--border)"}`}}>
                        <span style={{color:isOn?"var(--text)":"var(--text3)",fontSize:13,fontWeight:isOn?600:400}}>{label}</span>
                        <button onClick={()=>toggleAdminTab(key)} style={{padding:"5px 14px",borderRadius:20,border:"none",background:isOn?"var(--green)":"var(--border)",color:isOn?"#fff":"#555",fontWeight:700,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>
                          {isOn?"Autorizada":"Bloqueada"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Abas visíveis — gestor escolhe dentro das autorizadas */}
            {!isOwner && (
              <div style={{...S.card,marginBottom:20}}>
                <p style={{color:ac,fontSize:14,fontWeight:700,margin:"0 0 4px"}}>📋 Abas visíveis</p>
                <p style={{color:"var(--text3)",fontSize:12,marginBottom:14}}>Escolha quais abas aparecem para você e para os empregados. Só é possível ativar abas autorizadas pelo administrador.</p>
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {[
                    ["horarios",    "🕐 Horários"],
                    ["faq",         "❓ FAQ"],
                    ["comunicados", "📢 Comunicados"],
                    ["dp",          "💬 Fale com DP"],
                  ].filter(([key]) => restaurant.tabsConfig?.[key] !== false)
                  .map(([key, label]) => {
                    const isOn = getTabsGestor(key);
                    return (
                      <div key={key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"var(--bg1)",borderRadius:10,border:`1px solid ${isOn?"#10b98133":"var(--border)"}`}}>
                        <span style={{color:isOn?"var(--text)":"var(--text3)",fontSize:13,fontWeight:isOn?600:400}}>{label}</span>
                        <button onClick={()=>toggleGestorTab(key)} style={{padding:"5px 14px",borderRadius:20,border:"none",background:isOn?"var(--green)":"var(--border)",color:isOn?"#fff":"#555",fontWeight:700,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>
                          {isOn?"Visível":"Oculta"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{...S.card,marginBottom:20}}>
              <p style={{color:ac,fontSize:14,fontWeight:700,margin:"0 0 4px"}}>Retenção Fiscal sobre Gorjeta</p>
              <p style={{color:"var(--text3)",fontSize:12,marginBottom:12}}>Conforme a Lei 13.419/2017, a gorjeta é rendimento do trabalhador sujeito a encargos. A alíquota depende do regime tributário do estabelecimento.</p>

              <div style={{display:"flex",gap:10,marginBottom:14}}>
                {[[0.33,"33%"],[0.20,"20%"]].map(([rate,lbl])=>{
                  const sel = (localRest.taxRate ?? TAX) === rate;
                  return (
                    <button key={rate} onClick={()=>{
                      patchConfig({ taxRate: rate });
                    }} style={{flex:1,padding:"12px",borderRadius:12,border:`2px solid ${sel?ac:"var(--border)"}`,background:sel?ac+"11":"transparent",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:16,fontWeight:700,color:sel?ac:"#555"}}>
                      {lbl}
                    </button>
                  );
                })}
              </div>

              {/* Explicação das alíquotas */}
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <div style={{padding:"12px 14px",borderRadius:10,background:(localRest.taxRate??TAX)===0.33?"var(--ac-bg)":"var(--bg2)",border:`1px solid ${(localRest.taxRate??TAX)===0.33?"var(--ac)33":"var(--border)"}`}}>
                  <div style={{fontWeight:700,fontSize:13,color:"var(--text)",marginBottom:4}}>33% — Lucro Real ou Lucro Presumido</div>
                  <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.6}}>
                    Aplica-se a empresas tributadas pelo Lucro Real ou Presumido. Incide INSS patronal (20%) + FGTS (8%) + RAT/terceiros (~5%). Base: art. 457 CLT e Lei 13.419/2017.
                  </div>
                </div>
                <div style={{padding:"12px 14px",borderRadius:10,background:(localRest.taxRate??TAX)===0.20?"var(--ac-bg)":"var(--bg2)",border:`1px solid ${(localRest.taxRate??TAX)===0.20?"var(--ac)33":"var(--border)"}`}}>
                  <div style={{fontWeight:700,fontSize:13,color:"var(--text)",marginBottom:4}}>20% — Simples Nacional</div>
                  <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.6}}>
                    Aplica-se a MEI, ME e EPP optantes pelo Simples Nacional. A gorjeta integra a folha de pagamento com encargos simplificados. Base: LC 123/2006 e Resolução CGSN 140/2018.
                  </div>
                </div>
              </div>
              <p style={{color:"var(--text3)",fontSize:11,marginTop:10,marginBottom:0,fontStyle:"italic"}}>⚠️ Esta configuração não substitui orientação contábil. Consulte seu contador para confirmar a alíquota correta.</p>
            </div>
            {/* Fault Penalty */}
            <div style={{...S.card,marginBottom:20}}>
              <p style={{color:ac,fontSize:14,fontWeight:700,margin:"0 0 6px"}}>Penalidade por Falta Injustificada</p>
              <p style={{color:"var(--text3)",fontSize:12,marginBottom:14}}>Percentual do pool mensal de gorjetas descontado por cada dia de falta injustificada. O desconto é cumulativo: se um empregado tiver 3 faltas e a penalidade for 2%, será descontado 6% do pool mensal.</p>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <p style={{color:"var(--text3)",fontSize:11,margin:0,fontWeight:600}}>Por área (empregados regulares):</p>
                {AREAS.map(area => {
                  const current = localRest.faultPenalty?.[area] ?? 0;
                  return (
                    <div key={area} style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{minWidth:80}}><AreaBadge area={area}/></div>
                      <input type="number" min="0" max="20" step="0.01" value={current}
                        onChange={e => {
                          const val = parseFloat(e.target.value) || 0;
                          patchConfig({ faultPenalty: { ...(localRest.faultPenalty??{}), [area]: Math.round(val*100)/100 } });
                        }}
                        style={{...S.input, width:70, textAlign:"center"}}
                      />
                      <span style={{color:"var(--text3)",fontSize:13}}>% por falta</span>
                    </div>
                  );
                })}
                <div style={{borderTop:"1px solid var(--border)",paddingTop:10,marginTop:4}}>
                  <p style={{color:"#ec4899",fontSize:11,margin:"0 0 8px",fontWeight:600}}>🏭 Empregados de Produção:</p>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                    <div style={{minWidth:130}}>
                      <span style={{background:"#dc262611",color:"var(--red)",padding:"3px 10px",borderRadius:8,fontSize:11,fontWeight:700,fontFamily:"'DM Mono',monospace"}}>Falta injustificada</span>
                    </div>
                    <input type="number" min="0" max="20" step="0.01" value={localRest.producaoPenaltyU ?? 6.66}
                      onChange={e => {
                        const val = parseFloat(e.target.value) || 0;
                        patchConfig({ producaoPenaltyU: Math.round(val*100)/100 });
                      }}
                      style={{...S.input, width:70, textAlign:"center"}}
                    />
                    <span style={{color:"var(--text3)",fontSize:13}}>% por falta</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{minWidth:130}}>
                      <span style={{background:"#f59e0b11",color:"#f59e0b",padding:"3px 10px",borderRadius:8,fontSize:11,fontWeight:700,fontFamily:"'DM Mono',monospace"}}>Falta justificada</span>
                    </div>
                    <input type="number" min="0" max="20" step="0.01" value={localRest.producaoPenaltyJ ?? 3.33}
                      onChange={e => {
                        const val = parseFloat(e.target.value) || 0;
                        patchConfig({ producaoPenaltyJ: Math.round(val*100)/100 });
                      }}
                      style={{...S.input, width:70, textAlign:"center"}}
                    />
                    <span style={{color:"var(--text3)",fontSize:13}}>% por falta</span>
                  </div>
                  <div style={{background:"#ec489911",border:"1px solid #ec489922",borderRadius:10,padding:"10px 14px",marginTop:10}}>
                    <p style={{color:"var(--text2)",fontSize:12,margin:0,lineHeight:1.6}}>
                      <strong style={{color:"#ec4899"}}>Como funciona a produção:</strong> Empregados marcados como "Produção" (🏭) recebem gorjeta <strong>todos os dias</strong>, exceto férias. Sofrem penalidade tanto por falta injustificada quanto justificada, cada uma com seu percentual. O desconto é sobre o pool mensal total, por dia de falta. Pode ser atribuído a empregados de qualquer área.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div style={{...S.card,marginBottom:20}}>
              <p style={{color:ac,fontSize:14,fontWeight:700,margin:"0 0 8px"}}>Modalidade de Divisão</p>
              <p style={{color:"var(--text3)",fontSize:12,marginBottom:14}}>Define como a gorjeta é dividida entre os empregados.</p>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {[[MODE_AREA_POINTS,"🏷️ Áreas + Pontos","Divide por área (%) e depois por pontos dentro de cada área"],[MODE_GLOBAL_POINTS,"⚡ Pontos Global","Divide diretamente pelos pontos de todos os empregados, sem separação por área"]].map(([mode,label,desc])=>{
                  const selected = (localRest.divisionMode ?? MODE_AREA_POINTS) === mode;
                  return (
                    <button key={mode} onClick={()=>{
                      patchConfig({ divisionMode: mode });
                    }} style={{padding:"14px 16px",borderRadius:12,border:`2px solid ${selected?ac:"var(--border)"}`,background:selected?ac+"11":"transparent",cursor:"pointer",textAlign:"left",fontFamily:"'DM Mono',monospace"}}>
                      <div style={{color:selected?ac:"var(--text)",fontWeight:700,fontSize:14}}>{label}</div>
                      <div style={{color:"var(--text3)",fontSize:12,marginTop:4}}>{desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            {/* Exibir gorjeta para empregados */}
            <div style={{...S.card,marginBottom:20}}>
              <p style={{color:ac,fontSize:14,fontWeight:700,margin:"0 0 8px"}}>👁️ Exibir Gorjeta para Empregados</p>
              <p style={{color:"var(--text3)",fontSize:12,marginBottom:14}}>Quando ativo, o empregado consegue ver a aba de gorjeta no aplicativo. Os valores só aparecem após confirmação semanal pelo DP. Se desativado, a aba de gorjeta fica completamente oculta para os empregados deste restaurante.</p>
              <label style={{display:"flex",alignItems:"center",gap:12,cursor:"pointer"}}>
                <div onClick={()=>patchConfig({ showTipsToEmployee: !localRest.showTipsToEmployee })} style={{width:48,height:26,borderRadius:13,background:localRest.showTipsToEmployee?ac:"var(--border)",position:"relative",cursor:"pointer",transition:"background 0.2s"}}>
                  <div style={{width:22,height:22,borderRadius:11,background:"#fff",position:"absolute",top:2,left:localRest.showTipsToEmployee?24:2,transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
                </div>
                <span style={{color:"var(--text)",fontSize:14,fontWeight:600}}>{localRest.showTipsToEmployee ? "Ativo — empregado vê gorjeta" : "Desativado — gorjeta oculta"}</span>
              </label>
            </div>
            {/* Privacidade */}
            <div style={{...S.card,marginBottom:20}}>
              <p style={{color:ac,fontSize:14,fontWeight:700,margin:"0 0 8px"}}>🔒 Privacidade</p>
              <p style={{color:"var(--text3)",fontSize:12,marginBottom:14}}>Quando ativo, oculta dados sensíveis (valores de gorjeta, CPFs, mensagens DP e comunicados) da visão do administrador AppTip.</p>
              <label style={{display:"flex",alignItems:"center",gap:12,cursor:"pointer"}}>
                <div onClick={()=>patchConfig({ privacyMode: !localRest.privacyMode })} style={{width:48,height:26,borderRadius:13,background:localRest.privacyMode?ac:"var(--border)",position:"relative",cursor:"pointer",transition:"background 0.2s"}}>
                  <div style={{width:22,height:22,borderRadius:11,background:"#fff",position:"absolute",top:2,left:localRest.privacyMode?24:2,transition:"left 0.2s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
                </div>
                <span style={{color:"var(--text)",fontSize:14,fontWeight:600}}>{localRest.privacyMode ? "Ativo — dados ocultos para o admin" : "Desativado"}</span>
              </label>
            </div>
            {/* Backup do restaurante — admin only */}
            {isOwner && (
              <div style={{...S.card,marginBottom:20}}>
                <p style={{color:ac,fontSize:14,fontWeight:700,margin:"0 0 4px"}}>💾 Backup do Restaurante</p>
                <p style={{color:"var(--text3)",fontSize:12,marginBottom:14}}>Exporta todos os dados deste restaurante: empregados, cargos, gorjetas, escalas, gestores vinculados e configurações financeiras.</p>
                <button onClick={()=>{
                  const restEmps = employees.filter(e=>e.restaurantId===restaurant.id);
                  const restRoles = roles.filter(ro=>ro.restaurantId===restaurant.id);
                  const restTips = tips.filter(t=>t.restaurantId===restaurant.id);
                  const restSchedules = schedules.filter(s=>s.restaurantId===restaurant.id);
                  const restMgrs = (data?.managers??[]).filter(m=>m.restaurantIds?.includes(restaurant.id)).map(m=>({...m,pin:"***"}));
                  const exportData = {
                    exportedAt: new Date().toISOString(),
                    restaurante: restaurant,
                    empregados: restEmps,
                    cargos: restRoles,
                    gorjetas: restTips,
                    escalas: restSchedules,
                    gestores: restMgrs,
                  };
                  const safeName = restaurant.name.replace(/[^a-zA-Z0-9]/g,"_").toLowerCase();
                  const blob = new Blob([JSON.stringify(exportData,null,2)],{type:"application/json"});
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href=url; a.download=`apptip_backup_${safeName}_${today()}.json`; a.click();
                  URL.revokeObjectURL(url);
                  onUpdate("_toast",`✅ Backup de ${restaurant.name} exportado!`);
                }} style={{...S.btnSecondary,color:"var(--green)",borderColor:"var(--green)",fontSize:13,width:"100%",textAlign:"center",padding:"12px"}}>
                  💾 Exportar backup de {restaurant.name}
                </button>
              </div>
            )}
            {/* Zona de perigo — excluir restaurante (admin only) */}
            {isOwner && (
              <div style={{...S.card,marginBottom:20,border:"1px solid var(--red)33",background:"#fef2f2"}}>
                <p style={{color:"var(--red)",fontSize:14,fontWeight:700,margin:"0 0 4px"}}>⚠️ Zona de Perigo</p>
                <p style={{color:"var(--text3)",fontSize:12,marginBottom:14}}>Mover este restaurante para a lixeira. Você poderá restaurá-lo posteriormente pela aba Lixeira.</p>
                <button onClick={()=>{
                  if(!window.confirm(`Tem certeza que deseja mover "${restaurant.name}" para a lixeira?\n\nTodos os dados do restaurante serão preservados na lixeira.`)) return;
                  if(window.confirm(`Deseja exportar um backup de "${restaurant.name}" antes de excluir?`)) {
                    const restEmps = employees.filter(e=>e.restaurantId===restaurant.id);
                    const restRoles = roles.filter(ro=>ro.restaurantId===restaurant.id);
                    const restTips = tips.filter(t=>t.restaurantId===restaurant.id);
                    const restSchedules = schedules.filter(s=>s.restaurantId===restaurant.id);
                    const restMgrs = (data?.managers??[]).filter(m=>m.restaurantIds?.includes(restaurant.id)).map(m=>({...m,pin:"***"}));
                    const exportData = {
                      exportedAt: new Date().toISOString(),
                      restaurante: restaurant,
                      empregados: restEmps,
                      cargos: restRoles,
                      gorjetas: restTips,
                      escalas: restSchedules,
                      gestores: restMgrs,
                    };
                    const safeName = restaurant.name.replace(/[^a-zA-Z0-9]/g,"_").toLowerCase();
                    const blob = new Blob([JSON.stringify(exportData,null,2)],{type:"application/json"});
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href=url; a.download=`apptip_backup_${safeName}_${today()}.json`; a.click();
                    URL.revokeObjectURL(url);
                  }
                  const trash = data?.trash ?? { restaurants:[], managers:[], employees:[] };
                  const entry = { ...restaurant, deletedAt: new Date().toISOString(), deletedBy: currentUser?.name ?? "Admin" };
                  const newTrash = { ...trash, restaurants: [...(trash.restaurants??[]), entry] };
                  onUpdate("trash", newTrash);
                  onUpdate("restaurants", restaurants.filter(x=>x.id!==restaurant.id));
                  onUpdate("_toast", `🗑️ ${restaurant.name} movido para a lixeira.`);
                }} style={{...S.btnSecondary,color:"var(--red)",borderColor:"var(--red)",fontSize:13,width:"100%",textAlign:"center",padding:"12px"}}>
                  🗑️ Excluir {restaurant.name}
                </button>
              </div>
            )}
            {(localRest.divisionMode ?? MODE_AREA_POINTS) === MODE_AREA_POINTS && (
              <div style={{...S.card,marginBottom:20}}>
                <p style={{color:ac,fontSize:14,fontWeight:700,margin:"0 0 4px"}}>Distribuição por Área</p>
                <p style={{color:"var(--text3)",fontSize:11,margin:"0 0 14px"}}>Percentuais de cada área no pool total.</p>
                <div style={{marginBottom:14}}><MonthNav year={year} month={month} onChange={(y,m)=>{setYear(y);setMonth(m);setSplitForm(null);}}/></div>
                {splitForm ? (
                  <div>
                    {AREAS.map(a=><div key={a} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}><div style={{minWidth:70}}><AreaBadge area={a}/></div><input type="number" min="0" max="100" step="0.5" value={splitForm[a]} onChange={e=>setSplitForm({...splitForm,[a]:e.target.value})} style={{...S.input,width:80,textAlign:"center"}}/><span style={{color:"var(--text3)",fontSize:13}}>%</span></div>)}
                    <div style={{color:Math.abs(AREAS.reduce((a,k)=>a+parseFloat(splitForm[k]||0),0)-100)<0.01?"var(--green)":"var(--red)",fontSize:13,marginBottom:10}}>Total: {AREAS.reduce((a,k)=>a+parseFloat(splitForm[k]||0),0).toFixed(1)}%</div>
                    <div style={{display:"flex",gap:8}}><button onClick={saveSplit} style={{...S.btnPrimary,flex:1}}>Salvar</button><button onClick={()=>setSplitForm(null)} style={S.btnSecondary}>Cancelar</button></div>
                  </div>
                ) : (
                  <div>
                    {AREAS.map(a=><div key={a} style={{display:"flex",justifyContent:"space-between",marginBottom:8,alignItems:"center"}}><AreaBadge area={a}/><span style={{color:"var(--text2)",fontSize:14}}>{curSplit[a]}%</span></div>)}
                    <button onClick={()=>setSplitForm({...curSplit})} style={{...S.btnSecondary,marginTop:12,width:"100%",textAlign:"center"}}>Editar percentuais</button>
                  </div>
                )}
              </div>
            )}

          </div>
        )}
      </div>

      {showExport && <ExportModal onClose={()=>setShowExport(false)} employees={employees} roles={roles} tips={tips} restaurant={restaurant}/>}
      {previewDoc && <PDFPreviewModal pdfDoc={previewDoc} fileName={previewFileName} title="Pré-visualização do PDF" onClose={()=>setPreviewDoc(null)} />}
    </div>
  );
}

//
// SUPER MANAGER PORTAL
//
function OwnerPortal({ data, onUpdate, onBack, currentUser, toggleTheme, theme }) {
  // eslint-disable-next-line no-unused-vars
  const { owners, managers, restaurants, employees, roles, tips, splits, schedules, noTipDays } = data;
  const [tab, setTab] = useState("financeiro_geral");
  const isMobile = useMobile();
  const [selRestaurant, setSelRestaurantState] = useState(() => {
    const saved = localStorage.getItem("apptip_selrest");
    if (saved && restaurants.find(r => r.id === saved)) return saved;
    return null;
  });

  function setSelRestaurant(id) {
    setSelRestaurantState(id);
    if (id) localStorage.setItem("apptip_selrest", id);
    else localStorage.removeItem("apptip_selrest");
  }

  // forms
  // Modal states — grouped to reduce useState count
  const [modals, setModals] = useState({ rest:false, mgr:false, owner:false });
  const [editIds, setEditIds] = useState({ rest:null, mgr:null, owner:null });
  const showRestModal = modals.rest, showMgrModal = modals.mgr, showOwnerModal = modals.owner;
  const editRestId = editIds.rest, editMgrId = editIds.mgr, editOwnerId = editIds.owner;
  const setShowRestModal = v => setModals(p=>({...p,rest:v}));
  const setShowMgrModal = v => setModals(p=>({...p,mgr:v}));
  const setShowOwnerModal = v => setModals(p=>({...p,owner:v}));
  const setEditRestId = v => setEditIds(p=>({...p,rest:v}));
  const setEditMgrId = v => setEditIds(p=>({...p,mgr:v}));
  const setEditOwnerId = v => setEditIds(p=>({...p,owner:v}));
  const [restForm, setRestForm]             = useState({ name:"",shortCode:"",cnpj:"",address:"",whatsappFin:"",whatsappOp:"",serviceStartDate:"" });
  const [mgrForm, setMgrForm]               = useState({ name:"",cpf:"",pin:"",restaurantIds:[],perms:{tips:true,schedule:true},isDP:false,profile:"custom",areas:[] });
  const [ownerForm, setOwnerForm]           = useState({ name:"",cpf:"",pin:"" });
  const [viewOnly, setViewOnly]             = useState(false);
  // View-only guard — shadow onUpdate to block writes when locked
  const _realUpdate = onUpdate;
  onUpdate = (field, value) => { // eslint-disable-line
    if (viewOnly && field !== "_toast") { _realUpdate("_toast", "🔒 Modo somente leitura — desbloqueie para editar"); return; }
    _realUpdate(field, value);
  };

  function saveRest() {
    if (!restForm.name.trim()) return;
    const code = restForm.shortCode.trim().toUpperCase().replace(/[^A-Z]/g,"").slice(0,3);
    if (code.length !== 3) { alert("O ID deve ter exatamente 3 letras (ex: QUI)."); return; }
    // Check uniqueness
    const conflict = restaurants.find(r => r.shortCode === code && r.id !== editRestId);
    if (conflict) { alert(`ID "${code}" já está em uso por "${conflict.name}".`); return; }
    const r = { ...restForm, shortCode: code, id: editRestId ?? Date.now().toString() };
    onUpdate("restaurants", editRestId ? restaurants.map(x=>x.id===editRestId?r:x) : [...restaurants,r]);
    setShowRestModal(false);
  }
  function saveMgr() {
    if (!mgrForm.name.trim()) return;
    // CPF required for managers
    const cpfDigits = (mgrForm.cpf??"").replace(/\D/g,"");
    if (cpfDigits.length < 11) { onUpdate("_toast","⚠️ CPF é obrigatório para gestores (11 dígitos)"); return; }
    // Líder must have at least one area
    if (mgrForm.profile==="lider" && (mgrForm.areas??[]).length===0) { onUpdate("_toast","⚠️ Selecione pelo menos uma área para o Líder Operacional"); return; }
    // PIN = primeiros 4 dígitos do CPF no cadastro inicial
    const isNew = !editMgrId;
    const pin = isNew ? cpfDigits.slice(0,4) : (mgrForm.pin || cpfDigits.slice(0,4));
    const m = { ...mgrForm, pin, id: editMgrId ?? Date.now().toString(), ...(isNew ? {mustChangePin:true} : {}) };
    onUpdate("managers", editMgrId ? managers.map(x=>x.id===editMgrId?m:x) : [...managers,m]);
    setShowMgrModal(false);
  }
  function saveOwner() {
    if (!ownerForm.name.trim()||!ownerForm.pin.trim()) return;
    // Primeiro admin cadastrado vira master automaticamente
    const isMaster = ownerForm.isMaster ?? (owners.length === 0 && !editOwnerId);
    const s = { ...ownerForm, isMaster, id: editOwnerId ?? Date.now().toString() };
    // Não pode remover isMaster de um master via edição
    if (editOwnerId) {
      const existing = owners.find(x=>x.id===editOwnerId);
      if (existing?.isMaster) s.isMaster = true; // preserva
    }
    onUpdate("owners", editOwnerId ? owners.map(x=>x.id===editOwnerId?s:x) : [...owners,s]);
    setShowOwnerModal(false);
  }

  const PLANOS = [
    { id:"p10",  label:"Starter",     empMax:10,  mensal:97,    anual:87.30,  multi:false },
    { id:"p20",  label:"Básico",      empMax:20,  mensal:187,   anual:168.30, multi:true  },
    { id:"p50",  label:"Profissional",empMax:50,  mensal:397,   anual:357.30, multi:true  },
    { id:"p999", label:"Enterprise",  empMax:100, mensal:null,  anual:null,   multi:true  },
    { id:"pOrc", label:"On Demand",    empMax:999, mensal:null,  anual:null,   multi:true  },
  ];
  function getPlano(r) { return PLANOS.find(p=>p.id===(r.planoId??"p10")) ?? PLANOS[0]; }

  // Privacy helpers — mascarar dados sensíveis quando restaurante tem privacyMode
  function isPrivate(restId) {
    const r = restaurants.find(x => x.id === restId);
    return r?.privacyMode === true;
  }
  function maskCpfPriv(cpf, restId) {
    if (!isPrivate(restId)) return cpf || "—";
    return cpf ? "•••.•••.•••-••" : "—";
  }
  // Check if ANY selected restaurant is private
  function anyPrivate() {
    if (selRestaurant) return isPrivate(selRestaurant);
    return restaurants.some(r => r.privacyMode === true);
  }

  const notifications = data?.notifications ?? [];
  const unreadNotifs = notifications.filter(n => !n.read && n.targetRole === "admin").length;
  const isMaster = currentUser?.isMaster === true;
  const trash = data?.trash ?? { restaurants:[], managers:[], employees:[], tabData:[] };
  const trashCount = (trash.restaurants?.length??0) + (trash.managers?.length??0) + (trash.employees?.length??0) + (trash.tabData?.length??0);
  const [restTab, setRestTab] = useState("operacional");
  const [filtroFinanceiro, setFiltroFinanceiro] = useState("todos");
  const PIX_PADRAO = data?.pixChave  || "11985499821";
  const PIX_NOME   = data?.pixNome   || "Gustavo Rodrigues da Silva";
  const [cob, setCob] = useState({ forma:"pix", chave:PIX_PADRAO, link:"", valor:"", periodo:"", venc:"" });
  const cobForma = cob.forma, cobChave = cob.chave, cobLink = cob.link, cobValor = cob.valor, cobPeriodo = cob.periodo, cobVenc = cob.venc;
  const setCobForma = v => setCob(p=>({...p,forma:v}));
  const setCobChave = v => setCob(p=>({...p,chave:v}));
  const setCobLink  = v => setCob(p=>({...p,link:v}));
  const setCobValor = v => setCob(p=>({...p,valor:v}));
  const setCobPeriodo = v => setCob(p=>({...p,periodo:v}));
  const setCobVenc  = v => setCob(p=>({...p,venc:v}));

  // Soft delete helpers
  function softDelete(type, item) {
    const entry = { ...item, deletedAt: new Date().toISOString(), deletedBy: currentUser?.name ?? "Admin" };
    const newTrash = { ...trash, [type]: [...(trash[type]??[]), entry] };
    onUpdate("trash", newTrash);
  }
  function restore(type, item) {
    const newTrash = { ...trash, [type]: (trash[type]??[]).filter(x=>x.id!==item.id) };
    onUpdate("trash", newTrash);
    const clean = {...item};
    delete clean.deletedAt; delete clean.deletedBy; delete clean._type; delete clean._icon;
    if (type === "restaurants") {
      const exists = restaurants.find(r=>r.id===item.id);
      if (!exists) onUpdate("restaurants", [...restaurants, clean]);
    }
    if (type === "managers") {
      const exists = managers.find(m=>m.id===item.id);
      if (!exists) onUpdate("managers", [...managers, clean]);
    }
    if (type === "employees") {
      const exists = (data?.employees??[]).find(e=>e.id===item.id);
      if (!exists) onUpdate("employees", [...(data?.employees??[]), clean]);
    }
    onUpdate("_toast", `✅ ${item.name} restaurado!`);
  }
  function hardDelete(type, item) {
    if (!window.confirm(`Excluir permanentemente "${item.name}"? Esta ação não pode ser desfeita.`)) return;
    const newTrash = { ...trash, [type]: (trash[type]??[]).filter(x=>x.id!==item.id) };
    onUpdate("trash", newTrash);
    onUpdate("_toast", `🗑️ ${item.name} excluído permanentemente.`);
  }

  const ac = "var(--ac)";
  const TABS = [
    ["financeiro_geral", "💰 Financeiro"],
    ["managers","👔 Gestores"],
    ["owners","⭐ Admins AppTip"],
    ["inbox", `📬 Caixa${unreadNotifs > 0 ? ` (${unreadNotifs})` : ""}`],
    ...(isMaster ? [["trash", `🗑️ Lixeira${trashCount > 0 ? ` (${trashCount})` : ""}`]] : []),
    ["changelog", "📋 Versões"],
  ];

  if (selRestaurant) {
    const rest = restaurants.find(r => r.id === selRestaurant);
    const restMgrs = managers.filter(m => m.restaurantIds?.includes(selRestaurant));

    return (
      <div style={{ minHeight:"100vh", background:"var(--bg)", fontFamily:"'DM Sans',sans-serif" }}>
        {/* Header */}
        <div style={{ background:"var(--header-bg)", borderBottom:"1px solid var(--border)", padding:isMobile?"10px 12px":"12px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", boxShadow:"0 1px 4px rgba(0,0,0,0.04)", gap:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:isMobile?6:8, minWidth:0, flex:1 }}>
            <button onClick={()=>setSelRestaurant(null)} style={{ ...S.btnSecondary, fontSize:isMobile?11:12, padding:isMobile?"5px 8px":"6px 12px",flexShrink:0 }}>← {isMobile?"":"Voltar"}</button>
            <span style={{ color:"var(--text)", fontWeight:700, fontSize:isMobile?13:15, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{rest?.name}</span>
            {!isMobile && <span style={{ background:"var(--ac-bg)", color:"var(--ac-text)", borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:700 }}>{getPlano(rest).label}</span>}
            {!isMobile && rest?.earlyAdopter && <span style={{background:"#d4a01715",color:"#d4a017",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700}}>🚀 Early Adopter</span>}
          </div>
          <button onClick={onBack} style={{ ...S.btnSecondary, fontSize:12 }}>Sair</button>
        </div>

        {/* Sub-tabs */}
        <div style={{ display:"flex", borderBottom:"1px solid var(--border)", background:"var(--header-bg)", overflowX:"auto" }}>
          {[["operacional",isMobile?"⚙️ Op.":"⚙️ Operacional"],["gestores","👔 Gestores"],["financeiro","💳 Financeiro"]].map(([id,lbl])=>(
            <button key={id} onClick={()=>setRestTab(id)}
              style={{ padding:isMobile?"10px 14px":"10px 20px", background:"none", border:"none", borderBottom:`2px solid ${restTab===id?ac:"transparent"}`, color:restTab===id?ac:"var(--text3)", cursor:"pointer", fontSize:isMobile?12:13, fontFamily:"'DM Sans',sans-serif", fontWeight:restTab===id?700:500, whiteSpace:"nowrap", flex:isMobile?1:undefined, textAlign:"center" }}>
              {lbl}
            </button>
          ))}
        </div>

        {/* Operacional */}
        {restTab === "operacional" && (
          <RestaurantPanel restaurant={rest} restaurants={restaurants} employees={employees} roles={roles} tips={tips} splits={splits} schedules={schedules} onUpdate={onUpdate} perms={{ tips:true, schedule:true }} isOwner data={data} currentUser={currentUser} privacyMask={rest?.privacyMode === true} mobileOnly={isMobile} />
        )}

        {/* Gestores deste restaurante */}
        {restTab === "gestores" && (
          <div style={{ padding:isMobile?"12px 10px":"24px", maxWidth:800, margin:"0 auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:isMobile?14:20, gap:8 }}>
              <div style={{minWidth:0}}>
                <h3 style={{ color:"var(--text)", fontSize:isMobile?14:16, fontWeight:700, margin:"0 0 4px" }}>Gestores de {rest?.name}</h3>
                <p style={{ color:"var(--text3)", fontSize:isMobile?11:13, margin:0 }}>{restMgrs.length} gestor{restMgrs.length!==1?"es":""} com acesso</p>
              </div>
              <button onClick={()=>{
                setEditMgrId(null);
                setMgrForm({name:"",cpf:"",pin:"",restaurantIds:[selRestaurant],perms:{tips:true,schedule:true},isDP:false,profile:"custom",areas:[]});
                setShowMgrModal(true);
              }} style={{...S.btnPrimary,width:"auto",padding:isMobile?"8px 14px":"10px 20px",fontSize:isMobile?12:14,whiteSpace:"nowrap"}}>+ Novo Gestor</button>
            </div>

            {restMgrs.length === 0 && (
              <div style={{...S.card, textAlign:"center", padding:40}}>
                <div style={{fontSize:36,marginBottom:12}}>👔</div>
                <p style={{color:"var(--text3)",fontSize:14,marginBottom:16}}>Nenhum gestor atribuído a este restaurante.</p>
                <button onClick={()=>{
                  setEditMgrId(null);
                  setMgrForm({name:"",cpf:"",pin:"",restaurantIds:[selRestaurant],perms:{tips:true,schedule:true},isDP:false,profile:"custom",areas:[]});
                  setShowMgrModal(true);
                }} style={{...S.btnPrimary,width:"auto",padding:"10px 24px"}}>Adicionar primeiro gestor</button>
              </div>
            )}

            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {restMgrs.map(m => (
                <div key={m.id} style={{...S.card}}>
                  <div style={{display:"flex",flexDirection:isMobile?"column":"row",justifyContent:"space-between",alignItems:isMobile?"stretch":"flex-start",gap:isMobile?10:0}}>
                    <div style={{minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2,flexWrap:"wrap"}}>
                        <span style={{color:"var(--text)",fontWeight:700,fontSize:isMobile?14:15}}>{m.name}</span>
                        {m.profile==="dp" && <span style={{background:"var(--blue-bg)",color:"var(--blue)",borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:700}}>📬 DP</span>}
                        {m.profile==="lider" && <span style={{background:"#f59e0b22",color:"#f59e0b",borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:700}}>👔 Líder Op.</span>}
                      </div>
                      <div style={{color:"var(--text3)",fontSize:isMobile?11:12,marginBottom:4}}>CPF: {isPrivate(selRestaurant) ? "•••.•••.•••-••" : (m.cpf||"—")}</div>
                      {m.profile==="lider" && (m.areas??[]).length>0 && (
                        <div style={{color:"var(--text3)",fontSize:11,marginBottom:6}}>Áreas: {m.areas.join(", ")}</div>
                      )}
                      <div style={{display:"flex",gap:isMobile?4:6,flexWrap:"wrap",marginBottom:6}}>
                        {[["tips","💸 Gorjetas"],["schedule","📅 Escala"],["roles","🏷️ Cargos"],["employees","👥 Equipe"],["comunicados","📢 Comuns."],["faq","❓ FAQ"],["dp","💬 DP"],["horarios","🕐 Horários"],["vt","🚌 VT"]].map(([k,lbl])=>
                          m.perms?.[k]!==false ? <span key={k} style={{background:"var(--green-bg)",color:"var(--green)",borderRadius:6,padding:"2px 6px",fontSize:isMobile?10:11,fontWeight:600}}>{lbl}</span> : null
                        )}
                        {m.isDP && !m.profile && <span style={{background:"var(--blue-bg)",color:"var(--blue)",borderRadius:6,padding:"2px 6px",fontSize:isMobile?10:11,fontWeight:600}}>📬 DP</span>}
                      </div>
                      {(m.restaurantIds??[]).filter(rid=>rid!==selRestaurant).length > 0 && (
                        <div style={{color:"var(--text3)",fontSize:11}}>
                          Também acessa: {(m.restaurantIds??[]).filter(rid=>rid!==selRestaurant).map(rid=>restaurants.find(r=>r.id===rid)?.name).filter(Boolean).join(", ")}
                        </div>
                      )}
                    </div>
                    <div style={{display:"flex",gap:8,flexShrink:0,flexWrap:"nowrap"}}>
                      <button onClick={()=>{
                        const cpfDigits = (m.cpf??"").replace(/\D/g,"");
                        if (cpfDigits.length < 4) { onUpdate("_toast","⚠️ CPF inválido — não foi possível gerar PIN automático"); return; }
                        const newPin = cpfDigits.slice(0,4);
                        if(!window.confirm(`Resetar PIN de "${m.name}"?\n\nO PIN voltará para ${newPin} (4 primeiros dígitos do CPF) e ele será obrigado a trocar no próximo acesso.`)) return;
                        onUpdate("managers", managers.map(x=>x.id===m.id?{...x,pin:newPin,mustChangePin:true}:x));
                        onUpdate("_toast", `🔑 PIN de ${m.name} resetado para ${newPin}`);
                      }} title="Resetar PIN para os 4 primeiros dígitos do CPF" style={{...S.btnSecondary,fontSize:isMobile?11:12,flex:isMobile?1:undefined,textAlign:"center",padding:isMobile?"6px 8px":undefined}}>{isMobile?"🔑 PIN":"🔑 Resetar PIN"}</button>
                      <button onClick={()=>{setEditMgrId(m.id);setMgrForm({name:m.name,cpf:m.cpf??"",pin:m.pin??"",restaurantIds:m.restaurantIds??[],perms:m.perms??{tips:true,schedule:true},isDP:m.isDP??false,profile:m.profile??"custom",areas:m.areas??[]});setShowMgrModal(true);}} style={{...S.btnSecondary,fontSize:isMobile?11:12,flex:isMobile?1:undefined,textAlign:"center",padding:isMobile?"6px 8px":undefined}}>Editar</button>
                      <button onClick={()=>{
                        if(!window.confirm(`Remover ${m.name} deste restaurante?`)) return;
                        const newIds = (m.restaurantIds??[]).filter(rid=>rid!==selRestaurant);
                        if(newIds.length === 0) {
                          softDelete("managers", m);
                          onUpdate("managers", managers.filter(x=>x.id!==m.id));
                          onUpdate("_toast", `🗑️ ${m.name} movido para a lixeira.`);
                        } else {
                          onUpdate("managers", managers.map(x=>x.id===m.id?{...x,restaurantIds:newIds}:x));
                          onUpdate("_toast", `✅ ${m.name} removido deste restaurante.`);
                        }
                      }} style={{background:"none",border:"1px solid var(--red)33",borderRadius:8,color:"var(--red)",cursor:"pointer",fontSize:isMobile?11:12,padding:isMobile?"6px 8px":"6px 12px",fontFamily:"'DM Sans',sans-serif",flex:isMobile?1:undefined,textAlign:"center"}}>Remover</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Adicionar gestor existente */}
            {managers.filter(m=>!m.restaurantIds?.includes(selRestaurant)).length > 0 && (
              <div style={{...S.card,marginTop:16,background:"var(--bg2)"}}>
                <p style={{color:"var(--text3)",fontSize:13,marginBottom:12,fontWeight:600}}>Adicionar gestor existente a este restaurante:</p>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {managers.filter(m=>!m.restaurantIds?.includes(selRestaurant)).map(m=>(
                    <div key={m.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",borderRadius:10,background:"var(--card-bg)",border:"1px solid var(--border)"}}>
                      <div>
                        <span style={{color:"var(--text)",fontWeight:600,fontSize:14}}>{m.name}</span>
                        <span style={{color:"var(--text3)",fontSize:12,marginLeft:8}}>já acessa: {(m.restaurantIds??[]).map(rid=>restaurants.find(r=>r.id===rid)?.name).filter(Boolean).join(", ")||"nenhum"}</span>
                      </div>
                      <button onClick={()=>{
                        onUpdate("managers", managers.map(x=>x.id===m.id?{...x,restaurantIds:[...(x.restaurantIds??[]),selRestaurant]}:x));
                        onUpdate("_toast",`✅ ${m.name} adicionado a ${rest?.name}`);
                      }} style={{padding:"6px 14px",borderRadius:8,border:`1px solid ${ac}`,background:"transparent",color:"var(--ac-text)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600}}>
                        + Adicionar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Financeiro */}
        {restTab === "financeiro" && (() => {
          const fin = rest?.financeiro ?? {};

          // ─── Helpers ────────────────────────────────────────────────
          const fmt = (d) => d ? new Date(d+"T12:00:00").toLocaleDateString("pt-BR") : "—";
          const addDays = (d, n) => { const r = new Date(d+"T12:00:00"); r.setDate(r.getDate()+n); return r.toISOString().slice(0,10); };
          const addYear = (d) => { const r = new Date(d+"T12:00:00"); r.setFullYear(r.getFullYear()+1); return r.toISOString().slice(0,10); };

          // ─── Plano e valor ──────────────────────────────────────────
          const plano        = getPlano(rest);
          const tipo         = rest?.tipoCobranca ?? "mensal";
          const isEnt        = rest?.planoId === "p999";
          const isOrc        = rest?.planoId === "pOrc";
          const empMax       = isEnt ? (rest?.empMaxCustom ?? 51) : isOrc ? (rest?.empMaxCustom ?? 101) : plano.empMax;
          const empAtivos    = employees.filter(e=>e.restaurantId===selRestaurant&&!e.inactive).length;

          // Early Adopter — 30% desconto permanente
          const isEarlyAdopter = rest?.earlyAdopter === true;
          const EA_DESC = 0.7; // fator multiplicador (1 - 0.30)

          // Valor da cobrança — mensal = valor do mês, anual = total do ano
          const valorBruto = (() => {
            if (isOrc) return null;
            if (isEnt) {
              const porEmp = empMax * 7.99;
              return tipo === "anual" ? porEmp * 12 * 0.9 : porEmp;
            }
            if (tipo === "anual") return (plano.anual ?? 0) * 12;
            return plano.mensal;
          })();
          const valorMensal = valorBruto != null && isEarlyAdopter ? Math.round(valorBruto * EA_DESC * 100) / 100 : valorBruto;

          // ─── Ciclo ─────────────────────────────────────────────────
          // fonte única de verdade: fin.cicloInicio e fin.cicloFim
          const cicloIni  = fin.cicloInicio ?? null;
          const cicloFim  = fin.cicloFim ?? null;
          const trialIni  = fin.trialInicio ?? null;
          const trialFim  = fin.trialFim ?? null;
          const hoje      = today();

          const emTrial       = trialIni && !cicloIni && trialFim >= hoje;
          const trialVencido  = trialIni && !cicloIni && trialFim < hoje;
          const cicloAtivo    = cicloIni && cicloFim && cicloFim >= hoje;
          const cicloVencido  = cicloIni && cicloFim && cicloFim < hoje;

          const diasCiclo  = cicloFim ? Math.ceil((new Date(cicloFim+"T12:00:00")-new Date())/(1000*60*60*24)) : null;
          const diasTrial  = trialFim ? Math.ceil((new Date(trialFim+"T12:00:00")-new Date())/(1000*60*60*24)) : null;
          const alertaVenc = cicloAtivo && diasCiclo !== null && diasCiclo <= 7;

          const inadimplente = fin.status === "inadimplente";

          // ─── Próximo ciclo a cobrar ─────────────────────────────────
          // começa no dia seguinte ao fim do ciclo atual (ou trial)
          const proxIni = (() => {
            if (cicloFim) return addDays(cicloFim, 1);
            if (trialFim) return addDays(trialFim, 1);
            return hoje;
          })();
          const proxFim = tipo === "anual" ? addDays(addYear(proxIni), -1) : addDays(proxIni, 29);
          // Vencimento = dia anterior ao início do próximo ciclo = último dia do ciclo atual
          const proxVenc = addDays(proxIni, -1);

          // ─── Helpers de persistência ────────────────────────────────
          function saveFin(update) {
            onUpdate("restaurants", restaurants.map(r => r.id===selRestaurant ? {...r, financeiro:{...fin,...update}} : r));
          }

          function confirmar(cob) {
            const ini  = hoje;
            const fim  = tipo === "anual" ? addDays(addYear(ini), -1) : addDays(ini, 29);
            const nIni = addDays(fim, 1);
            const nFim = tipo === "anual" ? addDays(addYear(nIni), -1) : addDays(nIni, 29);
            const updCobs = (fin.cobrancas??[]).map(x => x.id===cob.id ? {...x, status:"pago", pagoEm:new Date().toISOString()} : x);
            const novoPag = { id:Date.now().toString(), data:ini, valor:cob.valor, forma:cob.forma, periodoLabel:`${fmt(ini)} a ${fmt(fim)}`, registradoEm:new Date().toISOString() };
            const proxCob = { id:(Date.now()+1).toString(), periodoLabel:`${fmt(nIni)} a ${fmt(nFim)}`, periodoInicio:nIni, periodoFim:nFim, venc:nFim, valor:valorMensal??cob.valor, forma:cob.forma??"PIX", chave:cob.chave??PIX_PADRAO, criadaEm:new Date().toISOString(), status:"pendente", autoGerada:true };
            saveFin({ cobrancas:[...updCobs, proxCob], pagamentos:[novoPag,...(fin.pagamentos??[])], status:"ativo", cicloInicio:ini, cicloFim:fim });
            onUpdate("_toast", `✅ Pago! Ciclo ${fmt(ini)} a ${fmt(fim)}`);
          }

          const pagamentos = fin.pagamentos ?? [];
          const cobrancasAbertas = (fin.cobrancas??[]).filter(c=>c.status==="pendente"||c.status==="aguardando_confirmacao");

          return (
            <div style={{padding:"24px",maxWidth:700,margin:"0 auto"}}>

              {/* ── 1. STATUS DO CICLO ── */}
              <div style={{...S.card, marginBottom:20, border:`1px solid ${
                inadimplente?"var(--red)44":
                trialVencido||cicloVencido?"var(--red)44":
                emTrial||alertaVenc?"#f59e0b44":"var(--green)44"
              }`, background:
                inadimplente?"var(--red-bg)":
                trialVencido||cicloVencido?"var(--red-bg)":
                emTrial||alertaVenc?"#fffbeb":"var(--green-bg)"
              }}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:12}}>
                  <div>
                    {inadimplente && <div style={{color:"var(--red)",fontWeight:700,fontSize:16,marginBottom:4}}>🔴 Inadimplente — acesso bloqueado</div>}
                    {!inadimplente && emTrial && <>
                      <div style={{color:"#92400e",fontWeight:700,fontSize:16,marginBottom:4}}>🎯 Período de teste</div>
                      <div style={{color:"#92400e",fontSize:13}}>{diasTrial} dia{diasTrial!==1?"s":""} restante{diasTrial!==1?"s":""} — até {fmt(trialFim)}</div>
                    </>}                    {!inadimplente && trialVencido && <>
                      <div style={{color:"var(--red)",fontWeight:700,fontSize:16,marginBottom:4}}>⏰ Trial encerrado</div>
                      <div style={{color:"var(--red)",fontSize:13}}>Gere a 1ª cobrança para ativar o acesso pago.</div>
                    </>}
                    {!inadimplente && cicloAtivo && <>
                      <div style={{color:alertaVenc?"#92400e":"var(--green)",fontWeight:700,fontSize:16,marginBottom:4}}>
                        {alertaVenc?`⚡ Vence em ${diasCiclo} dia${diasCiclo!==1?"s":""}!`:"✅ Ciclo ativo"}
                      </div>
                      <div style={{color:"var(--text2)",fontSize:13}}>
                        {fmt(cicloIni)} a {fmt(cicloFim)}
                        {alertaVenc && <span style={{color:"#a16207",marginLeft:8,fontSize:12}}>— envie a cobrança logo!</span>}
                      </div>
                    </>}
                    {!inadimplente && cicloVencido && <>
                      <div style={{color:"var(--red)",fontWeight:700,fontSize:16,marginBottom:4}}>🔴 Ciclo vencido</div>
                      <div style={{color:"var(--red)",fontSize:13}}>Venceu em {fmt(cicloFim)} — {Math.abs(diasCiclo)} dias sem renovação</div>
                    </>}
                    {!cicloIni && !trialIni && <div style={{color:"var(--text3)",fontWeight:600,fontSize:14}}>⚙️ Sem ciclo iniciado</div>}
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    {inadimplente && <button onClick={()=>saveFin({status:"ativo"})} style={{padding:"8px 16px",borderRadius:8,border:"1px solid var(--green)44",background:"var(--green-bg)",color:"var(--green)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700}}>✅ Liberar acesso</button>}

                    {/* Trial ativo — estender ou suspender */}
                    {!inadimplente && emTrial && <>
                      <button onClick={()=>{
                        const maxDias = 30 - Math.ceil((new Date(trialFim+"T12:00:00")-new Date(trialIni+"T12:00:00"))/(1000*60*60*24));
                        const diasExtra = parseInt(window.prompt(`Quantos dias a mais de trial? (máximo ${maxDias} dias adicionais, total máximo 30 dias)`));
                        if (!diasExtra || isNaN(diasExtra) || diasExtra <= 0) return;
                        const novoFim = addDays(trialFim, Math.min(diasExtra, maxDias));
                        saveFin({ trialFim: novoFim });
                        onUpdate("_toast", `✅ Trial estendido até ${fmt(novoFim)}`);
                      }} style={{padding:"8px 16px",borderRadius:8,border:"1px solid #f59e0b44",background:"#fffbeb",color:"#92400e",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600}}>
                        ⏰ Estender trial
                      </button>
                      <button onClick={()=>{
                        if(!window.confirm("Suspender o período de teste e bloquear o acesso?")) return;
                        saveFin({ trialFim: addDays(hoje, -1), status:"inadimplente" });
                        onUpdate("_toast","🔴 Trial suspenso. Acesso bloqueado.");
                      }} style={{padding:"8px 16px",borderRadius:8,border:"1px solid var(--red)33",background:"transparent",color:"var(--red)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600}}>
                        🚫 Suspender trial
                      </button>
                    </>}

                    {!inadimplente && cicloIni && <button onClick={()=>{if(!window.confirm("Marcar como inadimplente e bloquear acesso?"))return; saveFin({status:"inadimplente"});}} style={{padding:"8px 16px",borderRadius:8,border:"1px solid var(--red)33",background:"transparent",color:"var(--red)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600}}>🔴 Inadimplente</button>}

                    {/* Trial vencido — bloquear ou reativar */}
                    {!inadimplente && trialVencido && <>
                      <button onClick={()=>{
                        const novoFim = addDays(hoje, 7);
                        saveFin({ trialFim: novoFim, status:"ativo" });
                        onUpdate("_toast",`🎯 Trial reativado até ${fmt(novoFim)}`);
                      }} style={{padding:"8px 16px",borderRadius:8,border:"1px solid #f59e0b44",background:"#fffbeb",color:"#92400e",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600}}>
                        🔄 Reativar trial
                      </button>
                      <button onClick={()=>saveFin({status:"inadimplente"})} style={{padding:"8px 16px",borderRadius:8,border:"1px solid var(--red)33",background:"transparent",color:"var(--red)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600}}>
                        🔴 Bloquear acesso
                      </button>
                    </>}
                  </div>
                </div>
              </div>

              {/* Iniciar trial */}
              {!trialIni && !cicloIni && (
                <div style={{...S.card,marginBottom:20,textAlign:"center",padding:28}}>
                  <div style={{fontSize:32,marginBottom:12}}>🎯</div>
                  <h4 style={{color:"var(--text)",fontWeight:700,fontSize:15,margin:"0 0 8px"}}>Iniciar período de teste</h4>
                  <p style={{color:"var(--text3)",fontSize:13,margin:"0 0 16px"}}>7 dias gratuitos — a 1ª cobrança vence no último dia do trial</p>
                  <button onClick={()=>{
                    const fim7 = addDays(hoje, 6);
                    const cob = { id:Date.now().toString(), periodoLabel:`Trial — ${fmt(hoje)} a ${fmt(fim7)}`, periodoInicio:hoje, periodoFim:fim7, venc:fim7, valor:valorMensal??0, forma:"PIX", chave:PIX_PADRAO, criadaEm:new Date().toISOString(), status:"pendente", isTrial:true };
                    saveFin({ trialInicio:hoje, trialFim:fim7, status:"ativo", cobrancas:[...(fin.cobrancas??[]), cob] });
                    onUpdate("_toast","🎯 Trial iniciado até "+fmt(fim7));
                  }} style={{...S.btnPrimary,width:"auto",padding:"10px 28px"}}>Iniciar trial</button>
                </div>
              )}

              {/* ── 2. PLANO ── */}
              <div style={{...S.card,marginBottom:20}}>
                <h4 style={{color:"var(--text)",fontWeight:700,fontSize:14,margin:"0 0 14px"}}>📦 Plano contratado</h4>
                <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14}}>
                  {PLANOS.map(p=>{
                    const sel = (rest?.planoId??"p10")===p.id;
                    const precos = {
                      p10:  "R$97/mês · R$1.047,60/ano (−10%)",
                      p20:  "R$187/mês · R$2.019,60/ano (−10%)",
                      p50:  "R$397/mês · R$4.287,60/ano (−10%)",
                      p999: "R$7,99/emp./mês · 10% desc. no anual",
                      pOrc: "Sob orçamento"
                    };
                    return (
                      <button key={p.id} onClick={()=>onUpdate("restaurants",restaurants.map(r=>r.id===selRestaurant?{...r,planoId:p.id}:r))}
                        style={{padding:"10px 14px",borderRadius:10,border:`1px solid ${sel?ac:"var(--border)"}`,background:sel?"var(--ac-bg)":"transparent",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",textAlign:"left",display:"flex",flexDirection:"column",gap:4}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",width:"100%"}}>
                          <span style={{color:sel?"var(--ac-text)":"var(--text2)",fontWeight:sel?700:400}}>{sel?"✓":"○"} {p.label} {p.id==="p10"?"(até 10)":p.id==="p20"?"(até 20)":p.id==="p50"?"(até 50)":p.id==="p999"?"(51–100)":"(+100)"}</span>
                          <span style={{color:"var(--text3)",fontSize:11}}>{precos[p.id]}</span>
                        </div>
                        <span style={{fontSize:10,color:p.multi?"var(--green)":"var(--text3)",fontWeight:500}}>
                          {p.multi?"🏢 Múltiplas unidades":"🏢 Máx. 1 unidade"}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div style={{display:"flex",gap:8,marginBottom:12}}>
                  {[["mensal","Mensal"],["anual","Anual (−10%)"]].map(([v,l])=>{
                    const sel=(rest?.tipoCobranca??"mensal")===v;
                    return <button key={v} onClick={()=>onUpdate("restaurants",restaurants.map(r=>r.id===selRestaurant?{...r,tipoCobranca:v}:r))}
                      style={{flex:1,padding:"10px",borderRadius:10,border:`1px solid ${sel?"var(--green)":"var(--border)"}`,background:sel?"var(--green-bg)":"transparent",color:sel?"var(--green)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:sel?700:400}}>
                      {sel?"✓":""} {l}
                    </button>;
                  })}
                </div>

                {/* Early Adopter toggle */}
                <label style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderRadius:10,border:`1px solid ${isEarlyAdopter?"#d4a01766":"var(--border)"}`,background:isEarlyAdopter?"linear-gradient(135deg,#1c120811,#d4a01711)":"transparent",cursor:"pointer",marginBottom:12,userSelect:"none"}}>
                  <input type="checkbox" checked={isEarlyAdopter}
                    onChange={e=>onUpdate("restaurants",restaurants.map(r=>r.id===selRestaurant?{...r,earlyAdopter:e.target.checked}:r))}
                    style={{width:18,height:18,accentColor:"#d4a017",cursor:"pointer",flexShrink:0}}/>
                  <div>
                    <div style={{color:isEarlyAdopter?"#d4a017":"var(--text2)",fontWeight:700,fontSize:13}}>🚀 Early Adopter — 30% off permanente</div>
                    <div style={{color:"var(--text3)",fontSize:11,marginTop:2}}>Primeiros 30 clientes. Desconto válido enquanto a assinatura estiver ativa.</div>
                  </div>
                </label>

                {isEnt && <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                  <label style={{...S.label,marginBottom:0}}>Empregados contratados (51–100):</label>
                  <input type="number" min="51" max="100" defaultValue={rest?.empMaxCustom??51}
                    onBlur={e=>{const v=Math.min(100,Math.max(51,parseInt(e.target.value)||51));onUpdate("restaurants",restaurants.map(r=>r.id===selRestaurant?{...r,empMaxCustom:v}:r));}}
                    style={{...S.input,width:80,textAlign:"center",fontFamily:"'DM Mono',monospace"}}/>
                </div>}
                {isOrc && <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
                  <label style={{...S.label,marginBottom:0}}>Empregados (+100):</label>
                  <input type="number" min="101" defaultValue={rest?.empMaxCustom??101}
                    onBlur={e=>{const v=Math.max(101,parseInt(e.target.value)||101);onUpdate("restaurants",restaurants.map(r=>r.id===selRestaurant?{...r,empMaxCustom:v}:r));}}
                    style={{...S.input,width:90,textAlign:"center",fontFamily:"'DM Mono',monospace"}}/>
                </div>}

                {/* Valor calculado */}
                <div style={{padding:"14px",borderRadius:12,background:isEarlyAdopter?"linear-gradient(135deg,#1c120811,#d4a01718)":"var(--ac-bg)",border:`1px solid ${isEarlyAdopter?"#d4a01744":"var(--ac)33"}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{color:"var(--text3)",fontSize:11,fontWeight:600,marginBottom:4}}>
                      VALOR A COBRAR {isEarlyAdopter && <span style={{color:"#d4a017",fontWeight:700}}>· 🚀 −30% EARLY ADOPTER</span>}
                    </div>
                    {isOrc
                      ? <div style={{color:"var(--ac-text)",fontWeight:800,fontSize:18}}>Sob orçamento</div>
                      : <div>
                          {isEarlyAdopter && valorBruto != null && <div style={{color:"var(--text3)",fontSize:13,textDecoration:"line-through",marginBottom:2,fontFamily:"'DM Mono',monospace"}}>
                            R$ {valorBruto.toLocaleString("pt-BR",{minimumFractionDigits:2})}
                          </div>}
                          <div style={{color:isEarlyAdopter?"#d4a017":"var(--ac-text)",fontWeight:800,fontSize:22,fontFamily:"'DM Mono',monospace"}}>
                            R$ {valorMensal?.toLocaleString("pt-BR",{minimumFractionDigits:2})}
                            <span style={{color:"var(--text3)",fontSize:13,fontWeight:400}}>
                              {tipo==="anual"?"/ano (12x)":"/mês"}
                            </span>
                          </div>
                        </div>
                    }
                    {isEnt && <div style={{color:"var(--text3)",fontSize:11,marginTop:2}}>
                      {tipo==="anual"
                        ? `${empMax} emp. × R$7,99 × 12 meses × 0,9 (−10%)${isEarlyAdopter?" × 0,7 (−30%)":""}`
                        : `${empMax} emp. × R$7,99/mês${isEarlyAdopter?" × 0,7 (−30%)":""}`}
                    </div>}
                  </div>
                  <div style={{color:"var(--text3)",fontSize:13}}>{empAtivos}/{isOrc?"∞":empMax} ativos</div>
                </div>
              </div>

              {/* ── 3. GERAR COBRANÇA ── */}
              <div style={{...S.card,marginBottom:20}}>
                <h4 style={{color:"var(--text)",fontWeight:700,fontSize:14,margin:"0 0 4px"}}>📲 Gerar cobrança</h4>
                <p style={{color:"var(--text3)",fontSize:12,margin:"0 0 14px"}}>Envia a fatura via WhatsApp para o contato financeiro</p>

                {!rest?.whatsappFin && <div style={{padding:"10px 14px",borderRadius:10,background:"var(--red-bg)",border:"1px solid var(--red)33",marginBottom:12}}>
                  <p style={{color:"var(--red)",fontSize:12,margin:0}}>⚠️ WhatsApp financeiro não cadastrado. Edite o restaurante.</p>
                </div>}

                {/* Próximo ciclo pré-calculado */}
                <div style={{background:"var(--bg2)",borderRadius:12,padding:"16px",marginBottom:14,border:"1px solid var(--border)"}}>
                  <div style={{color:"var(--text3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:10}}>Próximo ciclo</div>

                  <div style={{marginBottom:12}}>
                    <div style={{color:"var(--text)",fontWeight:700,fontSize:15,marginBottom:2}}>{fmt(cobPeriodo||proxIni)} a {fmt(cobVenc||proxFim)}</div>
                    <div style={{color:"var(--text3)",fontSize:12,marginBottom:10}}>{tipo==="anual"?"Ciclo anual":"Ciclo 30 dias"} · Venc. {fmt(cobVenc||proxVenc)}</div>
                    <div style={{display:"flex",flexDirection:"column",gap:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{color:"var(--text3)",fontSize:12,width:80,flexShrink:0}}>Início:</span>
                        <input key={`ini-${proxIni}`} type="date" defaultValue={cobPeriodo||proxIni}
                          onChange={e=>setCobPeriodo(e.target.value)}
                          style={{...S.input,fontSize:13,flex:1,boxSizing:"border-box"}}/>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{color:"var(--text3)",fontSize:12,width:80,flexShrink:0}}>Vencimento:</span>
                        <input key={`fim-${proxVenc}`} type="date" defaultValue={cobVenc||proxVenc}
                          onChange={e=>setCobVenc(e.target.value)}
                          style={{...S.input,fontSize:13,flex:1,boxSizing:"border-box"}}/>
                      </div>
                    </div>
                  </div>

                  {/* Valor */}
                  <div style={{marginBottom:12}}>
                    <div style={{color:"var(--text3)",fontSize:11,marginBottom:4}}>Valor (R$)</div>
                    <input type="number" value={cobValor||(valorMensal?.toFixed(2)??"0")} onChange={e=>setCobValor(e.target.value)}
                      style={{...S.input,fontSize:20,fontWeight:700,color:"var(--ac-text)",fontFamily:"'DM Mono',monospace",width:"100%",boxSizing:"border-box"}}/>
                    {valorMensal && <div style={{color:"var(--text3)",fontSize:11,marginTop:3}}>Plano {plano.label} — R${valorMensal.toFixed(2)}{tipo==="anual"?"/ano":"/mês"}</div>}
                  </div>
                  <div style={{color:"var(--text3)",fontSize:11,marginBottom:8}}>Forma de pagamento</div>
                  <div style={{display:"flex",gap:8,marginBottom:10}}>
                    {[["pix","PIX"],["link","Link"]].map(([v,l])=>(
                      <button key={v} onClick={()=>{setCobForma(v);if(v==="pix")setCobChave(PIX_PADRAO);else setCobChave("");}}
                        style={{flex:1,padding:"9px",borderRadius:10,border:`2px solid ${cobForma===v?ac:"var(--border)"}`,background:cobForma===v?"var(--ac-bg)":"transparent",color:cobForma===v?"var(--ac-text)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:cobForma===v?700:400}}>
                        {l}
                      </button>
                    ))}
                  </div>
                  {cobForma==="pix"
                    ? <div><input value={cobChave} onChange={e=>setCobChave(e.target.value)} placeholder="Chave PIX" style={S.input}/>
                        <p style={{color:"var(--text3)",fontSize:11,marginTop:4,marginBottom:0}}>Padrão: <strong>{PIX_PADRAO}</strong> — {PIX_NOME}
                          {cobChave!==PIX_PADRAO&&<button onClick={()=>setCobChave(PIX_PADRAO)} style={{background:"none",border:"none",color:ac,cursor:"pointer",fontSize:11,marginLeft:8,padding:0,textDecoration:"underline"}}>Restaurar</button>}
                        </p></div>
                    : <input value={cobLink} onChange={e=>setCobLink(e.target.value)} placeholder="Cole o link de pagamento" style={S.input}/>
                  }
                </div>

                {/* Preview */}
                <div style={{background:"#f0fdf4",borderRadius:10,padding:"10px 14px",marginBottom:12,border:"1px solid #86efac"}}>
                  <div style={{color:"#166534",fontSize:11,fontWeight:700,marginBottom:4}}>📱 Mensagem que será enviada</div>
                  <div style={{color:"#166534",fontSize:13,lineHeight:1.6}}>
                    Ola, <strong>{rest?.name}</strong>! Segue o link da sua fatura AppTip referente ao período <strong>{fmt(cobPeriodo||proxIni)} a {fmt(cobVenc||proxFim)}</strong>: apptip.app/fatura/(link)
                  </div>
                </div>

                <button onClick={()=>{
                  if(!rest?.whatsappFin){alert("Cadastre o WhatsApp financeiro primeiro.");return;}
                  const valor=parseFloat(cobValor)||valorMensal;
                  if(!valor){alert("Verifique o valor.");return;}
                  if(cobForma==="link"&&!cobLink.trim()){alert("Cole o link de pagamento.");return;}
                  const ini=cobPeriodo||proxIni;
                  const fim=cobVenc||proxFim;
                  const venc=cobVenc||proxVenc;
                  const pLabel=`${fmt(ini)} a ${fmt(fim)}`;
                  const chave=cobForma==="pix"?(cobChave||PIX_PADRAO):cobLink;
                  const cob={id:Date.now().toString(),periodoLabel:pLabel,periodoInicio:ini,periodoFim:fim,venc,valor,forma:cobForma==="pix"?"PIX":"Link",chave,criadaEm:new Date().toISOString(),status:"pendente"};
                  saveFin({cobrancas:[...(fin.cobrancas??[]).filter(c=>!(c.autoGerada&&c.status==="pendente")),cob]});
                  const faturaUrl=`https://apptip.app/fatura/${cob.id}`;
                  const msg=`Ola, *${rest?.name}*!\n\nSegue o link da sua fatura *AppTip* referente ao periodo *${pLabel}*:\n\n${faturaUrl}\n\nQualquer duvida estamos a disposicao!\n*Equipe AppTip*`;
                  const numero=rest.whatsappFin.replace(/\D/g,"");
                  setTimeout(()=>{window.location.href=`https://wa.me/55${numero}?text=${encodeURIComponent(msg)}`;},300);
                  setCobValor("");setCobVenc("");setCobLink("");setCobPeriodo("");
                  onUpdate("_toast","📲 Cobrança enviada!");
                }} disabled={!rest?.whatsappFin}
                  style={{...S.btnPrimary,opacity:rest?.whatsappFin?1:0.5,cursor:rest?.whatsappFin?"pointer":"not-allowed"}}>
                  📲 Enviar cobrança via WhatsApp
                </button>
              </div>

              {/* ── 4. COBRANÇAS EM ABERTO ── */}
              {cobrancasAbertas.length > 0 && (
                <div style={{...S.card,marginBottom:20,border:"1px solid #f59e0b33",background:"#fffbeb"}}>
                  <h4 style={{color:"#92400e",fontWeight:700,fontSize:14,margin:"0 0 12px"}}>⏳ Cobranças em aberto</h4>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {cobrancasAbertas.map(c=>(
                      <div key={c.id} style={{padding:"12px 14px",borderRadius:10,background:"#fff",border:`1px solid ${c.status==="aguardando_confirmacao"?"#86efac":"#fde68a"}`}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                          <div>
                            <div style={{color:"var(--text)",fontWeight:700,fontSize:14,marginBottom:2}}>
                              R$ {c.valor?.toLocaleString("pt-BR",{minimumFractionDigits:2})}
                            </div>
                            <div style={{color:"var(--text3)",fontSize:12,marginBottom:4}}>
                              {c.periodoLabel} · {c.forma} · Venc. {fmt(c.venc)}
                            </div>
                            {c.status==="aguardando_confirmacao" && (
                              <div style={{color:"#166534",fontSize:12,fontWeight:600,background:"#f0fdf4",padding:"4px 10px",borderRadius:6,display:"inline-block"}}>
                                ✅ Cliente informou pagamento em {fmt(c.clienteConfirmouEm?.slice(0,10))} — aguarda sua confirmação
                              </div>
                            )}
                          </div>
                          <div style={{display:"flex",gap:6,flexShrink:0}}>
                            {c.status==="aguardando_confirmacao" && <>
                              <button onClick={()=>confirmar(c)} style={{padding:"7px 14px",borderRadius:8,border:"1px solid var(--green)44",background:"var(--green-bg)",color:"var(--green)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700}}>✅ Confirmar</button>
                              <button onClick={()=>{if(!window.confirm("Negar e marcar inadimplente?"))return;saveFin({cobrancas:(fin.cobrancas??[]).map(x=>x.id===c.id?{...x,status:"pendente",clienteConfirmou:false}:x),status:"inadimplente"});onUpdate("_toast","🔴 Inadimplente.");}} style={{padding:"7px 10px",borderRadius:8,border:"1px solid var(--red)33",background:"transparent",color:"var(--red)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12}}>✕ Negar</button>
                            </>}
                            {c.status==="pendente" && <>
                              <button onClick={()=>{if(!window.confirm("Confirmar recebimento deste pagamento?"))return;confirmar(c);}} style={{padding:"7px 14px",borderRadius:8,border:"1px solid var(--green)44",background:"var(--green-bg)",color:"var(--green)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700}}>✅ Confirmar pago</button>
                              <button onClick={()=>{if(!window.confirm("Cancelar esta cobrança?"))return;saveFin({cobrancas:(fin.cobrancas??[]).map(x=>x.id===c.id?{...x,status:"cancelada"}:x)});}} style={{padding:"7px 10px",borderRadius:8,border:"1px solid var(--border)",background:"transparent",color:"var(--text3)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12}}>✕ Cancelar</button>
                            </>}                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── 5. HISTÓRICO ── */}
              <div style={{...S.card}}>
                <h4 style={{color:"var(--text)",fontWeight:700,fontSize:14,margin:"0 0 14px"}}>📋 Histórico de pagamentos</h4>
                {pagamentos.length === 0 && <p style={{color:"var(--text3)",fontSize:13,textAlign:"center",padding:"20px 0"}}>Nenhum pagamento confirmado ainda.</p>}
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {pagamentos.map(p=>(
                    <div key={p.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 14px",borderRadius:10,background:"var(--bg2)"}}>
                      <div>
                        <div style={{color:"var(--text)",fontWeight:700,fontSize:14,fontFamily:"'DM Mono',monospace",marginBottom:2}}>
                          R$ {p.valor?.toLocaleString("pt-BR",{minimumFractionDigits:2})}
                        </div>
                        <div style={{color:"var(--text3)",fontSize:12}}>
                          {fmt(p.data)} · {p.forma?.toUpperCase()} · {p.periodoLabel || p.obs || ""}
                        </div>
                        <div style={{color:"var(--green)",fontSize:11,marginTop:2,fontWeight:600}}>✅ Confirmado pelo Admin</div>
                      </div>
                      <button onClick={()=>{if(!window.confirm("Cancelar este pagamento? O ciclo será revertido."))return;saveFin({pagamentos:pagamentos.filter(x=>x.id!==p.id),cicloInicio:null,cicloFim:null,status:"ativo"});onUpdate("_toast","↩ Pagamento cancelado.");}}
                        style={{background:"none",border:"1px solid var(--red)33",borderRadius:8,color:"var(--red)",cursor:"pointer",fontSize:12,padding:"5px 10px",fontFamily:"'DM Sans',sans-serif"}}>
                        Cancelar
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}

        {/* Modais herdados */}
        {showMgrModal && (
          <Modal title={editMgrId?"Editar Gestor":"Novo Gestor"} onClose={()=>setShowMgrModal(false)} wide>
            <div style={{display:"flex",flexDirection:"column",gap:12}}>
              {/* Puxar da equipe — só no modo criação */}
              {!editMgrId && (() => {
                const restEmps = employees.filter(e => e.restaurantId === selRestaurant && !e.inactive);
                if (restEmps.length === 0) return null;
                return (
                  <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 14px"}}>
                    <label style={{...S.label,margin:0}}>👥 Puxar dados de um empregado da equipe</label>
                    <p style={{color:"var(--text3)",fontSize:11,margin:"4px 0 8px"}}>Selecione para pré-preencher nome, CPF e PIN. O empregado continua ativo na equipe.</p>
                    <select
                      onChange={e => {
                        const emp = restEmps.find(x => x.id === e.target.value);
                        if (!emp) return;
                        setMgrForm(f => ({...f, name: emp.name, cpf: emp.cpf ?? ""}));
                      }}
                      style={{...S.input,cursor:"pointer"}}
                      defaultValue=""
                    >
                      <option value="" disabled>Selecionar empregado...</option>
                      {restEmps.sort((a,b)=>a.name.localeCompare(b.name)).map(e => {
                        const role = roles.find(r => r.id === e.roleId);
                        return <option key={e.id} value={e.id}>{e.name}{role ? ` — ${role.name}` : ""}{e.cpf ? ` (${isPrivate(selRestaurant) ? "•••.•••.•••-••" : e.cpf})` : ""}</option>;
                      })}
                    </select>
                  </div>
                );
              })()}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label style={S.label}>Nome completo</label><input value={mgrForm.name} onChange={e=>setMgrForm({...mgrForm,name:e.target.value})} style={S.input}/></div>
                <div><label style={S.label}>CPF *</label><input value={mgrForm.cpf} onChange={e=>setMgrForm({...mgrForm,cpf:maskCpf(e.target.value)})} placeholder="000.000.000-00" style={S.input} inputMode="numeric"/></div>
              </div>
              {editMgrId
                ? <div><label style={S.label}>PIN (4 dígitos)</label><input type="password" value={mgrForm.pin} onChange={e=>setMgrForm({...mgrForm,pin:e.target.value})} maxLength={4} inputMode="numeric" style={S.input}/></div>
                : <div style={{padding:"8px 12px",borderRadius:8,background:"var(--bg2)",border:"1px solid var(--border)",fontSize:12,color:"var(--text3)"}}> PIN inicial = 4 primeiros dígitos do CPF. No primeiro acesso o gestor será solicitado a trocar.</div>
              }
              {/* Perfil do gestor */}
              <div>
                <label style={S.label}>Perfil do gestor</label>
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {[
                    {id:"dp",icon:"📬",title:"Gestor Administrativo",desc:"Acesso completo: gorjetas, escala, cargos, equipe, comunicados, FAQ, DP e notificações. Recebe mensagens do Fale com DP."},
                    {id:"lider",icon:"👔",title:"Líder Operacional",desc:"Acesso apenas à escala e horários da(s) sua(s) área(s)."},
                    {id:"custom",icon:"⚙️",title:"Personalizado",desc:"Escolha as permissões manualmente."},
                  ].map(p=>{
                    const on = mgrForm.profile === p.id;
                    return (
                      <button key={p.id} onClick={()=>{
                        const presets = {
                          dp: {perms:{tips:true,schedule:true,roles:true,employees:true,comunicados:true,faq:true,dp:true,horarios:true},isDP:true,areas:[]},
                          lider: {perms:{tips:false,schedule:true,roles:false,employees:false,comunicados:false,faq:false,dp:false,horarios:true,vt:false},isDP:false},
                          custom: {isDP:mgrForm.isDP},
                        };
                        const preset = presets[p.id];
                        setMgrForm(f=>({...f,...preset,profile:p.id,areas:p.id==="lider"?f.areas:[]}));
                      }}
                        style={{width:"100%",padding:"12px 14px",borderRadius:10,border:`1px solid ${on?ac:"var(--border)"}`,background:on?"var(--ac-bg)":"transparent",color:on?"var(--ac-text)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,textAlign:"left",display:"flex",alignItems:"center",gap:10}}>
                        <span style={{fontSize:18}}>{p.icon}</span>
                        <div>
                          <div style={{fontWeight:700}}>{on?"✓ ":""}{p.title}</div>
                          <div style={{fontSize:11,opacity:0.7,marginTop:2}}>{p.desc}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Area restriction for Líder */}
              {mgrForm.profile === "lider" && (
                <div>
                  <label style={S.label}>Áreas do líder</label>
                  <p style={{color:"var(--text3)",fontSize:11,margin:"0 0 8px"}}>O líder só verá empregados e escalas das áreas selecionadas.</p>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    {AREAS.map(a=>{
                      const on = (mgrForm.areas??[]).includes(a);
                      return <button key={a} onClick={()=>setMgrForm(f=>({...f,areas:on?f.areas.filter(x=>x!==a):[...(f.areas??[]),a]}))}
                        style={{padding:"8px 16px",borderRadius:20,border:`1px solid ${on?AREA_COLORS[a]??"#555":"var(--border)"}`,background:on?(AREA_COLORS[a]??"#555")+"22":"transparent",color:on?AREA_COLORS[a]??"var(--text)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:on?700:400}}>
                        {on?"✓ ":""}{a}
                      </button>;
                    })}
                  </div>
                  {(mgrForm.areas??[]).length===0 && <p style={{color:"var(--red)",fontSize:11,marginTop:6}}>Selecione pelo menos uma área.</p>}
                </div>
              )}

              {/* Custom permissions */}
              {mgrForm.profile === "custom" && (
                <div>
                  <label style={S.label}>Permissões</label>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    {[["tips","💸 Gorjetas"],["schedule","📅 Escala"],["roles","🏷️ Cargos"],["employees","👥 Equipe"],["comunicados","📢 Comunicados"],["faq","❓ FAQ"],["dp","💬 Fale c/ DP"],["horarios","🕐 Horários"],["vt","🚌 Vale Transporte"]].map(([k,lbl])=>{
                      const on = mgrForm.perms?.[k] !== false;
                      return (
                        <button key={k} onClick={()=>setMgrForm({...mgrForm,perms:{...mgrForm.perms,[k]:!on}})}
                          style={{padding:"10px",borderRadius:10,border:`1px solid ${on?"var(--green)":"var(--border)"}`,background:on?"var(--green-bg)":"transparent",color:on?"var(--green)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,textAlign:"left"}}>
                          {on?"✓":"○"} {lbl}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {mgrForm.profile === "custom" && (
                <div style={{borderTop:"1px solid var(--border)",paddingTop:12}}>
                  <button onClick={()=>setMgrForm({...mgrForm,isDP:!mgrForm.isDP})}
                    style={{width:"100%",padding:"12px 14px",borderRadius:10,border:`1px solid ${mgrForm.isDP?"var(--blue)":"var(--border)"}`,background:mgrForm.isDP?"var(--blue-bg)":"transparent",color:mgrForm.isDP?"var(--blue)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,textAlign:"left",display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:18}}>📬</span>
                    <div>
                      <div style={{fontWeight:700}}>{mgrForm.isDP?"✓ É gestor do DP":"○ Não é gestor do DP"}</div>
                      <div style={{fontSize:11,opacity:0.7,marginTop:2}}>Recebe notificações de horários e mensagens do Fale com DP</div>
                    </div>
                  </button>
                </div>
              )}

              <div>
                <label style={S.label}>Outros restaurantes com acesso</label>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {restaurants.filter(r=>r.id!==selRestaurant).map(r=>{
                    const sel = mgrForm.restaurantIds?.includes(r.id);
                    return (
                      <button key={r.id} onClick={()=>setMgrForm({...mgrForm,restaurantIds:sel?mgrForm.restaurantIds.filter(x=>x!==r.id):[...(mgrForm.restaurantIds??[]),r.id]})}
                        style={{padding:"10px 14px",borderRadius:10,border:`1px solid ${sel?ac:"var(--border)"}`,background:sel?"var(--ac-bg)":"transparent",color:sel?"var(--ac-text)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,textAlign:"left"}}>
                        {sel?"✓":"○"} {r.name}
                      </button>
                    );
                  })}
                  {restaurants.filter(r=>r.id!==selRestaurant).length===0 && <p style={{color:"var(--text3)",fontSize:12}}>Nenhum outro restaurante cadastrado.</p>}
                </div>
              </div>
              <button onClick={saveMgr} style={S.btnPrimary}>{editMgrId?"Salvar":"Criar Gestor"}</button>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", fontFamily:"'DM Sans',sans-serif" }}>
      <div style={{ background:"var(--header-bg)", borderBottom:"1px solid var(--border)", padding:isMobile?"10px 12px":"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", boxShadow:"0 1px 4px rgba(0,0,0,0.04)", gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:isMobile?6:8, minWidth:0 }}>
          <span style={{ fontSize:isMobile?14:18 }}>⭐</span>
          <span style={{ color:"var(--text)", fontWeight:800, fontSize:isMobile?13:16 }}>{isMobile?"Gestor":"Gestor AppTip"}</span>
          {!isMobile && <span style={{ color:"var(--text3)", fontSize:12 }}>· {currentUser?.name}</span>}
        </div>
        <div style={{display:"flex",gap:isMobile?4:6,alignItems:"center",flexShrink:0}}>
          <button onClick={()=>setViewOnly(!viewOnly)} title={viewOnly?"Modo somente leitura ativo — clique para desbloquear":"Clique para ativar modo somente leitura"}
            style={{background:viewOnly?"var(--ac)22":"none",border:`1px solid ${viewOnly?"var(--ac)":"var(--border)"}`,borderRadius:20,padding:isMobile?"5px 8px":"6px 10px",cursor:"pointer",fontSize:isMobile?12:14,color:viewOnly?"var(--ac)":"var(--text3)"}}>
            {viewOnly?"🔒":"🔓"}
          </button>
          <button onClick={toggleTheme} style={{background:"none",border:"1px solid var(--border)",borderRadius:20,padding:isMobile?"5px 8px":"6px 10px",cursor:"pointer",fontSize:isMobile?12:14,color:"var(--text2)"}}>{theme==="dark"?"☀️":"🌙"}</button>
          <button onClick={onBack} style={{ ...S.btnSecondary, fontSize:isMobile?11:12, padding:isMobile?"5px 10px":undefined }}>Sair</button>
        </div>
      </div>
      {viewOnly && <div style={{background:"var(--ac)11",borderBottom:"1px solid var(--ac)33",padding:isMobile?"5px 12px":"6px 20px",textAlign:"center",fontSize:isMobile?11:12,color:"var(--ac)",fontWeight:600}}>🔒 Modo somente leitura — edições bloqueadas</div>}
      <div style={{ display:"flex", borderBottom:"1px solid var(--border)", background:"var(--header-bg)", overflowX:"auto", WebkitOverflowScrolling:"touch" }}>
        {TABS.map(([id,lbl])=>(
          <button key={id} onClick={()=>setTab(id)} style={{ padding:isMobile?"10px 12px":"12px 20px", background:"none", border:"none", borderBottom:`2px solid ${tab===id?ac:"transparent"}`, color:tab===id?ac:"var(--text3)", cursor:"pointer", fontSize:isMobile?11:14, fontFamily:"'DM Sans',sans-serif", fontWeight:tab===id?700:500, whiteSpace:"nowrap" }}>{lbl}</button>
        ))}
      </div>

      <div style={{ padding:isMobile?"12px 10px":"20px 24px", maxWidth:1100, margin:"0 auto" }}>

        {/* DASHBOARD (removido — info consolidada no Financeiro) */}
        {false && (() => {
          const totalRests = restaurants.length;
          const totalEmps = employees.filter(e=>!e.inactive).length;
          const totalMgrs = managers.length;
          const receitaMensal = restaurants.reduce((sum, r) => {
            const p = getPlano(r);
            const ea = r.earlyAdopter ? 0.7 : 1;
            if (r.planoId === "p999") return sum + ((r.empMaxCustom ?? 51) * 7.99 * ea);
            if (r.planoId === "pOrc") return sum;
            return sum + ((p.mensal ?? 0) * ea);
          }, 0);

          const today_ = today();
          const thisMonth = today_.slice(0,7);

          return (
            <div>
              {/* Métricas */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:16,marginBottom:28}}>
                {[
                  { label:"Restaurantes", value:totalRests, icon:"🏢", color:"var(--blue)" },
                  { label:"Empregados ativos", value:totalEmps, icon:"👥", color:"var(--green)" },
                  { label:"Gestores", value:totalMgrs, icon:"👔", color:"#8b5cf6" },
                  { label:"Receita mensal est.", value:`R$${receitaMensal.toLocaleString("pt-BR")}`, icon:"💰", color:"var(--ac)" },
                ].map(m=>(
                  <div key={m.label} style={{...S.card,display:"flex",alignItems:"center",gap:14}}>
                    <div style={{fontSize:28,width:48,height:48,borderRadius:12,background:m.color+"15",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{m.icon}</div>
                    <div>
                      <div style={{color:"var(--text3)",fontSize:11,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5,marginBottom:2}}>{m.label}</div>
                      <div style={{color:"var(--text)",fontSize:22,fontWeight:800,fontFamily:"'DM Mono',monospace"}}>{m.value}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Status dos restaurantes */}
              <div style={{...S.card,marginBottom:20}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                  <h3 style={{color:"var(--text)",fontSize:15,fontWeight:700,margin:0}}>Status dos clientes</h3>
                  <span style={{color:"var(--text3)",fontSize:12}}>{thisMonth}</span>
                </div>
                {restaurants.length === 0 && <p style={{color:"var(--text3)",fontSize:13,textAlign:"center"}}>Nenhum restaurante cadastrado.</p>}
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {restaurants.map(r => {
                    const plano = getPlano(r);
                    const empAtivos = employees.filter(e=>e.restaurantId===r.id&&!e.inactive).length;
                    const pct = Math.min(100, Math.round((empAtivos/plano.empMax)*100));
                    const temGorjetaMes = tips.some(t=>t.restaurantId===r.id&&t.monthKey===thisMonth);
                    const ultimaGorjeta = tips.filter(t=>t.restaurantId===r.id).sort((a,b)=>b.date?.localeCompare(a.date??"")??"").at(0);
                    const diasSemGorjeta = ultimaGorjeta?.date
                      ? Math.floor((new Date()-new Date(ultimaGorjeta.date+"T12:00:00"))/(1000*60*60*24))
                      : 999;

                    // Semáforo
                    let semaforo = "verde";
                    let semaforoMsg = "Ativo";
                    const finStatus = r.financeiro?.status ?? "ativo";
                    const cicloFimR = r.financeiro?.cicloFim;
                    const trialFimR = r.financeiro?.trialFim;
                    const cicloInicioR = r.financeiro?.cicloInicio;
                    const diasCiclo = cicloFimR ? Math.ceil((new Date(cicloFimR+"T12:00:00")-new Date())/(1000*60*60*24)) : null;
                    const diasTrial = (!cicloInicioR && trialFimR) ? Math.ceil((new Date(trialFimR+"T12:00:00")-new Date())/(1000*60*60*24)) : null;
                    if (finStatus === "inadimplente")              { semaforo = "vermelho"; semaforoMsg = "🔴 Inadimplente"; }
                    else if (!cicloInicioR && !trialFimR)          { semaforo = "amarelo";  semaforoMsg = "⚙️ Sem ciclo iniciado"; }
                    else if (!cicloInicioR && diasTrial !== null && diasTrial <= 0) { semaforo = "vermelho"; semaforoMsg = "⏰ Trial encerrado"; }
                    else if (!cicloInicioR && diasTrial !== null)  { semaforo = "amarelo";  semaforoMsg = `🎯 Trial — ${diasTrial}d restantes`; }
                    else if (diasCiclo !== null && diasCiclo < 0)  { semaforo = "vermelho"; semaforoMsg = `⏰ Vencido há ${Math.abs(diasCiclo)}d`; }
                    else if (diasCiclo !== null && diasCiclo <= 7) { semaforo = "amarelo";  semaforoMsg = `⚡ Vence em ${diasCiclo}d`; }
                    else if (pct >= 100)                           { semaforo = "vermelho"; semaforoMsg = "Limite atingido"; }
                    else if (!temGorjetaMes)                       { semaforo = "amarelo";  semaforoMsg = "Sem gorjeta este mês"; }
                    else if (pct >= 80)                            { semaforo = "amarelo";  semaforoMsg = "Próximo do limite"; }

                    const semColor = semaforo === "verde" ? "var(--green)" : semaforo === "amarelo" ? "#f59e0b" : "var(--red)";

                    return (
                      <div key={r.id} style={{display:"flex",alignItems:"center",gap:14,padding:"12px 16px",borderRadius:12,background:"var(--bg2)",border:"1px solid var(--border)",cursor:"pointer"}}
                        onClick={()=>setSelRestaurant(r.id)}>
                        {/* Semáforo */}
                        <div style={{width:10,height:10,borderRadius:"50%",background:semColor,flexShrink:0,boxShadow:`0 0 6px ${semColor}`}}/>
                        {/* Info */}
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                            <span style={{color:"var(--text)",fontWeight:700,fontSize:14}}>{r.name}</span>
                            <span style={{background:"var(--ac-bg)",color:"var(--ac-text)",borderRadius:6,padding:"1px 8px",fontSize:11,fontWeight:700}}>{plano.label}</span>
                          </div>
                          <div style={{display:"flex",gap:12,fontSize:12,color:"var(--text3)"}}>
                            <span>{empAtivos}/{plano.empMax} emp.</span>
                            <span style={{color:semColor,fontWeight:600}}>{semaforoMsg}</span>
                            {ultimaGorjeta && <span>Última gorjeta: {diasSemGorjeta}d atrás</span>}
                          </div>
                        </div>
                        {/* Barra de uso */}
                        <div style={{width:80,flexShrink:0}}>
                          <div style={{background:"var(--border)",borderRadius:4,height:6,overflow:"hidden"}}>
                            <div style={{width:`${pct}%`,height:"100%",background:semColor,borderRadius:4,transition:"width 0.3s"}}/>
                          </div>
                          <div style={{textAlign:"right",fontSize:10,color:"var(--text3)",marginTop:2}}>{pct}%</div>
                        </div>
                        <span style={{color:"var(--text3)",fontSize:16}}>›</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Alertas de pagamentos aguardando confirmação */}
              {(() => {
                const aguardando = restaurants.flatMap(r =>
                  (r.financeiro?.cobrancas??[])
                    .filter(c => c.status === "aguardando_confirmacao")
                    .map(c => ({ ...c, restName: r.name, restId: r.id }))
                );
                if (aguardando.length === 0) return null;
                return (
                  <div style={{...S.card,marginBottom:16,border:"1px solid #f59e0b44",background:"#fffbeb"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                      <span style={{color:"#92400e",fontWeight:700,fontSize:14}}>💬 {aguardando.length} pagamento{aguardando.length>1?"s":""} aguardando confirmação</span>
                    </div>
                    {aguardando.map(c=>(
                      <div key={c.id} style={{display:"flex",flexDirection:isMobile?"column":"row",justifyContent:"space-between",alignItems:isMobile?"stretch":"center",gap:isMobile?8:0,padding:isMobile?"10px":"10px 12px",borderRadius:10,background:"#fff",border:"1px solid #fde68a",marginBottom:8}}>
                        <div>
                          <div style={{color:"var(--text)",fontWeight:700,fontSize:13}}>{c.restName}</div>
                          <div style={{color:"var(--text3)",fontSize:12}}>
                            {c.periodoLabel} · R$ {c.valor?.toLocaleString("pt-BR",{minimumFractionDigits:2})} · Cliente confirmou em {c.clienteConfirmouEm ? new Date(c.clienteConfirmouEm).toLocaleDateString("pt-BR") : "—"}
                          </div>
                        </div>
                        <div style={{display:"flex",gap:6,flexShrink:0}}>
                          <button onClick={()=>{
                            // Confirma — chama confirmarPagamento indiretamente via update
                            const r = restaurants.find(x=>x.id===c.restId);
                            if (!r) return;
                            const dataPag = c.clienteConfirmouEm?.slice(0,10) ?? today();
                            const cicloEnd = (() => {
                              const d = new Date(dataPag+"T12:00:00");
                              if ((r.tipoCobranca??"mensal") === "anual") d.setFullYear(d.getFullYear()+1);
                              else d.setDate(d.getDate()+30);
                              return d.toISOString().slice(0,10);
                            })();
                            const [ano,mes] = cicloEnd.split("-");
                            const mesesNome = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
                            const proxLabel = `${mesesNome[parseInt(mes)-1]}/${ano}`;
                            const proxCob = { id:(Date.now()).toString(), periodo:cicloEnd.slice(0,7), periodoLabel:proxLabel, venc:cicloEnd, valor:c.valor, forma:c.forma, chave:c.chave, criadaEm:new Date().toISOString(), status:"pendente", autoGerada:true };
                            const updatedCobs = (r.financeiro?.cobrancas??[]).map(x=>x.id===c.id?{...x,status:"pago",pagoEm:new Date().toISOString()}:x);
                            const novoPag = { id:(Date.now()+1).toString(), data:dataPag, valor:c.valor, forma:c.forma, obs:`Ref. ${c.periodoLabel}`, registradoEm:new Date().toISOString() };
                            const updated = restaurants.map(x=>x.id===c.restId?{...x,financeiro:{...x.financeiro,cobrancas:[...updatedCobs,proxCob],pagamentos:[novoPag,...(x.financeiro?.pagamentos??[])],status:"ativo",cicloInicio:dataPag,cicloFim:cicloEnd,proximoVencimento:cicloEnd}}:x);
                            onUpdate("restaurants",updated);
                            onUpdate("_toast",`✅ Pagamento de ${c.restName} confirmado!`);
                          }} style={{padding:"6px 12px",borderRadius:8,border:"1px solid var(--green)44",background:"var(--green-bg)",color:"var(--green)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:700}}>
                            ✅ Confirmar
                          </button>
                          <button onClick={()=>{
                            const updated = restaurants.map(r=>r.id===c.restId?{...r,financeiro:{...r.financeiro,cobrancas:(r.financeiro?.cobrancas??[]).map(x=>x.id===c.id?{...x,status:"pendente",clienteConfirmou:false}:x),status:"inadimplente"}}:r);
                            onUpdate("restaurants",updated);
                            onUpdate("_toast",`🔴 ${c.restName} marcado como inadimplente.`);
                          }} style={{padding:"6px 12px",borderRadius:8,border:"1px solid var(--red)33",background:"transparent",color:"var(--red)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600}}>
                            ✕ Negar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Notificações recentes */}
              {unreadNotifs > 0 && (
                <div style={{...S.card,border:"1px solid var(--ac)33",background:"var(--ac-bg)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                    <span style={{color:"var(--ac-text)",fontWeight:700,fontSize:14}}>📬 {unreadNotifs} mensagem{unreadNotifs>1?"ns":""} não lida{unreadNotifs>1?"s":""}</span>
                    <button onClick={()=>setTab("inbox")} style={{...S.btnSecondary,fontSize:12,padding:"4px 12px"}}>Ver caixa →</button>
                  </div>
                  {notifications.filter(n=>!n.read&&n.targetRole==="admin").slice(0,3).map(n=>(
                    <div key={n.id} style={{padding:"8px 0",borderBottom:"1px solid var(--border)",fontSize:13,color:"var(--text2)"}}>
                      {n.body}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* CAIXA */}
        {tab === "inbox" && (() => {
          const adminNotifs = [...notifications].filter(n => n.targetRole === "admin" || n.type === "upgrade_request")
            .sort((a,b) => b.date?.localeCompare(a.date??""));

          return (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <h3 style={{color:"var(--text)",fontSize:16,fontWeight:700,margin:0}}>📬 Caixa de entrada</h3>
                {adminNotifs.some(n=>!n.read) && (
                  <button onClick={()=>{
                    const updated = notifications.map(n => n.targetRole==="admin"||n.type==="upgrade_request" ? {...n,read:true} : n);
                    onUpdate("notifications", updated);
                  }} style={{...S.btnSecondary,fontSize:12,padding:"6px 14px"}}>Marcar todas como lidas</button>
                )}
              </div>

              {adminNotifs.length === 0 && (
                <div style={{...S.card,textAlign:"center",padding:40}}>
                  <div style={{fontSize:36,marginBottom:12}}>📭</div>
                  <p style={{color:"var(--text3)",fontSize:14}}>Nenhuma mensagem ainda.</p>
                </div>
              )}

              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {adminNotifs.map(n => {
                  const isUpgrade = n.type === "upgrade_request";
                  const rest = restaurants.find(r=>r.id===n.restaurantId);
                  return (
                    <div key={n.id} style={{...S.card,border:`1px solid ${n.read?"var(--border)":isUpgrade?"var(--ac)44":"var(--blue)33"}`,background:n.read?"var(--card-bg)":isUpgrade?"var(--ac-bg)":"var(--blue-bg)"}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12}}>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                            <span style={{fontSize:16}}>{isUpgrade?"📦":"💬"}</span>
                            <span style={{color:"var(--text)",fontWeight:700,fontSize:14}}>
                              {isUpgrade?"Solicitação de upgrade":"Mensagem"}
                            </span>
                            {!n.read && <span style={{background:isUpgrade?ac:"var(--blue)",color:"#fff",borderRadius:20,padding:"1px 8px",fontSize:10,fontWeight:700}}>Novo</span>}
                            {rest && <span style={{color:"var(--text3)",fontSize:12}}>· {rest.name}</span>}
                          </div>
                          <p style={{color:"var(--text2)",fontSize:13,margin:"0 0 8px",lineHeight:1.5}}>{n.body}</p>
                          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                            <span style={{color:"var(--text3)",fontSize:11}}>{n.date ? new Date(n.date).toLocaleString("pt-BR") : ""}</span>
                            {isUpgrade && (
                              <button onClick={()=>setSelRestaurant(n.restaurantId)} style={{padding:"4px 12px",borderRadius:8,border:`1px solid ${ac}`,background:"transparent",color:"var(--ac-text)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600}}>
                                Abrir restaurante →
                              </button>
                            )}
                          </div>
                        </div>
                        <div style={{display:"flex",flexDirection:"column",gap:4,flexShrink:0,alignItems:"flex-end"}}>
                          {!n.read && (
                            <button onClick={()=>{
                              const updated = notifications.map(x => x.id===n.id ? {...x,read:true} : x);
                              onUpdate("notifications", updated);
                            }} style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:18,padding:4}}>✓</button>
                          )}
                          <button onClick={()=>{
                            if(!window.confirm("Apagar permanentemente esta notificação?")) return;
                            onUpdate("notifications", notifications.filter(x => x.id!==n.id));
                            onUpdate("_toast","🗑️ Notificação apagada");
                          }} style={{background:"none",border:"1px solid #e74c3c22",borderRadius:6,color:"var(--text3)",cursor:"pointer",fontSize:11,padding:"3px 8px",fontFamily:"'DM Mono',monospace"}}>🗑️</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* FINANCEIRO GERAL */}
        {tab === "financeiro_geral" && (() => {
          const totalEmps = employees.filter(e=>!e.inactive).length;
          const totalMgrs = managers.length;
          const thisMonth = today().slice(0,7);

          const rows = restaurants.map(r => {
            const plano = getPlano(r);
            const fin = r.financeiro ?? {};
            const tipoCobranca = r.tipoCobranca ?? "mensal";
            const isEnt = r.planoId === "p999";
            const isOrc = r.planoId === "pOrc";
            const empMax = isEnt ? (r.empMaxCustom ?? 51) : (isOrc ? (r.empMaxCustom ?? 101) : plano.empMax);
            const ea = r.earlyAdopter ? 0.7 : 1;
            const valorMensalCalc = (() => {
              if (isOrc) return null;
              if (isEnt) {
                const porEmp = empMax * 7.99;
                return (tipoCobranca === "anual" ? porEmp * 0.9 : porEmp) * ea;
              }
              return (tipoCobranca === "anual" ? (plano.anual ?? 0) : (plano.mensal ?? 0)) * ea;
            })();
            const valorTotal = valorMensalCalc;
            const status = fin.status ?? "ativo";
            const venc = fin.proximoVencimento;
            const diasParaVencer = venc ? Math.ceil((new Date(venc+"T12:00:00") - new Date()) / (1000*60*60*24)) : null;
            const ultimoPag = fin.pagamentos?.[0];
            const empAtivos = employees.filter(e=>e.restaurantId===r.id&&!e.inactive).length;
            const gorjetasMes = tips.filter(t=>t.restaurantId===r.id&&t.monthKey===thisMonth);
            const diasGorjeta = [...new Set(gorjetasMes.map(t=>t.date))].length;
            return { r, plano, fin, tipoCobranca, valorTotal, status, venc, diasParaVencer, ultimoPag, empAtivos, empMax, diasGorjeta };
          });

          const receitaTotal = rows.reduce((s, x) => s + (x.valorTotal ?? 0), 0);
          const inadimplentes = rows.filter(x => x.status === "inadimplente").length;
          const vencendo = rows.filter(x => x.status !== "inadimplente" && x.diasParaVencer !== null && x.diasParaVencer <= 7 && x.diasParaVencer >= 0).length;
          const vencidos = rows.filter(x => x.status !== "inadimplente" && x.diasParaVencer !== null && x.diasParaVencer < 0).length;
          const emDia = rows.length - inadimplentes - vencidos - vencendo;

          const [filtro, setFiltro] = [filtroFinanceiro, setFiltroFinanceiro];
          const rowsFiltrados = rows.filter(x => {
            if (filtro === "inadimplente") return x.status === "inadimplente";
            if (filtro === "vencido") return x.status !== "inadimplente" && x.diasParaVencer !== null && x.diasParaVencer < 0;
            if (filtro === "vencendo") return x.status !== "inadimplente" && x.diasParaVencer !== null && x.diasParaVencer >= 0 && x.diasParaVencer <= 7;
            if (filtro === "emdia") return x.status === "ativo" && (x.diasParaVencer === null || x.diasParaVencer > 7);
            return true;
          });

          // Pagamentos aguardando confirmação
          const aguardando = restaurants.flatMap(r =>
            (r.financeiro?.cobrancas??[])
              .filter(c => c.status === "aguardando_confirmacao")
              .map(c => ({ ...c, restName: r.name, restId: r.id }))
          );

          return (
            <div>
              {/* ── Ações rápidas ── */}
              <div style={{display:"flex",gap:8,marginBottom:isMobile?12:16,flexWrap:"wrap"}}>
                <button onClick={()=>{setEditRestId(null);setRestForm({name:"",cnpj:"",address:"",whatsappFin:"",whatsappOp:"",serviceStartDate:""});setShowRestModal(true);}} style={{...S.btnPrimary,fontSize:isMobile?12:14}}>+ Novo Restaurante</button>
                {restaurants.length > 0 && (
                  <button onClick={()=>{
                    const exportData = {
                      exportedAt: new Date().toISOString(),
                      restaurantes: restaurants,
                      empregados: employees,
                      cargos: roles,
                      gorjetas: tips,
                      escalas: schedules,
                      gestores: managers.map(m=>({...m,pin:"***"})),
                    };
                    const blob = new Blob([JSON.stringify(exportData,null,2)],{type:"application/json"});
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href=url; a.download=`apptip_backup_${today()}.json`; a.click();
                    URL.revokeObjectURL(url);
                    onUpdate("_toast","✅ Backup exportado com sucesso!");
                  }} style={{...S.btnSecondary,fontSize:isMobile?11:12,color:"var(--green)",borderColor:"var(--green)"}}>
                    💾 Backup completo
                  </button>
                )}
              </div>

              {/* ── Overview rápido ── */}
              <div style={{display:"grid",gridTemplateColumns:isMobile?"repeat(2,1fr)":"repeat(4,1fr)",gap:isMobile?8:14,marginBottom:isMobile?16:24}}>
                {[
                  { label:"Restaurantes", value:restaurants.length, icon:"🏢", color:"var(--blue)" },
                  { label:"Empregados", value:totalEmps, icon:"👥", color:"var(--green)" },
                  { label:"Gestores", value:totalMgrs, icon:"👔", color:"#8b5cf6" },
                  { label:"Receita/mês", value:`R$${receitaTotal.toLocaleString("pt-BR",{minimumFractionDigits:0,maximumFractionDigits:0})}`, icon:"💰", color:"var(--ac)" },
                ].map(m=>(
                  <div key={m.label} style={{...S.card,display:"flex",alignItems:"center",gap:isMobile?10:14,padding:isMobile?"10px 12px":undefined}}>
                    <div style={{fontSize:isMobile?20:28,width:isMobile?36:48,height:isMobile?36:48,borderRadius:12,background:m.color+"15",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{m.icon}</div>
                    <div style={{minWidth:0}}>
                      <div style={{color:"var(--text3)",fontSize:isMobile?9:11,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5,marginBottom:1}}>{m.label}</div>
                      <div style={{color:"var(--text)",fontSize:isMobile?16:22,fontWeight:800,fontFamily:"'DM Mono',monospace"}}>{m.value}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* ── Semáforo financeiro ── */}
              <div style={{display:"flex",gap:isMobile?6:12,marginBottom:isMobile?16:24}}>
                {[
                  { label:"Em dia", value:emDia, color:"var(--green)", bg:"#10b98112" },
                  { label:"Vencendo", value:vencendo, color:"#f59e0b", bg:"#f59e0b12" },
                  { label:"Vencidos", value:vencidos, color:"var(--red)", bg:"#ef444412" },
                  { label:"Inadimpl.", value:inadimplentes, color:"var(--red)", bg:"#ef444412" },
                ].map(s=>(
                  <div key={s.label} style={{flex:1,background:s.bg,borderRadius:12,padding:isMobile?"10px 8px":"14px 16px",textAlign:"center",border:`1px solid ${s.color}22`}}>
                    <div style={{color:s.color,fontSize:isMobile?20:28,fontWeight:800,fontFamily:"'DM Mono',monospace"}}>{s.value}</div>
                    <div style={{color:s.color,fontSize:isMobile?9:11,fontWeight:600,marginTop:2}}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* ── Alertas de pagamento aguardando ── */}
              {aguardando.length > 0 && (
                <div style={{...S.card,marginBottom:isMobile?16:24,border:"1px solid #f59e0b44",background:"#fffbeb",padding:isMobile?"12px":"16px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                    <span style={{color:"#92400e",fontWeight:700,fontSize:isMobile?12:14}}>💬 {aguardando.length} pagamento{aguardando.length>1?"s":""} aguardando confirmação</span>
                  </div>
                  {aguardando.map(c=>(
                    <div key={c.id} style={{display:"flex",flexDirection:isMobile?"column":"row",justifyContent:"space-between",alignItems:isMobile?"stretch":"center",gap:isMobile?8:0,padding:isMobile?"10px":"10px 12px",borderRadius:10,background:"#fff",border:"1px solid #fde68a",marginBottom:8}}>
                      <div style={{minWidth:0}}>
                        <div style={{color:"var(--text)",fontWeight:700,fontSize:13}}>{c.restName}</div>
                        <div style={{color:"var(--text3)",fontSize:isMobile?11:12}}>
                          {c.periodoLabel} · R$ {c.valor?.toLocaleString("pt-BR",{minimumFractionDigits:2})} · {c.clienteConfirmouEm ? new Date(c.clienteConfirmouEm).toLocaleDateString("pt-BR") : "—"}
                        </div>
                      </div>
                      <div style={{display:"flex",gap:6,flexShrink:0}}>
                        <button onClick={()=>{
                          const r = restaurants.find(x=>x.id===c.restId);
                          if (!r) return;
                          const dataPag = c.clienteConfirmouEm?.slice(0,10) ?? today();
                          const cicloEnd = (() => {
                            const d = new Date(dataPag+"T12:00:00");
                            if ((r.tipoCobranca??"mensal") === "anual") d.setFullYear(d.getFullYear()+1);
                            else d.setDate(d.getDate()+30);
                            return d.toISOString().slice(0,10);
                          })();
                          const [ano,mes] = cicloEnd.split("-");
                          const mesesNome = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
                          const proxLabel = `${mesesNome[parseInt(mes)-1]}/${ano}`;
                          const proxCob = { id:(Date.now()).toString(), periodo:cicloEnd.slice(0,7), periodoLabel:proxLabel, venc:cicloEnd, valor:c.valor, forma:c.forma, chave:c.chave, criadaEm:new Date().toISOString(), status:"pendente", autoGerada:true };
                          const updatedCobs = (r.financeiro?.cobrancas??[]).map(x=>x.id===c.id?{...x,status:"pago",pagoEm:new Date().toISOString()}:x);
                          const novoPag = { id:(Date.now()+1).toString(), data:dataPag, valor:c.valor, forma:c.forma, obs:`Ref. ${c.periodoLabel}`, registradoEm:new Date().toISOString() };
                          const updated = restaurants.map(x=>x.id===c.restId?{...x,financeiro:{...x.financeiro,cobrancas:[...updatedCobs,proxCob],pagamentos:[novoPag,...(x.financeiro?.pagamentos??[])],status:"ativo",cicloInicio:dataPag,cicloFim:cicloEnd,proximoVencimento:cicloEnd}}:x);
                          onUpdate("restaurants",updated);
                          onUpdate("_toast",`✅ Pagamento de ${c.restName} confirmado!`);
                        }} style={{padding:"6px 12px",borderRadius:8,border:"1px solid var(--green)44",background:"var(--green-bg)",color:"var(--green)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:700,flex:isMobile?1:undefined,textAlign:"center"}}>
                          ✅ Confirmar
                        </button>
                        <button onClick={()=>{
                          const updated = restaurants.map(r=>r.id===c.restId?{...r,financeiro:{...r.financeiro,cobrancas:(r.financeiro?.cobrancas??[]).map(x=>x.id===c.id?{...x,status:"pendente",clienteConfirmou:false}:x),status:"inadimplente"}}:r);
                          onUpdate("restaurants",updated);
                          onUpdate("_toast",`🔴 ${c.restName} marcado como inadimplente.`);
                        }} style={{padding:"6px 12px",borderRadius:8,border:"1px solid var(--red)33",background:"transparent",color:"var(--red)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,flex:isMobile?1:undefined,textAlign:"center"}}>
                          ✕ Negar
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Notificações não lidas ── */}
              {unreadNotifs > 0 && (
                <div style={{...S.card,marginBottom:isMobile?16:24,border:"1px solid var(--ac)33",background:"var(--ac-bg)",padding:isMobile?"12px":"16px"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <span style={{color:"var(--ac-text)",fontWeight:700,fontSize:isMobile?12:14}}>📬 {unreadNotifs} mensagem{unreadNotifs>1?"ns":""} não lida{unreadNotifs>1?"s":""}</span>
                    <button onClick={()=>setTab("inbox")} style={{...S.btnSecondary,fontSize:11,padding:"4px 12px"}}>Ver caixa →</button>
                  </div>
                  {notifications.filter(n=>!n.read&&n.targetRole==="admin").slice(0,3).map(n=>(
                    <div key={n.id} style={{padding:"6px 0",borderBottom:"1px solid var(--border)",fontSize:isMobile?12:13,color:"var(--text2)"}}>
                      {n.body}
                    </div>
                  ))}
                </div>
              )}

              {/* ── Filtros ── */}
              <div style={{display:"flex",gap:isMobile?4:8,marginBottom:isMobile?12:16,flexWrap:"wrap"}}>
                {[
                  ["todos","Todos"],
                  ["emdia","✅ Em dia"],
                  ["vencendo","⚡ Vencendo"],
                  ["vencido","⏰ Vencidos"],
                  ["inadimplente","🔴 Inadimpl."],
                ].map(([v,l])=>(
                  <button key={v} onClick={()=>setFiltro(v)}
                    style={{padding:isMobile?"5px 10px":"6px 16px",borderRadius:20,border:`1px solid ${filtro===v?ac:"var(--border)"}`,background:filtro===v?"var(--ac-bg)":"transparent",color:filtro===v?"var(--ac-text)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:isMobile?11:13,fontWeight:filtro===v?700:400}}>
                    {l}
                  </button>
                ))}
              </div>

              {/* ── Tabela / Cards de restaurantes ── */}
              {isMobile ? (
                /* Mobile: cards empilhados */
                <div style={{display:"flex",flexDirection:"column",gap:8}}>
                  {rowsFiltrados.length === 0 && (
                    <div style={{...S.card,textAlign:"center",padding:32,color:"var(--text3)"}}>Nenhum restaurante neste filtro.</div>
                  )}
                  {rowsFiltrados.map(({r, plano, valorTotal, status, venc, diasParaVencer, ultimoPag, empAtivos, empMax, diasGorjeta})=>{
                    const isInad = status === "inadimplente";
                    const cicloFimRow = r.financeiro?.cicloFim;
                    const cicloInicioRow = r.financeiro?.cicloInicio;
                    const trialFimRow = r.financeiro?.trialFim;
                    const emTrialRow = !cicloInicioRow && trialFimRow;
                    const diasRow = cicloFimRow ? Math.ceil((new Date(cicloFimRow+"T12:00:00")-new Date())/(1000*60*60*24)) : null;
                    const diasTrialRow = emTrialRow ? Math.ceil((new Date(trialFimRow+"T12:00:00")-new Date())/(1000*60*60*24)) : null;
                    const isVencido = !isInad && cicloFimRow && diasRow < 0;
                    const isVencendo = !isInad && diasRow !== null && diasRow >= 0 && diasRow <= 7;
                    const semColor = isInad||isVencido ? "var(--red)" : isVencendo ? "#f59e0b" : emTrialRow ? "#92400e" : "var(--green)";
                    const statusLabel = isInad ? "🔴 Inadimplente" : isVencido ? `⏰ Vencido ${Math.abs(diasRow)}d` : isVencendo ? `⚡ ${diasRow}d` : emTrialRow ? `🎯 Trial ${diasTrialRow}d` : !cicloInicioRow ? "⚙️ Não iniciado" : "✅ Em dia";

                    return (
                      <div key={r.id} style={{...S.card,padding:"12px",borderLeft:`3px solid ${semColor}`}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}} onClick={()=>{ setSelRestaurant(r.id); setRestTab("financeiro"); }}>
                          <div style={{display:"flex",alignItems:"center",gap:6,minWidth:0}}>
                            <span style={{color:"var(--text)",fontWeight:700,fontSize:14}}>{r.name}</span>
                            {r.earlyAdopter && <span style={{fontSize:9,color:"#d4a017",fontWeight:700,background:"#d4a01715",padding:"1px 4px",borderRadius:6}}>EA</span>}
                          </div>
                          <span style={{color:semColor,fontWeight:700,fontSize:11,flexShrink:0}}>{statusLabel}</span>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,fontSize:11,color:"var(--text3)",marginBottom:8}} onClick={()=>{ setSelRestaurant(r.id); setRestTab("financeiro"); }}>
                          <div><span style={{fontWeight:600}}>Plano:</span> {plano.label}</div>
                          <div><span style={{fontWeight:600}}>Valor:</span> {valorTotal ? `R$${valorTotal.toLocaleString("pt-BR",{minimumFractionDigits:2})}` : "—"}</div>
                          <div><span style={{fontWeight:600}}>Emp.:</span> {empAtivos}/{empMax}</div>
                          <div><span style={{fontWeight:600}}>Gorjetas:</span> {diasGorjeta}d no mês</div>
                          <div><span style={{fontWeight:600}}>Últ. pag.:</span> {ultimoPag ? new Date(ultimoPag.data+"T12:00:00").toLocaleDateString("pt-BR") : "—"}</div>
                          <div><span style={{fontWeight:600}}>Venc.:</span> {venc ? new Date(venc+"T12:00:00").toLocaleDateString("pt-BR") : "—"}</div>
                        </div>
                        <div style={{display:"flex",gap:6,borderTop:"1px solid var(--border)",paddingTop:8}}>
                          <button onClick={()=>setSelRestaurant(r.id)} style={{...S.btnSecondary,fontSize:11,flex:1,textAlign:"center",color:ac,borderColor:ac,padding:"6px"}}>Abrir →</button>
                          <button onClick={()=>{setSelRestaurant(r.id);setRestTab("financeiro");}} style={{...S.btnSecondary,fontSize:11,flex:1,textAlign:"center",color:"var(--green)",borderColor:"var(--green)",padding:"6px"}}>💳</button>
                          <button onClick={()=>{setEditRestId(r.id);setRestForm({name:r.name,shortCode:r.shortCode??"",cnpj:r.cnpj??"",address:r.address??"",whatsappFin:r.whatsappFin??"",whatsappOp:r.whatsappOp??"",serviceStartDate:r.serviceStartDate??""});setShowRestModal(true);}} style={{...S.btnSecondary,fontSize:11,flex:1,textAlign:"center",padding:"6px"}}>✏️ Editar</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Desktop: tabela */
                <div style={{...S.card,padding:0,overflow:"hidden"}}>
                  <div style={{display:"grid",gridTemplateColumns:"2fr 0.8fr 0.7fr 1fr 0.8fr 0.8fr 1fr 0.6fr",gap:0,padding:"10px 16px",background:"var(--bg2)",borderBottom:"1px solid var(--border)"}}>
                    {["Restaurante","Plano","Emp.","Valor/mês","Últ. pag.","Vencimento","Status","Ações"].map(h=>(
                      <div key={h} style={{color:"var(--text3)",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>{h}</div>
                    ))}
                  </div>

                  {rowsFiltrados.length === 0 && (
                    <div style={{padding:"32px",textAlign:"center",color:"var(--text3)"}}>Nenhum restaurante neste filtro.</div>
                  )}

                  {rowsFiltrados.map(({r, plano, valorTotal, status, venc, diasParaVencer, ultimoPag, empAtivos, empMax, diasGorjeta})=>{
                    const isInad = status === "inadimplente";
                    const cicloFimRow = r.financeiro?.cicloFim;
                    const cicloInicioRow = r.financeiro?.cicloInicio;
                    const trialFimRow = r.financeiro?.trialFim;
                    const emTrialRow = !cicloInicioRow && trialFimRow;
                    const diasRow = cicloFimRow ? Math.ceil((new Date(cicloFimRow+"T12:00:00")-new Date())/(1000*60*60*24)) : null;
                    const diasTrialRow = emTrialRow ? Math.ceil((new Date(trialFimRow+"T12:00:00")-new Date())/(1000*60*60*24)) : null;
                    const isVencido = !isInad && cicloFimRow && diasRow < 0;
                    const isVencendo = !isInad && diasRow !== null && diasRow >= 0 && diasRow <= 7;

                    const rowBg = isInad ? "var(--red-bg)" : isVencido ? "#fff8f0" : "transparent";
                    const statusEl = isInad
                      ? <span style={{color:"var(--red)",fontWeight:700,fontSize:11}}>🔴 Inadimplente</span>
                      : isVencido
                      ? <span style={{color:"var(--red)",fontWeight:600,fontSize:11}}>⏰ Vencido {Math.abs(diasRow)}d</span>
                      : isVencendo
                      ? <span style={{color:"#f59e0b",fontWeight:600,fontSize:11}}>⚡ {diasRow}d</span>
                      : emTrialRow
                      ? <span style={{color:"#92400e",fontWeight:600,fontSize:11}}>🎯 Trial {diasTrialRow}d</span>
                      : !cicloInicioRow
                      ? <span style={{color:"var(--text3)",fontSize:11}}>⚙️ Não iniciado</span>
                      : <span style={{color:"var(--green)",fontWeight:600,fontSize:11}}>✅ Em dia</span>;

                    return (
                      <div key={r.id} style={{display:"grid",gridTemplateColumns:"2fr 0.8fr 0.7fr 1fr 0.8fr 0.8fr 1fr 0.6fr",gap:0,padding:"10px 16px",borderBottom:"1px solid var(--border)",background:rowBg,alignItems:"center"}}>
                        <div style={{cursor:"pointer"}} onClick={()=>{ setSelRestaurant(r.id); setRestTab("financeiro"); }}>
                          <div style={{color:"var(--text)",fontWeight:700,fontSize:13}}>
                            {r.name}
                            {r.earlyAdopter && <span style={{marginLeft:6,fontSize:9,color:"#d4a017",fontWeight:700,background:"#d4a01715",padding:"1px 5px",borderRadius:6}}>🚀 EA</span>}
                          </div>
                          <div style={{color:"var(--text3)",fontSize:10}}>{r.tipoCobranca==="anual"?"Anual":"Mensal"} {diasGorjeta>0?`· ${diasGorjeta}d gorjeta`:""}</div>
                        </div>
                        <div style={{color:"var(--text2)",fontSize:12,cursor:"pointer"}} onClick={()=>{ setSelRestaurant(r.id); setRestTab("financeiro"); }}>{plano.label}</div>
                        <div style={{color:"var(--text2)",fontSize:12,fontFamily:"'DM Mono',monospace"}}>{empAtivos}/{empMax}</div>
                        <div style={{color:"var(--text)",fontWeight:700,fontSize:12,fontFamily:"'DM Mono',monospace"}}>
                          {valorTotal ? `R$${valorTotal.toLocaleString("pt-BR",{minimumFractionDigits:2})}` : "—"}
                        </div>
                        <div style={{color:"var(--text3)",fontSize:11}}>
                          {ultimoPag ? new Date(ultimoPag.data+"T12:00:00").toLocaleDateString("pt-BR") : "—"}
                        </div>
                        <div style={{color:isVencido||isInad?"var(--red)":isVencendo?"#f59e0b":"var(--text3)",fontSize:11,fontWeight:isVencido||isVencendo||isInad?700:400}}>
                          {venc ? new Date(venc+"T12:00:00").toLocaleDateString("pt-BR") : "—"}
                        </div>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          {statusEl}
                        </div>
                        <div style={{display:"flex",gap:4,alignItems:"center"}} onClick={e=>e.stopPropagation()}>
                          <button onClick={()=>setSelRestaurant(r.id)} title="Abrir" style={{background:"none",border:`1px solid ${ac}33`,borderRadius:6,color:ac,cursor:"pointer",fontSize:11,padding:"4px 8px",fontFamily:"'DM Sans',sans-serif"}}>Abrir</button>
                          <button onClick={()=>{setEditRestId(r.id);setRestForm({name:r.name,shortCode:r.shortCode??"",cnpj:r.cnpj??"",address:r.address??"",whatsappFin:r.whatsappFin??"",whatsappOp:r.whatsappOp??"",serviceStartDate:r.serviceStartDate??""});setShowRestModal(true);}} title="Editar" style={{background:"none",border:"1px solid var(--border)",borderRadius:6,color:"var(--text3)",cursor:"pointer",fontSize:11,padding:"4px 8px",fontFamily:"'DM Sans',sans-serif"}}>✏️</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Resumo */}
              <div style={{marginTop:12,color:"var(--text3)",fontSize:isMobile?11:12,textAlign:"right"}}>
                {rowsFiltrados.length} de {rows.length} restaurantes · Receita filtrada: R${rowsFiltrados.reduce((s,x)=>s+(x.valorTotal??0),0).toLocaleString("pt-BR",{minimumFractionDigits:2})}
              </div>
            </div>
          );
        })()}


        {/* GESTORES */}
        {tab === "managers" && (
          <div>
            <div style={{...S.card,background:"var(--bg2)",marginBottom:20,display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontSize:20}}>ℹ️</span>
              <p style={{color:"var(--text3)",fontSize:13,margin:0}}>Visão global de todos os gestores. Clique em <strong>Editar</strong> para modificar ou em um restaurante para abri-lo.</p>
            </div>
            {managers.length === 0 && <p style={{color:"var(--text3)",textAlign:"center"}}>Nenhum gestor cadastrado. Crie gestores dentro de cada restaurante.</p>}
            {managers.map(m=>(
              <div key={m.id} style={{...S.card,marginBottom:10}}>
                <div style={{display:"flex",flexDirection:isMobile?"column":"row",justifyContent:"space-between",alignItems:isMobile?"stretch":"center",gap:isMobile?10:12}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2,flexWrap:"wrap"}}>
                      <span style={{color:"var(--text)",fontWeight:700,fontSize:isMobile?13:15}}>{m.name}</span>
                      {m.isDP && <span style={{background:"var(--blue-bg)",color:"var(--blue)",borderRadius:6,padding:"2px 8px",fontSize:isMobile?10:11,fontWeight:700}}>📬 DP</span>}
                      {m.profile && m.profile !== "custom" && <span style={{background:"var(--bg2)",color:"var(--text3)",borderRadius:6,padding:"2px 8px",fontSize:isMobile?10:11,fontWeight:600}}>{m.profile === "lider" ? "👑 Líder Op." : m.profile === "padrao" ? "📋 Padrão" : m.profile}</span>}
                    </div>
                    <div style={{color:"var(--text3)",fontSize:isMobile?11:12,marginBottom:6}}>CPF: {(m.restaurantIds??[]).some(rid=>isPrivate(rid)) ? maskCpfPriv(m.cpf, (m.restaurantIds??[])[0]) : (m.cpf||"—")}</div>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                      {(m.restaurantIds??[]).map(rid=>{
                        const r=restaurants.find(x=>x.id===rid);
                        return r ? (
                          <button key={rid} onClick={()=>setSelRestaurant(rid)}
                            style={{background:"var(--ac-bg)",color:"var(--ac-text)",borderRadius:6,padding:"3px 10px",fontSize:isMobile?11:12,fontWeight:600,border:"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                            {r.name} →
                          </button>
                        ) : null;
                      })}
                      {(!m.restaurantIds||m.restaurantIds.length===0)&&<span style={{color:"var(--text3)",fontSize:isMobile?11:12}}>Sem restaurantes atribuídos</span>}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:6,flexShrink:0,justifyContent:isMobile?"stretch":"flex-end"}}>
                    <button onClick={()=>{setEditMgrId(m.id);setMgrForm({name:m.name,cpf:m.cpf??"",pin:m.pin??"",restaurantIds:m.restaurantIds??[],perms:m.perms??{tips:true,schedule:true},isDP:m.isDP??false,profile:m.profile??"custom",areas:m.areas??[]});setShowMgrModal(true);}} style={{...S.btnSecondary,fontSize:isMobile?11:12,flex:isMobile?1:undefined,textAlign:"center"}}>✏️ Editar</button>
                    <button onClick={()=>{
                      if(!window.confirm(`Resetar o PIN de ${m.name}? O novo PIN temporário será 0000.`)) return;
                      onUpdate("managers", managers.map(x=>x.id===m.id?{...x,pin:"0000",mustChangePin:true}:x));
                      onUpdate("_toast",`🔑 PIN de ${m.name} resetado para 0000`);
                    }} style={{...S.btnSecondary,fontSize:isMobile?11:12,flex:isMobile?1:undefined,textAlign:"center"}}>{isMobile?"🔑 PIN":"🔑 Resetar PIN"}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* SUPER GESTORES */}
        {tab === "owners" && (
          <div>
            <button onClick={()=>{setEditOwnerId(null);setOwnerForm({name:"",cpf:"",pin:""});setShowOwnerModal(true);}} style={{...S.btnPrimary,marginBottom:20,fontSize:isMobile?12:14}}>+ Novo Admin AppTip</button>
            {owners.map(s=>(
              <div key={s.id} style={{...S.card,marginBottom:10,display:"flex",flexDirection:isMobile?"column":"row",justifyContent:"space-between",alignItems:isMobile?"stretch":"center",gap:isMobile?10:0,border:s.isMaster?"1px solid var(--ac)44":"1px solid var(--border)"}}>
                <div style={{minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    <span style={{color:"var(--text)",fontWeight:700,fontSize:isMobile?14:15}}>{s.name}</span>
                    {s.isMaster && <span style={{background:"var(--ac-bg)",color:"var(--ac-text)",borderRadius:6,padding:"2px 8px",fontSize:isMobile?10:11,fontWeight:700}}>👑 Master</span>}
                    {s.id===currentUser?.id&&<span style={{color:"var(--text3)",fontSize:isMobile?10:11}}>← você</span>}
                  </div>
                  <div style={{color:"var(--text3)",fontSize:isMobile?11:12}}>CPF: {anyPrivate() ? "•••.•••.•••-••" : (s.cpf||"—")}</div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>{setEditOwnerId(s.id);setOwnerForm({name:s.name,cpf:s.cpf??"",pin:s.pin??"",isMaster:s.isMaster??false});setShowOwnerModal(true);}} style={{...S.btnSecondary,fontSize:isMobile?11:12,flex:isMobile?1:undefined,textAlign:"center"}}>Editar</button>
                  {!s.isMaster && owners.length>1 && isMaster && (
                    <button onClick={()=>{
                      if(!window.confirm(`Excluir admin "${s.name}"?`)) return;
                      onUpdate("owners",owners.filter(x=>x.id!==s.id));
                    }} style={{background:"none",border:"1px solid var(--red)33",borderRadius:8,color:"var(--red)",cursor:"pointer",fontSize:isMobile?11:12,padding:"6px 12px",fontFamily:"'DM Sans',sans-serif",flex:isMobile?1:undefined,textAlign:"center"}}>✕ Excluir</button>
                  )}
                  {s.isMaster && <span style={{color:"var(--text3)",fontSize:isMobile?10:11,padding:"6px 8px"}}>🔒 Protegido</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* LIXEIRA — só master */}
        {tab === "trash" && isMaster && (() => {
          const cutoff7  = new Date(Date.now() - 7  * 24*60*60*1000).toISOString();

          const allItems = [
            ...(trash.restaurants??[]).map(x=>({...x,_type:"restaurants",_icon:"🏢",_days:30})),
            ...(trash.managers??[]).map(x=>({...x,_type:"managers",_icon:"👔",_days:30})),
            ...(trash.employees??[]).map(x=>({...x,_type:"employees",_icon:"👤",_days:30})),
          ].sort((a,b)=>(b.deletedAt??"").localeCompare(a.deletedAt??""));

          const tabItems = (trash.tabData??[])
            .filter(x=>x.deletedAt > cutoff7)
            .sort((a,b)=>(b.deletedAt??"").localeCompare(a.deletedAt??""));

          const tabIcons = { tips:"💸", schedule:"📅", roles:"🏷️", employees:"👥", comunicados:"📢", faq:"❓", dp:"💬", horarios:"🕐" };

          function restoreTab(entry) {
            const { tabKey, snapshot, restaurantId } = entry;
            if (tabKey === "tips") onUpdate("tips", [...(data?.tips??[]).filter(t=>t.restaurantId!==restaurantId), ...(snapshot.tips??[])]);
            if (tabKey === "schedule") onUpdate("schedules", {...(data?.schedules??{}), [restaurantId]: snapshot.schedules});
            if (tabKey === "roles") onUpdate("roles", [...(data?.roles??[]).filter(r=>r.restaurantId!==restaurantId), ...(snapshot.roles??[])]);
            if (tabKey === "employees") onUpdate("employees", [...(data?.employees??[]).filter(e=>e.restaurantId!==restaurantId), ...(snapshot.employees??[])]);
            if (tabKey === "comunicados") onUpdate("communications", [...(data?.communications??[]).filter(c=>c.restaurantId!==restaurantId), ...(snapshot.communications??[])]);
            if (tabKey === "faq") onUpdate("faq", {...(data?.faq??{}), [restaurantId]: snapshot.faq});
            if (tabKey === "dp") onUpdate("dpMessages", [...(data?.dpMessages??[]).filter(m=>m.restaurantId!==restaurantId), ...(snapshot.dpMessages??[])]);
            if (tabKey === "horarios") onUpdate("workSchedules", prev => ({...(prev??{}), [restaurantId]: snapshot.workSchedules}));
            onUpdate("trash", prev => ({...prev, tabData:(prev.tabData??[]).filter(x=>x.id!==entry.id)}));
            onUpdate("_toast", `↩ ${entry.tabLabel} restaurado!`);
          }

          function hardDeleteTab(entry) {
            if(!window.confirm(`Excluir permanentemente "${entry.tabLabel}" de ${entry.restaurantName}? Não tem volta.`)) return;
            onUpdate("trash", prev => ({...prev, tabData:(prev.tabData??[]).filter(x=>x.id!==entry.id)}));
            onUpdate("_toast","🗑️ Excluído permanentemente.");
          }

          const totalCount = allItems.length + tabItems.length;

          return (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <div>
                  <h3 style={{color:"var(--text)",fontSize:16,fontWeight:700,margin:"0 0 4px"}}>🗑️ Lixeira</h3>
                  <p style={{color:"var(--text3)",fontSize:13,margin:0}}>Restaurantes/gestores/empregados: 30 dias · Dados de abas: 7 dias</p>
                </div>
                {totalCount > 0 && (
                  <button onClick={()=>{
                    if(!window.confirm("Esvaziar lixeira permanentemente? Esta ação não pode ser desfeita.")) return;
                    onUpdate("trash", {restaurants:[],managers:[],employees:[],tabData:[]});
                    onUpdate("_toast","🗑️ Lixeira esvaziada.");
                  }} style={{padding:"8px 16px",borderRadius:10,border:"1px solid var(--red)33",background:"transparent",color:"var(--red)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600}}>
                    Esvaziar tudo
                  </button>
                )}
              </div>

              {totalCount === 0 && (
                <div style={{...S.card,textAlign:"center",padding:48}}>
                  <div style={{fontSize:36,marginBottom:12}}>✨</div>
                  <p style={{color:"var(--text3)",fontSize:14}}>Lixeira vazia.</p>
                </div>
              )}

              {/* Dados de abas — 7 dias */}
              {tabItems.length > 0 && (
                <div style={{marginBottom:20}}>
                  <h4 style={{color:"var(--text2)",fontSize:13,fontWeight:700,margin:"0 0 10px",textTransform:"uppercase",letterSpacing:0.5}}>📂 Dados de abas — 7 dias</h4>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {tabItems.map(item=>{
                      const daysAgo = Math.floor((new Date()-new Date(item.deletedAt))/(1000*60*60*24));
                      const daysLeft = 7 - daysAgo;
                      return (
                        <div key={item.id} style={{...S.card,opacity:0.9,border:`1px solid var(--border)`}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <div>
                              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                                <span style={{fontSize:16}}>{tabIcons[item.tabKey]??""}</span>
                                <span style={{color:"var(--text)",fontWeight:700,fontSize:14}}>{item.tabLabel}</span>
                                <span style={{color:"var(--text3)",fontSize:12}}>— {item.restaurantName}</span>
                              </div>
                              <div style={{color:"var(--text3)",fontSize:12}}>
                                Resetado em {new Date(item.deletedAt).toLocaleDateString("pt-BR")}
                                <span style={{color:daysLeft<=2?"var(--red)":"var(--text3)",marginLeft:8}}>· {daysLeft}d restante{daysLeft!==1?"s":""}</span>
                              </div>
                            </div>
                            <div style={{display:"flex",gap:8}}>
                              <button onClick={()=>restoreTab(item)}
                                style={{padding:"7px 16px",borderRadius:8,border:"1px solid var(--green)44",background:"var(--green-bg)",color:"var(--green)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700}}>
                                ↩ Restaurar
                              </button>
                              <button onClick={()=>hardDeleteTab(item)}
                                style={{padding:"7px 12px",borderRadius:8,border:"1px solid var(--red)33",background:"transparent",color:"var(--red)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12}}>
                                🗑️
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Restaurantes, gestores, empregados — 30 dias */}
              {allItems.length > 0 && (
                <div>
                  <h4 style={{color:"var(--text2)",fontSize:13,fontWeight:700,margin:"0 0 10px",textTransform:"uppercase",letterSpacing:0.5}}>🏢 Restaurantes · Gestores · Empregados — 30 dias</h4>
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {allItems.map(item=>{
                      const deletedDaysAgo = item.deletedAt ? Math.floor((new Date()-new Date(item.deletedAt))/(1000*60*60*24)) : 0;
                      const daysLeft = 30 - deletedDaysAgo;
                      return (
                        <div key={item.id} style={{...S.card,opacity:0.85}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <div>
                              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                                <span style={{fontSize:18}}>{item._icon}</span>
                                <span style={{color:"var(--text)",fontWeight:700,fontSize:14,textDecoration:"line-through",opacity:0.7}}>{item.name}</span>
                              </div>
                              <div style={{color:"var(--text3)",fontSize:12}}>
                                Excluído em {item.deletedAt ? new Date(item.deletedAt).toLocaleDateString("pt-BR") : "—"}
                                <span style={{color:daysLeft<7?"var(--red)":"var(--text3)",marginLeft:8}}>· {daysLeft}d até exclusão permanente</span>
                              </div>
                            </div>
                            <div style={{display:"flex",gap:8}}>
                              <button onClick={()=>restore(item._type, item)}
                                style={{padding:"7px 16px",borderRadius:8,border:"1px solid var(--green)44",background:"var(--green-bg)",color:"var(--green)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700}}>
                                ↩ Restaurar
                              </button>
                              <button onClick={()=>hardDelete(item._type, item)}
                                style={{padding:"7px 12px",borderRadius:8,border:"1px solid var(--red)33",background:"transparent",color:"var(--red)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12}}>
                                🗑️
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {tab === "changelog" && (() => {
          const CHANGELOG = [
            { version:"5.19.0", date:"2026-04-18", items:[
              "Refatoração: removidas ~400 linhas de código morto (componentes e funções não utilizadas)",
              "Refatoração: hook useAiGenerate unifica chamadas de IA — reduz duplicação de lógica de loading/erro",
              "Refatoração: hook useMobile substitui detecções duplicadas de viewport",
              "Refatoração: modal de privacidade agora usa state React em vez de manipulação DOM direta",
              "Refatoração: estados de cobrança e modais agrupados — reduz número de useState no OwnerPortal",
              "Melhoria: paleta de cores C e estilos S.btnSmall padronizados, AREA_COLORS consistente",
              "Melhoria: botões secundários com minHeight:44px para touch targets adequados em mobile",
            ]},
            { version:"5.18.0", date:"2026-04-17", items:[
              "Novo: importação de folha de ponto via PDF — análise automática com IA identifica atrasos, faltas e horas extras, atualiza escala e cria ocorrências",
              "Novo: exportação da trilha do empregado em PDF — relatório completo com ocorrências, feedbacks, histórico de cargos e resumo do período selecionado",
            ]},
            { version:"5.17.1", date:"2026-04-17", items:[
              "Segurança: ocorrências (positivas e negativas) agora são 100% internas — empregado não vê nenhuma",
              "Melhoria: métricas do empregado mostram mês anterior (fechado) em vez do mês corrente",
              "Melhoria: feedback do empregado simplificado — exibe apenas meta e cargo-alvo, sem estrelas ou detalhes internos",
              "Melhoria: formulário de ocorrência do gestor diferencia visualmente positivas (verde) e negativas (vermelho)",
              "Melhoria: timeline do gestor com cores e badges distintos por tipo de ocorrência",
              "Removido: badge 'Destaque' e seção 'Elogios Recebidos' da visão do empregado",
            ]},
            { version:"5.17.0", date:"2026-04-17", items:[
              "Redesign: aba Equipe totalmente refeita — listagem com cards compactos (nome, cargo, área, status) em vez de planilha",
              "Novo: detalhe do empregado com 3 abas internas: Cadastro (dados editáveis), Ações (promover, demitir, PIN, etc.) e Trilha (timeline + ocorrências + feedback)",
              "Novo: botão '+ Novo' no topo abre formulário dedicado para adicionar empregado",
              "Melhoria: card de cada empregado mostra avatar com inicial, cargo, badges de status (Ativo/Inativo/Demitido/Promoção), flags (Produção/Freela)",
              "Melhoria: aba Ações com botões descritivos — cada ação com título e explicação clara",
            ]},
            { version:"5.16.1", date:"2026-04-17", items:[
              "Unificação: abas Equipe e Trilha integradas em uma única aba Equipe",
              "Novo: visão detalhada do empregado com timeline, ocorrências e feedback integrados",
              "Melhoria: formulários de ocorrência e feedback pré-selecionados para o empregado em contexto",
            ]},
            { version:"5.16.0", date:"2026-04-17", items:[
              "Novo: Aba 📈 Trilha do Empregado — linha do tempo completa com eventos automáticos (escala, promoções, demissão) e manuais (ocorrências, feedbacks)",
              "Novo: Registro de ocorrências/incidentes — seletor múltiplo de envolvidos, 8 tipos (advertências, desentendimento, elogio, destaque), 3 gravidades",
              "Novo: Registro de feedback trimestral — avaliação 1-5 estrelas, pontos fortes/melhorar, observações internas, meta e cargo-alvo",
              "Novo: Botão ⬆️ Promover na aba Equipe — mudança de cargo com data efetiva, imediata ou agendada, com histórico (roleHistory)",
              "Novo: Promoções agendadas auto-aplicadas no carregamento do app quando a data chega",
              "Novo: Visão gamificada 'Minha Trilha' no portal do empregado — nível/progresso, badges, métricas vs área, metas, checklist de desenvolvimento",
              "Novo: Badges automáticos (tempo de casa, promoção, avaliação 5★, elogios recebidos)",
              "Novo: Métricas anônimas comparando faltas do empregado com média da área",
              "Novo: Checklist de desenvolvimento por cargo com links para materiais de estudo",
              "Segurança: ocorrências negativas, gravidade, nomes de envolvidos e observações internas NÃO visíveis ao empregado",
              "Acesso: Gestor AppTip, Gestor Adm. e Líder Operacional (líder só vê empregados da sua área)",
            ]},
            { version:"5.15.4", date:"2026-04-17", items:[
              "Correção: tela de primeiro acesso do empregado (cadastro de PIN) agora tem botão '← Voltar ao login'",
            ]},
            { version:"5.15.3", date:"2026-04-17", items:[
              "Correção: demissão agora marca empregado como inativo imediatamente (antes só no mês seguinte)",
              "Correção: empregado demitido sai do dashboard (equipe de hoje) e do cálculo de gorjeta na hora",
              "Correção: na escala do mês da demissão, demitido continua aparecendo como 'DEM'; no mês seguinte não aparece mais",
            ]},
            { version:"5.15.2", date:"2026-04-17", items:[
              "Melhoria: ações bulk da escala (Folgas do contrato, Reiniciar escala, Marcar férias) agora acumulam edições locais",
              "Melhoria: todas as edições exigem clique em 'Salvar nova versão' para confirmar — gera snapshot automático no histórico",
            ]},
            { version:"5.15.1", date:"2026-04-16", items:[
              "Melhoria: design unificado em todas as abas do painel do gestor — mesma linguagem visual em cabeçalhos, botões, cards e espaçamentos",
              "Melhoria: todas as abas agora têm título H3 consistente (fontSize 16/20) com botões de ação à direita",
              "Melhoria: Dashboard — seções de área agora usam barras com borda lateral colorida (mesmo padrão do VT)",
              "Melhoria: Dashboard — barras de distribuição de gorjeta por área com borda lateral e DM Mono nos valores",
              "Melhoria: Escala — botões de ação unificados com S.btnSecondary (padding e fontSize consistentes)",
              "Melhoria: Gorjetas — cabeçalho h3 + botões de exportar/histórico alinhados à direita",
              "Melhoria: Cargos, Equipe, FAQ, Comunicados, DP, Notificações, Configurações — todos com layout de cabeçalho padrão",
            ]},
            { version:"5.15.0", date:"2026-04-16", items:[
              "Novo: Aba Vale Transporte (🚌 VT) — cálculo mensal de VT por empregado com base na escala de trabalho",
              "Novo: VT Diário editável por empregado, persistido entre meses (altera valor dali pra frente)",
              "Novo: Dias previstos calculados automaticamente a partir do horário contratual + escala do mês",
              "Novo: Ajuste automático do mês anterior — compara dias pagos vs dias reais (faltas descontam, dias extras somam)",
              "Novo: Campo de ajuste editável — sistema sugere valor mas gestor pode alterar livremente",
              "Novo: Campo de desconto manual por empregado (livre para qualquer desconto adicional)",
              "Novo: Botão 'Marcar como Pago' — congela snapshot dos valores e usa como referência para ajuste do mês seguinte",
              "Novo: Exportação de VT para CSV e PDF (impressão)",
              "Novo: Layout responsivo — tabela completa no desktop, cards compactos no mobile",
              "Regras: Férias, folgas, compensações e faltas (justificadas e injustificadas) não pagam VT. Freelancers ficam fora",
            ]},
            { version:"5.14.1", date:"2026-04-12", items:[
              "Removido: botão 'Salvar Dias' da aba Horários — fluxo unificado em Validar → Salvar Horário",
              "Removido: botão 'Resetar horários' da página geral de Horários — ação preservada apenas na tela de edição do empregado (evita duplicação)",
              "Melhoria: botão de Validar/Salvar Horário ocupa toda a largura disponível (mais visível)",
            ]},
            { version:"5.14.0", date:"2026-04-12", items:[
              "Novo: Histórico de versões da Escala — botão '🕐 Histórico' no topo da aba (Admin/DP). Últimas 30 versões, restore do mês inteiro, cada alteração vira ponto no histórico",
              "Novo: Histórico de versões das Gorjetas — mesmo formato da escala, botão '🕐 Histórico' na aba Gorjetas",
              "Novo: ações bulk (Reiniciar escala, Folgas do contrato, Marcar férias, Recalcular, Remover gorjeta) geram snapshot automático antes de aplicar",
              "Novo: edições individuais na escala geram snapshot debounced de 30s (agrupa cliques em sequência)",
              "Novo: restaurar versão também cria um ponto — permite desfazer o desfazer",
              "Novo: Horários — botão '♻️ Reativar' em cada versão do histórico copia a versão antiga como nova vigência a partir de hoje",
              "Melhoria: fluxo de Horários separado em 2 passos — '✓ Validar Horários' confirma as regras CLT e só depois libera '💾 Salvar Horário' (previne salvamento acidental sem validar)",
              "Melhoria: card verde 'Horário validado' aparece entre validação e salvamento como confirmação visual",
            ]},
            { version:"5.13.0", date:"2026-04-12", items:[
              "Novo: botão '🔑 Resetar PIN' nos cards de gestores (Admin AppTip e DP Gestores) — PIN volta para 4 primeiros dígitos do CPF e força troca no próximo acesso",
              "Melhoria: fluxo de reset de PIN dos gestores agora consistente com o dos empregados",
              "Correção: IA (Comunicados, FAQ, Cargos, Empregados, Horários) agora exibe mensagem real do erro em vez de 'Não foi possível gerar'",
              "Correção: groqGenerate detecta chave ausente, modelo descontinuado, rate limit (429) e auth inválido (401) com mensagens específicas",
              "Correção: erros da IA agora aparecem no console.error com detalhes completos (status, código, payload)",
            ]},
            { version:"5.12.3", date:"2026-04-12", items:[
              "Melhoria: cards 'Copiar horário' e 'Assistente IA' em Horários com padding 18px 22px, ícones maiores, subtítulo descritivo e divisor ao expandir",
              "Melhoria: no desktop, input + botão da IA ficam lado a lado (antes empilhados)",
              "Melhoria: resultado da IA com padding 16px 18px e fontes maiores",
            ]},
            { version:"5.12.2", date:"2026-04-12", items:[
              "Melhoria: barra de Total Semanal em Horários redesenhada — padding generoso, ícone ✅/⚠️, total em 28px mono, descrição do status CLT",
            ]},
            { version:"5.12.1", date:"2026-04-12", items:[
              "Melhoria: botões de ação em Horários (Salvar Dias / Validar e Salvar) com padding 14px 24px no desktop",
              "Melhoria: botão 'Confirmar e Salvar' com padding generoso e peso 700",
              "Melhoria: lista de empregados em Horários (desktop) redesenhada — avatar colorido por área, grid 48px + 1fr + status + seta, padding 16px 20px, hover border",
              "Melhoria: status do empregado agora exibido como badge colorido (verde=completo, âmbar=pendente, cinza=sem horário)",
            ]},
            { version:"5.12.0", date:"2026-04-12", items:[
              "Novo: IA de horários entende listas estruturadas por dia (ex: 'Qua e Qui: das 15h às 24h com 1h de intervalo')",
              "Novo: IA reconhece separadores como linha nova, •, ·, ; e dias não mencionados viram folga automaticamente",
              "Novo: IA aceita 'das X às Y' como entrada+saída na mesma expressão (inclui 24h → meia-noite)",
              "Novo: botão 'Resetar horário' do empregado — apaga todas as versões do horário atual",
              "Melhoria: layout desktop dos horários refeito — linhas espaçosas em grid (dia | campos | toggle), intervalo com 110px, labels uppercase",
              "Melhoria: dias de folga no desktop mostram texto discreto ao invés de card vazio",
            ]},
            { version:"5.11.0", date:"2026-04-12", items:[
              "Novo: Horários — copiar horário de outro empregado ao cadastrar/editar (seletor por área com carga semanal)",
              "Melhoria: Horários mobile redesenhado — 7 dias em um único card compacto com divisores (em vez de 7 cards separados)",
              "Melhoria: Horários mobile — inputs inline sem labels por linha, placeholder como label",
            ]},
            { version:"5.10.1", date:"2026-04-12", items:[
              "Melhoria: layout de Horários otimizado para mobile — cards, inputs, labels e botões compactos",
              "Melhoria: container geral com padding reduzido no celular",
              "Melhoria: assistente IA com texto de ajuda compacto no mobile",
              "Melhoria: lista de empregados mais densa no celular (tags e subtítulos abreviados)",
              "Melhoria: cálculos de horas simplificados no mobile (Trab + Contr em vez de Real + Diurna + Contratual)",
            ]},
            { version:"5.10.0", date:"2026-04-12", items:[
              "Novo: aba Horários disponível no mobile do gestor — edição completa + assistente IA",
              "Atualizado: aviso de funcionalidades desktop removeu Horários da lista (agora disponível no celular)",
            ]},
            { version:"5.9.0", date:"2026-04-12", items:[
              "Melhoria: IA de horários — parser reescrito para entender linguagem natural flexível em português",
              "Melhoria: IA aceita conjugações verbais (folgue, trabalhe, dividindo, entrando), typos (semanis, entrandoa s) e frases compostas",
              "Melhoria: IA reconhece 'trabalhe nos outros dias' como padrão para preencher dias não mencionados",
              "Melhoria: campo de texto da IA de horários em layout empilhado (input + botão 100% largura)",
              "Removido: aba Gorjetas do mobile (lançamentos apenas pelo PC)",
              "Removido: 'Ações rápidas' do dashboard mobile",
              "Novo: aba Caixa de entrada na visão mobile do gestor",
              "Correção: mobile tabs agora Dashboard + Escala + Caixa de entrada",
            ]},
            { version:"5.8.0", date:"2026-04-12", items:[
              "Novo: Escala mobile — visão semanal com navegação ◀/▶, grid 7 colunas, toque para alterar status",
              "Melhoria: botões de ação da escala compactos no mobile (Folgas, Reiniciar, Férias)",
              "Melhoria: legenda da escala ajustada para telas menores",
              "Removido: botão PDF export e Reset ocultos no mobile",
            ]},
            { version:"5.7.0", date:"2026-04-12", items:[
              "Melhoria: dashboard gorjetas — label 'Dias preenchidos' + valores zerados exibem R$ 0,00",
              "Melhoria: aba Escala agora disponível no mobile do gestor (Dashboard + Gorjetas + Escala)",
              "Melhoria: arredondamento financeiro (2 casas) em todos os cálculos de gorjeta e penalidade",
              "Melhoria: data de admissão padrão agora é dinâmica (ano corrente) em vez de fixa",
              "Melhoria: PIX e nome agora lidos da config (data.pixChave / data.pixNome) com fallback",
              "Correção: cor do 'Pool total' trocada de branco fixo para var(--text) — visível em ambos os temas",
              "Correção: versão centralizada no rodapé em todas as telas",
              "Limpeza: console.logs de debug removidos, variáveis mortas eliminadas, eslint granular",
              "Acessibilidade: Toast com role=status, Modal com role=dialog + Escape, aria-labels em botões",
              "Refatoração: STATUS_SHORT e STATUS_COLORS centralizados como constantes globais",
              "Segurança: try-catch em calcTipForDate e applyFaultPenalty com feedback via toast",
            ]},
            { version:"5.6.0", date:"2026-04-12", items:[
              "Novo: Admissão default — empregados sem data de admissão assumem 01/01/2026",
              "Novo: Privacidade de dados na landing page e no guia do gestor",
              "Novo: Botões da escala reorganizados — Folgas, Reiniciar, Férias lado a lado + Exportar PDF à direita",
              "Novo: Mobile gestor — apenas Dashboard e Gorjetas, com aviso para usar demais funções no PC",
              "Novo: Assistente de Horários com IA — descreva o que deseja e o sistema sugere preenchimento automático",
              "Correção: input de gorjeta aceita vírgula como separador decimal (padrão brasileiro)",
            ]},
            { version:"5.5.0", date:"2026-04-12", items:[
              "Tabela de gorjetas simplificada — digita valores e salva tudo de uma vez (padrão deferred save)",
              "Removido: modo simples vs tabela, botões salvar por dia, 'Lançar Todos Preenchidos'",
              "Botão sticky 'Salvar Gorjetas' + 'Descartar' aparece quando há alterações pendentes",
              "Aviso ao sair da aba Gorjetas sem salvar — pergunta se deseja salvar antes",
            ]},
            { version:"5.4.2", date:"2026-04-12", items:[
              "Correção: gorjeta lançada não sumia mais — refatoração de calcTipForDate e recalcTipDay para evitar stale closure",
              "Correção: 'Lançar Todos Preenchidos' agora acumula tips corretamente em batch",
              "Correção: 'Recalcular Todos os Dias' agora preserva todas as gorjetas ao recalcular em batch",
            ]},
            { version:"5.4.1", date:"2026-04-12", items:[
              "Privacidade: tabela diária de gorjetas — dias lançados mostram ••••,•• para o admin, dias vazios ficam normais",
            ]},
            { version:"5.4.0", date:"2026-04-12", items:[
              "Novo: Modo Privacidade — gestor pode ocultar dados sensíveis da visão do admin",
              "Valores de gorjeta, CPFs, mensagens DP e comunicados ficam mascarados (•••) para o admin",
              "Toggle na aba Config do gestor: 🔒 Privacidade",
              "Banner visual no topo quando admin acessa restaurante com privacidade ativa",
            ]},
            { version:"5.3.3", date:"2026-04-12", items:[
              "Login por ID (ex: LBZ0001): agora mostra tela de escolha Gestor/Empregado quando o CPF do empregado também é de um gestor",
            ]},
            { version:"5.3.2", date:"2026-04-12", items:[
              "FAQ gorjeta: texto agora explica claramente o cálculo para cada modo (Área+Pontos vs Pontos Global)",
              "FAQ sistema: descrição detalhada de como funciona cada modalidade de divisão",
              "Botão Salvar Config movido para o topo da aba (sticky) — visível imediatamente",
            ]},
            { version:"5.3.1", date:"2026-04-12", items:[
              "Aba Config unificada: todas as configurações agora salvam com botão explícito (retenção, penalidades, modalidade, abas)",
              "Botão Salvar Config fixo no rodapé (sticky) — sempre visível quando há alterações pendentes",
              "Aviso ao sair da aba Config sem salvar: pergunta se deseja salvar antes",
              "FAQ automático do gestor agora reflete alterações de config em tempo real (antes de salvar)",
              "Correção: FAQ de gorjeta atualiza corretamente ao alternar entre Área+Pontos e Pontos Global",
            ]},
            { version:"5.3.0", date:"2026-04-12", items:[
              "Aba Horários: empregados agrupados por área",
              "Alternância empregado/gestor: botão direto no header para usuários com perfil duplo",
              "Tela do gestor agora inicia sempre pelo Dashboard",
              "Correção: comunicados automáticos de horário não bloqueiam mais a tela do empregado",
              "Percentuais de área: ao salvar, pergunta se deseja aplicar aos próximos meses",
              "Novos percentuais padrão: Bar 12%, Cozinha 40%, Salão 40%, Limpeza 8%",
              "Campo PIN substituído por botão 🔑 Resetar na aba Equipe",
            ]},
            { version:"5.2.0", date:"2026-04-12", items:[
              "Novo status de escala: FREELA — empregado presente mas sem gorjeta",
              "Novo flag de empregado: Freela (🎯) — nunca participa do rateio de gorjeta",
              "Dashboard de equipe separado por áreas (Bar, Cozinha, Salão, Limpeza), Produção e Fora",
              "Log de versões (esta aba) exclusivo para administradores",
              "Penalidade de produção: percentuais separados para falta justificada e injustificada",
              "Férias exclui todos os empregados da gorjeta, incluindo produção",
            ]},
            { version:"5.1.0", date:"2026-04-10", items:[
              "Produção deixa de ser área e passa a ser flag no empregado (🏭)",
              "Penalidade de produção com percentual configurável (padrão 6,66% / 3,33%)",
              "PIN de 4 dígitos para gestores e empregados com login unificado",
              "Forçar troca de PIN no primeiro acesso do gestor",
              "IA de cadastro de empregados com preview, edição e inativação",
              "Matching fuzzy de cargos na IA de cadastro",
              "FAQ de produção para empregados e gestores",
              "Guia do Gestor atualizado com produção e penalidades",
            ]},
            { version:"5.0.0", date:"2026-04-06", items:[
              "Rewrite completo: React 18 single-file architecture",
              "Sistema de gorjetas com modo Área+Pontos e Global Pontos",
              "Escala mensal com status: trabalho, folga, compensação, férias, faltas",
              "Gestão de cargos com pontos e áreas",
              "FAQ inteligente para empregados",
              "Guia do Gestor interativo",
              "Fale com DP (canal direto empregado-gestor)",
              "Comunicados com confirmação de leitura",
              "Horários contratuais com geração automática de escala",
              "Penalidade por falta injustificada por área",
              "Export PDF/CSV de gorjetas e escala",
              "Painel administrativo com dashboard financeiro",
              "Sistema de notificações e caixa de entrada",
              "Tema claro/escuro",
            ]},
          ];
          return (
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                <h3 style={{color:ac,fontSize:16,fontWeight:700,margin:0}}>📋 Log de Versões</h3>
                <span style={{color:"var(--text3)",fontSize:12}}>Versão atual: <strong style={{color:ac}}>{APP_VERSION}</strong></span>
              </div>
              {CHANGELOG.map((v,vi) => (
                <div key={v.version} style={{...S.card,marginBottom:12,border:vi===0?`1px solid ${ac}33`:"1px solid var(--border)"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{background:vi===0?ac:"var(--text3)",color:vi===0?"#fff":"var(--bg)",padding:"2px 10px",borderRadius:20,fontSize:12,fontWeight:700,fontFamily:"'DM Mono',monospace"}}>v{v.version}</span>
                      {vi===0 && <span style={{background:"#10b98133",color:"var(--green)",padding:"2px 8px",borderRadius:10,fontSize:10,fontWeight:700}}>ATUAL</span>}
                    </div>
                    <span style={{color:"var(--text3)",fontSize:11}}>{new Date(v.date+"T12:00:00").toLocaleDateString("pt-BR",{day:"numeric",month:"long",year:"numeric"})}</span>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:4}}>
                    {v.items.map((item,ii) => (
                      <div key={ii} style={{display:"flex",gap:6,alignItems:"flex-start",fontSize:12,color:"var(--text2)"}}>
                        <span style={{color:vi===0?ac:"var(--text3)",fontSize:10,marginTop:2}}>•</span>
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Modals */}
      {showRestModal && (
        <Modal title={editRestId?"Editar Restaurante":"Novo Restaurante"} onClose={()=>setShowRestModal(false)}>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div><label style={S.label}>Nome do restaurante</label><input value={restForm.name} onChange={e=>setRestForm({...restForm,name:e.target.value})} style={S.input}/></div>
            <div>
              <label style={S.label}>ID do restaurante (3 letras únicas, ex: QUI)</label>
              <input value={restForm.shortCode} onChange={e=>setRestForm({...restForm,shortCode:e.target.value.toUpperCase().replace(/[^A-Z]/g,"").slice(0,3)})}
                placeholder="QUI" maxLength={3} style={{...S.input, textTransform:"uppercase", letterSpacing:6, fontSize:18, textAlign:"center"}}
                disabled={!!editRestId}/>
              {editRestId && <p style={{color:"var(--text3)",fontSize:11,marginTop:4}}>O ID não pode ser alterado após criação.</p>}
            </div>
            <div><label style={S.label}>CNPJ (opcional)</label><input value={restForm.cnpj} onChange={e=>setRestForm({...restForm,cnpj:e.target.value})} placeholder="00.000.000/0000-00" style={S.input}/></div>
            <div><label style={S.label}>Endereço (opcional)</label><input value={restForm.address} onChange={e=>setRestForm({...restForm,address:e.target.value})} style={S.input}/></div>
            <div>
              <label style={S.label}>📅 Data de início da vigência do serviço</label>
              <input type="date" value={restForm.serviceStartDate??""} max={new Date().toISOString().split("T")[0]}
                onChange={e=>setRestForm({...restForm,serviceStartDate:e.target.value})} style={S.input}/>
              <p style={{color:"var(--text3)",fontSize:11,marginTop:4}}>Escala e gorjetas só podem ser lançadas a partir desta data. Admissão e horários não são afetados. Máximo: data de hoje.</p>
            </div>
            <div style={{borderTop:"1px solid var(--border)",paddingTop:10}}>
              <p style={{color:"var(--text3)",fontSize:12,margin:"0 0 8px",fontWeight:600}}>📱 Contatos WhatsApp</p>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <div>
                  <label style={S.label}>WhatsApp Financeiro <span style={{color:"var(--red)"}}>*</span></label>
                  <input value={restForm.whatsappFin??""} onChange={e=>setRestForm({...restForm,whatsappFin:e.target.value})} placeholder="11987654321" inputMode="numeric" style={S.input}/>
                  <p style={{color:"var(--text3)",fontSize:11,marginTop:3}}>Recebe cobranças e avisos de pagamento</p>
                </div>
                <div>
                  <label style={S.label}>WhatsApp Operacional</label>
                  <input value={restForm.whatsappOp??""} onChange={e=>setRestForm({...restForm,whatsappOp:e.target.value})} placeholder="11987654321" inputMode="numeric" style={S.input}/>
                  <p style={{color:"var(--text3)",fontSize:11,marginTop:3}}>Recebe comunicados técnicos e suporte</p>
                </div>
              </div>
            </div>
            {!editRestId && (
              <div style={{padding:"10px 14px",borderRadius:10,background:"var(--bg2)",border:"1px solid var(--border)"}}>
                <p style={{color:"var(--text3)",fontSize:12,margin:0}}>💡 Plano e cobrança podem ser definidos na aba <strong>💳 Financeiro</strong> após o cadastro.</p>
              </div>
            )}
            <button onClick={saveRest} style={S.btnPrimary}>{editRestId?"Salvar":"Cadastrar"}</button>
          </div>
        </Modal>
      )}

      {showMgrModal && (
        <Modal title={editMgrId?"Editar Gestor":"Novo Gestor"} onClose={()=>setShowMgrModal(false)} wide>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {/* Puxar da equipe */}
            {!editMgrId && (() => {
              const allActiveEmps = employees.filter(e => !e.inactive);
              if (allActiveEmps.length === 0) return null;
              return (
                <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,padding:"10px 14px"}}>
                  <label style={{...S.label,margin:0}}>👥 Puxar dados de um empregado da equipe</label>
                  <p style={{color:"var(--text3)",fontSize:11,margin:"4px 0 8px"}}>Selecione para pré-preencher nome e CPF. O empregado continua ativo na equipe.</p>
                  <select onChange={e => { const emp = allActiveEmps.find(x => x.id === e.target.value); if (!emp) return; setMgrForm(f => ({...f, name: emp.name, cpf: emp.cpf ?? "", restaurantIds: [...new Set([...(f.restaurantIds??[]), emp.restaurantId])]})); }} style={{...S.input,cursor:"pointer"}} defaultValue="">
                    <option value="" disabled>Selecionar empregado...</option>
                    {allActiveEmps.sort((a,b)=>a.name.localeCompare(b.name)).map(e => { const rest = restaurants.find(r => r.id === e.restaurantId); const role = roles.find(r => r.id === e.roleId); return <option key={e.id} value={e.id}>{e.name}{role ? ` — ${role.name}` : ""} ({rest?.name ?? "?"}){e.cpf ? ` (${e.cpf})` : ""}</option>; })}
                  </select>
                </div>
              );
            })()}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div><label style={S.label}>Nome completo</label><input value={mgrForm.name} onChange={e=>setMgrForm({...mgrForm,name:e.target.value})} style={S.input}/></div>
              <div><label style={S.label}>CPF *</label><input value={mgrForm.cpf} onChange={e=>setMgrForm({...mgrForm,cpf:maskCpf(e.target.value)})} placeholder="000.000.000-00" style={S.input} inputMode="numeric"/></div>
            </div>
            {editMgrId ? (
              <div><label style={S.label}>PIN (4 dígitos)</label><input type="password" value={mgrForm.pin} onChange={e=>setMgrForm({...mgrForm,pin:e.target.value.replace(/\D/g,"").slice(0,4)})} maxLength={4} style={S.input} inputMode="numeric"/></div>
            ) : (
              <div style={{background:"var(--ac-bg)",border:"1px solid var(--ac)33",borderRadius:10,padding:"10px 14px"}}>
                <span style={{color:"var(--ac-text)",fontSize:13}}>🔑 PIN inicial = 4 primeiros dígitos do CPF. No primeiro acesso o gestor será solicitado a trocar.</span>
              </div>
            )}

            <div>
              <label style={S.label}>Permissões de acesso às abas</label>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[["tips","💸 Gorjetas"],["schedule","📅 Escala"],["roles","🏷️ Cargos"],["employees","👥 Equipe"],["comunicados","📢 Comunicados"],["faq","❓ FAQ"],["dp","💬 Fale c/ DP"],["horarios","🕐 Horários"],["vt","🚌 Vale Transporte"]].map(([k,lbl])=>{
                  const on = mgrForm.perms?.[k] !== false;
                  return (
                    <button key={k} onClick={()=>setMgrForm({...mgrForm,perms:{...mgrForm.perms,[k]:!on}})}
                      style={{padding:"10px",borderRadius:10,border:`1px solid ${on?"var(--green)":"var(--border)"}`,background:on?"#10b98122":"transparent",color:on?"var(--green)":"#555",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12,textAlign:"left"}}>
                      {on?"✓":"✗"} {lbl}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label style={S.label}>Restaurantes com acesso</label>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {restaurants.length===0&&<p style={{color:"var(--text3)",fontSize:13}}>Nenhum restaurante cadastrado ainda.</p>}
                {restaurants.map(r=>{
                  const sel = mgrForm.restaurantIds?.includes(r.id);
                  return (
                    <button key={r.id} onClick={()=>setMgrForm({...mgrForm,restaurantIds:sel?mgrForm.restaurantIds.filter(x=>x!==r.id):[...(mgrForm.restaurantIds??[]),r.id]})}
                      style={{padding:"10px 14px",borderRadius:10,border:`1px solid ${sel?"var(--ac)":"var(--border)"}`,background:sel?"var(--ac)22":"transparent",color:sel?"var(--ac)":"#555",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:13,textAlign:"left"}}>
                      {sel?"✓":"○"} {r.name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{borderTop:"1px solid var(--border)",paddingTop:12}}>
              <label style={S.label}>Departamento Pessoal (DP)</label>
              <button onClick={()=>setMgrForm({...mgrForm,isDP:!mgrForm.isDP})}
                style={{width:"100%",padding:"12px 14px",borderRadius:10,border:`1px solid ${mgrForm.isDP?"#3b82f6":"var(--border)"}`,background:mgrForm.isDP?"#3b82f622":"transparent",color:mgrForm.isDP?"#3b82f6":"#555",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:13,textAlign:"left",display:"flex",alignItems:"center",gap:10}}>
                <span style={{fontSize:18}}>📬</span>
                <div>
                  <div style={{fontWeight:700}}>{mgrForm.isDP?"✓ É gestor do DP":"○ Não é gestor do DP"}</div>
                  <div style={{fontSize:11,opacity:0.7,marginTop:2}}>Recebe notificações de horários, mensagens do Fale com DP e avisos internos</div>
                </div>
              </button>
            </div>

            <button onClick={saveMgr} style={S.btnPrimary}>{editMgrId?"Salvar":"Criar Gestor"}</button>
          </div>
        </Modal>
      )}

      {showOwnerModal && (
        <Modal title={editOwnerId?"Editar Admin AppTip":"Novo Admin AppTip"} onClose={()=>setShowOwnerModal(false)}>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div><label style={S.label}>Nome completo</label><input value={ownerForm.name} onChange={e=>setOwnerForm({...ownerForm,name:e.target.value})} style={S.input}/></div>
            <div><label style={S.label}>CPF</label><input value={ownerForm.cpf} onChange={e=>setOwnerForm({...ownerForm,cpf:maskCpf(e.target.value)})} placeholder="000.000.000-00" style={S.input} inputMode="numeric"/></div>
            <div><label style={S.label}>PIN (4 dígitos)</label><input type="password" value={ownerForm.pin} onChange={e=>setOwnerForm({...ownerForm,pin:e.target.value})} maxLength={4} style={S.input}/></div>
            {/* Só o master pode designar outro master */}
            {isMaster && !owners.find(o=>o.id===editOwnerId)?.isMaster && (
              <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"12px 14px",borderRadius:10,border:`1px solid ${ownerForm.isMaster?"var(--ac)":"var(--border)"}`,background:ownerForm.isMaster?"var(--ac-bg)":"transparent"}}>
                <input type="checkbox" checked={!!ownerForm.isMaster} onChange={e=>setOwnerForm({...ownerForm,isMaster:e.target.checked})} style={{width:16,height:16,accentColor:ac}}/>
                <div>
                  <div style={{color:"var(--text)",fontWeight:600,fontSize:14}}>👑 Admin Master</div>
                  <div style={{color:"var(--text3)",fontSize:12}}>Pode ver lixeira e não pode ser excluído</div>
                </div>
              </label>
            )}
            {owners.find(o=>o.id===editOwnerId)?.isMaster && (
              <div style={{padding:"10px 14px",borderRadius:10,background:"var(--ac-bg)",border:"1px solid var(--ac)33"}}>
                <span style={{color:"var(--ac-text)",fontSize:13,fontWeight:600}}>👑 Este admin é Master — proteção não pode ser removida</span>
              </div>
            )}
            <button onClick={saveOwner} style={S.btnPrimary}>{editOwnerId?"Salvar":"Criar"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

//
// MANAGER PORTAL (regular manager, single or multi restaurant)
//
function ManagerPortal({ manager, data, onUpdate, onBack, toggleTheme, theme, onSwitchToEmployee }) {
  const { restaurants, employees, roles, tips, splits, schedules } = data;
  const myRestaurants = restaurants.filter(r => manager.restaurantIds?.includes(r.id));
  const [selId, setSelId] = useState(() => {
    const saved = localStorage.getItem("apptip_selrest");
    if (myRestaurants.length === 1) return myRestaurants[0].id;
    if (saved && myRestaurants.find(r => r.id === saved)) return saved;
    return null;
  });
  const isMobile = useMobile();

  useEffect(() => {
    if (selId) localStorage.setItem("apptip_selrest", selId);
    else localStorage.removeItem("apptip_selrest");
  }, [selId]);

  const selRest = myRestaurants.find(r => r.id === selId);

  // Métricas rápidas por restaurante para o card de seleção
  function getRestMetrics(r) {
    const rid = r.id;
    const empAtivos = employees.filter(e => e.restaurantId === rid && !e.inactive).length;
    const now = new Date();
    const mk = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
    const monthTips = tips.filter(t => t.restaurantId === rid && t.monthKey === mk);
    const diasComGorjeta = [...new Set(monthTips.map(t => t.date))].length;
    const dpNaoLidas = (data?.dpMessages??[]).filter(m => m.restaurantId === rid && !m.read && !m.deleted).length;
    const commsPendentes = (data?.communications??[]).filter(c =>
      c.restaurantId === rid && !c.deleted &&
      employees.filter(e => e.restaurantId === rid).some(e => !(data?.commAcks??{})[`${c.id}_${e.id}`])
    ).length;
    return { empAtivos, diasComGorjeta, dpNaoLidas, commsPendentes };
  }

  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", fontFamily:"'DM Sans',sans-serif" }}>

      {/* Header */}
      <div style={{ background:"var(--header-bg)", borderBottom:"1px solid var(--border)", padding:"10px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:"6px 12px", boxShadow:"0 1px 4px rgba(0,0,0,0.04)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, minWidth:0, flex:"1 1 auto" }}>
          {selId && myRestaurants.length > 1 && (
            <button onClick={()=>setSelId(null)}
              style={{ background:"none", border:"1px solid var(--border)", borderRadius:8, padding:"4px 8px", cursor:"pointer", color:"var(--text3)", fontSize:11, flexShrink:0 }}>
              ‹
            </button>
          )}
          <div style={{minWidth:0}}>
            <div style={{ display:"flex", alignItems:"center", gap:5 }}>
              <span style={{fontSize:14}}>📊</span>
              <span style={{color:"var(--text)",fontWeight:800,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {selRest ? selRest.name : "Gestor Adm."}
              </span>
            </div>
            <div style={{color:"var(--text3)",fontSize:10,marginTop:1}}>
              {manager.name}
              {selRest?.cnpj && <span style={{marginLeft:6,color:"var(--text3)",fontSize:10}}>{selRest.cnpj}</span>}
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:5,alignItems:"center",flexShrink:0}}>
          <button onClick={toggleTheme} style={{background:"none",border:"1px solid var(--border)",borderRadius:20,padding:"5px 8px",cursor:"pointer",fontSize:13,color:"var(--text2)"}}>
            {theme==="dark"?"☀️":"🌙"}
          </button>
          <a href="/guia-gestor" target="_blank" rel="noreferrer"
            style={{...S.btnSecondary,fontSize:11,textDecoration:"none",display:"flex",alignItems:"center",gap:3,padding:"5px 10px"}}>
            ❓ Ajuda
          </a>
          {onSwitchToEmployee && <button onClick={onSwitchToEmployee} style={{...S.btnSecondary,fontSize:11,padding:"5px 10px",color:"var(--ac)",borderColor:"var(--ac)"}}>👤 Empregado</button>}
          <button onClick={onBack} style={{...S.btnSecondary,fontSize:11,padding:"5px 10px"}}>Sair</button>
        </div>
      </div>

      {/* Seleção de restaurante */}
      {!selId && (
        <div style={{padding:"32px 20px",maxWidth:520,margin:"0 auto"}}>
          {myRestaurants.length === 0 ? (
            <div style={{textAlign:"center",padding:"60px 24px"}}>
              <div style={{fontSize:48,marginBottom:16}}>🏢</div>
              <h3 style={{color:"var(--text)",fontSize:18,fontWeight:700,margin:"0 0 8px"}}>Nenhum restaurante atribuído</h3>
              <p style={{color:"var(--text3)",fontSize:14,lineHeight:1.6}}>Seu acesso ainda não foi configurado.<br/>Entre em contato com o administrador do AppTip.</p>
            </div>
          ) : (
            <>
              <h2 style={{color:"var(--text)",fontSize:18,fontWeight:800,margin:"0 0 6px"}}>Seus restaurantes</h2>
              <p style={{color:"var(--text3)",fontSize:13,margin:"0 0 20px"}}>Selecione para entrar</p>
              {myRestaurants.map(r => {
                const inad = r.financeiro?.status === "inadimplente";
                const m = getRestMetrics(r);
                return (
                  <button key={r.id} onClick={()=>setSelId(r.id)}
                    style={{width:"100%",cursor:"pointer",textAlign:"left",display:"block",marginBottom:12,
                      background: inad ? "var(--red-bg)" : "var(--card-bg)",
                      border: `1px solid ${inad?"var(--red)44":"var(--border)"}`,
                      borderRadius:14, padding:"16px 18px",
                      boxShadow:"0 2px 8px rgba(0,0,0,0.04)", transition:"box-shadow 0.15s"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                      <div>
                        <div style={{color:"var(--text)",fontWeight:700,fontSize:16}}>{r.name}</div>
                        {r.address && <div style={{color:"var(--text3)",fontSize:12,marginTop:2}}>{r.address}</div>}
                      </div>
                      {inad
                        ? <span style={{color:"var(--red)",fontSize:12,fontWeight:700,background:"var(--red-bg)",padding:"3px 10px",borderRadius:20,border:"1px solid var(--red)33"}}>🔒 Suspenso</span>
                        : <span style={{color:"var(--text3)",fontSize:18}}>›</span>
                      }
                    </div>
                    {!inad && (
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        <span style={{fontSize:12,color:"var(--text3)",background:"var(--bg2)",padding:"3px 10px",borderRadius:20}}>👥 {m.empAtivos} ativos</span>
                        <span style={{fontSize:12,color:"var(--text3)",background:"var(--bg2)",padding:"3px 10px",borderRadius:20}}>💸 {m.diasComGorjeta}d lançados</span>
                        {m.dpNaoLidas > 0 && <span style={{fontSize:12,color:"#3b82f6",background:"#eff6ff",padding:"3px 10px",borderRadius:20}}>💬 {m.dpNaoLidas} nova{m.dpNaoLidas>1?"s":""}</span>}
                        {m.commsPendentes > 0 && <span style={{fontSize:12,color:"#f59e0b",background:"#fffbeb",padding:"3px 10px",borderRadius:20}}>📢 {m.commsPendentes} pendente{m.commsPendentes>1?"s":""}</span>}
                      </div>
                    )}
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}

      {selId && selRest && (
        <div>
          {/* Bloqueia restaurante inadimplente */}
          {selRest.financeiro?.status === "inadimplente" ? (
            <div style={{minHeight:"60vh",display:"flex",alignItems:"center",justifyContent:"center",padding:32}}>
              <div style={{maxWidth:400,textAlign:"center"}}>
                <div style={{fontSize:56,marginBottom:20}}>🔒</div>
                <h2 style={{color:"var(--text)",fontSize:22,fontWeight:800,margin:"0 0 12px"}}>Acesso suspenso</h2>
                <p style={{color:"var(--text3)",fontSize:15,lineHeight:1.6,margin:"0 0 20px"}}>
                  O acesso ao <strong>{selRest.name}</strong> está temporariamente suspenso por pendência financeira.
                </p>
                <div style={{marginTop:24,padding:"14px 18px",borderRadius:12,background:"var(--bg2)",border:"1px solid var(--border)",fontSize:13,color:"var(--text3)"}}>
                  📱 WhatsApp: <strong style={{color:"var(--text)"}}>+55 11 98549-9821</strong>
                </div>
                {myRestaurants.filter(r=>r.financeiro?.status!=="inadimplente").length > 0 && (
                  <button onClick={()=>setSelId(null)} style={{...S.btnSecondary,marginTop:16,width:"100%",textAlign:"center"}}>
                    ← Ver outros restaurantes
                  </button>
                )}
              </div>
            </div>
          ) : isMobile ? (
            <div>
              <div style={{margin:"16px 16px 0",padding:"14px 16px",borderRadius:12,background:"#fffbeb",border:"1px solid #f59e0b44",display:"flex",alignItems:"center",gap:12}}>
                <span style={{fontSize:22,flexShrink:0}}>🖥️</span>
                <div>
                  <p style={{color:"#92400e",fontSize:12,fontWeight:700,margin:0}}>Demais funcionalidades no computador</p>
                  <p style={{color:"#92400e99",fontSize:11,margin:"2px 0 0",lineHeight:1.4}}>Gorjetas, Cargos, VT, Comunicados, FAQ, DP e Config.</p>
                </div>
              </div>
              <RestaurantPanel
                restaurant={selRest} restaurants={restaurants} employees={employees}
                roles={roles} tips={tips} splits={splits} schedules={schedules}
                onUpdate={onUpdate}
                perms={{...(manager.perms ?? {tips:true,schedule:true}), isDP: manager.isDP ?? false, managerAreas: manager.profile==="lider"?(manager.areas??[]):[] }}
                isOwner={false} data={data} currentUser={manager} mobileOnly
              />
            </div>
          ) : (
            <RestaurantPanel
              restaurant={selRest} restaurants={restaurants} employees={employees}
              roles={roles} tips={tips} splits={splits} schedules={schedules}
              onUpdate={onUpdate}
              perms={{...(manager.perms ?? {tips:true,schedule:true}), isDP: manager.isDP ?? false, managerAreas: manager.profile==="lider"?(manager.areas??[]):[] }}
              isOwner={false} data={data} currentUser={manager}
            />
          )}
        </div>
      )}
    </div>
  );
}

//
// MANAGER PIN CHANGE (first access / reset)
//
function ManagerPinChange({ manager, onDone, onBack }) {
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [err, setErr] = useState("");

  function submit() {
    if (pin1.length !== 4 || !/^\d{4}$/.test(pin1)) { setErr("PIN deve ter exatamente 4 dígitos numéricos."); return; }
    if (pin1 !== pin2) { setErr("PINs não coincidem."); return; }
    const cpfDigits = (manager.cpf??"").replace(/\D/g,"");
    if (pin1 === cpfDigits.slice(0,4)) { setErr("O novo PIN não pode ser igual aos 4 primeiros dígitos do CPF."); return; }
    onDone(pin1);
  }

  return (
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',sans-serif",padding:24}}>
      <div style={{...S.card,maxWidth:380,width:"100%",boxShadow:"0 8px 32px rgba(0,0,0,0.08)"}}>
        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{fontSize:36,marginBottom:12}}>🔑</div>
          <h2 style={{color:"var(--text)",margin:"0 0 8px",fontSize:22,fontWeight:800}}>Novo PIN</h2>
          <p style={{color:"var(--text3)",fontSize:14,lineHeight:1.5}}>
            Olá, {manager.name?.split(" ")[0]}! Defina um novo PIN de 4 dígitos para continuar.
          </p>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div>
            <label style={S.label}>Novo PIN (4 dígitos)</label>
            <input type="password" inputMode="numeric" maxLength={4} value={pin1} onChange={e=>setPin1(e.target.value.replace(/\D/g,"").slice(0,4))} placeholder="••••" style={{...S.input,letterSpacing:8,fontSize:22,textAlign:"center",fontFamily:"'DM Mono',monospace"}}/>
          </div>
          <div>
            <label style={S.label}>Confirmar PIN</label>
            <input type="password" inputMode="numeric" maxLength={4} value={pin2} onChange={e=>setPin2(e.target.value.replace(/\D/g,"").slice(0,4))} placeholder="••••" style={{...S.input,letterSpacing:8,fontSize:22,textAlign:"center",fontFamily:"'DM Mono',monospace"}} onKeyDown={e=>e.key==="Enter"&&submit()}/>
          </div>
          {err && <div style={{background:"var(--red-bg)",border:"1px solid var(--red)33",borderRadius:8,padding:"8px 12px",color:"var(--red)",fontSize:13}}>{err}</div>}
          <button onClick={submit} style={S.btnPrimary}>Salvar e Continuar →</button>
          <button onClick={onBack} style={{...S.btnSecondary,textAlign:"center"}}>← Sair</button>
        </div>
      </div>
    </div>
  );
}

//
// LOGIN
//
function UnifiedLogin({ owners, managers, employees, restaurants, onLoginOwner, onLoginManager, onLoginEmployee, onSetupFirst, onGoHome, toggleTheme, theme, dataLoaded }) {
  const [credential, setCredential] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [blockedUntil, setBlockedUntil] = useState(null);
  const [termsAccepted, setTermsAccepted] = useState(() => localStorage.getItem("apptip_terms") === "1");
  const [choices, setChoices] = useState(null); // { name, options: [{label, icon, action}] }

  const isBlocked = blockedUntil && new Date() < blockedUntil;
  const isEmpId = /^[A-Za-z]{2,4}\d+$/.test(credential.trim());
  const isCpf = credential.replace(/\D/g,"").length >= 11;

  useEffect(() => {
    if (!blockedUntil) return;
    const t = setInterval(() => {
      if (new Date() >= blockedUntil) { setBlockedUntil(null); setErr(""); clearInterval(t); }
      else setErr(`Muitas tentativas. Aguarde ${Math.ceil((blockedUntil-new Date())/1000)}s.`);
    }, 1000);
    return () => clearInterval(t);
  }, [blockedUntil]);

  function tryLogin() {
    if (isBlocked || !termsAccepted) return;
    const clean = credential.trim();
    const cleanCpf = clean.replace(/\D/g,"");
    const cleanPin = pin.trim();

    // Detecta se os dados não carregaram (conexão falhou)
    const noData = owners.length === 0 && managers.length === 0 && employees.length === 0;
    if (noData && !dataLoaded) {
      setErr("⚠️ Erro de conexão — os dados não foram carregados. Verifique sua internet e recarregue a página.");
      return;
    }

    if (!isEmpId) {
      // 1) Admin AppTip — acesso direto, sem tela de escolha
      const superUser = owners.find(s => s.cpf?.replace(/\D/g,"") === cleanCpf && String(s.pin) === cleanPin);
      if (superUser) { setErr(""); setAttempts(0); onLoginOwner(superUser); return; }

      // 2) Buscar empregado e gestor pelo mesmo CPF (login unificado)
      const emp = employees.find(e => e.cpf?.replace(/\D/g,"") === cleanCpf);
      const mgr = managers.find(m => m.cpf?.replace(/\D/g,"") === cleanCpf);

      // PIN unificado: aceita PIN do empregado OU do gestor
      const pinMatch = (emp && String(emp.pin) === cleanPin) || (mgr && String(mgr.pin) === cleanPin);

      if (!pinMatch) {
        // Falhou
        const na = attempts + 1;
        setAttempts(na);
        if (na >= 5) {
          setBlockedUntil(new Date(Date.now() + 30000));
          setAttempts(0);
          setErr("Muitas tentativas. Aguarde 30 segundos.");
        } else {
          setErr(`Credenciais incorretas. ${5-na} tentativa${5-na!==1?"s":""} restante${5-na!==1?"s":""}.`);
        }
        return;
      }

      // PIN bateu — montar opções
      const found = [];

      if (mgr) {
        found.push({ label:"Gestor Adm.", icon:"📊", action:()=>{ setChoices(null); onLoginManager(mgr); } });
      }

      if (emp && !(emp.inactive && emp.inactiveFrom && emp.inactiveFrom <= today())) {
        const restDoEmp = restaurants.find(r=>r.id===emp.restaurantId);
        if (restDoEmp?.financeiro?.status === "inadimplente") {
          if (!mgr) { setErr("⚠️ O acesso ao sistema está suspenso. Entre em contato com o administrador do restaurante."); return; }
          // Se é gestor+empregado e restaurante inadimplente, permite só gestor
        } else {
          found.push({ label:"Empregado", icon:"👤", action:()=>{ setChoices(null); localStorage.setItem("apptip_empid", emp.id); localStorage.setItem("apptip_userid", emp.id); onLoginEmployee(emp); } });
        }
      }

      if (found.length === 1) { setErr(""); setAttempts(0); found[0].action(); return; }
      if (found.length > 1) {
        const name = mgr?.name ?? emp?.name ?? "Usuário";
        setErr(""); setAttempts(0); setChoices({ name, options: found }); return;
      }
      if (found.length === 0) {
        // CPF existe mas sem papel ativo
        const na = attempts + 1;
        setAttempts(na);
        if (na >= 5) { setBlockedUntil(new Date(Date.now() + 30000)); setAttempts(0); setErr("Muitas tentativas. Aguarde 30 segundos."); }
        else setErr(`Credenciais incorretas. ${5-na} tentativa${5-na!==1?"s":""} restante${5-na!==1?"s":""}.`);
        return;
      }
    } else {
      // Por ID — busca empregado, mas verifica se também é gestor
      const emp = employees.find(e => e.empCode?.toUpperCase() === clean.toUpperCase() && String(e.pin) === cleanPin);
      if (emp) {
        if (emp.inactive && emp.inactiveFrom && emp.inactiveFrom <= today()) {
          setErr("Acesso desativado. Fale com o departamento pessoal."); return;
        }
        // Verificar se o CPF desse empregado também é de um gestor
        const empCpf = emp.cpf?.replace(/\D/g,"");
        let mgr = empCpf ? managers.find(m => m.cpf?.replace(/\D/g,"") === empCpf) : null;
        // Fallback: linkedManagerId ou nome exato no mesmo restaurante
        if (!mgr && emp.linkedManagerId) mgr = managers.find(m => m.id === emp.linkedManagerId);
        if (!mgr && emp.name) mgr = managers.find(m => m.name === emp.name && (m.restaurantIds ?? []).includes(emp.restaurantId));
        if (mgr) {
          // Dual-role — mostrar tela de escolha
          const found = [];
          found.push({ label:"Gestor Adm.", icon:"📊", action:()=>{ setChoices(null); onLoginManager(mgr); } });
          const restDoEmp = restaurants.find(r=>r.id===emp.restaurantId);
          if (!(restDoEmp?.financeiro?.status === "inadimplente")) {
            found.push({ label:"Empregado", icon:"👤", action:()=>{ setChoices(null); localStorage.setItem("apptip_empid", emp.id); localStorage.setItem("apptip_userid", emp.id); onLoginEmployee(emp); } });
          }
          if (found.length === 1) { setErr(""); setAttempts(0); found[0].action(); return; }
          const name = mgr.name ?? emp.name ?? "Usuário";
          setErr(""); setAttempts(0); setChoices({ name, options: found }); return;
        }
        // Só empregado
        localStorage.setItem("apptip_empid", emp.id);
        localStorage.setItem("apptip_userid", emp.id);
        setErr(""); setAttempts(0); onLoginEmployee(emp); return;
      }
      // Falhou
      const na = attempts + 1;
      setAttempts(na);
      if (na >= 5) { setBlockedUntil(new Date(Date.now() + 30000)); setAttempts(0); setErr("Muitas tentativas. Aguarde 30 segundos."); }
      else setErr(`Credenciais incorretas. ${5-na} tentativa${5-na!==1?"s":""} restante${5-na!==1?"s":""}.`);
    }
  }

  // Tela de escolha de papel
  if (choices) return (
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{width:"100%",maxWidth:380}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:40,marginBottom:12}}>🍽️</div>
          <h1 style={{fontSize:22,fontWeight:800,color:"var(--text)",margin:"0 0 6px"}}>Olá, {choices.name}!</h1>
          <p style={{color:"var(--text3)",fontSize:14}}>Como deseja entrar?</p>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {choices.options.map(opt=>(
            <button key={opt.label} onClick={opt.action}
              style={{display:"flex",alignItems:"center",gap:16,padding:"20px 24px",borderRadius:16,border:`1px solid var(--border)`,background:"var(--card-bg)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",textAlign:"left",boxShadow:"0 2px 8px rgba(0,0,0,0.05)",transition:"all 0.15s"}}
              onMouseEnter={e=>e.currentTarget.style.borderColor=ac}
              onMouseLeave={e=>e.currentTarget.style.borderColor="var(--border)"}>
              <span style={{fontSize:32}}>{opt.icon}</span>
              <div>
                <div style={{color:"var(--text)",fontWeight:700,fontSize:16}}>{opt.label}</div>
                <div style={{color:"var(--text3)",fontSize:13,marginTop:2}}>
                  {opt.label==="Gestor AppTip"&&"Gerenciar restaurantes e equipes"}
                  {opt.label==="Gestor Adm."&&"Gerenciar gorjetas, escala e equipe"}
                  {opt.label==="Empregado"&&"Ver meu extrato, escala e comunicados"}
                </div>
              </div>
              <span style={{marginLeft:"auto",color:"var(--text3)",fontSize:18}}>›</span>
            </button>
          ))}
          <button onClick={()=>{setChoices(null);setPin("");}}
            style={{...S.btnSecondary,width:"100%",textAlign:"center",marginTop:4}}>
            ← Voltar
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,fontFamily:"'DM Sans',sans-serif"}}>

      {/* Botão de tema */}
      <div style={{position:"fixed",top:16,right:16}}>
        <button onClick={toggleTheme} style={{background:"var(--bg1)",border:"1px solid var(--border)",borderRadius:20,padding:"8px 14px",cursor:"pointer",fontSize:16,color:"var(--text2)"}}>
          {theme==="dark"?"☀️":"🌙"}
        </button>
      </div>

      <div style={{width:"100%",maxWidth:380}}>
        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:40,marginBottom:12}}>🍽️</div>
          <h1 style={{fontSize:28,fontWeight:800,color:"var(--text)",margin:"0 0 6px",letterSpacing:-0.5}}>
            App<span style={{color:ac}}>Tip</span>
          </h1>
          <p style={{color:"var(--text3)",fontSize:14}}>Gestão de gorjetas para restaurantes</p>
        </div>

        {/* Card de login */}
        <div style={{background:"var(--card-bg)",borderRadius:20,padding:"28px 24px",border:"1px solid var(--border)",boxShadow:"0 4px 24px rgba(0,0,0,0.06)"}}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>

            <div>
              <label style={S.label}>CPF ou ID do empregado</label>
              <input
                value={credential}
                onChange={e => {
                  const v = e.target.value;
                  if (/^\d/.test(v)) setCredential(maskCpf(v));
                  else setCredential(v.toUpperCase());
                }}
                placeholder="000.000.000-00 ou LBZ0001"
                style={{...S.input}}
                disabled={isBlocked}
                autoComplete="username"
              />
              {credential.length > 2 && (
                <div style={{fontSize:11,color:"var(--text3)",marginTop:4}}>
                  {isEmpId ? "👤 Acesso de empregado" : isCpf ? "🔐 Verificando perfis disponíveis" : ""}
                </div>
              )}
            </div>

            <div>
              <label style={S.label}>PIN</label>
              <input
                type="password" inputMode="numeric" maxLength={4}
                value={pin}
                onChange={e => setPin(e.target.value)}
                placeholder="••••"
                style={{...S.input, letterSpacing:8, fontSize:20, textAlign:"center", fontFamily:"'DM Mono',monospace"}}
                onKeyDown={e => e.key==="Enter" && tryLogin()}
                disabled={isBlocked}
                autoComplete="current-password"
              />
            </div>

            {!termsAccepted && (
              <label style={{display:"flex",alignItems:"flex-start",gap:10,cursor:"pointer"}}>
                <input type="checkbox" checked={termsAccepted}
                  onChange={e=>{setTermsAccepted(e.target.checked);if(e.target.checked)localStorage.setItem("apptip_terms","1");}}
                  style={{width:16,height:16,marginTop:2,accentColor:ac,flexShrink:0}}/>
                <span style={{color:"var(--text3)",fontSize:12,lineHeight:1.5}}>
                  Li e aceito a{" "}
                  <button onClick={e=>{e.preventDefault();window.__showPrivacy?.();}}
                    style={{background:"none",border:"none",color:ac,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,padding:0,textDecoration:"underline"}}>
                    Política de Privacidade
                  </button>
                </span>
              </label>
            )}

            {err && (
              <div style={{background:isBlocked?"#f59e0b12":err.includes("conexão")?"#3b82f612":"var(--red-bg)",border:`1px solid ${isBlocked?"#f59e0b33":err.includes("conexão")?"#3b82f633":"var(--red)33"}`,borderRadius:8,padding:"10px 12px",color:isBlocked?"#d97706":err.includes("conexão")?"#2563eb":"var(--red)",fontSize:13,fontWeight:500}}>
                {err}
                {err.includes("conexão") && (
                  <button onClick={()=>window.location.reload()}
                    style={{display:"block",marginTop:8,padding:"6px 16px",borderRadius:8,background:"#3b82f6",border:"none",color:"#fff",fontWeight:700,cursor:"pointer",fontSize:12,fontFamily:"'DM Sans',sans-serif"}}>
                    Recarregar página
                  </button>
                )}
              </div>
            )}

            <button onClick={tryLogin}
              disabled={isBlocked || !termsAccepted || !credential.trim() || !pin.trim()}
              style={{...S.btnPrimary, opacity:(isBlocked||!termsAccepted||!credential.trim()||!pin.trim())?0.5:1, cursor:(isBlocked||!termsAccepted||!credential.trim()||!pin.trim())?"not-allowed":"pointer", marginTop:4}}>
              Entrar →
            </button>


          </div>
        </div>

        <div style={{textAlign:"center",marginTop:20}}>
          {termsAccepted && (
            <button onClick={()=>window.__showPrivacy?.()}
              style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,padding:0}}>
              Política de Privacidade
            </button>
          )}
        </div>

        {/* Link para landing page */}
        <div style={{textAlign:"center",marginTop:16,paddingTop:16,borderTop:"1px solid var(--border)"}}>
          <button onClick={onGoHome}
            style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,padding:0}}>
            Ainda não usa o AppTip? <span style={{color:"var(--ac-text)",fontWeight:700}}>Conheça como funciona →</span>
          </button>
        </div>
      </div>
    </div>
  );
}

//
// FIRST SETUP
//
function FirstSetup({ onDone }) {
  const INVITE = "apptip@2024"; // senha de convite — mude aqui se quiser
  const [step, setStep] = useState("invite"); // "invite" | "form"
  const [invite, setInvite] = useState("");
  const [inviteErr, setInviteErr] = useState("");
  const [form, setForm] = useState({ name:"",cpf:"",pin:"",pin2:"" });
  const [err, setErr] = useState("");

  function checkInvite() {
    if (invite.trim() !== INVITE) { setInviteErr("Senha de convite incorreta."); return; }
    setStep("form");
  }

  function submit() {
    if (!form.name.trim()) { setErr("Informe o nome."); return; }
    if (!form.cpf.trim()) { setErr("Informe o CPF."); return; }
    if (form.pin.length !== 4 || !/^\d{4}$/.test(form.pin)) { setErr("PIN deve ter exatamente 4 dígitos numéricos."); return; }
    if (form.pin !== form.pin2) { setErr("PINs não coincidem."); return; }
    onDone({ id: Date.now().toString(), name: form.name.trim(), cpf: form.cpf.trim(), pin: form.pin });
  }

  return (
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',sans-serif",padding:24}}>
      <div style={{...S.card,maxWidth:360,width:"100%",boxShadow:"0 4px 24px rgba(0,0,0,0.08)"}}>
        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{fontSize:40,marginBottom:8}}>🍽️</div>
          <h2 style={{color:"var(--text)",margin:"0 0 6px",fontSize:22,fontWeight:800}}>App<span style={{color:ac}}>Tip</span></h2>
          <p style={{color:"var(--text3)",fontSize:13}}>{step==="invite"?"Digite a senha de convite para continuar":"Cadastro do primeiro Admin AppTip"}</p>
        </div>

        {step === "invite" ? (
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div>
              <label style={S.label}>Senha de convite</label>
              <input type="password" value={invite} onChange={e=>setInvite(e.target.value)} placeholder="••••••••" style={S.input} onKeyDown={e=>e.key==="Enter"&&checkInvite()}/>
            </div>
            {inviteErr && <div style={{background:"var(--red-bg)",border:"1px solid var(--red)33",borderRadius:8,padding:"8px 12px",color:"var(--red)",fontSize:13}}>{inviteErr}</div>}
            <button onClick={checkInvite} style={S.btnPrimary}>Continuar →</button>
          </div>
        ) : (
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div><label style={S.label}>Nome completo</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} style={S.input}/></div>
            <div><label style={S.label}>CPF</label><input value={form.cpf} onChange={e=>setForm({...form,cpf:maskCpf(e.target.value)})} placeholder="000.000.000-00" style={S.input} inputMode="numeric"/></div>
            <div><label style={S.label}>PIN (4 dígitos)</label><input type="password" maxLength={4} value={form.pin} onChange={e=>setForm({...form,pin:e.target.value})} style={S.input}/></div>
            <div><label style={S.label}>Confirmar PIN</label><input type="password" maxLength={4} value={form.pin2} onChange={e=>setForm({...form,pin2:e.target.value})} style={S.input} onKeyDown={e=>e.key==="Enter"&&submit()}/></div>
            {err && <div style={{background:"var(--red-bg)",border:"1px solid var(--red)33",borderRadius:8,padding:"8px 12px",color:"var(--red)",fontSize:13}}>{err}</div>}
            <button onClick={submit} style={S.btnPrimary}>Criar e Entrar →</button>
          </div>
        )}
      </div>
    </div>
  );
}

//
// HOME
//
function Home({ onLogin }) {
  const [formData, setFormData] = useState({ nome:"", email:"", restaurante:"", empregados:"", mensagem:"" });
  const [formSent, setFormSent] = useState(false);
  const [formSending, setFormSending] = useState(false);

  async function sendForm() {
    if (!formData.nome.trim()) return;
    setFormSending(true);
    const msg = encodeURIComponent(
      `Olá! Tenho interesse no AppTip.\n\nNome: ${formData.nome}\nRestaurante: ${formData.restaurante || "—"}\nNº empregados: ${formData.empregados || "—"}${formData.mensagem ? `\n\nMensagem: ${formData.mensagem}` : ""}`
    );
    window.open(`https://wa.me/5511985499821?text=${msg}`, "_blank");
    setTimeout(() => { setFormSent(true); setFormSending(false); }, 800);
  }

  const FEATURES = [
    { icon:"💸", title:"Gorjetas transparentes", desc:"Cálculo e distribuição automática por área e cargo. Cada empregado vê exatamente o que recebeu, bruto e líquido, sem dúvidas." },
    { icon:"📅", title:"Escala inteligente", desc:"Controle de folgas, faltas, férias e compensações integrado ao cálculo de gorjetas. Escala base gerada automaticamente pelo horário contratual." },
    { icon:"👥", title:"Gestão de equipe", desc:"Cadastro completo, cargos, pontos e acesso individual para cada empregado. Histórico preservado mesmo após inativação." },
    { icon:"🕐", title:"Horários com IA", desc:"Cadastre dias de trabalho e folga, preencha horários ou use o assistente de IA — descreva em linguagem natural e o sistema gera os horários automaticamente. Validação de carga semanal, interjornada e hora noturna." },
    { icon:"❓", title:"FAQ com assistente de IA", desc:"Base de perguntas e respostas para sua equipe. Perguntas automáticas sobre gorjetas e regras, mais IA para ajudar o gestor a redigir." },
    { icon:"📢", title:"Comunicados com IA", desc:"Envie avisos para toda a equipe ou áreas específicas. Assistente de IA ajuda a redigir. Acompanhe quem leu e confirmou." },
    { icon:"💬", title:"Canal com o DP", desc:"Canal direto, inclusive anônimo, para comunicação entre equipe e departamento pessoal. Sugestões, denúncias, atestados e dúvidas trabalhistas." },

    { icon:"👔", title:"Perfis de gestor", desc:"Gestor Administrativo com acesso completo ou Líder Operacional com visão restrita. Permissões granulares, criação de gestores e CPF obrigatório para segurança." },
    { icon:"🛡️", title:"Privacidade de dados", desc:"Gestores controlam a visibilidade dos dados. Com o modo privacidade, a equipe de administradores não acessa valores de gorjetas, CPFs, mensagens do DP ou comunicados — garantindo sigilo total da operação." },
    { icon:"🔒", title:"Segurança e controle", desc:"Acesso por PIN e CPF, permissões por perfil, modo somente leitura, lixeira com restauração e auditoria completa. Cada pessoa vê apenas o que deve." },
    { icon:"📱", title:"100% no celular", desc:"Sem app para instalar. Acessa pelo navegador em qualquer smartphone. Gestor gerencia escala, horários e caixa de entrada direto pelo celular. Empregado com portal próprio e seguro." },
  ];

  const PLANOS = [
    { nome:"Starter",      emp:"até 10",    precoAnual:"R$87,30",  precoMensal:"R$97",   anualSub:"por mês no plano anual", mensalSub:"ou R$97/mês no mensal",  destaque:false, cta:"Começar agora", multi:false },
    { nome:"Básico",       emp:"até 20",    precoAnual:"R$168,30", precoMensal:"R$187",  anualSub:"por mês no plano anual", mensalSub:"ou R$187/mês no mensal", destaque:true,  cta:"Começar agora", multi:true },
    { nome:"Profissional", emp:"até 50",    precoAnual:"R$357,30", precoMensal:"R$397",  anualSub:"por mês no plano anual", mensalSub:"ou R$397/mês no mensal", destaque:false, cta:"Começar agora", multi:true },
    { nome:"Enterprise",   emp:"51 a 100",  precoAnual:"R$7,99",   precoMensal:null,     anualSub:"por funcionário/mês",    mensalSub:"pagamento mensal",       destaque:false, cta:"Falar com a gente", multi:true },
    { nome:"On Demand",    emp:"+100",      precoAnual:null,       precoMensal:null,     anualSub:"",                       mensalSub:"Sob orçamento",          destaque:false, cta:"Falar com a gente", multi:true },
  ];

  const ac = "#d4a017";

  return (
    <div style={{fontFamily:"'DM Sans',sans-serif",background:"#faf8f4",color:"#2d2416",minHeight:"100vh"}}>

      {/* NAV */}
      <nav style={{position:"sticky",top:0,zIndex:100,background:"rgba(250,248,244,0.96)",backdropFilter:"blur(12px)",borderBottom:"1px solid #ede8df",padding:"0 24px",display:"flex",justifyContent:"space-between",alignItems:"center",height:64}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:22}}>🍽️</span>
          <span style={{fontWeight:800,fontSize:20,color:"#2d2416",letterSpacing:-0.5}}>App<span style={{color:ac}}>Tip</span></span>
        </div>
        <div style={{display:"flex",gap:16,alignItems:"center"}}>
          <a href="#funcionalidades" style={{color:"#8c7a5e",fontSize:14,textDecoration:"none",fontWeight:500}}>Funcionalidades</a>
          <a href="#precos" style={{color:"#8c7a5e",fontSize:14,textDecoration:"none",fontWeight:500}}>Preços</a>
          <a href="#contato" style={{color:"#8c7a5e",fontSize:14,textDecoration:"none",fontWeight:500}}>Contato</a>
          <button onClick={onLogin} style={{padding:"9px 22px",borderRadius:20,border:"none",background:ac,color:"#fff",fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:14,letterSpacing:-0.3}}>Entrar →</button>
        </div>
      </nav>

      {/* HERO */}
      <section style={{padding:"90px 24px 80px",textAlign:"center",background:"linear-gradient(180deg,#faf8f4 0%,#f5f0e8 100%)"}}>
        <div style={{maxWidth:680,margin:"0 auto"}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:8,background:"#d4a01722",border:"1px solid #d4a01744",borderRadius:20,padding:"6px 16px",marginBottom:28}}>
            <span style={{color:ac,fontSize:12,fontWeight:700,letterSpacing:0.3}}>✦ Gestão completa para restaurantes</span>
          </div>
          <h1 style={{fontSize:"clamp(34px,6vw,58px)",fontWeight:800,lineHeight:1.1,margin:"0 0 20px",letterSpacing:-1.5,color:"#1c1208"}}>
            Gorjetas distribuídas<br/><span style={{color:ac}}>com transparência total</span>
          </h1>
          <p style={{color:"#8c7a5e",fontSize:"clamp(15px,2vw,18px)",lineHeight:1.7,marginBottom:40,maxWidth:520,margin:"0 auto 40px"}}>
            O AppTip automatiza o cálculo e distribuição de gorjetas, controla escala, horários e comunicados com IA — tudo pelo celular, sem app para instalar.
          </p>
          <div style={{display:"flex",gap:12,justifyContent:"center",flexWrap:"wrap"}}>
            <a href="#contato" style={{padding:"15px 32px",borderRadius:12,background:ac,color:"#fff",fontWeight:700,fontSize:16,textDecoration:"none",display:"inline-block",boxShadow:"0 4px 20px #d4a01744"}}>
              Quero conhecer →
            </a>
            <a href="#funcionalidades" style={{padding:"15px 32px",borderRadius:12,border:"1px solid #ede8df",color:"#5c4a2e",fontSize:16,textDecoration:"none",display:"inline-block",background:"#fff",fontWeight:500}}>
              Ver funcionalidades
            </a>
          </div>
          <p style={{color:"#b0996e",fontSize:13,marginTop:24}}>Sem taxa de adesão · Suporte incluso · Cancele quando quiser</p>
        </div>
      </section>

      {/* STATS */}
      <section style={{background:"#fff",padding:"48px 24px",borderTop:"1px solid #ede8df",borderBottom:"1px solid #ede8df"}}>
        <div style={{maxWidth:700,margin:"0 auto",display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:24,textAlign:"center"}}>
          {[["100%","Mobile first — sem app instalar"],["IA","Horários, FAQ e comunicados assistidos"],["LGPD","Conformidade e dados protegidos"]].map(([n,l])=>(
            <div key={l}>
              <div style={{fontSize:32,fontWeight:800,color:ac,marginBottom:6,letterSpacing:-1,fontFamily:"'DM Mono',monospace"}}>{n}</div>
              <div style={{color:"#8c7a5e",fontSize:13,fontWeight:500}}>{l}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FUNCIONALIDADES */}
      <section id="funcionalidades" style={{padding:"80px 24px",background:"#faf8f4"}}>
        <div style={{maxWidth:960,margin:"0 auto"}}>
          <div style={{textAlign:"center",marginBottom:56}}>
            <h2 style={{fontSize:"clamp(24px,4vw,38px)",fontWeight:800,margin:"0 0 12px",letterSpacing:-0.8,color:"#1c1208"}}>Tudo que sua equipe precisa</h2>
            <p style={{color:"#8c7a5e",fontSize:16}}>Gorjetas, escala, horários com IA, comunicados com IA e muito mais</p>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:20}}>
            {FEATURES.map(f=>(
              <div key={f.title} style={{padding:"28px",borderRadius:16,border:"1px solid #ede8df",background:"#fff",boxShadow:"0 2px 12px rgba(0,0,0,0.03)"}}>
                <div style={{fontSize:32,marginBottom:14}}>{f.icon}</div>
                <h3 style={{fontSize:16,fontWeight:700,margin:"0 0 8px",color:"#1c1208"}}>{f.title}</h3>
                <p style={{color:"#8c7a5e",fontSize:14,lineHeight:1.6,margin:0}}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COMO FUNCIONA */}
      <section style={{padding:"80px 24px",background:"#f0ebe0"}}>
        <div style={{maxWidth:800,margin:"0 auto",textAlign:"center"}}>
          <h2 style={{color:"#1c1208",fontSize:"clamp(24px,4vw,38px)",fontWeight:800,margin:"0 0 12px",letterSpacing:-0.8}}>Como funciona</h2>
          <p style={{color:"#8c7a5e",fontSize:16,marginBottom:56}}>Do cadastro ao extrato do empregado em minutos</p>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:32}}>
            {[
              ["1","Configure o restaurante","Cadastre cargos, empregados, horários e regras fiscais. Defina dias de trabalho e folga — horários depois."],
              ["2","Lance as gorjetas","Informe o valor diário. O sistema distribui automaticamente por cargo, área e escala."],
              ["3","Comunique a equipe","Envie comunicados com IA, gerencie o FAQ automático e mantenha todos informados."],
              ["4","Equipe acompanha tudo","Cada empregado vê extrato, escala, horários e comunicados direto pelo celular."],
            ].map(([n,t,d])=>(
              <div key={n}>
                <div style={{width:52,height:52,borderRadius:"50%",background:ac,color:"#fff",fontSize:22,fontWeight:800,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px",fontFamily:"'DM Mono',monospace"}}>{n}</div>
                <h3 style={{color:"#1c1208",fontSize:16,fontWeight:700,margin:"0 0 8px"}}>{t}</h3>
                <p style={{color:"#8c7a5e",fontSize:14,lineHeight:1.6,margin:0}}>{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* EARLY ADOPTER + PREÇOS */}
      <section id="precos" style={{padding:"0",background:"#faf8f4"}}>

        {/* Banner Early Adopter */}
        <div style={{background:"linear-gradient(135deg,#1c1208 0%,#2d1f0e 60%,#3a2a10 100%)",padding:"clamp(40px,6vw,72px) 24px",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",top:-60,right:-60,width:240,height:240,borderRadius:"50%",background:"radial-gradient(circle,#d4a01730 0%,transparent 70%)",pointerEvents:"none"}}/>
          <div style={{position:"absolute",bottom:-40,left:-40,width:180,height:180,borderRadius:"50%",background:"radial-gradient(circle,#d4a01718 0%,transparent 70%)",pointerEvents:"none"}}/>
          <div style={{maxWidth:760,margin:"0 auto",textAlign:"center",position:"relative",zIndex:1}}>
            <div style={{display:"inline-block",background:"linear-gradient(135deg,#d4a017,#e8b84a)",color:"#1c1208",fontSize:12,fontWeight:800,padding:"5px 18px",borderRadius:20,marginBottom:18,letterSpacing:0.8,textTransform:"uppercase"}}>🚀 Oferta limitada — Early Adopter</div>
            <h2 style={{fontSize:"clamp(24px,5vw,42px)",fontWeight:900,color:"#fff",margin:"0 0 10px",letterSpacing:-1,lineHeight:1.15}}>
              Primeiros <span style={{color:"#d4a017"}}>30 clientes</span> ganham
            </h2>
            <p style={{fontSize:"clamp(20px,4vw,32px)",fontWeight:800,color:"#d4a017",margin:"0 0 16px",lineHeight:1.2}}>
              30% de desconto permanente
            </p>
            <p style={{color:"#b0996e",fontSize:"clamp(13px,2vw,16px)",maxWidth:480,margin:"0 auto 28px",lineHeight:1.6}}>
              Assine agora e pague menos para sempre. O desconto vale enquanto sua assinatura estiver ativa — sem prazo, sem truques.
            </p>

            {/* Preços com desconto */}
            <div style={{display:"flex",justifyContent:"center",gap:12,flexWrap:"wrap",marginBottom:28}}>
              {[
                {plano:"Starter",       de:"R$97",  por:"R$67,90",  emp:"até 10"},
                {plano:"Básico",        de:"R$187", por:"R$130,90", emp:"até 20"},
                {plano:"Profissional",  de:"R$397", por:"R$277,90", emp:"até 50"},
              ].map(p=>(
                <div key={p.plano} style={{background:"rgba(255,255,255,0.06)",border:"1px solid #d4a01733",borderRadius:14,padding:"16px 22px",minWidth:150,backdropFilter:"blur(4px)"}}>
                  <div style={{color:"#e8d5a8",fontSize:12,fontWeight:700,marginBottom:2}}>{p.plano}</div>
                  <div style={{color:"#6b5a3e",fontSize:11,marginBottom:6}}>{p.emp} func.</div>
                  <div style={{color:"#8c7a5e",fontSize:13,textDecoration:"line-through",marginBottom:2}}>{p.de}/mês</div>
                  <div style={{color:"#d4a017",fontSize:22,fontWeight:800,fontFamily:"'DM Mono',monospace",lineHeight:1}}>{p.por}</div>
                  <div style={{color:"#a08060",fontSize:10,marginTop:2}}>/mês</div>
                </div>
              ))}
            </div>

            <a href="#contato" style={{display:"inline-block",padding:"16px 44px",borderRadius:14,background:"linear-gradient(135deg,#d4a017,#e8b84a)",color:"#1c1208",fontWeight:800,fontSize:"clamp(15px,2vw,18px)",textDecoration:"none",letterSpacing:-0.3,boxShadow:"0 6px 28px #d4a01755",transition:"transform 0.2s"}}>
              Garantir meu desconto →
            </a>
            <p style={{color:"#6b5a3e",fontSize:11,marginTop:14}}>Vagas limitadas · Desconto válido enquanto a assinatura estiver ativa</p>
          </div>
        </div>

        {/* Tabela de preços */}
        <div style={{padding:"48px 24px 80px"}}>
        <div style={{maxWidth:1000,margin:"0 auto"}}>
          <div style={{textAlign:"center",marginBottom:48}}>
            <h2 style={{fontSize:"clamp(24px,4vw,38px)",fontWeight:800,margin:"0 0 12px",letterSpacing:-0.8,color:"#1c1208"}}>Todos os planos</h2>
            <p style={{color:"#8c7a5e",fontSize:16}}>Plano anual com <strong style={{color:ac}}>10% de desconto</strong> · Máx. 1 unidade no Starter</p>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:16}}>
            {PLANOS.map(p=>(
              <div key={p.nome} style={{borderRadius:16,border:p.destaque?`2px solid ${ac}`:"1px solid #ede8df",padding:"24px 18px",background:p.destaque?"#1c1208":"#fff",position:"relative",boxShadow:p.destaque?"0 8px 32px #d4a01733":"0 2px 12px rgba(0,0,0,0.04)",display:"flex",flexDirection:"column"}}>
                {p.destaque && <div style={{position:"absolute",top:-12,left:"50%",transform:"translateX(-50%)",background:ac,color:"#fff",fontSize:11,fontWeight:700,padding:"4px 14px",borderRadius:20,whiteSpace:"nowrap"}}>Mais popular</div>}
                <div style={{color:p.destaque?"#fff":"#1c1208",fontWeight:800,fontSize:16,marginBottom:4}}>{p.nome}</div>
                <div style={{color:p.destaque?"#d4c4a0":"#8c7a5e",fontSize:12,marginBottom:4}}>{p.emp} funcionários</div>
                <div style={{color:p.destaque?"#887a5e":"#b0996e",fontSize:10,marginBottom:14}}>{p.multi ? "🏢 Múltiplas unidades" : "🏢 Máx. 1 unidade"}</div>

                {/* Preço principal — anual */}
                {p.precoAnual ? (
                  <div style={{marginBottom:8,flex:1}}>
                    <div style={{display:"flex",alignItems:"baseline",gap:2,flexWrap:"wrap",marginBottom:2}}>
                      <span style={{color:p.destaque?ac:"#1c1208",fontSize:p.nome==="Enterprise"?20:26,fontWeight:800,fontFamily:"'DM Mono',monospace",letterSpacing:-0.5,lineHeight:1.1}}>{p.precoAnual}</span>
                      <span style={{color:p.destaque?"#d4c4a0":"#8c7a5e",fontSize:11,whiteSpace:"nowrap"}}>/mês</span>
                    </div>
                    <div style={{color:"#d4a017",fontSize:11,fontWeight:700,marginBottom:p.precoMensal?6:16}}>
                      {p.nome==="Enterprise" ? "por funcionário/mês" : "✦ no plano anual"}
                    </div>
                    {p.precoMensal && (
                      <div style={{color:p.destaque?"#6b5a3e":"#a08060",fontSize:11,marginBottom:16}}>
                        ou {p.precoMensal}/mês no mensal
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{marginBottom:16,flex:1}}>
                    <div style={{color:p.destaque?ac:"#1c1208",fontSize:18,fontWeight:800,marginBottom:4}}>Sob orçamento</div>
                    <div style={{color:p.destaque?"#d4c4a0":"#8c7a5e",fontSize:12}}>{p.mensalSub}</div>
                  </div>
                )}

                {p.multi && (
                  <div style={{color:p.destaque?"#6b5a3e":"#a08060",fontSize:10,marginBottom:12,lineHeight:1.5}}>
                    Distribua os funcionários entre suas unidades como quiser.
                  </div>
                )}

                <a href="#contato" style={{display:"block",textAlign:"center",padding:"11px",borderRadius:10,background:p.destaque?ac:"#f5f0e8",color:p.destaque?"#fff":"#5c4a2e",fontWeight:700,fontSize:14,textDecoration:"none",marginTop:"auto"}}>
                  {p.cta}
                </a>
              </div>
            ))}
          </div>
        </div>
        </div>
      </section>

      {/* CONTATO */}
      <section id="contato" style={{padding:"80px 24px",background:"#f0ebe0"}}>
        <div style={{maxWidth:540,margin:"0 auto"}}>
          <div style={{textAlign:"center",marginBottom:40}}>
            <h2 style={{fontSize:"clamp(24px,4vw,38px)",fontWeight:800,margin:"0 0 12px",letterSpacing:-0.8,color:"#1c1208"}}>Vamos conversar?</h2>
            <p style={{color:"#8c7a5e",fontSize:16}}>Solicite uma demonstração gratuita ou tire suas dúvidas</p>
          </div>

          {/* E-mail — único contato exposto */}
          <div style={{background:"#fff",borderRadius:14,padding:"20px",border:"1px solid #ede8df",textAlign:"center",marginBottom:28}}>
            <div style={{fontSize:28,marginBottom:8}}>📧</div>
            <div style={{fontWeight:700,fontSize:14,color:"#1c1208",marginBottom:6}}>E-mail</div>
            <a href="mailto:contato@apptip.app" style={{color:ac,fontSize:15,fontWeight:700,textDecoration:"none"}}>contato@apptip.app</a>
            <div style={{color:"#b0996e",fontSize:12,marginTop:6}}>Para dúvidas, parcerias e suporte</div>
          </div>

          {/* Formulário → envia via WhatsApp */}
          {formSent ? (
            <div style={{textAlign:"center",padding:"48px",background:"#fff",borderRadius:16,border:"1px solid #ede8df"}}>
              <div style={{fontSize:48,marginBottom:16}}>✅</div>
              <h3 style={{fontSize:20,fontWeight:700,margin:"0 0 8px",color:"#1c1208"}}>Mensagem enviada!</h3>
              <p style={{color:"#8c7a5e"}}>Entraremos em contato em breve. Obrigado pelo interesse no AppTip!</p>
            </div>
          ) : (
            <div style={{background:"#fff",borderRadius:16,padding:"36px",border:"1px solid #ede8df",boxShadow:"0 4px 24px rgba(0,0,0,0.06)"}}>
              <div style={{display:"flex",flexDirection:"column",gap:14}}>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <div>
                    <label style={{display:"block",fontSize:13,color:"#8c7a5e",marginBottom:6,fontWeight:600}}>Nome *</label>
                    <input value={formData.nome} onChange={e=>setFormData({...formData,nome:e.target.value})} placeholder="Seu nome" style={{width:"100%",padding:"11px 14px",borderRadius:10,border:"1px solid #ede8df",fontFamily:"'DM Sans',sans-serif",fontSize:14,outline:"none",boxSizing:"border-box",background:"#faf8f4"}}/>
                  </div>
                  <div>
                    <label style={{display:"block",fontSize:13,color:"#8c7a5e",marginBottom:6,fontWeight:600}}>Restaurante</label>
                    <input value={formData.restaurante} onChange={e=>setFormData({...formData,restaurante:e.target.value})} placeholder="Nome do restaurante" style={{width:"100%",padding:"11px 14px",borderRadius:10,border:"1px solid #ede8df",fontFamily:"'DM Sans',sans-serif",fontSize:14,outline:"none",boxSizing:"border-box",background:"#faf8f4"}}/>
                  </div>
                </div>
                <div>
                  <label style={{display:"block",fontSize:13,color:"#8c7a5e",marginBottom:6,fontWeight:600}}>Nº de empregados</label>
                  <input value={formData.empregados} onChange={e=>setFormData({...formData,empregados:e.target.value})} placeholder="Ex: 15" type="number" style={{width:"100%",padding:"11px 14px",borderRadius:10,border:"1px solid #ede8df",fontFamily:"'DM Sans',sans-serif",fontSize:14,outline:"none",boxSizing:"border-box",background:"#faf8f4"}}/>
                </div>
                <div>
                  <label style={{display:"block",fontSize:13,color:"#8c7a5e",marginBottom:6,fontWeight:600}}>Mensagem</label>
                  <textarea value={formData.mensagem} onChange={e=>setFormData({...formData,mensagem:e.target.value})} placeholder="Conte um pouco sobre seu restaurante e o que precisa..." rows={3} style={{width:"100%",padding:"11px 14px",borderRadius:10,border:"1px solid #ede8df",fontFamily:"'DM Sans',sans-serif",fontSize:14,outline:"none",resize:"vertical",boxSizing:"border-box",background:"#faf8f4"}}/>
                </div>
                <button onClick={sendForm} disabled={!formData.nome.trim()||formSending}
                  style={{padding:"14px",borderRadius:12,border:"none",background:!formData.nome.trim()?"#e8e0d0":"#25d366",color:"#fff",fontWeight:700,fontSize:16,cursor:!formData.nome.trim()?"not-allowed":"pointer",fontFamily:"'DM Sans',sans-serif",boxShadow:"0 4px 16px #25d36633",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
                  <span style={{fontSize:18}}>💬</span>
                  {formSending?"Abrindo WhatsApp...":"Enviar pelo WhatsApp →"}
                </button>
                <p style={{color:"#b0996e",fontSize:12,textAlign:"center",margin:0}}>Você será redirecionado para o WhatsApp para enviar a mensagem</p>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{background:"#1c1208",padding:"48px 24px",textAlign:"center"}}>
        <div style={{marginBottom:12}}>
          <span style={{fontSize:20}}>🍽️</span>
          <span style={{fontWeight:800,fontSize:18,color:"#fff",marginLeft:8,letterSpacing:-0.5}}>App<span style={{color:ac}}>Tip</span></span>
        </div>
        <p style={{color:"#8c7a5e",fontSize:13,marginBottom:20}}>Transparência e eficiência para equipes de restaurantes</p>
        <div style={{display:"flex",gap:20,justifyContent:"center",flexWrap:"wrap",marginBottom:16}}>
          <button onClick={onLogin} style={{background:"none",border:"none",color:"#8c7a5e",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13}}>Área de acesso</button>
          <a href="mailto:contato@apptip.app" style={{color:"#8c7a5e",fontSize:13,textDecoration:"none"}}>contato@apptip.app</a>
          <button onClick={()=>window.__showPrivacy?.()} style={{background:"none",border:"none",color:"#8c7a5e",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13}}>Política de Privacidade</button>
        </div>
        <p style={{color:"#4a3a2a",fontSize:12}}>© {new Date().getFullYear()} AppTip. Todos os direitos reservados.</p>
      </footer>
    </div>
  );
}


//

//
// FATURA PAGE — página pública de cobrança
//
function FaturaPage({ faturaId, restaurants, onUpdate, loaded }) {
  const [confirmado, setConfirmado] = useState(false);

  if (!loaded) return (
    <div style={{minHeight:"100vh",background:"#faf8f4",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{fontSize:40}}>🍽️</div>
      <div style={{color:"#8c7a5e",fontSize:15,animation:"pulse 1.5s ease-in-out infinite"}}>Carregando fatura...</div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  );

  // Busca a cobrança pelo ID em todos os restaurantes
  let cobFound = null;
  let restFound = null;
  for (const r of restaurants) {
    const cob = (r.financeiro?.cobrancas??[]).find(c => c.id === faturaId);
    if (cob) { cobFound = cob; restFound = r; break; }
  }

  if (!cobFound || !restFound) return (
    <div style={{minHeight:"100vh",background:"#faf8f4",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{textAlign:"center",padding:40}}>
        <div style={{fontSize:48,marginBottom:16}}>🔍</div>
        <h2 style={{color:"#1c1208",fontSize:20,fontWeight:700,margin:"0 0 8px"}}>Fatura não encontrada</h2>
        <p style={{color:"#8c7a5e",fontSize:14}}>O link pode ter expirado ou ser inválido.</p>
      </div>
    </div>
  );

  const ac = "#d4a017";
  const isPago = cobFound.status === "pago";
  const isClienteConfirmou = cobFound.clienteConfirmou;
  const vencLabel = cobFound.venc ? new Date(cobFound.venc+"T12:00:00").toLocaleDateString("pt-BR") : null;

  function clienteConfirmarPagamento() {
    const updated = restaurants.map(r => {
      if (r.id !== restFound.id) return r;
      const novasCobs = (r.financeiro?.cobrancas??[]).map(c =>
        c.id === faturaId ? {...c, clienteConfirmou:true, clienteConfirmouEm:new Date().toISOString(), status:"aguardando_confirmacao"} : c
      );
      // NÃO libera acesso — fica aguardando confirmação do admin
      return {...r, financeiro:{...r.financeiro, cobrancas:novasCobs}};
    });
    onUpdate("restaurants", updated);
    setConfirmado(true);
  }

  return (
    <div style={{minHeight:"100vh",background:"#faf8f4",fontFamily:"'DM Sans',sans-serif"}}>
      {/* Header */}
      <div style={{background:"#1c1208",padding:"18px 24px",display:"flex",alignItems:"center",gap:10}}>
        <span style={{fontSize:22}}>🍽️</span>
        <span style={{fontWeight:800,fontSize:18,color:"#fff",letterSpacing:-0.5}}>App<span style={{color:ac}}>Tip</span></span>
        <span style={{color:"#6b5a3e",fontSize:13,marginLeft:8}}>· Fatura</span>
      </div>

      <div style={{maxWidth:480,margin:"0 auto",padding:"32px 20px"}}>

        {/* Status */}
        {isPago && (
          <div style={{background:"#f0fdf4",border:"1px solid #86efac",borderRadius:12,padding:"14px 18px",marginBottom:20,display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:24}}>✅</span>
            <div>
              <div style={{color:"#166534",fontWeight:700,fontSize:15}}>Pagamento confirmado</div>
              <div style={{color:"#16a34a",fontSize:13}}>Esta fatura já foi paga. Obrigado!</div>
            </div>
          </div>
        )}
        {isClienteConfirmou && !isPago && (
          <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:12,padding:"14px 18px",marginBottom:20,display:"flex",alignItems:"center",gap:10}}>
            <span style={{fontSize:24}}>⏳</span>
            <div>
              <div style={{color:"#92400e",fontWeight:700,fontSize:15}}>Pagamento em verificação</div>
              <div style={{color:"#a16207",fontSize:13}}>Você confirmou o pagamento. Aguardando validação.</div>
            </div>
          </div>
        )}

        {/* Card da fatura */}
        <div style={{background:"#fff",borderRadius:16,border:"1px solid #ede8df",boxShadow:"0 4px 24px rgba(0,0,0,0.06)",overflow:"hidden",marginBottom:20}}>
          {/* Cabeçalho da fatura */}
          <div style={{background:"#1c1208",padding:"24px",textAlign:"center"}}>
            <div style={{color:"#8c7a5e",fontSize:12,fontWeight:600,textTransform:"uppercase",letterSpacing:1,marginBottom:8}}>Fatura AppTip</div>
            <div style={{color:"#fff",fontSize:22,fontWeight:800,marginBottom:4}}>{restFound.name}</div>
            <div style={{color:"#d4c4a0",fontSize:14}}>{cobFound.periodoLabel}</div>
          </div>

          {/* Detalhes */}
          <div style={{padding:"24px"}}>
            <div style={{display:"flex",flexDirection:"column",gap:14,marginBottom:24}}>
              {[
                ["Plano", cobFound.forma === "PIX" || cobFound.forma === "Link" ? (restFound.planoId === "p10"?"Starter":restFound.planoId === "p20"?"Básico":restFound.planoId === "p50"?"Profissional":restFound.planoId === "p999"?"Enterprise":"On Demand") : cobFound.forma],
                ["Valor", `R$ ${cobFound.valor?.toLocaleString("pt-BR",{minimumFractionDigits:2})}`],
                ...(vencLabel ? [["Vencimento", vencLabel]] : []),
              ].map(([k,v])=>(
                <div key={k} style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingBottom:14,borderBottom:"1px solid #f5f0e8"}}>
                  <span style={{color:"#8c7a5e",fontSize:14}}>{k}</span>
                  <span style={{color:"#1c1208",fontWeight:700,fontSize:15}}>{v}</span>
                </div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{color:"#1c1208",fontWeight:700,fontSize:16}}>Total</span>
                <span style={{color:ac,fontWeight:800,fontSize:22,fontFamily:"'DM Mono',monospace"}}>R$ {cobFound.valor?.toLocaleString("pt-BR",{minimumFractionDigits:2})}</span>
              </div>
            </div>

            {/* Dados de pagamento */}
            {cobFound.chave && (
              <div style={{background:"#faf8f4",borderRadius:12,padding:"16px",border:"1px solid #ede8df",marginBottom:20}}>
                <div style={{color:"#8c7a5e",fontSize:12,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5,marginBottom:10}}>
                  {cobFound.forma === "Link" ? "Link de pagamento" : "Pagamento via PIX"}
                </div>
                {cobFound.forma === "Link" ? (
                  <a href={cobFound.chave} target="_blank" rel="noreferrer"
                    style={{color:ac,fontWeight:700,fontSize:14,wordBreak:"break-all"}}>
                    {cobFound.chave}
                  </a>
                ) : (
                  <>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                      <span style={{color:"#8c7a5e",fontSize:13}}>Chave PIX</span>
                      <span style={{color:"#1c1208",fontWeight:700,fontSize:14,fontFamily:"'DM Mono',monospace"}}>{cobFound.chave}</span>
                    </div>
                    <div style={{display:"flex",justifyContent:"space-between"}}>
                      <span style={{color:"#8c7a5e",fontSize:13}}>Favorecido</span>
                      <span style={{color:"#1c1208",fontSize:13}}>Gustavo Rodrigues da Silva</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Botão confirmar */}
            {!isPago && !isClienteConfirmou && !confirmado && (
              <button onClick={clienteConfirmarPagamento}
                style={{width:"100%",padding:"16px",borderRadius:12,border:"none",background:ac,color:"#fff",fontWeight:700,fontSize:16,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",boxShadow:"0 4px 16px #d4a01744"}}>
                Já efetuei o pagamento ✓
              </button>
            )}
            {(confirmado || isClienteConfirmou) && !isPago && (
              <div style={{textAlign:"center",padding:"16px",borderRadius:12,background:"#f0fdf4",border:"1px solid #86efac"}}>
                <div style={{fontSize:32,marginBottom:8}}>✅</div>
                <div style={{color:"#166534",fontWeight:700,fontSize:15,marginBottom:4}}>Confirmação recebida!</div>
                <div style={{color:"#16a34a",fontSize:13}}>Aguarde a validação do pagamento. Seu acesso continua liberado.</div>
              </div>
            )}
            {isPago && (
              <div style={{textAlign:"center",padding:"16px",borderRadius:12,background:"#f0fdf4"}}>
                <div style={{color:"#166534",fontWeight:700,fontSize:15}}>Esta fatura foi paga e confirmada. Obrigado!</div>
              </div>
            )}
          </div>
        </div>

        <p style={{color:"#b0996e",fontSize:12,textAlign:"center"}}>Duvidas? Entre em contato via WhatsApp: (11) 98549-9821</p>
      </div>
    </div>
  );
}

//
// GUIA DO GESTOR
//
function GuiaGestor() {
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>AppTip — Guia do Gestor</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&family=DM+Mono:wght@400;500&display=swap');
:root{--ac:#d4a017;--ac-l:#fef9ee;--ac-b:#f0d080;--text:#1c1208;--t2:#4a3b1f;--t3:#8c7a5e;--bg:#faf8f4;--card:#fff;--border:#ede8df;--green:#16a34a;--gbg:#f0fdf4;--red:#dc2626;--rbg:#fef2f2;--blue:#2563eb;--bbg:#eff6ff;--sw:260px}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
.layout{display:flex;min-height:100vh}
.sidebar{width:var(--sw);background:var(--text);position:fixed;top:0;left:0;bottom:0;overflow-y:auto;padding-bottom:40px;z-index:100}
.logo{padding:20px 18px;border-bottom:1px solid #2e2010;display:flex;align-items:center;gap:10px}
.logo .nm{font-weight:800;font-size:18px;color:#fff;letter-spacing:-.5px}
.logo .nm span{color:var(--ac)}
.logo .badge{font-size:10px;background:var(--ac);color:#fff;padding:2px 7px;border-radius:20px;font-weight:700;margin-left:auto}
.sg{padding:16px 16px 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#6b5a3e}
.sidebar a{display:flex;align-items:center;gap:10px;padding:8px 14px;color:#c8b89a;text-decoration:none;font-size:13px;border-radius:8px;margin:2px 8px}
.sidebar a:hover,.sidebar a.active{background:#2a1e0e;color:#fff}
.sidebar a .ic{font-size:14px;width:18px;text-align:center}
.main{margin-left:var(--sw);flex:1}
.topbar{background:var(--card);border-bottom:1px solid var(--border);padding:18px 40px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:50}
.topbar h1{font-size:22px;font-weight:800}
.topbar .sub{font-size:13px;color:var(--t3);margin-top:2px}
.ver{font-size:11px;background:var(--ac-l);color:var(--ac);border:1px solid var(--ac-b);padding:4px 12px;border-radius:20px;font-family:'DM Mono',monospace}
.content{padding:40px;max-width:820px}
.sec{margin-bottom:52px;scroll-margin-top:80px}
.sh{display:flex;align-items:center;gap:12px;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid var(--border)}
.iw{width:40px;height:40px;border-radius:10px;background:var(--ac-l);border:1px solid var(--ac-b);display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
.sh h2{font-size:20px;font-weight:800}
.sh p{font-size:13px;color:var(--t3);margin-top:2px}
.card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:20px 24px;margin-bottom:16px}
.card h3{font-size:15px;font-weight:700;margin-bottom:10px}
.card p,.card li{font-size:14px;color:var(--t2);line-height:1.7}
.card p+p{margin-top:8px}
.card ul{margin:10px 0 0 18px}
.card li{margin-bottom:4px}
.steps{display:flex;flex-direction:column;gap:12px;margin-top:12px}
.step{display:flex;gap:14px;align-items:flex-start}
.sn{width:26px;height:26px;border-radius:50%;background:var(--ac);color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.sc strong{font-size:14px;display:block;margin-bottom:2px}
.sc p{font-size:13px;color:var(--t2);margin:0}
.ib{border-radius:10px;padding:14px 16px;margin-top:14px;font-size:13px;display:flex;gap:10px;align-items:flex-start;line-height:1.6}
.ib.tip{background:var(--ac-l);border:1px solid var(--ac-b);color:var(--t2)}
.ib.warn{background:#fffbeb;border:1px solid #fde68a;color:#92400e}
.ib.green{background:var(--gbg);border:1px solid #86efac;color:#166534}
.ib.blue{background:var(--bbg);border:1px solid #bfdbfe;color:#1d4ed8}
.ib .ico{font-size:16px;flex-shrink:0;margin-top:1px}
.tag{display:inline-flex;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:700;font-family:'DM Mono',monospace;border:1px solid}
.tag.am{background:var(--ac-l);color:var(--ac);border-color:var(--ac-b)}
.tag.gr{background:var(--gbg);color:var(--green);border-color:#86efac}
.tag.rd{background:var(--rbg);color:var(--red);border-color:#fca5a5}
.tag.gy{background:var(--bg);color:var(--t3);border-color:var(--border)}
.new{display:inline-block;background:var(--ac);color:#fff;font-size:9px;font-weight:700;padding:1px 6px;border-radius:20px;margin-left:6px;vertical-align:middle;font-family:'DM Mono',monospace}
table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}
th{text-align:left;padding:10px 14px;background:var(--bg);color:var(--t3);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)}
td{padding:11px 14px;border-bottom:1px solid var(--border);color:var(--t2);vertical-align:top}
tr:last-child td{border-bottom:none}
tr:hover td{background:var(--bg)}
.hero{background:var(--text);padding:36px 40px;border-radius:16px;margin-bottom:40px;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;top:-40px;right:-40px;width:200px;height:200px;background:radial-gradient(circle,#d4a01733 0%,transparent 70%);border-radius:50%}
.hero h2{font-size:24px;font-weight:800;color:#fff;margin-bottom:8px}
.hero p{font-size:15px;color:#c8b89a;line-height:1.6;max-width:560px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}
.chip{padding:5px 14px;border-radius:20px;background:#2a1e0e;color:#c8b89a;font-size:12px;font-weight:600}
code{font-family:'DM Mono',monospace;font-size:12px;background:var(--bg);border:1px solid var(--border);padding:2px 7px;border-radius:5px;color:var(--t2)}
hr{border:none;border-top:1px solid var(--border);margin:24px 0}
@media(max-width:768px){.sidebar{display:none}.main{margin-left:0}.topbar,.content,.hero{padding-left:20px;padding-right:20px}}
</style>
</head>
<body>
<div class="layout">
<nav class="sidebar">
  <div class="logo"><span style="font-size:20px">🍽️</span><span class="nm">App<span>Tip</span></span><span class="badge">Gestor</span></div>
  <div class="sg">Visão Geral</div>
  <a href="#intro"><span class="ic">📖</span> O que é o AppTip?</a>
  <a href="#acesso"><span class="ic">🔐</span> Acesso e Login</a>
  <a href="#restaurante"><span class="ic">🏢</span> Selecionar Restaurante</a>
  <a href="#dashboard"><span class="ic">📊</span> Dashboard</a>
  <div class="sg">Funcionalidades</div>
  <a href="#gorjetas"><span class="ic">💸</span> Gorjetas</a>
  <a href="#escala"><span class="ic">📅</span> Escala</a>
  <a href="#cargos"><span class="ic">🏷️</span> Cargos</a>
  <a href="#equipe"><span class="ic">👥</span> Equipe</a>
  <a href="#horarios"><span class="ic">🕐</span> Horários</a>
  <a href="#comunicados"><span class="ic">📢</span> Comunicados</a>
  <a href="#faq"><span class="ic">❓</span> FAQ com IA</a>
  <a href="#dp"><span class="ic">💬</span> Fale com DP</a>
  <a href="#caixa"><span class="ic">📬</span> Caixa</a>
  <div class="sg">Configurações</div>
  <a href="#config-abas"><span class="ic">📋</span> Abas Visíveis</a>
  <a href="#config-fiscal"><span class="ic">💰</span> Retenção Fiscal</a>
  <a href="#config-divisao"><span class="ic">⚖️</span> Divisão de Gorjeta</a>
  <div class="sg">Referência</div>
  <a href="#permissoes"><span class="ic">🔑</span> Permissões</a>
  <a href="#privacidade-admin"><span class="ic">🛡️</span> Privacidade</a>
  <a href="#mobile-gestor"><span class="ic">📱</span> Acesso Mobile</a>
  <a href="#bloqueio"><span class="ic">🔒</span> Acesso Suspenso</a>
</nav>
<div class="main">
  <div class="topbar">
    <div><h1>Guia do Gestor</h1><div class="sub">Manual completo de uso do AppTip para gestores de restaurante</div></div>
    <span class="ver">v${APP_VERSION} · 2026</span>
  </div>
  <div class="content">

    <div class="hero">
      <h2>Bem-vindo ao AppTip 🍽️</h2>
      <p>O AppTip centraliza a gestão de gorjetas. Como gestor, você lança gorjetas, gerencia equipe, escala, horários com IA, comunicados, FAQ com IA e configura as regras do restaurante — inclusive pelo celular.</p>
      <div class="chips">
        <span class="chip">💸 Gorjetas automáticas</span><span class="chip">📅 Escala</span><span class="chip">👥 Equipe</span><span class="chip">🕐 Horários com IA</span><span class="chip">❓ FAQ com IA</span><span class="chip">📢 Comunicados com IA</span><span class="chip">📱 Mobile gestor</span><span class="chip">⚙️ Configurações</span>
      </div>
    </div>

    <div class="sec" id="intro">
      <div class="sh"><div class="iw">📖</div><div><h2>O que é o AppTip?</h2><p>Visão geral do sistema</p></div></div>
      <div class="card"><h3>🎯 Para que serve?</h3><p>O gestor lança o valor total de gorjeta do dia. O sistema distribui automaticamente entre os empregados conforme os pontos de cada cargo e os dias na escala. A dedução fiscal é calculada e mostrada automaticamente para cada empregado.</p></div>
      <div class="card"><h3>📱 Como acessar?</h3><p>Pelo navegador em <code>apptip.app</code>. O botão <strong>❓ Ajuda</strong> no header abre este guia a qualquer momento. Adicione à tela inicial do celular para acesso rápido como app nativo.</p></div>
    </div>

    <div class="sec" id="acesso">
      <div class="sh"><div class="iw">🔐</div><div><h2>Acesso e Login</h2><p>Como entrar no sistema</p></div></div>
      <div class="card"><h3>Como fazer login</h3>
        <div class="steps">
          <div class="step"><div class="sn">1</div><div class="sc"><strong>Digite seu CPF</strong><p>Campo "CPF ou ID do empregado" na tela inicial.</p></div></div>
          <div class="step"><div class="sn">2</div><div class="sc"><strong>Digite seu PIN</strong><p>Código de 4 dígitos. Se também for empregado, pode usar o mesmo PIN.</p></div></div>
          <div class="step"><div class="sn">3</div><div class="sc"><strong>Selecione "Gestor"</strong><p>Se tiver mais de um perfil cadastrado, escolha o correto.</p></div></div>
        </div>
      </div>
      <div class="ib warn"><span class="ico">⚠️</span><span>Nunca compartilhe seu PIN. Em caso de comprometimento, solicite troca ao administrador AppTip.</span></div>
    </div>

    <div class="sec" id="restaurante">
      <div class="sh"><div class="iw">🏢</div><div><h2>Selecionar Restaurante</h2><p>Navegar entre os restaurantes que você gerencia</p></div></div>
      <div class="card"><h3>Tela de seleção <span class="new">MELHORADO</span></h3>
        <p>Se gerenciar mais de um restaurante, aparece a tela de seleção após o login. Cada card mostra dados reais do restaurante:</p>
        <ul><li><strong>👥 Ativos</strong> — número de empregados ativos</li><li><strong>💸 Dias lançados</strong> — gorjetas lançadas no mês atual</li><li><strong>💬 Novas</strong> — mensagens não lidas no Fale com DP</li><li><strong>📢 Pendentes</strong> — comunicados sem confirmação de leitura</li></ul>
        <div class="ib tip"><span class="ico">💡</span><span>Restaurantes com <span class="tag rd">🔒 Suspenso</span> têm pendência financeira e ficam bloqueados até regularização.</span></div>
      </div>
      <div class="card"><h3>Trocar de restaurante <span class="new">MELHORADO</span></h3><p>Com o restaurante aberto, o nome aparece no <strong>header</strong>. Para trocar, clique em <strong>‹ Trocar</strong> no canto superior esquerdo — sem precisar sair do sistema.</p></div>
    </div>

    <div class="sec" id="dashboard">
      <div class="sh"><div class="iw">📊</div><div><h2>Dashboard</h2><p>Visão geral e resumo do dia</p></div></div>
      <div class="card"><h3>📅 Resumo do dia <span class="new">NOVO</span></h3>
        <p>No topo do Dashboard (apenas no mês corrente), um card âmbar mostra o estado atual:</p>
        <ul><li><strong>👥 Trabalhando hoje</strong> — empregados sem marcação de folga ou falta</li><li><strong>💸 Gorjeta lançada</strong> — valor do pool de hoje, ou "—" se ainda não lançado</li><li><strong>Pendência gorjeta</strong> — dias úteis passados sem lançamento</li></ul>
        <p style="margin-top:10px">Se a gorjeta de hoje ainda não foi lançada, aparece um botão direto <strong>"💸 Lançar gorjeta de hoje"</strong> que leva à aba Gorjetas (visível apenas no computador).</p>
      </div>
      <div class="card"><h3>🔔 Alertas automáticos</h3>
        <table>
          <tr><th>Alerta</th><th>O que significa</th></tr>
          <tr><td>💸 Dias sem gorjeta</td><td>Dias úteis passados sem lançamento</td></tr>
          <tr><td>👤 Sem cargo</td><td>Empregados sem cargo definido</td></tr>
          <tr><td>🕐 Sem horário</td><td>Empregados sem horário cadastrado</td></tr>
          <tr><td>⚠️ Faltas injustificadas</td><td>Faltas não justificadas no mês</td></tr>
          <tr><td>💬 Mensagens não lidas</td><td>Fale com DP com mensagens pendentes</td></tr>
          <tr><td>📢 Sem ciência</td><td>Empregados que não confirmaram comunicados</td></tr>
        </table>
        <div class="ib tip"><span class="ico">💡</span><span>Clique em qualquer alerta para ir direto à aba correspondente.</span></div>
      </div>
    </div>

    <div class="sec" id="gorjetas">
      <div class="sh"><div class="iw">💸</div><div><h2>Gorjetas</h2><p>Lançamento e distribuição automática</p></div></div>
      <div class="card"><h3>Como funciona?</h3><p>O gestor lança o valor total do dia. O sistema distribui entre os empregados pelos pontos do cargo e dias na escala. A dedução fiscal (20% ou 33%) é calculada automaticamente.</p></div>
      <div class="card"><h3>Lançamento em tabela</h3>
        <div class="steps">
          <div class="step"><div class="sn">1</div><div class="sc"><strong>Navegue pelo mês</strong><p>Setas <code>‹ ›</code> para mudar de mês.</p></div></div>
          <div class="step"><div class="sn">2</div><div class="sc"><strong>Preencha o valor do dia</strong><p>Digite o total no campo "Valor (R$)". Adicione observação se necessário.</p></div></div>
          <div class="step"><div class="sn">3</div><div class="sc"><strong>Marque "Sem gorjeta" quando necessário</strong><p>Para dias sem operação. O dia fica marcado em roxo.</p></div></div>
          <div class="step"><div class="sn">4</div><div class="sc"><strong>Clique em Lançar</strong><p>Salva todos os dias preenchidos e distribui automaticamente.</p></div></div>
        </div>
      </div>
      <div class="card"><h3>Cores das linhas</h3>
        <table>
          <tr><th>Cor</th><th>Significado</th></tr>
          <tr><td><span class="tag gy">Branco</span></td><td>Sem valor preenchido</td></tr>
          <tr><td><span class="tag gr">Verde</span></td><td>Gorjeta lançada e confirmada</td></tr>
          <tr><td><span class="tag" style="background:#fffbeb;color:#92400e;border-color:#fde68a">Amarelo</span></td><td>Valor editado, ainda não relançado</td></tr>
          <tr><td><span class="tag" style="background:#f5f0ff;color:#6366f1;border-color:#c4b5fd">Roxo</span></td><td>Marcado como "sem gorjeta"</td></tr>
        </table>
      </div>
      <div class="card"><h3>📤 Exportar</h3><p>O botão "Exportar Gorjeta" baixa um Excel com todos os lançamentos do mês: valor por empregado, cargo, bruto, líquido e imposto.</p></div>
      <div class="ib warn"><span class="ico">⚠️</span><span>Apenas empregados com presença na escala do dia recebem gorjeta daquele dia. Mantenha a escala atualizada. Exceção: empregados de produção (🏭) recebem gorjeta todos os dias automaticamente.</span></div>
    </div>

    <div class="sec" id="escala">
      <div class="sh"><div class="iw">📅</div><div><h2>Escala</h2><p>Dias trabalhados por empregado</p></div></div>
      <div class="card"><h3>Por que é fundamental?</h3><p>A escala define quem trabalhou em cada dia e determina quem recebe gorjeta. Manter a escala atualizada garante a distribuição correta.</p></div>
      <div class="card"><h3>Como preencher</h3>
        <div class="steps">
          <div class="step"><div class="sn">1</div><div class="sc"><strong>Filtre por área</strong><p>Salão, Cozinha, Bar, Limpeza.</p></div></div>
          <div class="step"><div class="sn">2</div><div class="sc"><strong>Marque os dias</strong><p><span class="tag gr">✓</span> trabalhado · <strong>F</strong> folga · <strong>FL</strong> freela (presente sem gorjeta) · <strong>C</strong> compensação · <strong>FJ</strong> falta justificada · <strong>FI</strong> falta injustificada · <strong>V</strong> férias</p></div></div>
          <div class="step"><div class="sn">3</div><div class="sc"><strong>Salvo automaticamente</strong><p>Sem botão de confirmação — cada clique salva.</p></div></div>
        </div>
        <div class="ib tip"><span class="ico">💡</span><span>Empregados com horário contratual cadastrado em Horários têm a escala base gerada automaticamente. Você só ajusta as exceções.</span></div>
      </div>
    </div>

    <div class="sec" id="cargos">
      <div class="sh"><div class="iw">🏷️</div><div><h2>Cargos</h2><p>Pontos de gorjeta por cargo</p></div></div>
      <div class="card"><h3>O que são pontos?</h3><p>Cada cargo tem uma quantidade de pontos que define a proporção da gorjeta recebida. Mais pontos = maior fatia da gorjeta.</p>
        <div class="ib blue"><span class="ico">📐</span><span>Exemplo: gorjeta de R$1.000, 50 pontos totais → cada ponto vale R$20. Cargo com 6 pontos recebe R$120 bruto (antes da dedução fiscal).</span></div>
      </div>
      <div class="card"><h3>Gerenciar cargos</h3>
        <table>
          <tr><th>Ação</th><th>Como fazer</th></tr>
          <tr><td>Criar</td><td>Preencha nome, pontos e área → clique "+ Add"</td></tr>
          <tr><td>Editar</td><td>Edite diretamente na linha — alterações ficam em amarelo</td></tr>
          <tr><td>Salvar</td><td>Clique "💾 Salvar tudo" para confirmar todas as alterações de uma vez</td></tr>
          <tr><td>Sem gorjeta</td><td>Marque "Sem gorjeta" para cargos que não participam (sócios, admin)</td></tr>
          <tr><td>Inativar</td><td>Clique "Inativar" — cargo some da lista ativa, histórico preservado</td></tr>
          <tr><td>Apagar</td><td>Cargos inativos sem empregados vinculados podem ser apagados permanentemente</td></tr>
          <tr><td>IA</td><td>Use "✨ Gerenciar cargos com IA" para criar, renomear, ajustar pontos ou inativar com linguagem natural. Revise antes de confirmar.</td></tr>
        </table>
      </div>
    </div>

    <div class="sec" id="equipe">
      <div class="sh"><div class="iw">👥</div><div><h2>Equipe</h2><p>Cadastro e gestão dos empregados</p></div></div>
      <div class="card"><h3>Cadastrar empregado</h3>
        <div class="steps">
          <div class="step"><div class="sn">1</div><div class="sc"><strong>Preencha os dados</strong><p>Nome, CPF (opcional), data de admissão e PIN inicial.</p></div></div>
          <div class="step"><div class="sn">2</div><div class="sc"><strong>Selecione o cargo</strong><p>Define os pontos de gorjeta do empregado.</p></div></div>
          <div class="step"><div class="sn">3</div><div class="sc"><strong>Clique em Add</strong><p>O sistema gera um ID automático (ex: <code>LBZ0012</code>) que o empregado usa para fazer login.</p></div></div>
        </div>
      </div>
      <div class="card"><h3>🏭 Empregado de Produção <span class="new">NOVO</span></h3>
        <p>Empregados podem ser marcados como "Produção" usando o botão 🏭 ao lado do cargo na tabela de equipe. Esse flag é independente da área do cargo — qualquer empregado de qualquer área pode ser marcado como produção.</p>
        <table>
          <tr><th>Regra</th><th>Descrição</th></tr>
          <tr><td>Gorjeta</td><td>Recebe gorjeta <strong>todos os dias</strong> (trabalhando, folga, compensação, etc.), <strong>exceto férias</strong></td></tr>
          <tr><td>Distribuição</td><td>Segue os pontos do cargo normalmente, como qualquer empregado</td></tr>
          <tr><td>Penalidade injustificada</td><td>Falta injustificada: padrão <strong>6,66%</strong> do pool mensal por dia de falta</td></tr>
          <tr><td>Penalidade justificada</td><td>Falta justificada: padrão <strong>3,33%</strong> do pool mensal por dia de falta</td></tr>
          <tr><td>Configuração</td><td>Os percentuais de penalidade são configuráveis em <strong>Configurações → Penalidade por Falta</strong></td></tr>
        </table>
        <div class="ib tip"><span class="ico">💡</span><span>Use esse flag para empregados que participam da produção geral do restaurante e devem receber gorjeta diariamente, independente da escala individual.</span></div>
      </div>
      <div class="card"><h3>🎯 Empregado Freela <span class="new">NOVO</span></h3>
        <p>Empregados podem ser marcados como "Freela" usando o botão 🎯 ao lado do cargo na tabela de equipe. São colaboradores esporádicos que cobrem a equipe.</p>
        <table>
          <tr><th>Regra</th><th>Descrição</th></tr>
          <tr><td>Gorjeta</td><td><strong>Nunca</strong> participa do rateio de gorjeta, independente do status na escala</td></tr>
          <tr><td>Escala</td><td>Aparece normalmente na escala e pode ser escalado em qualquer dia</td></tr>
          <tr><td>Cargo</td><td>Cargo e área são atribuídos normalmente, mas os pontos não contam para gorjeta</td></tr>
        </table>
        <div class="ib blue"><span class="ico">📐</span><span>Além do flag no cadastro, existe o status "Freela" (FL) na escala: marca um empregado regular como presente sem gorjeta naquele dia — útil para quem estava de folga e resolveu cobrir.</span></div>
      </div>
      <div class="card"><h3>Inativar empregado</h3><p>Ao inativar, o empregado perde o acesso imediatamente. O histórico de gorjetas é preservado. É possível reativar na aba "Inativos" a qualquer momento.</p></div>
      <div class="card"><h3>Limite do plano</h3>
        <table>
          <tr><th>Plano</th><th>Limite</th></tr>
          <tr><td>Starter</td><td>10 empregados</td></tr>
          <tr><td>Básico</td><td>20 empregados</td></tr>
          <tr><td>Profissional</td><td>50 empregados</td></tr>
          <tr><td>Enterprise</td><td>51–100 empregados</td></tr>
        </table>
        <div class="ib warn"><span class="ico">⚠️</span><span>Ao atingir o limite, um botão "Solicitar upgrade" aparece para contato com o administrador AppTip.</span></div>
      </div>
    </div>

    <div class="sec" id="horarios">
      <div class="sh"><div class="iw">🕐</div><div><h2>Horários <span class="new">COM IA</span></h2><p>Horários contratuais dos empregados — com assistente de IA</p></div></div>
      <div class="card"><h3>Para que serve?</h3><p>Registra os dias de trabalho/folga e horários contratuais (entrada, saída, intervalo) de cada empregado. Usado para controle interno e geração automática da escala base. Disponível também no celular do gestor.</p></div>
      <div class="card"><h3>Fluxo simplificado</h3>
        <p>Você pode cadastrar de três formas:</p>
        <div class="steps">
          <div class="step"><div class="sn">1</div><div class="sc"><strong>Manual: dias de trabalho e folga</strong><p>Use o toggle de cada dia: ON = trabalha, OFF = folga. Clique em <strong>"Salvar Dias"</strong> para registrar sem precisar preencher horários.</p></div></div>
          <div class="step"><div class="sn">2</div><div class="sc"><strong>Manual: horários completos</strong><p>Preencha entrada/saída/intervalo e clique em <strong>"Validar e Salvar Horário"</strong>. O sistema valida carga semanal (43:55–44:00), interjornada (11h), máximo 10h/dia e intervalo mínimo.</p></div></div>
          <div class="step"><div class="sn">3</div><div class="sc"><strong>Com IA: descreva em linguagem natural</strong><p>Abra o <strong>Assistente de Horários</strong> e descreva o que deseja. Ex: <em>"folgue segunda e terça, trabalhe nos outros dias dividindo 44h semanais entrando às 10"</em>. A IA preenche tudo automaticamente — revise e salve.</p></div></div>
        </div>
        <div class="ib tip"><span class="ico">💡</span><span>A escala usa os dias de trabalho/folga mesmo sem horários preenchidos. Cadastre os dias primeiro para já gerar a escala base.</span></div>
      </div>
      <div class="card"><h3>📋 Copiar de outro empregado <span class="new">NOVO</span></h3>
        <p>Na tela de edição de horário, o card <strong>"📋 Copiar horário de outro empregado"</strong> permite selecionar qualquer colega com horário cadastrado e trazer os dias e horários para o empregado atual. Os dados ficam em edição até você confirmar com "Salvar Dias" ou "Validar e Salvar Horário" — nada é salvo automaticamente.</p>
        <div class="ib tip"><span class="ico">💡</span><span>Útil para novos empregados que seguem a mesma escala de um colega: copie o horário, ajuste o que for diferente e salve.</span></div>
      </div>
      <div class="card"><h3>🤖 Assistente de IA <span class="new">NOVO</span></h3>
        <p>Descreva os horários em linguagem natural — com typos, conjugações verbais ou abreviações. O assistente entende e preenche os campos automaticamente.</p>
        <ul>
          <li><strong>Folgas:</strong> "folgue segunda e terça", "folga dom e seg"</li>
          <li><strong>Carga horária:</strong> "divida 44 horas semanais", "44h em 5 dias"</li>
          <li><strong>Entrada fixa:</strong> "entrando às 10 todo dia", "entrada 09:00"</li>
          <li><strong>Frases compostas:</strong> "folgue seg e ter, trabalhe nos outros dias dividindo 44h entrando às 10"</li>
        </ul>
        <div class="ib warn"><span class="ico">⚠️</span><span>A IA aplica as mesmas regras de validação CLT (carga semanal, interjornada, intervalo mínimo). Se a sugestão violar alguma regra, os erros são mostrados antes de salvar.</span></div>
      </div>
      <div class="card"><h3>Status na lista de empregados</h3>
        <table>
          <tr><th>Status</th><th>Significado</th></tr>
          <tr><td><span class="tag am">HORÁRIOS PENDENTES</span></td><td>Dias definidos mas sem horários — escala funciona, validação pendente</td></tr>
          <tr><td><span class="tag gr">XX:XX/sem</span></td><td>Horário completo e validado — carga semanal exibida</td></tr>
          <tr><td><span class="tag gy">Sem horário</span></td><td>Nenhum cadastro ainda</td></tr>
        </table>
      </div>
      <div class="card"><h3>Regras de validação</h3>
        <ul>
          <li><strong>Carga semanal:</strong> entre 43h55 e 44h00 contratuais (rígido)</li>
          <li><strong>Interjornada:</strong> mínimo 11h entre saída e próxima entrada</li>
          <li><strong>Máximo diário:</strong> 10h contratuais por dia</li>
          <li><strong>Intervalo mínimo:</strong> 30 minutos em jornadas acima de 6h</li>
          <li><strong>Hora noturna:</strong> 22:00–05:00 com conversão ficta (52.5min real = 60min contratual)</li>
        </ul>
      </div>
    </div>

    <div class="sec" id="comunicados">
      <div class="sh"><div class="iw">📢</div><div><h2>Comunicados <span class="new">COM IA</span></h2><p>Avisos e informações para a equipe</p></div></div>
      <div class="card"><h3>Criar comunicado</h3>
        <div class="steps">
          <div class="step"><div class="sn">1</div><div class="sc"><strong>Descreva informalmente ou use a IA</strong><p>Escreva direto ou descreva o tema no assistente IA — ele gera título e texto profissional editável.</p></div></div>
          <div class="step"><div class="sn">2</div><div class="sc"><strong>Escolha o destinatário</strong><p>Toda a equipe, áreas específicas ou empregados individuais.</p></div></div>
          <div class="step"><div class="sn">3</div><div class="sc"><strong>Publique</strong><p>Aparece imediatamente. Acompanhe confirmações de leitura na lista de enviados.</p></div></div>
        </div>
        <div class="ib green"><span class="ico">✅</span><span>Você visualiza quem leu e quem ainda não confirmou diretamente na lista de comunicados enviados.</span></div>
      </div>
      <div class="card"><h3>🗑️ Exclusão de comunicados</h3>
        <p>Gestores podem mover comunicados para a lixeira. Na lixeira, é possível restaurar ou (admin) apagar permanentemente. Comunicados na lixeira não aparecem mais para os empregados.</p>
      </div>
    </div>

    <div class="sec" id="faq">
      <div class="sh"><div class="iw">❓</div><div><h2>FAQ <span class="new">COM IA</span></h2><p>Perguntas frequentes para a equipe, com assistente de IA</p></div></div>
      <div class="card"><h3>Duas seções no FAQ do empregado</h3>
        <p>O FAQ que o empregado vê está dividido em duas seções distintas:</p>
        <ul>
          <li><strong>📐 Regras do sistema</strong> — 7 perguntas geradas <em>automaticamente</em> pelo AppTip com base nas regras reais do restaurante. Sempre atualizadas.</li>
          <li><strong>🏢 Sobre o restaurante</strong> — perguntas cadastradas por você, específicas do restaurante.</li>
        </ul>
      </div>
      <div class="card"><h3>📐 Perguntas automáticas do sistema</h3>
        <p>Visíveis para você na aba FAQ — aparece um card âmbar listando as 7 perguntas geradas automaticamente:</p>
        <ul>
          <li>💸 Como é calculada a minha gorjeta?</li>
          <li>📊 Como funciona a tabela de pontos? (ou por área)</li>
          <li>📅 Como funciona a escala e por que ela importa?</li>
                    <li>💬 Para que serve o Fale com DP?</li>
          <li>📢 Como funcionam os comunicados?</li>
          <li>🔐 O que é o PIN e como trocar?</li>
        </ul>
        <div class="ib tip"><span class="ico">💡</span><span>As perguntas sobre DP e comunicados só aparecem para o empregado se essas abas estiverem ativas nas suas configurações.</span></div>
      </div>
      <div class="card"><h3>✨ Assistente de IA <span class="new">NOVO</span></h3>
        <p>Ao criar uma nova pergunta, um campo de assistente IA aparece no formulário. Descreva informalmente o que quer comunicar e a IA redige uma versão profissional e editável.</p>
        <div class="steps">
          <div class="step"><div class="sn">1</div><div class="sc"><strong>Clique em "+ Nova Pergunta"</strong><p>O formulário abre com o assistente no topo.</p></div></div>
          <div class="step"><div class="sn">2</div><div class="sc"><strong>Descreva informalmente</strong><p>Ex: <em>"quando o empregado falta sem avisar ele perde a gorjeta do dia"</em></p></div></div>
          <div class="step"><div class="sn">3</div><div class="sc"><strong>Clique em "✨ Sugerir com IA"</strong><p>A IA gera pergunta e resposta profissional nos campos abaixo.</p></div></div>
          <div class="step"><div class="sn">4</div><div class="sc"><strong>Edite e salve</strong><p>Ajuste o texto como quiser antes de confirmar.</p></div></div>
        </div>
      </div>
      <div class="card"><h3>👁 Controle de visibilidade <span class="new">NOVO</span></h3>
        <p>Cada pergunta cadastrada tem um botão <span class="tag gr">👁 Exibindo</span> ou <span class="tag gy">🚫 Oculto</span>. Clique para alternar. Perguntas ocultas não aparecem para os empregados — útil para rascunhos ou perguntas temporariamente desativadas.</p>
      </div>
    </div>

    <div class="sec" id="dp">
      <div class="sh"><div class="iw">💬</div><div><h2>Fale com DP</h2><p>Canal com o departamento pessoal</p></div></div>
      <div class="card"><h3>Como funciona?</h3><p>Canal direto entre empregados e o gestor de DP — férias, atestados, dúvidas trabalhistas e documentos. Empregados podem enviar anonimamente.</p>
        <div class="ib blue"><span class="ico">ℹ️</span><span>Somente gestores marcados como "Gestor do DP" pelo administrador AppTip recebem essas mensagens.</span></div>
      </div>
      <div class="card"><h3>Gerenciar mensagens</h3><p>As mensagens aparecem na aba "Fale com DP". Selecione mensagens e mova para a lixeira. Na lixeira é possível restaurar ou (admin) apagar permanentemente.</p></div>
    </div>

    <div class="sec" id="caixa">
      <div class="sh"><div class="iw">📬</div><div><h2>Caixa</h2><p>Central de notificações</p></div></div>
      <div class="card"><h3>O que aparece na Caixa?</h3><p>Todas as notificações do restaurante: solicitações de alteração de horário, novas mensagens do Fale com DP e confirmações de leitura de comunicados. O número <code>📬 Caixa (3)</code> indica quantas não foram lidas.</p></div>
    </div>

    <div class="sec" id="config-abas">
      <div class="sh"><div class="iw">📋</div><div><h2>Abas Visíveis <span class="new">NOVO</span></h2><p>Escolha quais abas aparecem para você e seus empregados</p></div></div>
      <div class="card"><h3>Como acessar</h3><p>Clique em <strong>⚙️ Configurações</strong> no canto superior direito do painel do restaurante. O botão fica destacado em âmbar quando está ativo.</p></div>
      <div class="card"><h3>Sistema de dois níveis</h3>
        <table>
          <tr><th>Nível</th><th>Quem controla</th><th>O que faz</th></tr>
          <tr><td>1. Autorização</td><td>Administrador AppTip</td><td>Define quais abas o restaurante pode usar</td></tr>
          <tr><td>2. Visibilidade</td><td>Gestor (você)</td><td>Decide quais abas ativas aparecem para você e os empregados</td></tr>
        </table>
        <div class="ib tip"><span class="ico">💡</span><span>Você só pode ativar abas que o administrador autorizou. Abas bloqueadas aparecem acinzentadas com "(não autorizado pelo admin)".</span></div>
      </div>
      <div class="card"><h3>Efeito no FAQ automático</h3><p>As perguntas automáticas do FAQ se adaptam às abas ativas. Se você ocultar "Fale com DP", a pergunta sobre o DP some automaticamente do FAQ dos empregados.</p></div>
    </div>

    <div class="sec" id="config-fiscal">
      <div class="sh"><div class="iw">💰</div><div><h2>Retenção Fiscal <span class="new">ATUALIZADO</span></h2><p>Alíquota de dedução sobre gorjeta</p></div></div>
      <div class="card"><h3>Base legal — Lei 13.419/2017</h3>
        <p>A gorjeta é rendimento do trabalhador sujeito a encargos conforme a Lei 13.419/2017. A alíquota depende do regime tributário:</p>
        <table>
          <tr><th>Alíquota</th><th>Regime</th><th>Encargos</th></tr>
          <tr><td><strong>33%</strong></td><td>Lucro Real ou Presumido</td><td>INSS patronal (20%) + FGTS (8%) + RAT/terceiros (~5%). Art. 457 CLT e Lei 13.419/2017.</td></tr>
          <tr><td><strong>20%</strong></td><td>Simples Nacional (MEI, ME, EPP)</td><td>Encargos simplificados sobre folha. LC 123/2006 e Resolução CGSN 140/2018.</td></tr>
        </table>
        <div class="ib warn"><span class="ico">⚠️</span><span>Esta configuração não substitui orientação contábil. Consulte seu contador para confirmar a alíquota correta do seu estabelecimento.</span></div>
      </div>
    </div>

    <div class="sec" id="config-divisao">
      <div class="sh"><div class="iw">⚖️</div><div><h2>Divisão de Gorjeta</h2><p>Sistema de pontos global ou área + pontos</p></div></div>
      <div class="card"><h3>Dois modos disponíveis</h3>
        <table>
          <tr><th>Modo</th><th>Como funciona</th></tr>
          <tr><td><strong>Pontos Global</strong></td><td>Todos que trabalharam no dia dividem a gorjeta proporcionalmente aos pontos do cargo. Mais simples e direto.</td></tr>
          <tr><td><strong>Área + Pontos</strong></td><td>A gorjeta é dividida primeiro entre áreas (%) e depois internamente por pontos de cargo. Você define o percentual de cada área (Bar, Cozinha, Salão...).</td></tr>
        </table>
      </div>
      <div class="card"><h3>Penalidade por falta</h3>
        <p>Configure percentuais de desconto no pool mensal para empregados com faltas. A penalidade é cumulativa: cada dia de falta desconta o percentual configurado.</p>
        <table>
          <tr><th>Tipo</th><th>Como funciona</th></tr>
          <tr><td><strong>Por área</strong></td><td>Cada área (Bar, Cozinha, Salão, Limpeza) tem seu percentual de penalidade para faltas injustificadas. Padrão: 0%.</td></tr>
          <tr><td><strong>🏭 Produção (injustificada)</strong></td><td>Percentual próprio para faltas injustificadas (padrão: 6,66% por dia).</td></tr>
          <tr><td><strong>🏭 Produção (justificada)</strong></td><td>Percentual próprio para faltas justificadas (padrão: 3,33% por dia).</td></tr>
        </table>
        <div class="ib blue"><span class="ico">📐</span><span>Exemplo: pool mensal de R$10.000, empregado de produção com 2 faltas injustificadas (6,66%) + 1 justificada (3,33%) → desconto de 13,32% + 3,33% = 16,65% = R$1.665 do total de gorjetas dele no mês.</span></div>
        <div class="ib warn"><span class="ico">⚠️</span><span>Nenhum empregado recebe gorjeta durante férias, incluindo os de produção.</span></div>
      </div>
    </div>

    <div class="sec" id="permissoes">
      <div class="sh"><div class="iw">🔑</div><div><h2>Permissões</h2><p>O que cada gestor pode acessar</p></div></div>
      <div class="card"><h3>Perfis de gestor</h3>
        <p>O administrador define o perfil ao criar o gestor:</p>
        <table>
          <tr><th>Perfil</th><th>Descrição</th></tr>
          <tr><td>📬 Gestor Administrativo</td><td>Acesso completo: gorjetas, escala, cargos, equipe, comunicados, FAQ, DP e notificações. Pode criar outros gestores.</td></tr>
          <tr><td>👔 Líder Operacional</td><td>Acesso a escala e equipe apenas da(s) sua(s) área(s). Sem gorjetas, sem DP.</td></tr>
          <tr><td>⚙️ Personalizado</td><td>Permissões individuais escolhidas pelo admin.</td></tr>
        </table>
      </div>
      <div class="card"><h3>Permissões granulares (perfil personalizado)</h3>
        <table>
          <tr><th>Permissão</th><th>Dá acesso a</th></tr>
          <tr><td>💸 Gorjetas</td><td>Dashboard, aba Gorjetas, exportação</td></tr>
          <tr><td>📅 Escala</td><td>Aba Escala</td></tr>
          <tr><td>🕐 Horários</td><td>Aba Horários (se admin autorizou)</td></tr>
          <tr><td>🏷️ Cargos</td><td>Aba Cargos (se admin autorizou)</td></tr>
          <tr><td>👥 Equipe</td><td>Aba Equipe (se admin autorizou)</td></tr>
          <tr><td>📬 Gestor do DP</td><td>Aba Caixa, recebe mensagens do Fale com DP</td></tr>
        </table>
        <div class="ib tip"><span class="ico">💡</span><span>Se alguma aba não aparece, seu perfil pode não ter permissão ou o admin não autorizou. CPF é obrigatório para todos os gestores.</span></div>
      </div>
    </div>

    <div class="sec" id="privacidade-admin">
      <div class="sh"><div class="iw">🛡️</div><div><h2>Privacidade de Dados <span class="new">NOVO</span></h2><p>Controle o que a equipe de administradores pode ver</p></div></div>
      <div class="card"><h3>O que é o Modo Privacidade?</h3><p>Quando ativado, o modo privacidade oculta dados sensíveis do seu restaurante para a equipe de administradores do AppTip. Os admins continuam tendo acesso à gestão do sistema, mas não visualizam informações confidenciais da sua operação.</p></div>
      <div class="card"><h3>O que fica oculto para o admin</h3>
        <table>
          <tr><th>Dado</th><th>Visão do admin</th></tr>
          <tr><td>💸 Valores de gorjeta</td><td>Aparece como <strong>••••,••</strong></td></tr>
          <tr><td>📋 CPFs de empregados e gestores</td><td>Aparece como <strong>•••.•••.•••-••</strong></td></tr>
          <tr><td>📢 Comunicados</td><td>Conteúdo completamente oculto</td></tr>
          <tr><td>💬 Mensagens do DP</td><td>Conteúdo completamente oculto</td></tr>
          <tr><td>🔔 Notificações</td><td>Conteúdo completamente oculto</td></tr>
        </table>
        <div class="ib tip"><span class="ico">💡</span><span>O admin vê um banner indicando que o modo privacidade está ativo, garantindo transparência de que existem dados mas que estão protegidos.</span></div>
      </div>
      <div class="card"><h3>Como ativar</h3>
        <div class="steps">
          <div class="st"><span class="sn">1</span><span>Acesse <strong>⚙️ Configurações</strong></span></div>
          <div class="st"><span class="sn">2</span><span>Encontre a seção <strong>🔒 Privacidade</strong></span></div>
          <div class="st"><span class="sn">3</span><span>Ative o toggle de privacidade</span></div>
          <div class="st"><span class="sn">4</span><span>Clique em <strong>Salvar Configurações</strong></span></div>
        </div>
        <div class="ib blue"><span class="ico">ℹ️</span><span>O modo privacidade afeta apenas a visão do admin. Gestores e empregados continuam vendo todos os dados normalmente em seus respectivos portais.</span></div>
      </div>
    </div>

    <div class="sec" id="mobile-gestor">
      <div class="sh"><div class="iw">📱</div><div><h2>Acesso Mobile <span class="new">NOVO</span></h2><p>O que o gestor consegue fazer pelo celular</p></div></div>
      <div class="card"><h3>Abas no celular</h3>
        <p>No celular, o gestor tem acesso a um conjunto otimizado de abas:</p>
        <table>
          <tr><th>Aba</th><th>Funcionalidade</th></tr>
          <tr><td>📊 Dashboard</td><td>Resumo do dia, alertas, widget de gorjetas (somente leitura)</td></tr>
          <tr><td>📅 Escala</td><td>Visão semanal com navegação ◀/▶, toque para alterar status</td></tr>
          <tr><td>🕐 Horários</td><td>Edição completa + assistente de IA para gerar horários</td></tr>
          <tr><td>👥 Empregados</td><td>Lista de empregados, detalhes e trilha individual</td></tr>
          <tr><td>📋 Reuniões</td><td>Planejamento e histórico de reuniões com a equipe</td></tr>
          <tr><td>📬 Caixa</td><td>Notificações e mensagens do Fale com DP</td></tr>
        </table>
        <div class="ib tip"><span class="ico">💡</span><span>As demais funcionalidades (Gorjetas, Cargos, VT, Comunicados, FAQ, DP e Configurações) estão disponíveis apenas pelo computador.</span></div>
      </div>
    </div>

    <div class="sec" id="bloqueio">
      <div class="sh"><div class="iw">🔒</div><div><h2>Acesso Suspenso</h2><p>O que fazer quando o acesso está bloqueado</p></div></div>
      <div class="card"><h3>Por que ocorre?</h3><p>O acesso é suspenso por pendência financeira com o AppTip. Você faz login normalmente, mas ao entrar no restaurante vê a tela de bloqueio. Na seleção de restaurantes, o card aparece com <span class="tag rd">🔒 Suspenso</span>.</p></div>
      <div class="card"><h3>O que fazer</h3>
        <div class="steps">
          <div class="step"><div class="sn">1</div><div class="sc"><strong>Entre em contato com o Admin AppTip</strong><p>O número aparece na tela de bloqueio: <strong>(11) 98549-9821</strong></p></div></div>
          <div class="step"><div class="sn">2</div><div class="sc"><strong>Regularize a pendência</strong><p>Após confirmação do pagamento, o acesso é liberado automaticamente.</p></div></div>
        </div>
        <div class="ib warn"><span class="ico">⚠️</span><span>Durante a suspensão, os empregados também perdem acesso. Regularize o quanto antes para não impactar a operação.</span></div>
      </div>
    </div>

    <hr>
    <div style="text-align:center;padding:20px 0 40px;color:var(--t3);font-size:13px">
      <div style="font-size:28px;margin-bottom:8px">🍽️</div>
      <div>AppTip · Guia do Gestor · v${APP_VERSION} · Abril 2026</div>
      <div style="margin-top:4px">Dúvidas? <a href="/cdn-cgi/l/email-protection#9bf8f4f5effaeff4dbfaebebeff2ebb5faebeb" style="color:var(--ac)"><span class="__cf_email__" data-cfemail="3a5955544e5b4e557a5b4a4a4e534a145b4a4a">[email&#160;protected]</span></a> · Clientes: <strong style="color:var(--t2)">(11) 98549-9821</strong></div>
    </div>

  </div>
</div>
</div>
<script>
const secs=document.querySelectorAll('.sec'),links=document.querySelectorAll('.sidebar a');
// Highlight active sidebar link on scroll
const obs=new IntersectionObserver(e=>{e.forEach(en=>{if(en.isIntersecting){links.forEach(l=>l.classList.remove('active'));const id=en.target.id;const match=[...links].find(l=>l.getAttribute('href')==='#'+id);if(match)match.classList.add('active');}});},{rootMargin:'-20% 0px -70% 0px'});
secs.forEach(s=>obs.observe(s));
// Smooth scroll for sidebar links
links.forEach(l=>{l.addEventListener('click',e=>{e.preventDefault();const id=l.getAttribute('href')?.slice(1);const el=id&&document.getElementById(id);if(el)el.scrollIntoView({behavior:'smooth',block:'start'});});});
</script>
`;
  return (
    <iframe
      srcDoc={html}
      style={{width:"100%", height:"100vh", border:"none"}}
      title="Guia do Gestor AppTip"
    />
  );
}

//
// APP ROOT
//
export { ErrorBoundary as AppErrorBoundary };
export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("apptip_theme") || "light");
  const [showPrivacy, setShowPrivacy] = useState(false);

  useEffect(() => {
    document.body.classList.toggle("dark-mode", theme === "dark");
    localStorage.setItem("apptip_theme", theme);
  }, [theme]);

  function toggleTheme() { setTheme(t => t === "dark" ? "light" : "dark"); }

  // Global privacy modal toggle — avoids threading props through all portals
  useEffect(() => { window.__showPrivacy = () => setShowPrivacy(true); return () => { delete window.__showPrivacy; }; }, []);

  // Login unificado — uma única tela para todos
  const isSetupUrl = window.location.pathname.startsWith("/setup");
  const isFaturaUrl = window.location.pathname.startsWith("/fatura/");
  const isGuiaGestor = window.location.pathname.startsWith("/guia-gestor");
  const faturaId = isFaturaUrl ? window.location.pathname.split("/fatura/")[1] : null;

  const [view, setView] = useState(() => {
    if (isSetupUrl) return "setup";
    if (isFaturaUrl) return "fatura";
    if (isGuiaGestor) return "guia-gestor";
    const role = localStorage.getItem("apptip_role");
    if (role === "super") return "super";
    if (role === "manager") return "manager";
    if (role === "employee") return "employee";
    return "login";
  });
  const [loaded, setLoaded] = useState(false);
  const [loadProgress, setLoadProgress] = useState(""); // feedback visual durante carregamento
  const [loadError, setLoadError] = useState(false);    // true se não conseguiu conectar
  const [toast, setToast] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [currentUserId] = useState(() => {
    try { return localStorage.getItem("apptip_userid") || null; } catch { return null; }
  });
  const [userRole, setUserRole] = useState(() => localStorage.getItem("apptip_role") || null);

  // Persist session
  useEffect(() => {
    if (currentUser) localStorage.setItem("apptip_userid", currentUser.id);
    else if (userRole !== "employee") localStorage.removeItem("apptip_userid");
    // empregado: apptip_userid salvo diretamente no login via apptip_empid
  }, [currentUser, userRole]);
  useEffect(() => {
    if (userRole) localStorage.setItem("apptip_role", userRole);
    else localStorage.removeItem("apptip_role");
  }, [userRole]);

  const [owners, setOwners] = useState([]);
  const [managers,      setManagers]      = useState([]);
  const [restaurants,   setRestaurants]   = useState([]);
  const [employees,     setEmployees]     = useState([]);
  const [roles,         setRoles]         = useState([]);
  const [tips,          setTips]          = useState([]);
  const [splits,        setSplits]        = useState({});
  const [schedules,     setSchedules]     = useState({});
  const [communications,setCommunications]= useState([]);
  const [commAcks,      setCommAcks]      = useState({});
  const [faq,           setFaq]           = useState({});
  const [dpMessages,    setDpMessages]    = useState([]);
  const [workSchedules, setWorkSchedules] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [noTipDays,     setNoTipDays]     = useState({});
  const [trash,         setTrash]         = useState({ restaurants:[], managers:[], employees:[] });
  const [schedTemplates,setSchedTemplates]= useState({});
  const [schedDrafts,   setSchedDrafts]   = useState({});
  const [scheduleVersions, setScheduleVersions] = useState({});
  const [tipVersions,      setTipVersions]      = useState({});
  const [vtConfig,         setVtConfig]         = useState({});
  const [vtMonthly,        setVtMonthly]        = useState({});
  const [vtPayments,       setVtPayments]       = useState({});
  const [incidents,        setIncidents]        = useState([]);
  const [feedbacks,        setFeedbacks]        = useState([]);
  const [devChecklists,    setDevChecklists]    = useState({});
  const [scheduleAdjustments, setScheduleAdjustments] = useState({});
  const [scheduleStatus,      setScheduleStatus]      = useState({});
  const [schedulePrevista,    setSchedulePrevista]    = useState({});
  const [employeeGoals,       setEmployeeGoals]       = useState({});
  const [delays,              setDelays]              = useState({});
  const [tipApprovals,        setTipApprovals]        = useState({});
  const [meetingPlans,        setMeetingPlans]        = useState([]);

  useEffect(() => {
    const savedId = currentUserId;
    // Timeout: se demorar mais de 12s, mostra mensagem
    let slowTimer = setTimeout(() => setLoadProgress("Conexão lenta — tentando novamente..."), 6000);
    let verySlowTimer = setTimeout(() => setLoadProgress("Servidor demorando a responder... aguarde"), 12000);
    (async () => {
      setLoadProgress("Conectando ao servidor...");
      const allKeys = Object.values(K);
      const keyNames = Object.keys(K);

      // Carregar em paralelo com tracking
      let loadedCount = 0;
      const totalKeys = allKeys.length;
      const vals = await Promise.all(allKeys.map(async (k) => {
        const result = await load(k);
        loadedCount++;
        if (loadedCount <= 3) setLoadProgress("Conectando ao servidor...");
        else setLoadProgress(`Carregando dados... ${Math.round((loadedCount/totalKeys)*100)}%`);
        return result;
      }));

      clearTimeout(slowTimer);
      clearTimeout(verySlowTimer);
      setLoadProgress("Preparando o sistema...");

      const keys = keyNames;
      const map = { owners:setOwners, managers:setManagers, restaurants:setRestaurants, employees:setEmployees, roles:setRoles, tips:setTips, splits:setSplits, schedules:setSchedules, communications:setCommunications, commAcks:setCommAcks, faq:setFaq, dpMessages:setDpMessages, workSchedules:setWorkSchedules, notifications:setNotifications, noTipDays:setNoTipDays, trash:setTrash, schedTemplates:setSchedTemplates, schedDrafts:setSchedDrafts, scheduleVersions:setScheduleVersions, tipVersions:setTipVersions, vtConfig:setVtConfig, vtMonthly:setVtMonthly, vtPayments:setVtPayments, incidents:setIncidents, feedbacks:setFeedbacks, devChecklists:setDevChecklists, scheduleAdjustments:setScheduleAdjustments, scheduleStatus:setScheduleStatus, schedulePrevista:setSchedulePrevista, employeeGoals:setEmployeeGoals, delays:setDelays, tipApprovals:setTipApprovals, meetingPlans:setMeetingPlans };
      const loaded_data = {};
      let successCount = 0;
      keys.forEach((k, i) => {
        if (k !== "receipts" && vals[i]) { map[k]?.(vals[i]); loaded_data[k] = vals[i]; successCount++; }
      });

      // Se nenhuma key carregou com sucesso, marca como erro de conexão
      _loadSuccess = successCount > 0;
      if (!_loadSuccess) setLoadError(true);

      // Migração automática: v4:superManagers → v4:owners (executa só uma vez)
      if (!loaded_data.owners || loaded_data.owners.length === 0) {
        const migrated = localStorage.getItem("apptip_migrated_owners");
        if (!migrated) {
          const oldData = await load("v4:superManagers");
          if (oldData && oldData.length > 0) {
            console.log("Migrando superManagers → owners...", oldData.length, "registros");
            const migratedData = oldData.map((o, i) => i === 0 ? {...o, isMaster: true} : o);
            await save(K.owners, migratedData);
            setOwners(migratedData);
            loaded_data.owners = migratedData;
            localStorage.setItem("apptip_migrated_owners", "1");
          }
        }
      }

      if (savedId || localStorage.getItem("apptip_empid")) {
        const role = localStorage.getItem("apptip_role");
        if (role === "super") {
          const u = (loaded_data.owners ?? []).find(s => s.id === savedId);
          if (u) setCurrentUser(u);
          else { localStorage.removeItem("apptip_userid"); localStorage.removeItem("apptip_role"); setView("login"); }
        } else if (role === "manager") {
          const u = (loaded_data.managers ?? []).find(m => m.id === savedId);
          if (u) setCurrentUser(u);
          else { localStorage.removeItem("apptip_userid"); localStorage.removeItem("apptip_role"); setView("login"); }
        } else if (role === "employee") {
          const empIdSaved = localStorage.getItem("apptip_empid") || savedId;
          const u = (loaded_data.employees ?? []).find(e => e.id === empIdSaved);
          if (!u || (u.inactive && u.inactiveFrom && u.inactiveFrom <= today())) {
            // Sessão inválida — limpa tudo
            localStorage.removeItem("apptip_userid");
            localStorage.removeItem("apptip_role");
            localStorage.removeItem("apptip_empid");
            setView("login");
          } else {
            // Garante que userid está salvo
            localStorage.setItem("apptip_userid", empIdSaved);
            // sessão válida — view já está como "employee" pelo useState inicial
          }
        }
      }
      // Limpeza automática da lixeira — itens com mais de 30 dias
      if (loaded_data.trash) {
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const cleanTrash = {
          restaurants: (loaded_data.trash.restaurants??[]).filter(x => x.deletedAt > cutoff),
          managers:    (loaded_data.trash.managers??[]).filter(x => x.deletedAt > cutoff),
          employees:   (loaded_data.trash.employees??[]).filter(x => x.deletedAt > cutoff),
        };
        const totalOriginal = (loaded_data.trash.restaurants?.length??0)+(loaded_data.trash.managers?.length??0)+(loaded_data.trash.employees?.length??0);
        const totalClean = cleanTrash.restaurants.length+cleanTrash.managers.length+cleanTrash.employees.length;
        if (totalClean < totalOriginal) {
          await save(K.trash, cleanTrash);
          setTrash(cleanTrash);
        }
      }

      // Migração: cargos da área "Produção" → "Cozinha"
      const rolesWithProd = (loaded_data.roles ?? []).filter(r => r.area === "Produção");
      if (rolesWithProd.length > 0) {
        const migratedRoles = (loaded_data.roles ?? []).map(r => r.area === "Produção" ? {...r, area: "Cozinha"} : r);
        await save(K.roles, migratedRoles);
        setRoles(migratedRoles);
        console.log(`Migrados ${rolesWithProd.length} cargo(s) de Produção → Cozinha`);
      }

      // Migração: empregados sem empCode ou sem PIN
      {
        const allEmps = loaded_data.employees ?? [];
        const rests = loaded_data.restaurants ?? [];
        const needsFix = allEmps.filter(e => !e.empCode || !e.pin);
        if (needsFix.length > 0) {
          let fixed = [...allEmps];
          needsFix.forEach(emp => {
            const rest = rests.find(r => r.id === emp.restaurantId);
            const code = rest?.shortCode ?? "XXX";
            const idx = fixed.findIndex(e => e.id === emp.id);
            if (idx < 0) return;
            if (!fixed[idx].empCode) {
              const seq = nextEmpSeq(fixed, code);
              fixed[idx] = { ...fixed[idx], empCode: makeEmpCode(code, seq) };
            }
            if (!fixed[idx].pin) {
              const cpfDigits = (emp.cpf ?? "").replace(/\D/g, "");
              fixed[idx] = { ...fixed[idx], pin: cpfDigits.slice(0, 4).padEnd(4, "0") };
            }
          });
          await save(K.employees, fixed);
          setEmployees(fixed);
          console.log(`Migrados ${needsFix.length} empregado(s) sem empCode/PIN`);
        }
      }

      // Auto-inativar empregados demitidos cujo mês de demissão já passou
      {
        const allEmps = loaded_data.employees ?? [];
        const currentMonth = today().slice(0,7); // "YYYY-MM"
        const demitidosParaInativar = allEmps.filter(e => e.demitidoEm && !e.inactive && e.demitidoEm.slice(0,7) < currentMonth);
        if (demitidosParaInativar.length > 0) {
          const updated = allEmps.map(e =>
            e.demitidoEm && !e.inactive && e.demitidoEm.slice(0,7) < currentMonth
              ? { ...e, inactive: true, inactiveFrom: e.demitidoEm }
              : e
          );
          await save(K.employees, updated);
          setEmployees(updated);
          console.log(`Auto-inativados ${demitidosParaInativar.length} empregado(s) demitido(s)`);
        }
      }

      // Auto-aplicar promoções agendadas cuja data efetiva chegou
      {
        const allEmps = loaded_data.employees ?? [];
        const promos = allEmps.filter(e => e.pendingRoleChange && e.pendingRoleChange.effectiveDate <= today());
        if (promos.length > 0) {
          const updated = allEmps.map(e => {
            if (!e.pendingRoleChange || e.pendingRoleChange.effectiveDate > today()) return e;
            const prc = e.pendingRoleChange;
            const history = [...(e.roleHistory ?? []), { fromRoleId: e.roleId, toRoleId: prc.newRoleId, date: prc.effectiveDate, reason: prc.reason || "Promoção programada", changedBy: prc.changedBy }];
            const copy = { ...e, roleId: prc.newRoleId, roleHistory: history };
            delete copy.pendingRoleChange;
            return copy;
          });
          await save(K.employees, updated);
          setEmployees(updated);
          loaded_data.employees = updated;
          console.log(`Auto-aplicadas ${promos.length} promoção(ões) agendada(s)`);
        }
      }

      setLoadProgress("");
      setLoaded(true);
    })();
    return () => { clearTimeout(slowTimer); clearTimeout(verySlowTimer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const data = { owners, managers, restaurants, employees, roles, tips, splits, schedules, communications, commAcks, faq, dpMessages, workSchedules, notifications, noTipDays, trash, schedTemplates, schedDrafts, scheduleVersions, tipVersions, vtConfig, vtMonthly, vtPayments, incidents, feedbacks, devChecklists, scheduleAdjustments, scheduleStatus, schedulePrevista, employeeGoals, delays, tipApprovals, meetingPlans };

  async function handleUpdate(field, value) {
    if (field === "_toast") { setToast(value); return; }
    const setters = { owners:setOwners, managers:setManagers, restaurants:setRestaurants, employees:setEmployees, roles:setRoles, tips:setTips, splits:setSplits, schedules:setSchedules, communications:setCommunications, commAcks:setCommAcks, faq:setFaq, dpMessages:setDpMessages, workSchedules:setWorkSchedules, notifications:setNotifications, noTipDays:setNoTipDays, trash:setTrash, schedTemplates:setSchedTemplates, schedDrafts:setSchedDrafts, scheduleVersions:setScheduleVersions, tipVersions:setTipVersions, vtConfig:setVtConfig, vtMonthly:setVtMonthly, vtPayments:setVtPayments, incidents:setIncidents, feedbacks:setFeedbacks, devChecklists:setDevChecklists, scheduleAdjustments:setScheduleAdjustments, scheduleStatus:setScheduleStatus, schedulePrevista:setSchedulePrevista, employeeGoals:setEmployeeGoals, delays:setDelays, tipApprovals:setTipApprovals, meetingPlans:setMeetingPlans };
    const keys    = { owners:K.owners, managers:K.managers, restaurants:K.restaurants, employees:K.employees, roles:K.roles, tips:K.tips, splits:K.splits, schedules:K.schedules, communications:K.communications, commAcks:K.commAcks, faq:K.faq, dpMessages:K.dpMessages, workSchedules:K.workSchedules, notifications:K.notifications, noTipDays:K.noTipDays, trash:K.trash, schedTemplates:K.schedTemplates, schedDrafts:K.schedDrafts, scheduleVersions:K.scheduleVersions, tipVersions:K.tipVersions, vtConfig:K.vtConfig, vtMonthly:K.vtMonthly, vtPayments:K.vtPayments, incidents:K.incidents, feedbacks:K.feedbacks, devChecklists:K.devChecklists, scheduleAdjustments:K.scheduleAdjustments, scheduleStatus:K.scheduleStatus, schedulePrevista:K.schedulePrevista, employeeGoals:K.employeeGoals, delays:K.delays, tipApprovals:K.tipApprovals, meetingPlans:K.meetingPlans };
    // Support functional updates to prevent stale-state race conditions:
    // When value is a function, it receives the latest state (like setState(prev => ...))
    let resolvedValue;
    if (typeof value === 'function') {
      setters[field]?.(prev => {
        resolvedValue = value(prev);
        return resolvedValue;
      });
    } else {
      resolvedValue = value;
      setters[field]?.(value);
    }
    if (keys[field]) {
      const ok = await save(keys[field], resolvedValue);
      if (!ok) {
        setToast("Erro ao salvar — tente novamente");
        return;
      }
    }
    const labels = { owners:"Admins atualizados", managers:"Gestores atualizados", restaurants:"Restaurantes atualizados", employees:"Empregados atualizados", roles:"Cargos atualizados", tips:"Gorjetas atualizadas", splits:"Percentuais salvos", schedules:"Escala atualizada", communications:"Comunicados atualizados", commAcks:"Ciências atualizadas", faq:"FAQ atualizado", dpMessages:"Mensagem enviada", workSchedules:"Horários salvos", notifications:"Notificações atualizadas", schedTemplates:"Template salvo", schedDrafts:"Rascunho salvo", trash:"Lixeira atualizada", noTipDays:"Dias sem gorjeta atualizados", scheduleVersions:null, tipVersions:null, vtConfig:null, vtMonthly:null, vtPayments:"VT registrado", incidents:"Ocorrência registrada", feedbacks:"Feedback registrado", devChecklists:"Checklist atualizado", scheduleAdjustments:null, scheduleStatus:null, schedulePrevista:null, employeeGoals:"Objetivo atualizado", delays:"Atrasos atualizados", tipApprovals:null };
    if (labels[field] === null) return; // silent save (e.g. version snapshots)
    setToast(labels[field] ?? (typeof value === "string" ? value : "Salvo!"));
  }

  function doLogout() {
    setCurrentUser(null);
    setUserRole(null);
    localStorage.removeItem("apptip_selrest");
    localStorage.removeItem("apptip_userid");
    localStorage.removeItem("apptip_role");
    localStorage.removeItem("apptip_empid");
    setView("login");
  }

  // Fallback: se carregou mas sessão ficou sem usuário, redireciona pro login
  useEffect(() => {
    if (loaded && !currentUser && (view === "super" || view === "manager")) {
      console.warn("Sessão inválida: view="+view+" sem currentUser. Redirecionando para login.");
      doLogout();
    }
  }, [loaded, currentUser, view]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loaded) return (
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16,padding:24}}>
      <div style={{fontSize:40}}>🍽️</div>
      {loadError ? (
        <div style={{textAlign:"center",fontFamily:"'DM Sans',sans-serif",maxWidth:360}}>
          <div style={{color:"var(--red,#e74c3c)",fontSize:15,fontWeight:700,marginBottom:8}}>Erro de conexão</div>
          <div style={{color:"var(--text3,#888)",fontSize:13,marginBottom:16}}>Não foi possível conectar ao servidor. Verifique sua conexão com a internet e tente novamente.</div>
          <button onClick={()=>window.location.reload()}
            style={{padding:"10px 24px",borderRadius:10,background:"var(--ac,#d4a017)",border:"none",color:"#fff",fontWeight:700,cursor:"pointer",fontSize:14,fontFamily:"'DM Sans',sans-serif"}}>
            Tentar novamente
          </button>
        </div>
      ) : (
        <div style={{textAlign:"center",fontFamily:"'DM Sans',sans-serif"}}>
          <div style={{color:"var(--text3,#888)",fontSize:15,marginBottom:8,animation:"pulse 1.5s ease-in-out infinite"}}>
            {loadProgress || "Carregando…"}
          </div>
          {loadProgress && loadProgress.includes("lenta") && (
            <div style={{color:"var(--text3,#888)",fontSize:12,marginTop:4}}>
              Isso pode levar alguns segundos em conexões lentas
            </div>
          )}
        </div>
      )}
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
    </div>
  );

  return (
    <>
      {view === "login" && (
        <UnifiedLogin
          owners={owners} managers={managers} employees={employees} restaurants={restaurants}
          dataLoaded={_loadSuccess}
          onLoginOwner={u=>{setCurrentUser(u);setUserRole("super");setView("super");}}
          onLoginManager={u=>{setCurrentUser(u);setUserRole("manager");setView("manager");}}
          onLoginEmployee={u=>{
            localStorage.setItem("apptip_role", "employee");
            localStorage.setItem("apptip_userid", u.id);
            localStorage.setItem("apptip_empid", u.id);
            setUserRole("employee");
            setView("employee");
          }}
          onGoHome={()=>setView("home")}
          toggleTheme={toggleTheme} theme={theme}
        />
      )}
      {/* Setup acessível apenas via /setup — protegido por senha de convite */}
      {view === "setup" && <FirstSetup onDone={sm=>{handleUpdate("owners",[...owners,sm]);setCurrentUser(sm);setUserRole("super");setView("super");}} />}
      {view === "super" && currentUser && <OwnerPortal data={data} onUpdate={handleUpdate} onBack={doLogout} currentUser={currentUser} toggleTheme={toggleTheme} theme={theme} />}
      {view === "manager" && currentUser && (currentUser.mustChangePin ? (
        <ManagerPinChange manager={currentUser} onDone={newPin=>{
          const updated = {...currentUser, pin:newPin, mustChangePin:false};
          const next = managers.map(m=>m.id===updated.id?updated:m);
          handleUpdate("managers",next);
          setCurrentUser(updated);
        }} onBack={doLogout} />
      ) : (
        <ManagerPortal manager={currentUser} data={data} onUpdate={handleUpdate} onBack={doLogout} toggleTheme={toggleTheme} theme={theme}
          onSwitchToEmployee={(() => {
            const cpf = currentUser?.cpf?.replace(/\D/g,"");
            let emp = cpf ? employees.find(e => e.cpf?.replace(/\D/g,"") === cpf && !(e.inactive && e.inactiveFrom && e.inactiveFrom <= today())) : null;
            // Fallback: match por linkedEmpId do gestor
            if (!emp && currentUser?.linkedEmpId) emp = employees.find(e => e.id === currentUser.linkedEmpId && !(e.inactive && e.inactiveFrom && e.inactiveFrom <= today()));
            // Fallback: match por nome exato nos restaurantes do gestor
            if (!emp && currentUser?.name) {
              const mgrRids = currentUser.restaurantIds ?? (currentUser.restaurantId ? [currentUser.restaurantId] : []);
              emp = employees.find(e => e.name === currentUser.name && mgrRids.includes(e.restaurantId) && !(e.inactive && e.inactiveFrom && e.inactiveFrom <= today()));
            }
            if (!emp) return null;
            return () => { setCurrentUser(emp); setUserRole("employee"); localStorage.setItem("apptip_role","employee"); localStorage.setItem("apptip_userid",emp.id); localStorage.setItem("apptip_empid",emp.id); setView("employee"); };
          })()} />
      ))}
      {view === "employee" && <EmployeePortal employees={employees} roles={roles} tips={tips} schedules={schedules} splits={splits} restaurants={restaurants} communications={communications} commAcks={commAcks} faq={faq} dpMessages={dpMessages} workSchedules={workSchedules} incidents={incidents} feedbacks={feedbacks} devChecklists={devChecklists} employeeGoals={employeeGoals} tipApprovals={tipApprovals} delays={delays} meetingPlans={meetingPlans} onBack={doLogout} onUpdateEmployee={emp=>{const next=employees.map(e=>e.id===emp.id?emp:e);handleUpdate("employees",next);}} onUpdate={handleUpdate} toggleTheme={toggleTheme} theme={theme}
        onSwitchToManager={(() => {
          const cpf = currentUser?.cpf?.replace(/\D/g,"");
          let mgr = cpf ? managers.find(m => m.cpf?.replace(/\D/g,"") === cpf) : null;
          // Fallback: match por linkedManagerId do empregado
          if (!mgr && currentUser?.linkedManagerId) mgr = managers.find(m => m.id === currentUser.linkedManagerId);
          // Fallback: match por nome exato no mesmo restaurante
          if (!mgr && currentUser?.name) {
            mgr = managers.find(m => m.name === currentUser.name && (m.restaurantIds ?? []).includes(currentUser.restaurantId));
          }
          if (!mgr) return null;
          return () => { setCurrentUser(mgr); setUserRole("manager"); localStorage.setItem("apptip_role","manager"); localStorage.setItem("apptip_userid",mgr.id); setView("manager"); };
        })()} />}
      {view === "fatura" && <FaturaPage faturaId={faturaId} restaurants={restaurants} onUpdate={handleUpdate} loaded={loaded} />}
      {view === "guia-gestor" && <GuiaGestor />}
      {view === "home" && <Home onLogin={()=>setView("login")} />}
      <Toast msg={toast} onClose={()=>setToast("")} />
      {/* Rodapé de versão */}
      <div style={{position:"fixed",bottom:8,left:0,right:0,fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace",opacity:0.45,pointerEvents:"none",zIndex:100,textAlign:"center"}}>v{APP_VERSION}</div>

      <PrivacyModal open={showPrivacy} onClose={()=>setShowPrivacy(false)} />
    </>
  );
}

