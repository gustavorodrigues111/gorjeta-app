// AppTip v4.7 — 2026-04-11j — fix: AI escala (Gemini+Groq fallback, normalização IDs, deep copy schedules)
import { useState, useEffect } from "react";
import { db } from "./firebase";
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from "firebase/firestore";

/* eslint-disable no-unused-vars */
//
async function load(key) {
  try {
    const snap = await getDoc(doc(db, "appdata", key));
    return snap.exists() ? snap.data().value : null;
  } catch (e) { console.error("load error", e); return null; }
}
async function save(key, value, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await setDoc(doc(db, "appdata", key), { value });
      return;
    } catch (e) {
      console.error(`save error (tentativa ${i+1}):`, e);
      if (i < retries - 1) await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

// Receipts stored per-document to avoid Firestore 1MB limit
async function saveReceipt(receipt) {
  try {
    await setDoc(doc(db, "receipts", receipt.id), receipt);
  } catch (e) { console.error("saveReceipt error", e); }
}
async function deleteReceipt(id) {
  try {
    await deleteDoc(doc(db, "receipts", id));
  } catch (e) { console.error("deleteReceipt error", e); }
}
async function loadReceipts() {
  try {
    const snap = await getDocs(collection(db, "receipts"));
    return snap.docs.map(d => d.data());
  } catch (e) { console.error("loadReceipts error", e); return []; }
}

//
const fmt = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);
const fmtBR = (v) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v ?? 0);
const fmtDate = (d) => d ? new Date(d + "T12:00:00").toLocaleDateString("pt-BR") : "—";
const today = () => new Date().toISOString().slice(0, 10);
const maskCpf = (v) => { const d = (v ?? "").replace(/\D/g,"").slice(0,11); if(d.length<=3) return d; if(d.length<=6) return `${d.slice(0,3)}.${d.slice(3)}`; if(d.length<=9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`; return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9,11)}`; };
const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
const monthLabel = (y, m) => new Date(y, m, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const AREAS = ["Bar", "Cozinha", "Salão", "Limpeza", "Produção"];
const AREA_COLORS = { Bar: "#3b82f6", Cozinha: "#f59e0b", Salão: "var(--green)", Limpeza: "#8b5cf6", "Produção": "#ec4899" };
const DEFAULT_SPLIT = { Bar: 12, Cozinha: 35, Salão: 35, Limpeza: 8, "Produção": 10 };
const TAX = 0.33;
const DAY_OFF       = "off";    // folga programada
const DAY_COMP      = "comp";   // compensacao banco de horas
const DAY_VACATION  = "vac";    // ferias
const DAY_FAULT_J   = "faultj"; // falta justificada
const DAY_FAULT_U   = "faultu"; // falta injustificada

// eslint-disable-next-line no-unused-vars
const DAY_LABELS = {
  [DAY_OFF]:      { label: "Folga",          color: "var(--red)" },
  [DAY_COMP]:     { label: "Compensação",    color: "#3b82f6" },
  [DAY_VACATION]: { label: "Férias",         color: "#8b5cf6" },
  [DAY_FAULT_J]:  { label: "Falta Just.",    color: "#f59e0b" },
  [DAY_FAULT_U]:  { label: "Falta Injust.",  color: "var(--red)" },
};
// Days that count for gorjeta
const DAYS_EARN_TIP = new Set([DAY_COMP]);
// eslint-disable-next-line no-unused-vars
const DAYS_NO_TIP   = new Set([DAY_OFF, DAY_VACATION, DAY_FAULT_J, DAY_FAULT_U]);

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
  receipts:      "v4:receipts",
  workSchedules: "v4:workSchedules",
  notifications: "v4:notifications",
  noTipDays:     "v4:noTipDays",
  trash:         "v4:trash",           // {restaurants:[], managers:[], employees:[]}
};

//
const ac = "#d4a017";
const S = {
  input: { width:"100%", boxSizing:"border-box", padding:"11px 14px", borderRadius:10, border:"1px solid var(--border)", background:"var(--input-bg)", color:"var(--text)", fontSize:14, fontFamily:"'DM Sans',sans-serif", outline:"none" },
  btnPrimary: { width:"100%", padding:"12px", borderRadius:12, background:ac, border:"none", color:"var(--text)", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" },
  btnSecondary: { padding:"8px 18px", borderRadius:10, border:"1px solid var(--border)", background:"transparent", color:"var(--text2)", cursor:"pointer", fontFamily:"'DM Sans',sans-serif", fontSize:13 },
  card: { background:"var(--card-bg)", borderRadius:16, padding:"18px 20px", border:"1px solid var(--border)" },
  label: { color:"var(--text3)", fontSize:12, marginBottom:4, display:"block", fontWeight:500 },
  mono: { fontFamily:"'DM Mono',monospace" },
};

//
function Toast({ msg, onClose }) {
  useEffect(() => { if (msg) { const t = setTimeout(onClose, 3200); return () => clearTimeout(t); } }, [msg, onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!msg) return null;
  return <div style={{ position:"fixed", bottom:32, left:"50%", transform:"translateX(-50%)", background:"var(--text)", color:"var(--bg)", padding:"12px 28px", borderRadius:40, fontFamily:"'DM Sans',sans-serif", fontWeight:600, fontSize:14, boxShadow:"0 8px 32px rgba(0,0,0,.15)", zIndex:9999, whiteSpace:"nowrap" }}>{msg}</div>;
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.4)", zIndex:8000, display:"flex", alignItems:"center", justifyContent:"center", padding:16, overflowY:"auto" }}>
      <div style={{ background:"var(--card-bg)", borderRadius:20, padding:28, width:"100%", maxWidth:wide?680:480, border:"1px solid var(--border)", maxHeight:"92vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,.15)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <h3 style={{ color:"var(--text)", margin:0, fontFamily:"'DM Sans',sans-serif", fontSize:17, fontWeight:700 }}>{title}</h3>
          <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--text3)", fontSize:20, cursor:"pointer" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
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

function PermBadge({ label, on }) {
  if (!on) return null;
  return <span style={{ background:"var(--green-bg)", color:"var(--green)", borderRadius:6, padding:"2px 10px", fontSize:11, fontWeight:700 }}>✓ {label}</span>;
}

//
function CalendarGrid({ year, month, dayMap, onDayClick, readOnly }) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++)
    cells.push(`${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`);

  const colorOf = (dateStr) => {
    if (!dateStr) return null;
    const s = dayMap?.[dateStr];
    if (s === DAY_OFF)      return { bg: "#e74c3c22", border: "var(--red)",  text: "var(--red)"  };
    if (s === DAY_COMP)     return { bg: "#3b82f622", border: "#3b82f6",  text: "#3b82f6"  };
    if (s === DAY_VACATION) return { bg: "#8b5cf622", border: "#8b5cf6",  text: "#8b5cf6"  };
    if (s === DAY_FAULT_J)  return { bg: "#f59e0b22", border: "#f59e0b",  text: "#f59e0b"  };
    if (s === DAY_FAULT_U)  return { bg: "#ef444422", border: "var(--red)",  text: "var(--red)"  };
    return { bg: "#10b98122", border: "var(--green)", text: "var(--green)" };
  };

  const LEGEND = [
    ["var(--green)", "Trabalho"],
    ["var(--red)", "Folga"],
    ["#3b82f6", "Compensação"],
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
          return (
            <button key={dateStr} onClick={() => !readOnly && onDayClick && onDayClick(dateStr)}
              style={{ aspectRatio: "1", borderRadius: 8, border: `1px solid ${col.border}`, background: col.bg, color: col.text, cursor: readOnly ? "default" : "pointer", fontFamily: "'DM Mono',monospace", fontSize: 12, fontWeight: 600, padding: 0 }}>
              {d}
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

// Cycle order: work > off > comp > vacation > faultJ > faultU > work
const DAY_CYCLE = [DAY_OFF, DAY_COMP, DAY_VACATION, DAY_FAULT_J, DAY_FAULT_U];

function ScheduleCalendar({ empId, restaurantId, year, month, schedules, onUpdate }) {
  const mk = monthKey(year, month);
  const dayMap = schedules?.[restaurantId]?.[mk]?.[empId] ?? {};
  function cycleDay(dateStr) {
    const cur = dayMap[dateStr];
    const idx = DAY_CYCLE.indexOf(cur);
    const next = idx === DAY_CYCLE.length - 1 ? null : DAY_CYCLE[idx + 1];
    const newMap = { ...dayMap };
    if (next === null) delete newMap[dateStr]; else newMap[dateStr] = next;
    onUpdate("schedules", {
      ...schedules,
      [restaurantId]: { ...(schedules?.[restaurantId] ?? {}), [mk]: { ...(schedules?.[restaurantId]?.[mk] ?? {}), [empId]: newMap } }
    });
  }
  return <CalendarGrid year={year} month={month} dayMap={dayMap} onDayClick={cycleDay} />;
}

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
      doc.save(`gorjetas_${restaurant.name}_${dateFrom}_${dateTo}.pdf`);
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
    if (c.restaurantId !== restaurantId) return false;
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
  const splitType = rest?.splitType ?? "points";
  const ac = "var(--ac)";

  const now = new Date();
  const mk = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const curSplit = splits?.[restaurantId]?.[mk] ?? { Bar:12, Cozinha:35, Salão:35, Limpeza:8, "Produção":10 };

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
        const vpp = totalPontos > 0 ? EX/totalPontos : 0;
        const bruto = vpp * pontosCargo;
        const liq = bruto * (1-taxRate);
        return `A gorjeta é distribuída entre todos que trabalharam no dia, conforme a escala e os pontos do cargo.

📌 Seu cargo: ${empRole.name} — ${pontosCargo} ponto${pontosCargo!==1?"s":""}
📌 Dedução: ${taxLabel}

Passo a passo:
1. Gestor lança o valor total do dia
2. Sistema soma pontos de quem trabalhou
3. Divide o total pelos pontos → valor por ponto
4. Multiplica pelos seus pontos → bruto
5. Deduz ${(taxRate*100).toFixed(0)}% → líquido

Exemplo (gorjeta R$${fmtR(EX)}, ${totalPontos}pt no total):
• Valor por ponto: R$${fmtR(vpp)}
• Seus ${pontosCargo}pt → R$${fmtR(bruto)} bruto
• Após ${(taxRate*100).toFixed(0)}% → R$${fmtR(liq)} líquido`;
      })(),
    },
    {
      id:"__sistema__",
      q: splitType==="area" ? "🏢 Como funciona a divisão por área e pontos?" : "📊 Como funciona a tabela de pontos?",
      a:(() => {
        if (splitType==="area") {
          const AREAS = ["Bar","Cozinha","Salão","Limpeza","Produção"];
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
          return `Sistema: Área + Pontos\nA gorjeta é dividida primeiro por área (%), depois por pontos internamente.\n\nDistribuição:\n${linhas}${restRolesSemGorjeta.length>0?"\n\nSem gorjeta: "+restRolesSemGorjeta.map(r=>r.name).join(", "):""}\n\nSua situação (área: ${empArea}):\n• ${empArea} recebe ${pctArea}% → R$${fmtR(pool)} (de R$${fmtR(EX)})\n• Você tem ${pontosCargo}pt de ${totalPtsArea}pt da área\n• Bruto: R$${fmtR(bruto)} → Líquido: R$${fmtR(bruto*(1-taxRate))}`;
        } else {
          const linhas = restRolesComGorjeta
            .sort((a,b)=>(parseFloat(b.points)||0)-(parseFloat(a.points)||0))
            .map(r=>{
              const pct = totalPontos>0 ? ((parseFloat(r.points)||0)/totalPontos*100).toFixed(1):"0";
              const d = r.id===empRole?.id?" ◄ você":"";
              return `• ${r.name}: ${r.points}pt (${pct}%)${d}`;
            }).join("\n");
          return `Sistema: Pontos Global\nTodos que trabalharam no dia dividem a gorjeta proporcionalmente aos pontos do cargo.\n\nTabela de cargos:\n${linhas}${restRolesSemGorjeta.length>0?"\n\nSem gorjeta: "+restRolesSemGorjeta.map(r=>r.name).join(", "):""}\n\nTotal de pontos (todos presentes): ${totalPontos}pt\nQuanto maior a pontuação, maior a fatia da gorjeta.`;
        }
      })(),
    },
    {
      id:"__escala__",
      tabKey: "escala",
      q:"📅 Como funciona a escala e por que ela importa?",
      a:"A escala registra sua presença em cada dia e define diretamente se você recebe gorjeta.\n\nVocê recebe gorjeta quando:\n✅ Trabalhando normalmente\n✅ Compensação de banco de horas (C)\n\nVocê NÃO recebe gorjeta quando:\n❌ Folga\n❌ Falta injustificada (F) — além de não receber, pode haver uma penalidade descontada da gorjeta do mês, caso o restaurante tenha essa regra ativa\n❌ Falta justificada (FJ)\n❌ Atestado médico (A)\n❌ Férias (V)\n\nSe notar algum erro na sua escala, avise o gestor o quanto antes — erros afetam diretamente o valor que você recebe.",
    },
    {
      id:"__recibos__",
      tabKey: "recibos",
      q:"📄 Como acesso meus recibos de gorjeta?",
      a:"Na aba Recibos do aplicativo você encontra todos os seus recibos. O gestor faz o upload e ficam disponíveis aqui para você.\n\nOs recibos podem incluir:\n• Gorjeta mensal\n• Adiantamento salarial\n• Pagamento de férias\n• Décimo terceiro salário\n• Outros pagamentos\n\nSe algum recibo não aparecer, fale com o gestor.",
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
        <button onClick={()=>document.getElementById("apptip-privacy").style.display="flex"} style={{display:"block",marginTop:8,background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:11,padding:0,textDecoration:"underline"}}>
          Ver Política de Privacidade completa
        </button>
      </div>
    </div>
  );
}

//
// COMUNICADOS MANAGER TAB (manager/super view)
//
function ComunicadosManagerTab({ restaurantId, communications, commAcks, employees, onUpdate, currentManagerName }) {
  const myComms = communications.filter(c => c.restaurantId === restaurantId && !c.autoSchedule)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const restEmps = employees.filter(e => e.restaurantId === restaurantId && !(e.inactive && e.inactiveFrom && e.inactiveFrom <= today()));
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody]   = useState("");
  const [selComm, setSelComm] = useState(null);
  const [selAreas, setSelAreas] = useState([]);
  const [selEmps, setSelEmps] = useState([]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const ac = "var(--ac)";

  async function handleAiSuggest() {
    if (!aiInput.trim()) return;
    setAiLoading(true); setAiError("");
    try {
      const prompt = `Você é um assistente especializado em comunicação interna de restaurantes. O gestor quer enviar um comunicado para sua equipe. Baseado na descrição informal abaixo, redija um comunicado profissional, claro e direto para os empregados de um restaurante.

Descrição do gestor: "${aiInput.trim()}"

Responda APENAS com um JSON válido no formato:
{"titulo": "título claro e objetivo", "corpo": "texto completo do comunicado, claro e profissional"}

Sem markdown, sem explicações, apenas o JSON.`;
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.1,responseMimeType:"application/json"}})
      });
      const data = await res.json();
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const result = JSON.parse(raw.replace(/```json|```/g,"").trim());
      setTitle(result.titulo); setBody(result.corpo); setAiInput("");
    } catch(e) {
      setAiError("Não foi possível gerar sugestão. Tente novamente.");
    }
    setAiLoading(false);
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

  function remove(id) {
    onUpdate("communications", communications.filter(c => c.id !== id));
    const newAcks = { ...commAcks };
    delete newAcks[id];
    onUpdate("commAcks", newAcks);
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
          // Filter to target employees only
          const targetEmps = !c.target || c.target === "all" ? restEmps
            : c.target.startsWith("emp:") ? restEmps.filter(e => `emp:${e.id}` === c.target)
            : c.target.startsWith("area:") ? restEmps.filter(e => { const r = employees.find(x=>x.id===e.id); return true; }) // area filter below
            : restEmps;
          const areaFilter = c.target?.startsWith("area:") ? c.target.replace("area:","") : null;
          const finalEmps = areaFilter ? restEmps.filter(e => {
            // need roles from props - use employees directly
            return true; // simplified, will show all for area (ack table)
          }) : targetEmps;
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
                <span style={{color:"var(--ac-text)",fontWeight:700,fontSize:13}}>Assistente IA — Gemini</span>
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
      {myComms.length === 0 && <p style={{ color: "var(--text3)", textAlign: "center" }}>Nenhum comunicado publicado.</p>}
      {myComms.map(c => {
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
                <button onClick={() => remove(c.id)} style={{ background: "none", border: "1px solid #e74c3c33", borderRadius: 8, color: "var(--red)", cursor: "pointer", fontSize: 12, padding: "6px 12px", fontFamily: "'DM Mono',monospace" }}>✕</button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

//
// FAQ MANAGER TAB
//
const GEMINI_KEY = process.env.REACT_APP_GEMINI_KEY ?? ""
const GROQ_KEY = process.env.REACT_APP_GROQ_KEY ?? ""

async function geminiSuggestFaq(input) {
  const prompt = `Você é um assistente especializado em restaurantes. O gestor de um restaurante descreveu informalmente uma pergunta e resposta para o FAQ dos seus empregados. Sua tarefa é reformular isso de forma clara, profissional e empática, adequada para empregados de restaurante lerem no app.

Descrição do gestor: "${input}"

Responda APENAS com um JSON válido no formato:
{"q": "pergunta clara e objetiva", "a": "resposta completa, clara e profissional"}

Sem markdown, sem explicações, apenas o JSON.`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig:{temperature:0.1,responseMimeType:"application/json"} })
  });
  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return JSON.parse(raw.replace(/```json|```/g, "").trim());
}

function FaqManagerTab({ restaurantId, faq, onUpdate }) {
  const items = faq?.[restaurantId] ?? [];
  const [editIdx, setEditIdx] = useState(null);
  const [form, setForm] = useState({ q: "", a: "" });
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
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
    setAiLoading(true); setAiError("");
    try {
      const result = await geminiSuggestFaq(aiInput.trim());
      setForm({ q: result.q, a: result.a });
      setAiInput("");
    } catch (e) {
      setAiError("Não foi possível gerar sugestão. Tente novamente.");
    }
    setAiLoading(false);
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
              <span style={{ color: "var(--ac-text)", fontWeight: 700, fontSize: 13 }}>Assistente IA — Gemini</span>
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

  // All DP messages for this restaurant
  const dpMsgs = (dpMessages ?? [])
    .filter(m => m.restaurantId === restaurantId)
    .map(m => ({ ...m, _kind: "dp" }));

  // System notifications (horário changes, etc)
  const sysNots = (notifications ?? [])
    .filter(n => n.restaurantId === restaurantId)
    .map(n => ({ ...n, _kind: "sys" }));

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
            {isDP && <div style={{color:"var(--text2)",fontSize:12,marginBottom:6}}>De: <span style={{color:item.empName==="Anônimo"?"#8b5cf6":"#fff"}}>{item.empName}</span></div>}
            <div style={{color:"var(--text)",fontSize:13,lineHeight:1.6,whiteSpace:"pre-wrap",marginBottom:item.read?0:8}}>{item.body}</div>
            {!item.read && <button onClick={()=>markRead(item)} style={{...S.btnSecondary,fontSize:11,padding:"4px 12px"}}>Marcar como lida</button>}
          </div>
        );
      })}
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
function minToTime(m) {
  if (m === null || m === undefined) return "";
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  return `${String(h).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
}
function fmtHHMM(totalMin) {
  if (!totalMin && totalMin !== 0) return "—";
  const sign = totalMin < 0 ? "-" : "";
  const abs = Math.abs(totalMin);
  return `${sign}${String(Math.floor(abs/60)).padStart(2,"0")}:${String(abs%60).padStart(2,"0")}`;
}

// Calcula horas do dia respeitando hora ficta noturna
// Retorna {worked, diurnal, nocturnal, nocturnalFicta, error}
function calcDayHours(inTime, outTime, breakMin) {
  if (!inTime || !outTime) return { worked: 0, diurnal: 0, nocturnal: 0, nocturnalFicta: 0 };
  let inM = timeToMin(inTime);
  let outM = timeToMin(outTime);
  // Handle overnight (e.g. 22:00 -> 02:00)
  if (outM <= inM) outM += 24 * 60;
  const totalMin = outM - inM - (breakMin || 0);
  if (totalMin <= 0) return { worked: 0, diurnal: 0, nocturnal: 0, nocturnalFicta: 0, error: "Horário inválido" };

  // Nocturnal: 22:00 to 05:00 next day = 840min to 1740min (in 24h cycle)
  // Count minutes in nocturnal window
  let noctMin = 0;
  const NOC_START = 22 * 60; // 1320
  const NOC_END = 5 * 60 + 24 * 60; // 300 + 1440 = 1740 (next day 5am)
  for (let t = inM; t < outM; t++) {
    const tMod = t % (24 * 60);
    if (tMod >= NOC_START || tMod < 5 * 60) noctMin++;
  }
  // Subtract break proportionally from nocturnal (simplified: subtract from total)
  const noctProportion = noctMin / (outM - inM);
  const noctAfterBreak = Math.round(noctMin - (breakMin || 0) * noctProportion);
  const diurnAfterBreak = totalMin - noctAfterBreak;

  // Hora ficta: each 52.5 real nocturnal minutes = 60 contract minutes
  const nocturnalFicta = Math.round(noctAfterBreak * (60 / 52.5));

  return {
    worked: totalMin,
    diurnal: diurnAfterBreak,
    nocturnal: noctAfterBreak,
    nocturnalFicta,
    totalContract: diurnAfterBreak + nocturnalFicta,
  };
}

// Validate a full week schedule
function validateWeekSchedule(days) {
  const errors = [];
  const activeDays = Object.entries(days).filter(([,d]) => d && d.in && d.out);

  // Per day validations
  activeDays.forEach(([dayIdx, d]) => {
    const label = WEEK_DAYS_LABEL[parseInt(dayIdx)];
    const calc = calcDayHours(d.in, d.out, d.break || 0);
    if (calc.error) { errors.push(`${label}: ${calc.error}`); return; }
    // 10h limit applies to CONTRACT hours (nocturnal ficta already inflated)
    if (calc.totalContract > 10 * 60) errors.push(`${label}: jornada contratual de ${fmtHHMM(calc.totalContract)} ultrapassa o máximo de 10h (${fmtHHMM(calc.diurnal)} diurnas + ${fmtHHMM(calc.nocturnalFicta)} noturnas fictas).`);
    if ((d.break || 0) < 30) errors.push(`${label}: intervalo mínimo é 30 minutos (atual: ${d.break || 0}min).`);
  });

  // Interjornada (≥ 11h between end of one day and start of next)
  const sorted = activeDays.sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
  for (let i = 0; i < sorted.length - 1; i++) {
    const [, cur] = sorted[i];
    const [, nxt] = sorted[i + 1];
    const curOut = timeToMin(cur.out);
    const nxtIn = timeToMin(nxt.in);
    // If next day starts before current ends, it's next calendar day
    const gap = nxtIn >= curOut ? nxtIn - curOut : nxtIn + 24*60 - curOut;
    if (gap < 11 * 60) {
      errors.push(`Interjornada entre ${WEEK_DAYS_LABEL[parseInt(sorted[i][0])]} e ${WEEK_DAYS_LABEL[parseInt(sorted[i+1][0])]} é de ${fmtHHMM(gap)}, mínimo exigido é 11h.`);
    }
  }

  // Weekly total: must be between 43h55 and 44h00
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
function WorkScheduleManagerTab({ restaurantId, employees, workSchedules, notifications, managers, currentManagerName, onUpdate, communications, isOwner }) {
  const ac = "var(--ac)";
  const restEmps = employees.filter(e => e.restaurantId === restaurantId && !e.inactive);
  const [selEmpId, setSelEmpId] = useState(null);
  const [editDays, setEditDays] = useState({});
  const [errors, setErrors] = useState([]);
  const [showValidFrom, setShowValidFrom] = useState(false);
  const [validFrom, setValidFrom] = useState(today());
  const [selectedSchedIds, setSelectedSchedIds] = useState(new Set());

  const selEmp = restEmps.find(e => e.id === selEmpId);
  const empSchedules = workSchedules?.[restaurantId]?.[selEmpId] ?? [];
  const currentSched = empSchedules[empSchedules.length - 1];

  function loadEmp(empId) {
    setSelEmpId(empId);
    setErrors([]);
    setShowValidFrom(false);
    const sched = (workSchedules?.[restaurantId]?.[empId] ?? []);
    const cur = sched[sched.length - 1];
    setEditDays(cur ? { ...cur.days } : {});
  }

  function handleDayChange(dayIdx, field, val) {
    setEditDays(prev => ({
      ...prev,
      [dayIdx]: { ...(prev[dayIdx] ?? {}), [field]: val }
    }));
    setErrors([]);
  }

  function clearDay(dayIdx) {
    setEditDays(prev => { const n = { ...prev }; delete n[dayIdx]; return n; });
  }

  function tryValidate() {
    const { errors: errs } = validateWeekSchedule(editDays);
    setErrors(errs);
    if (errs.length === 0) setShowValidFrom(true);
  }

  function saveSchedule() {
    const { errors: errs, totalContract } = validateWeekSchedule(editDays);
    if (errs.length > 0) { setErrors(errs); return; }

    const newEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
      days: editDays,
      validFrom,
      createdBy: currentManagerName,
      createdAt: new Date().toISOString(),
      totalContract,
    };

    const empScheds = [...(workSchedules?.[restaurantId]?.[selEmpId] ?? []), newEntry];
    onUpdate("workSchedules", {
      ...workSchedules,
      [restaurantId]: { ...(workSchedules?.[restaurantId] ?? {}), [selEmpId]: empScheds }
    });

    // Notify all DP managers
    const dpMgrs = managers.filter(m => m.isDP && (m.restaurantIds ?? []).includes(restaurantId));
    if (dpMgrs.length > 0) {
      const body = `📋 Horário alterado\n\nEmpregado: ${selEmp?.name}\nAlterado por: ${currentManagerName}\nVigência a partir de: ${fmtDate(validFrom)}\n\nNovo horário:\n${[0,1,2,3,4,5,6].map(i=>{const d=editDays[i];return d?.in&&d?.out?`${WEEK_DAYS_LABEL[i]}: ${d.in} – ${d.out} (intervalo ${d.break??0}min)`:`${WEEK_DAYS_LABEL[i]}: Folga`;}).join("\n")}`;
      const notif = {
        id: `${Date.now()}-notif-${Math.random().toString(36).slice(2,5)}`,
        restaurantId,
        type: "horario",
        body,
        date: new Date().toISOString(),
        read: false,
        targetRole: "dp",
      };
      onUpdate("notifications", [...(notifications ?? []), notif]);
    }

    // Create comunicado only for this employee so they give ciência to new schedule
    const schedBody = `Seu horário de trabalho foi atualizado por ${currentManagerName}.\nVigência a partir de: ${fmtDate(validFrom)}\n\nNovo horário:\n${[0,1,2,3,4,5,6].map(i=>{const d=editDays[i];return d?.in&&d?.out?`${WEEK_DAYS_LABEL[i]}: ${d.in} – ${d.out} (intervalo ${d.break??0}min)`:`${WEEK_DAYS_LABEL[i]}: Folga`;}).join("\n")}`;
    const commForEmp = {
      id: `${Date.now()}-comm-${Math.random().toString(36).slice(2,5)}`,
      restaurantId,
      title: `📋 Novo horário — vigência ${fmtDate(validFrom)}`,
      body: schedBody,
      createdAt: new Date().toISOString(),
      createdBy: currentManagerName,
      target: `emp:${selEmpId}`,
      autoSchedule: true,
    };
    onUpdate("communications", [...(communications ?? []), commForEmp]);

    setShowValidFrom(false);
    setErrors([]);
    onUpdate("_toast", `✅ Horário de ${selEmp?.name} salvo com vigência a partir de ${fmtDate(validFrom)}`);
  }

  if (!selEmpId) return (
    <div>
      <p style={{color:"var(--text3)",fontSize:13,marginBottom:16}}>Selecione um empregado para editar o horário:</p>
      {restEmps.map(emp => {
        const sched = workSchedules?.[restaurantId]?.[emp.id] ?? [];
        const cur = sched[sched.length - 1];
        return (
          <div key={emp.id} onClick={()=>loadEmp(emp.id)} style={{...S.card,marginBottom:8,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{color:"var(--text)",fontWeight:600,fontSize:14}}>{emp.name}</div>
              <div style={{color:"var(--text3)",fontSize:12}}>{cur ? `Vigente desde ${fmtDate(cur.validFrom)} · ${fmtHHMM(cur.totalContract)}/sem` : "Sem horário cadastrado"}</div>
            </div>
            <span style={{color:ac,fontSize:13}}>›</span>
          </div>
        );
      })}
    </div>
  );

  const { totalContract } = validateWeekSchedule(editDays);
  const MIN_WEEK = 43*60+55, MAX_WEEK = 44*60;
  const weekOk = totalContract >= MIN_WEEK && totalContract <= MAX_WEEK;

  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
        <button onClick={()=>{setSelEmpId(null);setErrors([]);setShowValidFrom(false);}} style={{...S.btnSecondary,fontSize:12}}>← Voltar</button>
        <div>
          <span style={{color:"var(--text)",fontWeight:700,fontSize:15}}>{selEmp?.name}</span>
          <span style={{color:"var(--text3)",fontSize:12,marginLeft:8}}>Horário semanal</span>
        </div>
      </div>

      {/* History */}
      {empSchedules.length > 1 && (
        <details style={{marginBottom:16}}>
          <summary style={{color:"var(--text3)",fontSize:12,cursor:"pointer",padding:"8px 12px",background:"var(--bg1)",borderRadius:8}}>
            📂 Histórico ({empSchedules.length} versões)
          </summary>
          <div style={{paddingTop:8}}>
            {isOwner && (
              <div style={{padding:"6px 12px 10px",display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
                <span style={{color:"var(--text3)",fontSize:11}}>Selecione versões para apagar (a versão atual não pode ser removida):</span>
                {selectedSchedIds.size > 0 && (
                  <button onClick={()=>{
                    if(!window.confirm(`Apagar ${selectedSchedIds.size} versão(ões) do histórico de ${selEmp?.name}? Esta ação não pode ser desfeita.`)) return;
                    const remaining = empSchedules.filter(s => !selectedSchedIds.has(s.id));
                    onUpdate("workSchedules", {
                      ...workSchedules,
                      [restaurantId]: { ...(workSchedules?.[restaurantId]??{}), [selEmpId]: remaining }
                    });
                    setSelectedSchedIds(new Set());
                    onUpdate("_toast", `🗑️ ${selectedSchedIds.size} versão(ões) apagada(s)`);
                  }} style={{padding:"5px 12px",borderRadius:8,border:"none",background:"var(--red)",color:"var(--text)",fontWeight:700,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:11}}>
                    🗑️ Apagar selecionadas ({selectedSchedIds.size})
                  </button>
                )}
              </div>
            )}
            {[...empSchedules].reverse().slice(1).map(s => (
              <div key={s.id} style={{padding:"6px 12px",borderBottom:"1px solid var(--border)",fontSize:12,display:"flex",alignItems:"center",gap:10,background:selectedSchedIds.has(s.id)?"var(--red-bg)":"transparent"}}>
                {isOwner && (
                  <input type="checkbox" checked={selectedSchedIds.has(s.id)}
                    onChange={e=>{
                      const next = new Set(selectedSchedIds);
                      e.target.checked ? next.add(s.id) : next.delete(s.id);
                      setSelectedSchedIds(next);
                    }}
                    style={{accentColor:"var(--red)",cursor:"pointer",width:14,height:14}}
                  />
                )}
                <span style={{color:"var(--text2)"}}>Vigente de {fmtDate(s.validFrom)}</span>
                <span style={{color:"var(--text3)",marginLeft:4}}>por {s.createdBy}</span>
                <span style={{color:"var(--text3)",marginLeft:4}}>{fmtHHMM(s.totalContract)}/sem</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Weekly schedule table */}
      <div style={{...S.card,marginBottom:16,overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'DM Mono',monospace",fontSize:13}}>
          <thead>
            <tr>
              {["Dia","Entrada","Saída","Intervalo (min)","Hrs reais","Hrs diurnas","Hrs noturnas (real)","Hrs noturnas (ficta)","Hrs contratuais",""].map(h=>(
                <th key={h} style={{padding:"8px 10px",textAlign:"left",color:"var(--text3)",fontSize:11,borderBottom:"1px solid var(--border)",whiteSpace:"nowrap"}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[0,1,2,3,4,5,6].map(dayIdx => {
              const d = editDays[dayIdx] ?? {};
              const hasDay = d.in && d.out;
              const calc = hasDay ? calcDayHours(d.in, d.out, parseInt(d.break)||0) : null;
              const dayErr = calc && calc.worked > 10*60;
              return (
                <tr key={dayIdx} style={{background:dayIdx%2===0?"#111":"var(--bg2)",opacity:hasDay?1:0.5}}>
                  <td style={{padding:"6px 10px",color:([0,6].includes(dayIdx))?"#f59e0b":"#aaa",fontWeight:600,whiteSpace:"nowrap"}}>{WEEK_DAYS_LABEL[dayIdx]}</td>
                  <td style={{padding:"4px 6px"}}>
                    <input type="time" value={d.in||""} onChange={e=>handleDayChange(dayIdx,"in",e.target.value)}
                      style={{...S.input,width:90,padding:"4px 6px",fontSize:12}}/>
                  </td>
                  <td style={{padding:"4px 6px"}}>
                    <input type="time" value={d.out||""} onChange={e=>handleDayChange(dayIdx,"out",e.target.value)}
                      style={{...S.input,width:90,padding:"4px 6px",fontSize:12}}/>
                  </td>
                  <td style={{padding:"4px 6px"}}>
                    <input type="number" min="0" max="120" value={d.break||""} onChange={e=>handleDayChange(dayIdx,"break",parseInt(e.target.value)||0)}
                      placeholder="30" style={{...S.input,width:70,padding:"4px 6px",fontSize:12}} disabled={!hasDay}/>
                  </td>
                  <td style={{padding:"6px 10px",color:calc&&calc.totalContract>10*60?"var(--red)":"var(--green)",fontWeight:calc?600:400}}>{calc?fmtHHMM(calc.worked):"—"}</td>
                  <td style={{padding:"6px 10px",color:"var(--text2)"}}>{calc?fmtHHMM(calc.diurnal):"—"}</td>
                  <td style={{padding:"6px 10px",color:"#8b5cf6"}}>{calc?fmtHHMM(calc.nocturnal):"—"}</td>
                  <td style={{padding:"6px 10px",color:"#ec4899"}}>{calc?fmtHHMM(calc.nocturnalFicta):"—"}</td>
                  <td style={{padding:"6px 10px",color:calc&&calc.totalContract>10*60?"var(--red)":"var(--ac)",fontWeight:700}}>{calc?fmtHHMM(calc.totalContract):"—"}</td>
                  <td style={{padding:"4px 6px"}}>
                    {hasDay && <button onClick={()=>clearDay(dayIdx)} style={{background:"none",border:"1px solid #e74c3c33",borderRadius:6,color:"var(--red)",cursor:"pointer",padding:"3px 8px",fontSize:11,fontFamily:"'DM Mono',monospace"}}>Folga</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{borderTop:"2px solid var(--border)"}}>
              <td colSpan={4} style={{padding:"8px 10px",color:"var(--text3)",fontSize:12}}>Total semanal (contratual)</td>
              <td colSpan={4} style={{padding:"8px 10px",color:"var(--text3)",fontSize:11}}></td>
              <td style={{padding:"8px 10px",color:weekOk?"var(--green)":"var(--red)",fontWeight:700,fontSize:14}}>{fmtHHMM(totalContract)}</td>
              <td style={{padding:"8px 10px",color:"var(--text3)",fontSize:11}}>{weekOk?"✅ OK":"⚠️ Fora do limite (43:55–44:00)"}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Validation errors */}
      {errors.length > 0 && (
        <div style={{background:"#e74c3c11",border:"1px solid #e74c3c44",borderRadius:10,padding:"12px 16px",marginBottom:16}}>
          <p style={{color:"var(--red)",fontWeight:700,fontSize:13,margin:"0 0 8px"}}>⚠️ Corrija os seguintes erros antes de salvar:</p>
          {errors.map((e,i)=><div key={i} style={{color:"var(--red)",fontSize:12,marginBottom:4}}>• {e}</div>)}
        </div>
      )}

      {/* Valid from modal */}
      {showValidFrom && (
        <div style={{...S.card,border:"1px solid var(--ac)44",marginBottom:16}}>
          <p style={{color:ac,fontWeight:700,fontSize:14,margin:"0 0 10px"}}>📅 A partir de quando este horário entra em vigor?</p>
          <input type="date" value={validFrom} onChange={e=>setValidFrom(e.target.value)} style={{...S.input,marginBottom:12}}/>
          <p style={{color:"var(--text3)",fontSize:12,marginBottom:12}}>Todos os gestores marcados como DP receberão uma notificação com esta alteração.</p>
          <div style={{display:"flex",gap:10}}>
            <button onClick={saveSchedule} style={S.btnPrimary}>✅ Confirmar e Salvar</button>
            <button onClick={()=>setShowValidFrom(false)} style={S.btnSecondary}>Cancelar</button>
          </div>
        </div>
      )}

      {!showValidFrom && (
        <button onClick={tryValidate} style={S.btnPrimary}>Validar e Salvar Horário</button>
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
      <div style={{fontFamily:"'DM Mono',monospace"}}>
        {[0,1,2,3,4,5,6].map(i => {
          const d = s.days[i];
          const hasShift = d?.in && d?.out;
          const isWeekend = i === 0 || i === 6;
          return (
            <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 14px",marginBottom:5,background:hasShift?"var(--card-bg)":"var(--bg1)",borderRadius:9,border:`1px solid ${hasShift?"var(--border)":"transparent"}`,opacity:hasShift?1:0.5}}>
              <span style={{color:isWeekend?"#f59e0b":"var(--text)",fontWeight:700,fontSize:13,minWidth:36}}>{WEEK_DAYS_LABEL[i]}</span>
              {hasShift
                ? <span style={{color:"var(--text2)",fontSize:13}}>{d.in} – {d.out} <span style={{color:"var(--text3)",fontSize:11}}>({d.break||0}min intervalo)</span></span>
                : <span style={{color:"var(--text3)",fontSize:12}}>Folga</span>
              }
            </div>
          );
        })}
        {validUntil && (
          <p style={{color:"var(--text3)",fontSize:11,marginTop:6,textAlign:"right"}}>Vigente até {fmtDate(validUntil)}</p>
        )}
      </div>
    );
  }

  if (!current) return (
    <div style={{textAlign:"center",marginTop:40}}>
      <div style={{fontSize:32,marginBottom:12}}>🕐</div>
      <p style={{color:"var(--text3)",fontSize:14}}>Nenhum horário cadastrado ainda.</p>
    </div>
  );

  return (
    <div style={{fontFamily:"'DM Mono',monospace"}}>
      {/* Current schedule */}
      <div style={{...S.card,marginBottom:20,borderColor:"var(--ac)33"}}>
        <p style={{color:ac,fontSize:14,fontWeight:700,margin:"0 0 2px"}}>🕐 Horário atual</p>
        <p style={{color:"var(--text3)",fontSize:12,marginBottom:14}}>Vigência a partir de {fmtDate(current.validFrom)}</p>
        {scheduleBlock(current, null)}
      </div>

      {/* Previous schedules */}
      {empScheds.length > 1 && (
        <details>
          <summary style={{color:"var(--text3)",fontSize:12,cursor:"pointer",padding:"8px 12px",background:"var(--bg1)",borderRadius:8,marginBottom:8,listStyle:"none"}}>
            📂 Horários anteriores ({empScheds.length - 1}) ▾
          </summary>
          <div style={{paddingTop:4}}>
            {[...empScheds].reverse().slice(1).map((s, idx, arr) => {
              // validUntil = day before the next (more recent) schedule's validFrom
              const newerSched = [...empScheds].reverse()[idx]; // the one right after in reverse
              const validUntil = newerSched?.validFrom
                ? (() => { const d = new Date(newerSched.validFrom+"T12:00:00"); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); })()
                : null;
              return (
                <div key={s.id} style={{...S.card,marginBottom:10,opacity:0.7}}>
                  <p style={{color:"var(--text3)",fontSize:12,fontWeight:700,margin:"0 0 10px"}}>Vigência a partir de {fmtDate(s.validFrom)}</p>
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
  const msgs = dpMessages.filter(m => m.restaurantId === restaurantId)
    .sort((a, b) => b.date.localeCompare(a.date));
  const [filter, setFilter] = useState("all");
  const [selectedIds, setSelectedIds] = useState(new Set());
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
    if(!window.confirm(`Apagar ${selectedIds.size} mensagem(ns) permanentemente? Esta ação não pode ser desfeita.`)) return;
    onUpdate("dpMessages", dpMessages.filter(m => !selectedIds.has(m.id)));
    setSelectedIds(new Set());
    onUpdate("_toast", `🗑️ ${selectedIds.size} mensagem(ns) apagada(s)`);
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
        {isOwner && selectedIds.size > 0 && (
          <button onClick={deleteSelected} style={{padding:"6px 14px",borderRadius:8,border:"none",background:"var(--red)",color:"var(--text)",fontWeight:700,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>
            🗑️ Apagar selecionadas ({selectedIds.size})
          </button>
        )}
      </div>

      {filtered.length === 0 && <p style={{ color: "var(--text3)", textAlign: "center" }}>Nenhuma mensagem.</p>}
      {filtered.map(m => (
        <div key={m.id} style={{ ...S.card, marginBottom: 10, opacity: m.read ? 0.7 : 1, borderColor: selectedIds.has(m.id) ? "#ef444488" : m.read ? "var(--border)" : "var(--ac)44", background: selectedIds.has(m.id) ? "#1a0808" : undefined }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, alignItems:"flex-start" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {isOwner && (
                <input type="checkbox" checked={selectedIds.has(m.id)} onChange={()=>toggleSelect(m.id)}
                  style={{accentColor:"var(--red)",cursor:"pointer",width:14,height:14,flexShrink:0}}
                />
              )}
              <span style={{ color: "var(--text2)", fontSize: 12 }}>{CATS[m.category] ?? m.category}</span>
              {!m.read && <span style={{ background: ac, color: "#111", borderRadius: 4, padding: "1px 6px", fontSize: 10, fontWeight: 700 }}>Novo</span>}
            </div>
            <span style={{ color: "var(--text3)", fontSize: 11 }}>{new Date(m.date).toLocaleString("pt-BR")}</span>
          </div>
          <div style={{ color: "var(--text2)", fontSize: 12, marginBottom: 8 }}>De: <span style={{ color: m.empName === "Anônimo" ? "#8b5cf6" : "#fff" }}>{m.empName}</span></div>
          <div style={{ color: "var(--text)", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 8 }}>{m.body}</div>
          {!m.read && <button onClick={() => markRead(m.id)} style={{ ...S.btnSecondary, fontSize: 12 }}>Marcar como lida</button>}
        </div>
      ))}
    </div>
  );
}

// ── Recibos Manager Tab ──────────────────────────────────────────────────────
function ReceibosManagerTab({ restaurantId, employees, roles, restaurants, receipts, onUpdate, onUpdateEmployees }) {
  const restEmps = employees.filter(e => e.restaurantId === restaurantId);
  const restRoles = roles.filter(r => r.restaurantId === restaurantId && !r.inactive);
  const restaurant = restaurants.find(r => r.id === restaurantId);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [selMonth, setSelMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  });
  const [type, setType] = useState("pagamento");
  const [assignTarget, setAssignTarget] = useState({}); // {receiptId: empId}
  const [unmatchedAction, setUnmatchedAction] = useState({}); // {receiptId: "create"|"assign"}
  const [newEmpForm, setNewEmpForm] = useState({}); // {receiptId: {name,cpf,admission,roleId}}
  const ac = "var(--ac)";

  async function handleUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setProgress("Carregando PDF...");

    try {
      if (!window.pdfjsLib) {
        await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      }

      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const numPages = pdf.numPages;
      setProgress(`Lendo ${numPages} páginas...`);

      const newReceipts = [];
      const pageTexts = []; // store fingerprints to detect duplicates

      for (let p = 1; p <= numPages; p++) {
        setProgress(`Processando página ${p} de ${numPages}...`);
        const page = await pdf.getPage(p);
        const textContent = await page.getTextContent();
        const text = textContent.items.map(i => i.str).join(" ");

        // Duplicate detection using CPF + page type as fingerprint
        // Avoids false positives since all pages share same company header
        const cpfForFp = (text.match(/CPF:\s*([\d.-]+)/) || [])[1]?.replace(/\D/g,"") ?? "";
        const isContinuation = text.includes("Continua na próxima") ? "1" : "2";
        const fingerprint = cpfForFp.length >= 11 ? `${cpfForFp}|${isContinuation}` : null;

        // Only skip if we have a valid fingerprint AND already seen it
        const isDuplicate = fingerprint && pageTexts.includes(fingerprint);

        if (isDuplicate) {
          setProgress(`Página ${p} de ${numPages} — cópia ignorada ✓`);
          continue;
        }
        if (fingerprint) pageTexts.push(fingerprint);

        // Auto-detect month from text (e.g. "Março/2026", "03/2026", "Referente ao mês: Março 2026")
        let detectedMonth = selMonth; // fallback to selected
        const MONTHS_PT = {janeiro:"01",fevereiro:"02",março:"03",abril:"04",maio:"05",junho:"06",julho:"07",agosto:"08",setembro:"09",outubro:"10",novembro:"11",dezembro:"12"};
        const textLower = text.toLowerCase();
        // Try "Mês/Ano" or "Mês Ano" patterns
        for (const [name, num] of Object.entries(MONTHS_PT)) {
          const patterns = [
            new RegExp(name + "[/\\s]+(\\d{4})","i"),
            new RegExp("referente.*" + name + ".*?(\\d{4})","i"),
            new RegExp("compet.*" + name + ".*?(\\d{4})","i"),
          ];
          for (const pat of patterns) {
            const m = textLower.match(pat);
            if (m) { detectedMonth = `${m[1]}-${num}`; break; }
          }
          if (detectedMonth !== selMonth) break;
        }
        // Try numeric pattern MM/YYYY after "competência" or "referente"
        if (detectedMonth === selMonth) {
          const numPat = text.match(/(?:competência|compet\.|referente|ref\.|mês)[:\s]+(\d{2})\/(\d{4})/i);
          if (numPat) detectedMonth = `${numPat[2]}-${numPat[1]}`;
        }

        // Type is set by user before upload — no auto-detection
        const detectedType = type;
        let matchedEmp = null;
        let extractedName = "";
        let extractedCpf = "";
        let extractedAdmission = "";
        let extractedRole = "";

        // Extract ALL CPFs from text, pick the one labeled "CPF:"
        const cpfInText = text.match(/CPF:\s*(\d{3}[.-]\d{3}[.-]\d{3}[.-]\d{2})/);
        // Also try without separator (11 digits after CPF:)
        const cpfRawInText = text.match(/CPF:\s*(\d{11})/);
        const cpfStr = cpfInText ? cpfInText[1] : (cpfRawInText ? cpfRawInText[1] : null);
        // Normalize to exactly 11 digits with leading zeros preserved
        const cpfDigitsInText = cpfStr ? cpfStr.replace(/\D/g,"").padStart(11,"0") : null;

        for (const emp of restEmps) {
          if (emp.cpf && cpfDigitsInText) {
            // Normalize stored CPF to 11 digits too
            const cleanCpf = emp.cpf.replace(/\D/g,"").padStart(11,"0");
            if (cleanCpf === cpfDigitsInText) {
              matchedEmp = emp; break;
            }
          }
        }
        if (!matchedEmp) {
          // Try raw text search for CPF digits
          for (const emp of restEmps) {
            if (emp.cpf) {
              const cleanCpf = emp.cpf.replace(/\D/g,"").padStart(11,"0");
              if (cleanCpf.length === 11 && text.replace(/\D/g,"").includes(cleanCpf)) {
                matchedEmp = emp; break;
              }
            }
          }
        }
        if (!matchedEmp) {
          // Try name match — more flexible comparison
          const nameInText = text.match(/Nome\s+do\s+Colaborador\s+([A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇÀÜ][A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇÀÜ\s]{3,60}?)(?=\s{2,}|PIS|CTPS|\d{3})/);
          const nameFromPdf = nameInText ? nameInText[1].trim().toUpperCase().replace(/\s+/g," ") : null;
          if (nameFromPdf) {
            for (const emp of restEmps) {
              const empUpper = emp.name.toUpperCase().replace(/\s+/g," ");
              // Exact match
              if (empUpper === nameFromPdf) { matchedEmp = emp; break; }
              // PDF name contains emp name
              if (nameFromPdf.includes(empUpper)) { matchedEmp = emp; break; }
              // Emp name contains PDF name
              if (empUpper.includes(nameFromPdf)) { matchedEmp = emp; break; }
              // First + last name match
              const pdfParts = nameFromPdf.split(" ");
              const empParts = empUpper.split(" ");
              if (pdfParts[0] === empParts[0] && pdfParts[pdfParts.length-1] === empParts[empParts.length-1]) {
                matchedEmp = emp; break;
              }
            }
          }
          // Last resort: any word from PDF name (3+ chars) found in emp name
          if (!matchedEmp && nameFromPdf) {
            const pdfWords = nameFromPdf.split(" ").filter(w => w.length >= 4);
            for (const emp of restEmps) {
              const empUpper = emp.name.toUpperCase();
              const matchCount = pdfWords.filter(w => empUpper.includes(w)).length;
              if (matchCount >= 2) { matchedEmp = emp; break; }
            }
          }
        }

        // DEBUG — remove after fix
        console.log(`[PDF p.${p}] CPF found: "${cpfDigitsInText}" | Name pattern: "${text.match(/Nome\s+do\s+Colaborador\s+(.{0,50})/)?.[1]?.trim()}" | matched: ${matchedEmp?.name ?? "NONE"}`);

        // Extract using exact patterns from this payroll PDF format:
        // "Nome do Colaborador\nNOME COMPLETO" or "Nome do Colaborador NOME COMPLETO"
        // "CPF: 000.000.000-00"
        // "Admissão: DD/MM/YYYY"
        // "Função: CARGO"

        // Name: appears right after "Nome do Colaborador"
        const nameAfterLabel = text.match(/Nome\s+do\s+Colaborador\s+([A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇÀÜ][A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇÀÜ\s]{3,50}?)(?=\s{2,}|PIS|CTPS|CPF|\n\n)/);
        if (nameAfterLabel) {
          extractedName = nameAfterLabel[1].trim();
        } else {
          // Fallback: code + name pattern "000058 ROMILDO DE BRITO"
          const codeNameMatch = text.match(/\b\d{5,6}\s+([A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇÀÜ]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇÀÜ]{2,})+)/);
          if (codeNameMatch) extractedName = codeNameMatch[1].trim();
        }

        // CPF: labeled "CPF: 000.000.000-00"
        const cpfLabelMatch = text.match(/CPF:\s*(\d{3}[.-]\d{3}[.-]\d{3}[.-]\d{2})/);
        if (cpfLabelMatch) {
          const digits = cpfLabelMatch[1].replace(/\D/g,"").padStart(11,"0");
          if (digits.length === 11) extractedCpf = `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9)}`;
        }

        // Admission: "Admissão: DD/MM/YYYY"
        const admLabelMatch = text.match(/Admiss[aã]o:\s*(\d{2}[/]\d{2}[/]\d{4})/i);
        if (admLabelMatch) {
          const [d,m,y] = admLabelMatch[1].split("/");
          extractedAdmission = `${y}-${m}-${d}`;
        }

        // Role: "Função: CARGO NAME"
        const funcLabelMatch = text.match(/Fun[çc][aã]o:\s*([A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇÀÜ][A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇÀÜa-záéíóúãõâêîôûçàü\s()]{1,40}?)(?=\s{2,}|CPF|CBO|PIS|RUA|$)/);
        if (funcLabelMatch) extractedRole = funcLabelMatch[1].trim();



        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width; canvas.height = viewport.height;
        await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);

        newReceipts.push({
          id: `${Date.now()}-${p}-${Math.random().toString(36).slice(2,5)}`,
          restaurantId,
          empId: matchedEmp ? matchedEmp.id : null,
          empName: matchedEmp ? matchedEmp.name : (extractedName || `Página ${p} — não identificado`),
          unmatched: !matchedEmp,
          extractedName: extractedName || "",
          extractedCpf: extractedCpf || "",
          extractedAdmission: extractedAdmission || "",
          extractedRole: extractedRole || "",
          month: detectedMonth, type: detectedType, dataUrl,
          uploadedAt: new Date().toISOString(), page: p
        });
      }

      const matched = newReceipts.filter(r => !r.unmatched).length;
      const unmatched = newReceipts.filter(r => r.unmatched).length;
      const skipped = numPages - newReceipts.length;

      // Remove old receipts for same month+type combos found in this batch
      const batchKeys = new Set(newReceipts.map(r => `${r.month}|${r.type}`));
      const existing = receipts.filter(r =>
        !(r.restaurantId === restaurantId && batchKeys.has(`${r.month}|${r.type}`))
      );
      onUpdate("receipts", [...existing, ...newReceipts]);

      // Summary of detected months/types
      const summary = [...new Set(newReceipts.map(r => `${r.month} · ${r.type==="pagamento"?"Pagamento":r.type==="adiantamento"?"Adiantamento":"13º Salário"}`))].join(", ");
      setProgress(`✅ ${matched} identificados automaticamente.\n📅 Detectado: ${summary}${skipped ? `\n📋 ${skipped} duplicata(s) ignorada(s).` : ""}${unmatched ? `\n⚠️ ${unmatched} página(s) não identificada(s) — associe manualmente abaixo.` : ""}`);
    } catch (err) {
      setProgress(`❌ Erro: ${err.message}`);
    }
    setUploading(false);
    e.target.value = "";
  }

  function assignReceipt(receiptId, empId) {
    const emp = restEmps.find(e => e.id === empId);
    if (!emp) return;
    onUpdate("receipts", receipts.map(r =>
      r.id === receiptId ? { ...r, empId: emp.id, empName: emp.name, unmatched: false } : r
    ));
  }

  const myReceipts = receipts.filter(r => r.restaurantId === restaurantId);
  const unmatched = myReceipts.filter(r => r.unmatched);
  const months = [...new Set(myReceipts.filter(r=>!r.unmatched).map(r => r.month))].sort().reverse();

  return (
    <div style={{fontFamily:"'DM Mono',monospace"}}>
      <div style={{...S.card, marginBottom:20}}>
        <p style={{color:ac,fontSize:14,fontWeight:700,margin:"0 0 6px"}}>📤 Importar Recibos</p>
        <p style={{color:"var(--text3)",fontSize:12,marginBottom:14}}>Selecione o tipo e o mês antes de enviar o PDF.</p>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div>
            <label style={S.label}>Tipo de recibo</label>
            <div style={{display:"flex",gap:8}}>
              {[["pagamento","💰 Pagamento"],["adiantamento","💵 Adiantamento"],["13salario","🎄 13º Salário"],["ferias","🏖️ Férias"]].map(([v,l])=>(
                <button key={v} onClick={()=>setType(v)} style={{flex:1,padding:"10px 6px",borderRadius:10,border:`2px solid ${type===v?ac:"var(--border)"}`,background:type===v?ac+"22":"transparent",color:type===v?ac:"var(--text3)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:type===v?700:400}}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={S.label}>Mês de referência</label>
            <input type="month" value={selMonth} onChange={e=>setSelMonth(e.target.value)} style={S.input}/>
          </div>
          <div>
            <label style={S.label}>Arquivo PDF</label>
            <input type="file" accept=".pdf" onChange={handleUpload} disabled={uploading}
              style={{...S.input, cursor:"pointer"}}/>
          </div>
          {progress && (
            <div style={{background:"var(--bg1)",borderRadius:8,padding:"10px 12px",fontSize:12,color:progress.startsWith("✅")?"var(--green)":progress.startsWith("❌")?"var(--red)":"#aaa",whiteSpace:"pre-line"}}>
              {progress}
            </div>
          )}
        </div>
      </div>

      {/* Unmatched receipts */}
      {unmatched.length > 0 && (
        <div style={{...S.card,marginBottom:20,border:"1px solid #f59e0b44"}}>
          <p style={{color:"#f59e0b",fontWeight:700,fontSize:13,margin:"0 0 12px"}}>⚠️ {unmatched.length} recibo(s) não identificado(s)</p>
          {unmatched.map(r => {
            const action = unmatchedAction[r.id]; // "create" | "assign" | undefined
            const form = newEmpForm[r.id] ?? { name: r.extractedName||"", cpf: r.extractedCpf||"", admission: r.extractedAdmission||"", roleId:"" };

            return (
              <div key={r.id} style={{marginBottom:16,padding:12,background:"var(--bg2)",borderRadius:10,border:"1px solid #f59e0b33"}}>
                {/* Preview info extracted */}
                <div style={{marginBottom:8,display:"flex",gap:12,flexWrap:"wrap"}}>
                  {r.extractedName && <span style={{color:"var(--text)",fontSize:13,fontWeight:600}}>👤 {r.extractedName}</span>}
                  {r.extractedCpf && <span style={{color:"var(--text2)",fontSize:12}}>CPF: {r.extractedCpf}</span>}
                  {r.extractedAdmission && <span style={{color:"var(--text2)",fontSize:12}}>Admissão: {fmtDate(r.extractedAdmission)}</span>}
                  {!r.extractedName && <span style={{color:"var(--text3)",fontSize:12}}>Página {r.page} — dados não identificados</span>}
                </div>
                <img src={r.dataUrl} alt="" style={{width:"100%",borderRadius:6,marginBottom:10,maxHeight:160,objectFit:"cover"}}/>

                {/* Action choice */}
                {!action && (
                  <div>
                    <p style={{color:"var(--text2)",fontSize:12,marginBottom:8}}>O que deseja fazer com este recibo?</p>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                      <button onClick={()=>{
                        setUnmatchedAction(p=>({...p,[r.id]:"create"}));
                        setNewEmpForm(p=>({...p,[r.id]:{name:r.extractedName||"",cpf:r.extractedCpf||"",admission:r.extractedAdmission||"",roleId:"",newRoleName:r.extractedRole||"",newRoleArea:"Salão",newRolePoints:"1",creatingRole:false}}));
                      }} style={{padding:"8px 16px",borderRadius:8,border:"none",background:"var(--green)",color:"var(--text)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:700}}>
                        ➕ Criar novo empregado
                      </button>
                      <button onClick={()=>setUnmatchedAction(p=>({...p,[r.id]:"assign"}))} style={{padding:"8px 16px",borderRadius:8,border:"1px solid var(--border)",background:"transparent",color:"var(--text2)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>
                        🔗 Associar a existente
                      </button>
                      <button onClick={()=>onUpdate("receipts",receipts.filter(x=>x.id!==r.id))} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #e74c3c33",background:"transparent",color:"var(--red)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>
                        ✕ Descartar
                      </button>
                    </div>
                  </div>
                )}

                {/* Create new employee */}
                {action === "create" && (
                  <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:4}}>
                    <p style={{color:"var(--green)",fontSize:12,fontWeight:700,margin:0}}>➕ Criar novo empregado</p>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      <div>
                        <label style={S.label}>Nome completo</label>
                        <input value={form.name} onChange={e=>setNewEmpForm(p=>({...p,[r.id]:{...form,name:e.target.value}}))} style={S.input} placeholder="Nome extraído do recibo"/>
                      </div>
                      <div>
                        <label style={S.label}>CPF</label>
                        <input value={form.cpf} onChange={e=>setNewEmpForm(p=>({...p,[r.id]:{...form,cpf:maskCpf(e.target.value)}}))} placeholder="000.000.000-00" style={S.input}/>
                      </div>
                      <div>
                        <label style={S.label}>Data de admissão</label>
                        <input type="date" value={form.admission} onChange={e=>setNewEmpForm(p=>({...p,[r.id]:{...form,admission:e.target.value}}))} style={S.input}/>
                      </div>
                      <div>
                        <label style={S.label}>Cargo</label>
                        {!form.creatingRole ? (
                          <div style={{display:"flex",gap:6}}>
                            <select value={form.roleId} onChange={e=>setNewEmpForm(p=>({...p,[r.id]:{...form,roleId:e.target.value}}))} style={{...S.input,flex:1}}>
                              <option value="">Selecionar cargo…</option>
                              {restRoles.map(role=><option key={role.id} value={role.id}>{role.name} ({role.area})</option>)}
                            </select>
                            <button onClick={()=>setNewEmpForm(p=>({...p,[r.id]:{...form,creatingRole:true,roleId:""}}))}
                              title="Criar novo cargo" style={{padding:"8px 10px",borderRadius:8,border:"1px solid #10b98144",background:"#10b98111",color:"var(--green)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:13,whiteSpace:"nowrap"}}>+ Novo</button>
                          </div>
                        ) : (
                          <div style={{display:"flex",flexDirection:"column",gap:6,padding:"10px 12px",background:"var(--bg3)",borderRadius:8,border:"1px solid #10b98133"}}>
                            <p style={{color:"var(--green)",fontSize:11,fontWeight:700,margin:"0 0 4px"}}>Novo cargo</p>
                            <input value={form.newRoleName} onChange={e=>setNewEmpForm(p=>({...p,[r.id]:{...form,newRoleName:e.target.value}}))} placeholder={r.extractedRole||"Nome do cargo"} style={{...S.input,fontSize:12}}/>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                              <select value={form.newRoleArea} onChange={e=>setNewEmpForm(p=>({...p,[r.id]:{...form,newRoleArea:e.target.value}}))} style={{...S.input,fontSize:12}}>
                                {AREAS.map(a=><option key={a} value={a}>{a}</option>)}
                              </select>
                              <input type="number" min="0" step="0.5" value={form.newRolePoints} onChange={e=>setNewEmpForm(p=>({...p,[r.id]:{...form,newRolePoints:e.target.value}}))} placeholder="Pontos" style={{...S.input,fontSize:12}}/>
                            </div>
                            <div style={{display:"flex",gap:6}}>
                              <button onClick={()=>{
                                if(!form.newRoleName.trim()){alert("Nome do cargo obrigatório");return;}
                                const newRole = { id:`role-${Date.now()}-${Math.random().toString(36).slice(2,5)}`, restaurantId, name:form.newRoleName.trim(), area:form.newRoleArea, points:parseFloat(form.newRolePoints)??0, inactive:false };
                                onUpdate("roles", [...roles, newRole]);
                                setNewEmpForm(p=>({...p,[r.id]:{...form,roleId:newRole.id,creatingRole:false}}));
                              }} style={{flex:1,padding:"6px",borderRadius:8,border:"none",background:"var(--green)",color:"var(--text)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:700}}>✅ Criar cargo</button>
                              <button onClick={()=>setNewEmpForm(p=>({...p,[r.id]:{...form,creatingRole:false}}))} style={{...S.btnSecondary,fontSize:11,padding:"6px 10px"}}>Cancelar</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    {r.extractedRole && !form.creatingRole && <p style={{color:"var(--text3)",fontSize:11}}>Cargo no recibo: <strong style={{color:"var(--text2)"}}>{r.extractedRole}</strong></p>}
                    <div style={{display:"flex",gap:8,marginTop:4}}>
                      <button onClick={()=>{
                        if (!form.name.trim()) { alert("Nome obrigatório"); return; }
                        const code = restaurant?.shortCode ?? "EMP";
                        const seq = employees.filter(e=>e.restaurantId===restaurantId).length + 1;
                        const empCode = code.toUpperCase() + String(seq).padStart(4,"0");
                        const pin = empCode.slice(-4);
                        const newEmp = { id:`${Date.now()}-${Math.random().toString(36).slice(2,5)}`, restaurantId, name:form.name.trim(), cpf:form.cpf.trim(), admission:form.admission||today(), roleId:form.roleId||null, empCode, pin, inactive:false };
                        onUpdateEmployees([...employees, newEmp]);
                        onUpdate("receipts", receipts.map(x=>x.id===r.id?{...x,empId:newEmp.id,empName:newEmp.name,unmatched:false}:x));
                        setUnmatchedAction(p=>{const n={...p};delete n[r.id];return n;});
                        alert(`✅ Empregado "${newEmp.name}" criado!\nCódigo: ${empCode} | PIN: ${pin}`);
                      }} style={{padding:"8px 16px",borderRadius:8,border:"none",background:"var(--green)",color:"var(--text)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12,fontWeight:700}}>
                        ✅ Criar e associar
                      </button>
                      <button onClick={()=>setUnmatchedAction(p=>{const n={...p};delete n[r.id];return n;})} style={{...S.btnSecondary,fontSize:12}}>Voltar</button>
                    </div>
                  </div>
                )}

                {/* Assign to existing */}
                {action === "assign" && (
                  <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:4}}>
                    <p style={{color:"var(--text2)",fontSize:12,fontWeight:700,margin:0}}>🔗 Associar a empregado existente</p>
                    <div style={{display:"flex",gap:8}}>
                      <select value={assignTarget[r.id]??""} onChange={e=>setAssignTarget(p=>({...p,[r.id]:e.target.value}))} style={{...S.input,flex:1}}>
                        <option value="">Selecionar empregado…</option>
                        {restEmps.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                      <button onClick={()=>{
                        if(!assignTarget[r.id]) return;
                        const emp = restEmps.find(e=>e.id===assignTarget[r.id]);
                        if(!emp) return;
                        onUpdate("receipts", receipts.map(x=>x.id===r.id?{...x,empId:emp.id,empName:emp.name,unmatched:false}:x));
                        setUnmatchedAction(p=>{const n={...p};delete n[r.id];return n;});
                      }} disabled={!assignTarget[r.id]} style={{padding:"8px 14px",borderRadius:8,border:"none",background:assignTarget[r.id]?ac:"var(--bg4)",color:"var(--text)",fontWeight:700,cursor:assignTarget[r.id]?"pointer":"default",fontFamily:"'DM Mono',monospace",fontSize:12}}>
                        Associar
                      </button>
                      <button onClick={()=>setUnmatchedAction(p=>{const n={...p};delete n[r.id];return n;})} style={{...S.btnSecondary,fontSize:12}}>Voltar</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Recibos por mês */}
      {months.length === 0 && <p style={{color:"var(--text3)",textAlign:"center"}}>Nenhum recibo importado.</p>}
      {months.map(m => {
        const mReceipts = myReceipts.filter(r => r.month === m && !r.unmatched);
        const [y,mo] = m.split("-");
        const mLabel = new Date(parseInt(y), parseInt(mo)-1, 1).toLocaleDateString("pt-BR",{month:"long",year:"numeric"});
        const TYPE_INFO = {
          pagamento:   { label:"💰 Pagamento",    color:"var(--green)" },
          adiantamento:{ label:"💵 Adiantamento", color:"#3b82f6" },
          "13salario": { label:"🎄 13º Salário",  color:"#f59e0b" },
          ferias:      { label:"🏖️ Férias",       color:"#8b5cf6" },
        };
        const typeKeys = Object.keys(TYPE_INFO).filter(t => mReceipts.some(r=>r.type===t));

        return (
          <details key={m} open style={{marginBottom:12,background:"var(--card-bg)",borderRadius:14,border:"1px solid var(--border)",overflow:"hidden"}}>
            <summary style={{padding:"12px 16px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",listStyle:"none",userSelect:"none"}}>
              <span style={{color:ac,fontWeight:700,fontSize:14,textTransform:"capitalize"}}>📁 {mLabel}</span>
              <span style={{color:"var(--text3)",fontSize:12}}>{mReceipts.length} recibo(s)</span>
            </summary>

            <div style={{padding:"0 12px 12px"}}>
              {typeKeys.map(t => {
                const tReceipts = mReceipts.filter(r=>r.type===t);
                const { label, color } = TYPE_INFO[t];
                return (
                  <details key={t} open style={{marginBottom:8,background:"var(--bg2)",borderRadius:10,border:`1px solid ${color}33`,overflow:"hidden"}}>
                    <summary style={{padding:"8px 12px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",listStyle:"none",userSelect:"none"}}>
                      <span style={{color,fontSize:12,fontWeight:700}}>{label} ({tReceipts.length})</span>
                      <button onClick={e=>{e.preventDefault();e.stopPropagation();if(window.confirm(`Excluir TODOS os ${tReceipts.length} recibos de ${label} de ${mLabel}?`)) onUpdate("receipts", receipts.filter(r=>!(r.month===m&&r.type===t&&r.restaurantId===restaurantId)));}} style={{background:"none",border:"1px solid #e74c3c33",borderRadius:6,color:"var(--red)",cursor:"pointer",fontSize:11,padding:"2px 8px",fontFamily:"'DM Mono',monospace"}}>
                        Excluir todos
                      </button>
                    </summary>

                    <div style={{padding:"4px 8px 8px"}}>
                      {tReceipts.map(r=>(
                        <div key={r.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 8px",background:"var(--bg1)",borderRadius:8,marginBottom:4}}>
                          <span style={{flex:1,color:"var(--text)",fontSize:13}}>{r.empName}</span>
                          {/* Change type */}
                          <select value={r.type} onChange={e=>{
                            onUpdate("receipts", receipts.map(x=>x.id===r.id?{...x,type:e.target.value}:x));
                          }} style={{...S.input,width:"auto",fontSize:11,padding:"3px 6px",color:"var(--text2)"}}>
                            <option value="pagamento">💰 Pagamento</option>
                            <option value="adiantamento">💵 Adiantamento</option>
                            <option value="13salario">🎄 13º Salário</option>
                            <option value="ferias">🏖️ Férias</option>
                          </select>
                          <button onClick={()=>{if(window.confirm(`Excluir recibo de ${r.empName}?`)) onUpdate("receipts", receipts.filter(x=>x.id!==r.id));}} style={{background:"none",border:"1px solid #e74c3c33",borderRadius:6,color:"var(--red)",cursor:"pointer",fontSize:12,padding:"4px 8px",fontFamily:"'DM Mono',monospace",flexShrink:0}}>✕</button>
                        </div>
                      ))}
                    </div>
                  </details>
                );
              })}
              {typeKeys.length === 0 && <p style={{color:"var(--text3)",fontSize:12,textAlign:"center",padding:8}}>Nenhum recibo identificado neste mês.</p>}
            </div>
          </details>
        );
      })}
    </div>
  );
}

// ── Recibos Employee Tab ──────────────────────────────────────────────────────
function ReceibosEmployeeTab({ empId, restaurantId, receipts }) {
  const myReceipts = (receipts ?? [])
    .filter(r => r.empId === empId && r.restaurantId === restaurantId && !r.unmatched)
    .sort((a,b) => b.month.localeCompare(a.month));
  const months = [...new Set(myReceipts.map(r => r.month))];
  const [selReceipt, setSelReceipt] = useState(null);
  const ac = "var(--ac)";

  if (selReceipt) {
    return (
      <div>
        <button onClick={()=>setSelReceipt(null)} style={{...S.btnSecondary,marginBottom:16}}>← Voltar</button>
        <div style={{color:"var(--text)",fontWeight:700,marginBottom:4}}>{selReceipt.empName}</div>
        <div style={{color:"var(--text3)",fontSize:12,marginBottom:12}}>{selReceipt.month} · {selReceipt.type==="pagamento"?"💰 Pagamento":"💵 Adiantamento"}</div>
        <img src={selReceipt.dataUrl} alt="Recibo" style={{width:"100%",borderRadius:10,border:"1px solid var(--border)"}}/>
        <a href={selReceipt.dataUrl} download={`recibo_${selReceipt.month}_${selReceipt.type}.jpg`}
          style={{display:"block",marginTop:12,...S.btnPrimary,textAlign:"center",textDecoration:"none",padding:"12px",borderRadius:12,background:ac,color:"#1c1710",fontWeight:700,fontFamily:"'DM Mono',monospace",fontSize:14}}>
          ⬇️ Baixar Recibo
        </a>
      </div>
    );
  }

  if (myReceipts.length === 0) return (
    <div style={{textAlign:"center",marginTop:30}}>
      <div style={{fontSize:32,marginBottom:12}}>📄</div>
      <p style={{color:"var(--text3)",fontSize:14}}>Nenhum recibo disponível ainda.</p>
      <p style={{color:"var(--bg4)",fontSize:12,marginTop:8}}>Quando o gestor importar os recibos do mês, eles aparecerão aqui.</p>
      {(receipts??[]).length > 0 && <p style={{color:"var(--bg4)",fontSize:11,marginTop:4}}>({(receipts??[]).length} recibos no sistema, nenhum para você)</p>}
    </div>
  );

  return (
    <div>
      {months.map(m => {
        const mR = myReceipts.filter(r => r.month === m);
        return (
          <div key={m} style={{...S.card,marginBottom:12}}>
            <p style={{color:ac,fontWeight:700,margin:"0 0 10px",fontSize:13}}>{m}</p>
            {mR.map(r=>(
              <button key={r.id} onClick={()=>setSelReceipt(r)}
                style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg1)",cursor:"pointer",fontFamily:"'DM Mono',monospace",marginBottom:6}}>
                <span style={{color:"var(--text)",fontSize:13}}>{r.type==="pagamento"?"💰 Recibo de Pagamento":r.type==="adiantamento"?"💵 Recibo de Adiantamento":r.type==="ferias"?"🏖️ Férias":"🎄 13º Salário"}</span>
                <span style={{color:"var(--text3)",fontSize:11}}>Ver →</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function EmployeePortal({ employees, roles, tips, schedules, splits, restaurants, communications, commAcks, faq, dpMessages, receipts, workSchedules, onBack, onUpdateEmployee, onUpdate, toggleTheme, theme }) {
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
  const myTips = tips.filter(t => t.employeeId === empId && t.monthKey === mk);
  const grossTotal = myTips.reduce((a, t) => a + (t.myShare ?? 0), 0);
  const taxTotal   = myTips.reduce((a, t) => a + (t.myTax   ?? 0), 0);
  const netTotal   = myTips.reduce((a, t) => a + (t.myNet   ?? 0), 0);
  const dayMap = emp ? (schedules?.[emp.restaurantId]?.[mk]?.[empId] ?? {}) : {};

  // Pending communications
  const empRole = roles?.find(r => r.id === emp?.roleId);
  const myComms = emp ? communications.filter(c => {
    if (c.restaurantId !== emp.restaurantId) return false;
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
  const TABS = [
    ["comunicados", "📢 Comunicados"],
    ["escala",      "📅 Escala"],
    ["extrato",     "💸 Gorjeta"],
    empTabVisible("horarios") && ["horarios", "🕐 Horários"],
    empTabVisible("recibos")  && ["recibos",  "📄 Recibos"],
    empTabVisible("faq")      && ["faq",      "❓ FAQ"],
    empTabVisible("dp")       && ["dp",       "💬 Fale com DP"],
  ].filter(Boolean);

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
        </div>
      </div>
    </div>
  );

  // Bottom nav config: icon + short label
  const NAV = [
    ["comunicados","📢","Avisos"],
    ["escala","📅","Escala"],
    ["extrato","💸","Gorjeta"],
    empTabVisible("horarios") && ["horarios","🕐","Horários"],
    empTabVisible("recibos")  && ["recibos","📄","Recibos"],
    empTabVisible("faq")      && ["faq","❓","FAQ"],
    empTabVisible("dp")       && ["dp","💬","Fale DP"],
  ].filter(Boolean);

  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", fontFamily:"'DM Sans',sans-serif", paddingBottom:76 }}>
      {/* Header */}
      <div style={{ background:"var(--header-bg)", borderBottom:"1px solid var(--border)", padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", boxShadow:"0 1px 4px rgba(0,0,0,0.04)" }}>
        <div>
          <div style={{ color:"var(--text)", fontWeight:700, fontSize:15 }}>{emp?.name}</div>
          <div style={{ color:"var(--text3)", fontSize:11 }}>{role?.name} · {restaurant?.name}</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={toggleTheme} style={{background:"none",border:"1px solid var(--border)",borderRadius:20,padding:"6px 10px",cursor:"pointer",fontSize:16,color:"var(--text2)"}}>
            {theme==="dark"?"☀️":"🌙"}
          </button>
          <button onClick={() => { setEmpId(null); onBack(); }} style={{ ...S.btnSecondary, fontSize:12, padding:"6px 14px" }}>Sair</button>
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
              {[["Bruto", grossTotal, "#fff"], ["Imposto", taxTotal, "var(--red)"], ["Líquido", netTotal, ac]].map(([lbl, val, col]) => (
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
                    const statusLabels = {off:"Folga",vac:"Férias",faultj:"Falta Just.",faultu:"Falta Injust.",comp:"Compensação"};
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
                <CalendarGrid year={year} month={month} dayMap={dayMap} readOnly />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 20 }}>
                  {(() => {
                    const dim = new Date(year, month + 1, 0).getDate();
                    const counts = { work: 0, off: 0, comp: 0, vac: 0, fj: 0, fu: 0 };
                    for (let d = 1; d <= dim; d++) {
                      const k = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                      const s = dayMap[k];
                      if (s === DAY_OFF) counts.off++;
                      else if (s === DAY_COMP) counts.comp++;
                      else if (s === DAY_VACATION) counts.vac++;
                      else if (s === DAY_FAULT_J) counts.fj++;
                      else if (s === DAY_FAULT_U) counts.fu++;
                      else counts.work++;
                    }
                    return [
                      ["Trabalho", counts.work, "var(--green)"], ["Folga", counts.off, "var(--red)"],
                      ["Compensação", counts.comp, "#3b82f6"], ["Férias", counts.vac, "#8b5cf6"],
                      ["Falta Just.", counts.fj, "#f59e0b"], ["Falta Injust.", counts.fu, "var(--red)"],
                    ].map(([lbl, val, col]) => (
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
              const STATUS_COLORS = {
                [DAY_OFF]:      "var(--red)",
                [DAY_COMP]:     "#3b82f6",
                [DAY_VACATION]: "#8b5cf6",
                [DAY_FAULT_J]:  "#f59e0b",
                [DAY_FAULT_U]:  "var(--red)",
              };
              const STATUS_SHORT = {
                [DAY_OFF]:"F",[DAY_COMP]:"C",[DAY_VACATION]:"Fér",
                [DAY_FAULT_J]:"FJ",[DAY_FAULT_U]:"FI",
              };
              const LEGEND = [
                ["var(--green)","Trabalho"],["var(--red)","Folga"],["#3b82f6","Comp."],
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
                            <tr key={e.id} style={{background:isMe?"#1a1a0a":ei%2===0?"#111":"var(--bg2)"}}>
                              <td style={{position:"sticky",left:0,background:isMe?"#1a1a0a":ei%2===0?"#111":"var(--bg2)",zIndex:1,padding:"5px 8px",borderRight:"1px solid var(--border)",minWidth:90}}>
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
                                return (
                                  <td key={d} style={{
                                    textAlign:"center",padding:"3px 1px",
                                    background:isToday?"var(--ac)11":status?color+"22":(isWe?"#1a1a0a":"transparent"),
                                    borderRight:"1px solid var(--border)",
                                    width:22,outline:isToday?`1px solid ${ac}44`:undefined
                                  }}>
                                    <span style={{color:color,fontSize:status?8:9,fontWeight:status?700:300}}>{label}</span>
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

        {tab === "dp" && (
          <FaleDpTab empId={empId} emp={emp} restaurantId={emp?.restaurantId} dpMessages={dpMessages} onUpdate={onUpdate} />
        )}

        {tab === "horarios" && (
          <WorkScheduleEmployeeTab empId={empId} restaurantId={emp?.restaurantId} workSchedules={workSchedules ?? {}} />
        )}

        {tab === "recibos" && (
          <ReceibosEmployeeTab empId={empId} restaurantId={emp?.restaurantId} receipts={receipts ?? []} />
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
function RoleSpreadsheet({ restRoles, rid, roles, onUpdate }) {
  const blank = () => ({ id: null, name: "", area: "Bar", points: "1", restaurantId: rid });
  const [newRow, setNewRow] = useState(blank());
  const [editRows, setEditRows] = useState({});
  const [saved, setSaved] = useState({});
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [showAi, setShowAi] = useState(false);

  async function handleAiCargos() {
    if (!aiInput.trim()) return;
    setAiLoading(true); setAiError("");
    try {
      const prompt = `Você é um assistente de gestão de restaurantes. O gestor forneceu uma lista de cargos. Extraia os cargos e estruture como JSON.

Entrada do gestor: "${aiInput.trim()}"

Regras:
- "área" deve ser uma dessas: Bar, Cozinha, Salão, Limpeza, Produção
- "pontos" deve ser um número entre 0 e 20 (0 = sem gorjeta)
- Se não mencionar pontos, estime baseado na hierarquia do cargo (ex: Gerente=10, Subchef=9, Garçom=6, Auxiliar=3)
- Se não mencionar área, deduza pelo nome do cargo

Responda APENAS com JSON válido:
{"cargos": [{"nome": "...", "area": "...", "pontos": 6, "semGorjeta": false}]}`;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.1,responseMimeType:"application/json"}})
      });
      const data = await res.json();
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const result = JSON.parse(raw.replace(/```json|```/g,"").trim());
      const novos = result.cargos.map(c => ({
        id: `role-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
        restaurantId: rid,
        name: c.nome,
        area: c.area,
        points: c.semGorjeta ? 0 : (c.pontos ?? 1),
        noTip: c.semGorjeta ?? false,
        inactive: false,
      }));
      onUpdate("roles", [...roles, ...novos]);
      setAiInput(""); setShowAi(false);
      onUpdate("_toast", `✨ ${novos.length} cargo${novos.length>1?"s":""} adicionado${novos.length>1?"s":""} pela IA!`);
    } catch(e) {
      setAiError("Não foi possível processar. Tente reformular.");
    }
    setAiLoading(false);
  }

  const ROLE_COLS = "1.2fr 70px 120px 160px";

  function getRow(r) { return editRows[r.id] ?? { name: r.name, area: r.area, points: r.points === 0 ? "0" : String(r.points || "") }; }
  function setRow(id, field, val) { setEditRows(prev => ({ ...prev, [id]: { ...getRow({ id }), [field]: val } })); }

  function saveRole(r) {
    const row = getRow(r);
    if (!row.name.trim()) return;
    const pts = row.points === "" ? 0 : (Number(row.points) || 0);
    const updated = { ...r, name: row.name.trim(), area: row.area, points: pts };
    onUpdate("roles", roles.map(x => x.id === r.id ? updated : x));
    setSaved(p => ({ ...p, [r.id]: true }));
    setTimeout(() => setSaved(p => ({ ...p, [r.id]: false })), 1500);
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
    const isSaved = saved[r.id];
    return (
      <div key={r.id} style={{ display:"grid", gridTemplateColumns:ROLE_COLS, gap:6, marginBottom:4, background:"var(--card-bg)", borderRadius:10, padding:"6px 8px", border:`1px solid ${isSaved?"#10b98166":r.inactive?"#8b5cf622":"var(--border)"}`, opacity:r.inactive?0.6:1, alignItems:"center" }}>
        <input value={row.name} onChange={e => setRow(r.id, "name", e.target.value)} style={inStyle} />
        <input type="number" min="0" step="0.5" value={r.noTip ? 0 : row.points} disabled={r.noTip} onChange={e => setRow(r.id, "points", e.target.value)} style={{...inStyle, opacity: r.noTip ? 0.4 : 1, textAlign:"center"}} />
        <label style={{display:"flex",alignItems:"center",gap:6,cursor:"pointer",color:"var(--text2)",fontSize:12,fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap"}}>
          <input type="checkbox" checked={!!r.noTip} onChange={e=>{onUpdate("roles",roles.map(x=>x.id===r.id?{...x,noTip:e.target.checked,points:e.target.checked?0:parseFloat(row.points)||1}:x));}} style={{width:14,height:14,cursor:"pointer",accentColor:ac}}/>
          Sem gorjeta
        </label>
        <div style={{display:"flex",gap:4,justifyContent:"flex-end"}}>
          <button onClick={()=>saveRole(r)} style={{padding:"5px 10px",borderRadius:7,border:"none",background:isSaved?"var(--green)":ac,color:"var(--text)",fontWeight:700,fontSize:11,cursor:"pointer",fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap"}}>{isSaved?"✓":"Salvar"}</button>
          {r.inactive
            ? <button onClick={()=>reactivateRole(r.id)} style={{padding:"5px 10px",borderRadius:7,border:"1px solid #10b98144",background:"transparent",color:"var(--green)",cursor:"pointer",fontSize:11,fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap"}}>Reativar</button>
            : <button onClick={()=>inactivateRole(r.id)} style={{padding:"5px 10px",borderRadius:7,border:"1px solid #f59e0b44",background:"transparent",color:"#f59e0b",cursor:"pointer",fontSize:11,fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap"}}>Inativar</button>
          }
        </div>
      </div>
    );
  };

  return (
    <div style={{ fontFamily: "'DM Mono',monospace" }}>
      <p style={{ color: "var(--text3)", fontSize: 12, marginBottom: 12 }}>Edite inline e clique em Salvar. Nova linha no topo para adicionar.</p>

      {/* Assistente IA */}
      <div style={{marginBottom:14}}>
        <button onClick={()=>{setShowAi(!showAi);setAiError("");}}
          style={{...S.btnSecondary,fontSize:12,display:"inline-flex",alignItems:"center",gap:6,padding:"7px 14px",
            background:showAi?"var(--ac-bg)":undefined,borderColor:showAi?"var(--ac)":undefined,color:showAi?"var(--ac-text)":undefined}}>
          ✨ Importar cargos com IA
        </button>
        {showAi && (
          <div style={{marginTop:10,padding:"14px",borderRadius:12,background:"var(--ac-bg)",border:"1px solid var(--ac)33"}}>
            <p style={{color:"var(--text2)",fontSize:13,margin:"0 0 6px",fontWeight:600}}>✨ Assistente de cargos — Gemini</p>
            <p style={{color:"var(--text3)",fontSize:12,margin:"0 0 6px",lineHeight:1.5}}>Descreva os cargos livremente ou cole uma lista. A IA identifica nome, área e pontos.</p>
            <p style={{color:"var(--text3)",fontSize:11,margin:"0 0 10px",fontStyle:"italic"}}>Ex: "Garçom 6pts Salão, Barman 7pts Bar" ou "temos garçons, ajudantes de cozinha e um gerente"</p>
            <textarea value={aiInput} onChange={e=>setAiInput(e.target.value)}
              placeholder="Cole ou descreva os cargos aqui..." rows={4}
              style={{...S.input,resize:"vertical",marginBottom:8,fontSize:13}}/>
            {aiError && <p style={{color:"var(--red)",fontSize:12,margin:"0 0 8px"}}>{aiError}</p>}
            <div style={{display:"flex",gap:8}}>
              <button onClick={handleAiCargos} disabled={!aiInput.trim()||aiLoading}
                style={{...S.btnPrimary,flex:1,fontSize:13,opacity:(!aiInput.trim()||aiLoading)?0.6:1}}>
                {aiLoading?"✨ Processando...":"✨ Criar cargos"}
              </button>
              <button onClick={()=>{setShowAi(false);setAiInput("");setAiError("");}} style={S.btnSecondary}>Cancelar</button>
            </div>
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
    </div>
  );
}


// ─── EmpRowLine definido FORA do EmployeeSpreadsheet para evitar re-mount ───
const EMP_COLS        = "80px 2fr 1.2fr 100px auto 1.5fr auto";
const EMP_COLS_HEADER = "80px 2fr 1.2fr 100px auto 1.5fr auto";
const empInS2 = { background:"var(--bg1)", border:"1px solid var(--border)", borderRadius:6, color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:12, padding:"6px 8px", outline:"none", width:"100%", boxSizing:"border-box" };

function EmpRowLine({ emp, isNew, row, restRoles, isSaved, isOwner, onChange, onSave, onToggleInactive, onDelete, onAdd, onResetPin, employees }) {
  const ac = "var(--ac)";
  const isInactive = !isNew && emp?.inactive && emp?.inactiveFrom <= today();
  return (
    <div style={{display:"grid",gridTemplateColumns:EMP_COLS,gap:6,padding:"6px 8px",marginBottom:4,
      background:isNew?"#f0fdf4":isInactive?"#1a1a2a":"var(--card-bg)",borderRadius:10,
      border:`1px solid ${isSaved?"#10b98166":isNew?"#10b98144":isInactive?"#8b5cf644":"var(--border)"}`,
      alignItems:"center",opacity:isInactive?0.75:1}}>

      {/* ID / código */}
      <div style={{color:"var(--text3)",fontSize:11,fontFamily:"'DM Mono',monospace",textAlign:"center"}}>
        {isNew ? <span style={{color:"var(--text3)",fontSize:10}}>Auto</span> : <span style={{color:ac,fontWeight:700}}>{emp?.empCode ?? "—"}</span>}
      </div>

      <input value={row.name||""} onChange={ev=>onChange("name",ev.target.value)} placeholder="Nome completo" style={empInS2}/>
      <input value={row.cpf||""} onChange={ev=>onChange("cpf",maskCpf(ev.target.value))} placeholder="000.000.000-00" style={empInS2} inputMode="numeric"/>
      <input type="date" value={row.admission||""} onChange={ev=>onChange("admission",ev.target.value)} style={empInS2}/>

      {/* PIN — campo + botão resetar */}
      <div style={{display:"flex",gap:4,alignItems:"center"}}>
        <input type="password" value={row.pin||""} onChange={ev=>onChange("pin",ev.target.value)} maxLength={6} placeholder="••••"
          style={{...empInS2,width:70,flexShrink:0}}/>
        {!isNew && isOwner && (
          <button onClick={()=>onResetPin(emp)} title="Resetar PIN para o código do empregado"
            style={{padding:"5px 8px",borderRadius:6,border:"1px solid #f59e0b44",background:"transparent",color:"#f59e0b",cursor:"pointer",fontSize:10,fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap"}}>
            🔑
          </button>
        )}
      </div>

      <select value={row.roleId||""} onChange={ev=>onChange("roleId",ev.target.value)} style={{...empInS2,cursor:"pointer"}}>
        <option value="">Selecionar…</option>
        {AREAS.map(a=>(
          <optgroup key={a} label={a}>
            {restRoles.filter(r=>r.area===a&&!r.inactive).map(r=><option key={r.id} value={r.id}>{r.name} ({r.points}pt)</option>)}
          </optgroup>
        ))}
      </select>

      {/* Última coluna: ações */}
      <div style={{display:"flex",gap:4,alignItems:"center"}}>
        {isNew
          ? <button onClick={onAdd} style={{padding:"6px 12px",borderRadius:8,border:"none",background:"var(--green)",color:"var(--text)",fontWeight:700,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12,whiteSpace:"nowrap"}}>+ Add</button>
          : <>
              <button onClick={onSave} style={{padding:"4px 10px",borderRadius:6,border:"none",background:isSaved?"var(--green)":ac,color:"var(--text)",fontWeight:700,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:11}}>{isSaved?"✓":"Salvar"}</button>
              <button onClick={onToggleInactive} title={isInactive?"Reativar":"Inativar"}
                style={{padding:"4px 8px",borderRadius:6,border:`1px solid ${isInactive?"#10b98144":"#f59e0b44"}`,background:"transparent",color:isInactive?"var(--green)":"#f59e0b",cursor:"pointer",fontSize:11,fontFamily:"'DM Mono',monospace"}}>
                {isInactive?"↑":"↓"}
              </button>
              {isOwner && isInactive && (
                <button onClick={onDelete} title="Excluir permanentemente"
                  style={{padding:"4px 8px",borderRadius:6,border:"1px solid #e74c3c44",background:"transparent",color:"var(--red)",cursor:"pointer",fontSize:11,fontFamily:"'DM Mono',monospace"}}>✕</button>
              )}
            </>
        }
      </div>
    </div>
  );
}

function EmployeeSpreadsheet({ restEmps, restRoles, rid, employees, onUpdate, restCode: restCode_, isOwner, restaurant, notifications }) {
  const PLANOS = [
    { id:"p10",  empMax:10  },
    { id:"p20",  empMax:20  },
    { id:"p50",  empMax:50  },
    { id:"p999", empMax:100 },
    { id:"pOrc", empMax:999 },
  ];
  const plano = PLANOS.find(p=>p.id===(restaurant?.planoId??"p10")) ?? PLANOS[0];
  const activeCount = restEmps.filter(e=>!e.inactive).length;
  const blank = () => ({ name:"", cpf:"", admission:today(), pin:"", roleId:"", restaurantId:rid });
  const [newRow, setNewRow] = useState(blank());
  const [editRows, setEditRows] = useState({});
  const [saved, setSaved] = useState({});
  const [showInactive, setShowInactive] = useState(false);
  const [showAiEmp, setShowAiEmp] = useState(false);
  const [aiEmpInput, setAiEmpInput] = useState("");
  const [aiEmpLoading, setAiEmpLoading] = useState(false);
  const [aiEmpError, setAiEmpError] = useState("");

  async function handleAiEmpregados() {
    if (!aiEmpInput.trim()) return;
    setAiEmpLoading(true); setAiEmpError("");
    const cargosDisponiveis = restRoles.filter(r=>!r.inactive).map(r=>`${r.name} (id:${r.id})`).join(", ");
    try {
      const prompt = `Você é um assistente de gestão de restaurantes. O gestor forneceu uma lista de empregados. Extraia e estruture como JSON.

Cargos disponíveis no restaurante: ${cargosDisponiveis || "nenhum cadastrado"}
Entrada do gestor: "${aiEmpInput.trim()}"

Regras:
- "nome" é obrigatório (nome completo)
- "cargoId" deve ser o id do cargo da lista acima se conseguir identificar, senão null
- "admissao" no formato YYYY-MM-DD, se não informado use hoje: ${today()}
- "cpf" só se explicitamente informado, senão null

Responda APENAS com JSON válido:
{"empregados": [{"nome": "...", "cargoId": "...", "admissao": "2025-01-15", "cpf": null}]}`;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.1,responseMimeType:"application/json"}})
      });
      const data = await res.json();
      const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      const result = JSON.parse(raw.replace(/```json|```/g,"").trim());

      const restCode = restCode_ || "XXX";
      let seq = nextEmpSeq(employees, restCode);
      const novos = result.empregados.map(e => {
        const empCode = makeEmpCode(restCode, seq);
        const pin = String(seq).padStart(4,"0");
        seq++;
        return {
          id: empCode,
          restaurantId: rid,
          name: e.nome,
          cpf: e.cpf || "",
          admission: e.admissao || today(),
          pin,
          roleId: e.cargoId || "",
          mustChangePin: true,
        };
      });

      if (activeCount + novos.length > plano.empMax) {
        setAiEmpError(`Limite do plano: ${plano.empMax} empregados. Você tem ${activeCount} ativos e está tentando adicionar ${novos.length}.`);
        setAiEmpLoading(false); return;
      }

      onUpdate("employees", [...employees, ...novos]);
      setAiEmpInput(""); setShowAiEmp(false);
      onUpdate("_toast", `✨ ${novos.length} empregado${novos.length>1?"s":""} adicionado${novos.length>1?"s":""} pela IA!`);
    } catch(e) {
      setAiEmpError("Não foi possível processar. Tente reformular.");
    }
    setAiEmpLoading(false);
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
    return { name:emp.name||"", cpf:emp.cpf||"", admission:emp.admission||"", pin:emp.pin||"", roleId:emp.roleId||"", inactiveFrom:emp.inactiveFrom||"", ...(editRows[emp.id]??{}) };
  }

  function setField(id, field, val) {
    setEditRows(prev => ({ ...prev, [id]: { ...(prev[id]??{}), [field]: val } }));
  }

  function saveEmp(emp) {
    setEditRows(prev => {
      const row = { name:emp.name||"", cpf:emp.cpf||"", admission:emp.admission||"", pin:emp.pin||"", roleId:emp.roleId||"", inactiveFrom:emp.inactiveFrom||"", ...(prev[emp.id]??{}) };
      if (!row.name.trim()) return prev;
      onUpdate("employees", employees.map(x => x.id===emp.id ? {...emp, name:row.name.trim(), cpf:row.cpf, admission:row.admission, pin:row.pin, roleId:row.roleId, inactiveFrom:row.inactiveFrom} : x));
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
    onUpdate("employees", [...employees, { ...newRow, id:Date.now().toString(), empCode, pin, restaurantId:rid }]);
    setNewRow(blank());
  }

  function toggleInactive(emp) {
    const row = getRow(emp);
    onUpdate("employees", employees.map(x => x.id===emp.id ? {...emp, inactive:!emp.inactive, inactiveFrom:row.inactiveFrom||today()} : x));
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

  return (
    <div style={{fontFamily:"'DM Mono',monospace"}}>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <button onClick={()=>setShowInactive(false)} style={{flex:1,padding:"8px",borderRadius:10,border:`1px solid ${!showInactive?"var(--green)":"var(--border)"}`,background:!showInactive?"#10b98122":"transparent",color:!showInactive?"var(--green)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:13}}>
          Ativos ({activeEmps.length})
        </button>
        <button onClick={()=>setShowInactive(true)} style={{flex:1,padding:"8px",borderRadius:10,border:`1px solid ${showInactive?"#8b5cf6":"var(--border)"}`,background:showInactive?"#8b5cf622":"transparent",color:showInactive?"#8b5cf6":"var(--text3)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:13}}>
          Inativos ({inactiveEmps.length}){isOwner && inactiveEmps.length>0 && " · clique ✕ p/ excluir"}
        </button>
      </div>

      {/* Assistente IA para empregados */}
      {!showInactive && (
        <div style={{marginBottom:14}}>
          <button onClick={()=>{setShowAiEmp(!showAiEmp);setAiEmpError("");}}
            style={{...S.btnSecondary,fontSize:12,display:"inline-flex",alignItems:"center",gap:6,padding:"7px 14px",
              background:showAiEmp?"var(--ac-bg)":undefined,borderColor:showAiEmp?"var(--ac)":undefined,color:showAiEmp?"var(--ac-text)":undefined}}>
            ✨ Importar empregados com IA
          </button>
          {showAiEmp && (
            <div style={{marginTop:10,padding:"14px",borderRadius:12,background:"var(--ac-bg)",border:"1px solid var(--ac)33"}}>
              <p style={{color:"var(--text2)",fontSize:13,margin:"0 0 6px",fontWeight:600}}>✨ Assistente de empregados — Gemini</p>
              <p style={{color:"var(--text3)",fontSize:12,margin:"0 0 6px",lineHeight:1.5}}>Cole uma lista de empregados. A IA identifica nome, cargo e data de admissão. PIN e CPF precisam ser ajustados manualmente.</p>
              <p style={{color:"var(--text3)",fontSize:11,margin:"0 0 10px",fontStyle:"italic"}}>Ex: "João Silva, garçom, admitido 01/03/2025; Maria Souza, barman; Pedro Lima, subchef desde jan/25"</p>
              <textarea value={aiEmpInput} onChange={e=>setAiEmpInput(e.target.value)}
                placeholder="Cole ou descreva os empregados aqui..." rows={4}
                style={{...S.input,resize:"vertical",marginBottom:8,fontSize:13}}/>
              {aiEmpError && <p style={{color:"var(--red)",fontSize:12,margin:"0 0 8px"}}>{aiEmpError}</p>}
              <div style={{display:"flex",gap:8}}>
                <button onClick={handleAiEmpregados} disabled={!aiEmpInput.trim()||aiEmpLoading}
                  style={{...S.btnPrimary,flex:1,fontSize:13,opacity:(!aiEmpInput.trim()||aiEmpLoading)?0.6:1}}>
                  {aiEmpLoading?"✨ Processando...":"✨ Adicionar empregados"}
                </button>
                <button onClick={()=>{setShowAiEmp(false);setAiEmpInput("");setAiEmpError("");}} style={S.btnSecondary}>Cancelar</button>
              </div>
              <p style={{color:"var(--text3)",fontSize:11,margin:"10px 0 0",fontStyle:"italic"}}>⚠️ Revise os dados após importar — PIN inicial = sequência numérica, empregado deve trocar no 1º acesso.</p>
            </div>
          )}
        </div>
      )}

      {/* Cabeçalho */}
      <div style={{display:"grid",gridTemplateColumns:EMP_COLS,gap:6,padding:"4px 8px",marginBottom:4}}>
        {["ID","Nome","CPF","Admissão","PIN","Cargo",""].map(h=>(
          <div key={h} style={{color:"var(--text3)",fontSize:10,fontWeight:700}}>{h}</div>
        ))}
      </div>

      {/* Linha de novo empregado */}
      {!showInactive && (
        <EmpRowLine isNew emp={null} row={newRow} restRoles={restRoles}
          isSaved={false} isOwner={isOwner}
          onChange={(f,v)=>setNewRow(p=>({...p,[f]:v}))}
          onAdd={saveNew} onSave={null} onToggleInactive={null} onDelete={null} onResetPin={null} employees={employees}/>
      )}

      {activeCount >= plano.empMax && (
        <div style={{background:"var(--red-bg)",border:"1px solid var(--red)33",borderRadius:12,padding:"14px 16px",marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
            <div>
              <div style={{color:"var(--red)",fontSize:13,fontWeight:700,marginBottom:2}}>⚠️ Limite do plano atingido — {activeCount}/{plano.empMax} empregados</div>
              <div style={{color:"var(--text3)",fontSize:12}}>Para adicionar mais empregados, solicite upgrade do plano.</div>
            </div>
            <button onClick={()=>{
              const PLANOS_LABEL = { p10:"Starter (10 emp.)", p20:"Básico (20 emp.)", p50:"Profissional (50 emp.)", p999:"Enterprise (51-100 emp.)", pOrc:"On Demand (+100 emp.)" };
              const PROXIMO = { p10:"p20", p20:"p50", p50:"p999", p999:"pOrc" };
              const planoAtual = PLANOS_LABEL[restaurant?.planoId??"p10"] ?? "Starter";
              const planoProx = PLANOS_LABEL[PROXIMO[restaurant?.planoId??"p10"]] ?? "Enterprise";
              const restNome = restaurant?.name ?? "Restaurante";

              // 1. Notificação na caixa do Admin
              if (onUpdate) {
                const notif = {
                  id: Date.now().toString(),
                  restaurantId: rid,
                  type: "upgrade_request",
                  body: `📦 Solicitação de upgrade — ${restNome}: plano atual ${planoAtual} → solicitado ${planoProx}. Empregados ativos: ${activeCount}/${plano.empMax}.`,
                  date: new Date().toISOString(),
                  read: false,
                  targetRole: "admin",
                };
                onUpdate("notifications", [...(notifications ?? []), notif]);
              }

              // 2. WhatsApp
              const msg = encodeURIComponent(`Olá! Sou gestor do restaurante *${restNome}*.\n\nGostaria de solicitar upgrade do plano:\n• Plano atual: *${planoAtual}*\n• Plano desejado: *${planoProx}*\n• Empregados ativos: ${activeCount}/${plano.empMax}\n\nAguardo retorno. Obrigado!`);
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
          <span style={{color:"#f59e0b",fontSize:12}}>⚡ {activeCount}/{plano.empMax} empregados — próximo do limite do plano</span>
        </div>
      )}

      {/* Agrupado por área */}
      {(() => {
        const groups = {};
        list.forEach(emp => {
          const role = restRoles.find(r=>r.id===emp.roleId);
          const area = role?.area ?? "Sem área";
          if (!groups[area]) groups[area] = [];
          groups[area].push(emp);
        });
        return Object.entries(groups).map(([area, emps]) => (
          <div key={area} style={{marginBottom:12}}>
            <div style={{color:AREA_COLORS[area]??"#888",fontSize:11,fontWeight:700,padding:"8px 8px 4px",borderBottom:`1px solid ${AREA_COLORS[area]??"var(--bg4)"}33`,marginBottom:4,letterSpacing:1}}>
              {area.toUpperCase()} · {emps.length} empregado{emps.length!==1?"s":""}
            </div>
            {emps.map(emp => {
              const row = getRow(emp);
              return (
                <EmpRowLine key={emp.id} isNew={false} emp={emp} row={row} restRoles={restRoles}
                  isSaved={saved[emp.id]} isOwner={isOwner}
                  onChange={(f,v)=>setField(emp.id,f,v)}
                  onSave={()=>saveEmp(emp)}
                  onToggleInactive={()=>toggleInactive(emp)}
                  onDelete={()=>deleteEmp(emp)}
                  onResetPin={resetPin}
                  employees={employees}/>
              );
            })}
          </div>
        ));
      })()}
    </div>
  );
}

function RestaurantPanel({ restaurant, restaurants, employees, roles, tips, splits, schedules, onUpdate, perms, isOwner, data, currentUser }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const mk = monthKey(year, month);
  const rid = restaurant.id;

  const curSplit  = splits?.[rid]?.[mk] ?? DEFAULT_SPLIT;
  const monthTips = tips.filter(t => t.restaurantId === rid && t.monthKey === mk);
  const tipDates  = [...new Set(monthTips.map(t => t.date))].sort();
  const totalGross = monthTips.reduce((a, t) => a + t.myShare, 0);
  const totalNet   = monthTips.reduce((a, t) => a + t.myNet, 0);
  const totalTax   = monthTips.reduce((a, t) => a + t.myTax, 0);

  const restEmps  = employees.filter(e => e.restaurantId === rid && !(e.inactive && e.inactiveFrom && e.inactiveFrom <= today()));
  const restRoles = roles.filter(r => r.restaurantId === rid);

  // forms
  const [tipDate, setTipDate]   = useState(today());
  const [tipTotal, setTipTotal] = useState("");
  const [tipNote, setTipNote]   = useState("");
  const [showTipTable, setShowTipTable] = useState(true);
  const [tipRows, setTipRows]   = useState([{date:today(),total:"",note:""}]);
  const [showRecalc, setShowRecalc] = useState(false);
  const [splitForm, setSplitForm]         = useState(null);
  const [schedArea, setSchedArea]           = useState("Todos");
  const [showAiSched, setShowAiSched]       = useState(false);
  const [aiSchedInput, setAiSchedInput]     = useState("");
  const [aiSchedLoading, setAiSchedLoading] = useState(false);
  const [aiSchedError, setAiSchedError]     = useState("");
  const [aiSchedPreview, setAiSchedPreview] = useState(null);

  const [showExport, setShowExport]       = useState(false);

  const empSummary = restEmps.map(e => {
    const eT = monthTips.filter(t => t.employeeId === e.id);
    const r = restRoles.find(r => r.id === e.roleId);
    return { ...e, roleName: r?.name, area: r?.area, gross: eT.reduce((a, t) => a + t.myShare, 0), net: eT.reduce((a, t) => a + t.myNet, 0) };
  }).sort((a, b) => b.net - a.net);

  function calcTipForDate(date, totalVal, noteVal) {
    const total = parseFloat(totalVal);
    if (!total || isNaN(total) || total <= 0) return 0;
    const td = new Date(date + "T12:00:00");
    const tKey = monthKey(td.getFullYear(), td.getMonth());
    const taxRate = restaurant.taxRate ?? TAX;
    const totalTaxAmt = total * taxRate;
    const toDistribute = total - totalTaxAmt;
    const mode = restaurant.divisionMode ?? MODE_AREA_POINTS;
    const empDayStatus = (empId) => { const m = schedules?.[rid]?.[tKey]?.[empId] ?? {}; return m[date]; };
    const isProd = (area) => area === "Produção";
    const activeEmps = restEmps.filter(emp => {
      const r = restRoles.find(r => r.id === emp.roleId);
      if (!r) return false;
      if (emp.admission && emp.admission > date) return false;
      if (emp.inactive && emp.inactiveFrom && emp.inactiveFrom <= date) return false;
      const status = empDayStatus(emp.id);
      if (!status) return true;
      if (status === DAY_COMP) return true;
      if (status === DAY_FAULT_J || status === DAY_FAULT_U) return false;
      if (status === DAY_VACATION) return false;
      if (isProd(r.area)) return true;
      return false;
    }).map(emp => ({ ...emp, points: parseFloat(restRoles.find(r=>r.id===emp.roleId)?.points) || 0, area: restRoles.find(r=>r.id===emp.roleId)?.area }));
    const newTips = [];
    if (mode === MODE_GLOBAL_POINTS) {
      const totalPoints = activeEmps.reduce((a,e)=>a+e.points,0);
      if (!totalPoints) return 0;
      activeEmps.forEach(emp => { const g=total*(emp.points/totalPoints),tx=totalTaxAmt*(emp.points/totalPoints); newTips.push({id:`${Date.now()}-${emp.id}-${Math.random().toString(36).slice(2,6)}`,restaurantId:rid,employeeId:emp.id,date,monthKey:tKey,poolTotal:total,areaPool:toDistribute,area:emp.area??"—",myShare:g,myTax:tx,myNet:g-tx,note:noteVal,taxRate}); });
    } else {
      const tSplit = splits?.[rid]?.[tKey] ?? DEFAULT_SPLIT;
      const byArea = {}; AREAS.forEach(a=>{byArea[a]=[];}); activeEmps.forEach(emp=>{if(emp.area)byArea[emp.area].push(emp);});
      AREAS.forEach(area => { const emps=byArea[area],tp=emps.reduce((a,e)=>a+e.points,0); if(!tp)return; const ap=toDistribute*(tSplit[area]/100); emps.forEach(emp=>{const g=total*(tSplit[area]/100)*(emp.points/tp),tx=totalTaxAmt*(tSplit[area]/100)*(emp.points/tp);newTips.push({id:`${Date.now()}-${emp.id}-${Math.random().toString(36).slice(2,6)}`,restaurantId:rid,employeeId:emp.id,date,monthKey:tKey,poolTotal:total,areaPool:ap,area,myShare:g,myTax:tx,myNet:g-tx,note:noteVal,taxRate});}); });
    }
    // Remove existing tips for this date before adding new ones (supports re-launch)
    const tipsWithoutDate = tips.filter(t => !(t.restaurantId === rid && t.date === date));
    onUpdate("tips", [...tipsWithoutDate, ...newTips]);
    return newTips.length;
  }

  function applyFaultPenalty(tKey, allTips) {
    // Find employees with falta injustificada this month
    const monthSchedule = schedules?.[rid]?.[tKey] ?? {};
    const penaltyEmps = restEmps.filter(emp => {
      const r = restRoles.find(r => r.id === emp.roleId);
      if (!r) return false;
      // Producao has fixed 4%, others use configured rate
      const rate = r.area === "Produção" ? 4 : (restaurant.faultPenalty?.[r.area] ?? 0);
      if (rate <= 0) return false;
      const empDayMap = monthSchedule[emp.id] ?? {};
      return Object.values(empDayMap).some(s => s === DAY_FAULT_U);
    });
    if (!penaltyEmps.length) return;

    // Total pool for the month
    const monthTipsLocal = allTips.filter(t => t.restaurantId === rid && t.monthKey === tKey);
    const monthPool = [...new Set(monthTipsLocal.map(t => t.date))]
      .reduce((sum, date) => {
        const dayTips = monthTipsLocal.filter(t => t.date === date);
        return sum + (dayTips[0]?.poolTotal ?? 0);
      }, 0);
    if (!monthPool) return;

    const updated = allTips.map(t => {
      if (t.restaurantId !== rid || t.monthKey !== tKey) return t;
      const emp = penaltyEmps.find(e => e.id === t.employeeId);
      if (!emp) return t;
      const r = restRoles.find(r => r.id === emp.roleId);
      const rate = r?.area === "Produção" ? 4 : (restaurant.faultPenalty?.[r?.area] ?? 0);
      const empDayMap = monthSchedule[emp.id] ?? {};
      const faultDays = Object.values(empDayMap).filter(s => s === DAY_FAULT_U).length;
      const totalPenalty = monthPool * (rate / 100) * faultDays;
      const empTipsCount = allTips.filter(x => x.restaurantId === rid && x.monthKey === tKey && x.employeeId === emp.id).length;
      const penaltyPerEntry = empTipsCount > 0 ? totalPenalty / empTipsCount : 0;
      return { ...t, myNet: Math.max(0, t.myNet - penaltyPerEntry), penalty: penaltyPerEntry };
    });
    onUpdate("tips", updated);
  }

  function recalcTipDay(date) {
    // Find existing tips for this date
    const existing = tips.filter(t => t.restaurantId === rid && t.date === date);
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
      if (emp.admission && emp.admission > date) return false;
      const status = empDayStatus(emp.id);
      if (!status) return true; // trabalho = entra
      if (status === DAY_COMP) return true; // compensacao = entra
      if (status === DAY_FAULT_J || status === DAY_FAULT_U) return false; // faltas = nao entra
      if (status === DAY_VACATION) return false; // ferias = nao entra
      if (r.area === "Produção") return true; // producao entra em folga
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
    const remaining = tips.filter(t => !(t.restaurantId === rid && t.date === date));
    onUpdate("tips", [...remaining, ...newTips]);
    return newTips.length;
  }

  function saveSplit() {
    const total = AREAS.reduce((a, k) => a + parseFloat(splitForm[k] || 0), 0);
    if (Math.abs(total - 100) > 0.01) { alert("Os percentuais devem somar 100%."); return; }
    onUpdate("splits", { ...splits, [rid]: { ...(splits?.[rid] ?? {}), [mk]: Object.fromEntries(AREAS.map(a => [a, parseFloat(splitForm[a])])) } });
    setSplitForm(null);
  }

  const areaEmps = schedArea === "Todos"
    ? restEmps.slice().sort((a,b) => {
        const aA = restRoles.find(r=>r.id===a.roleId)?.area ?? "z";
        const bA = restRoles.find(r=>r.id===b.roleId)?.area ?? "z";
        return aA.localeCompare(bA) || a.name.localeCompare(b.name);
      })
    : restEmps.filter(e => restRoles.find(r => r.id === e.roleId)?.area === schedArea);
  const dim = new Date(year, month + 1, 0).getDate();

  const ac = "var(--ac)";
  const canTips  = perms.tips     || isOwner;
  const canSched = perms.schedule || isOwner;
  const isDP     = perms.isDP === true;

  // Abas opcionais — admin autoriza via tabsConfig, gestor escolhe via tabsGestor
  const adminAutoriza = (key) => restaurant.tabsConfig?.[key] !== false;
  const gestorAtivou  = (key) => restaurant.tabsGestor?.[key] !== false;
  const tabVisible    = (key) => adminAutoriza(key) && (isOwner || gestorAtivou(key));

  const inboxUnread = ((data?.notifications??[]).filter(n=>n.restaurantId===rid&&!n.read).length + (data?.dpMessages??[]).filter(m=>m.restaurantId===rid&&!m.read).length);

  const TABS = [
    canTips                                           && ["dashboard",   "📊 Dashboard"],
    canTips                                           && ["tips",        "💸 Gorjetas"],
    canSched                                          && ["schedule",    "📅 Escala"],
    (isOwner || tabVisible("roles"))           && ["roles",       "🏷️ Cargos"],
    (isOwner || canTips || tabVisible("employees")) && ["employees","👥 Equipe"],
    tabVisible("horarios")                            && ["horarios",    "🕐 Horários"],
    tabVisible("recibos")                             && ["recibos",     "📄 Recibos"],
    tabVisible("faq")                                 && ["faq",         "❓ FAQ"],
    tabVisible("comunicados")                         && ["comunicados", "📢 Comunicados"],
    tabVisible("dp")                                  && ["dp",          "💬 Fale com DP"],
    (isOwner || isDP)                          && ["notificacoes",`📬 Caixa${inboxUnread>0?` (${inboxUnread})`:""}`],
  ].filter(Boolean);

  const [tab, setTab] = useState(isOwner ? "dashboard" : isDP ? "notificacoes" : (perms.tips ? "dashboard" : "schedule"));

  // Reset de aba — só Admin AppTip (isOwner)
  function resetTab(tabKey, tabLabel, getSnapshot) {
    if (!isOwner) return;
    if (!window.confirm(`Resetar "${tabLabel}"?\n\nOs dados ficam na lixeira por 7 dias e podem ser restaurados.`)) return;
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

  return (
    <div style={{ fontFamily:"'DM Sans',sans-serif" }}>
      {/* Restaurant sub-header */}
      <div style={{ background:"var(--bg2)", borderBottom:"1px solid var(--border)", padding:"10px 16px", display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
        <div style={{display:"flex",alignItems:"center",gap:8,minWidth:0}}>
          <div style={{minWidth:0}}>
            <span style={{ color:"var(--text)", fontWeight:700, fontSize:14 }}>{restaurant.name}</span>
            {restaurant.cnpj && <span style={{ color:"var(--text3)", fontSize:11, marginLeft:8 }}>{restaurant.cnpj}</span>}
          </div>
        </div>
        {(canTips || isOwner) && (
          <button onClick={() => setTab("config")}
            style={{ ...S.btnSecondary, fontSize:12, flexShrink:0, display:"flex", alignItems:"center", gap:4,
              background: tab==="config" ? "var(--ac-bg)" : undefined,
              borderColor: tab==="config" ? ac : undefined,
              color: tab==="config" ? "var(--ac-text)" : undefined }}>
            ⚙️ Configurações
          </button>
        )}
      </div>

      {/* Tabs com scroll suave */}
      <div style={{ display:"flex", borderBottom:"1px solid var(--border)", background:"var(--header-bg)", overflowX:"auto", scrollbarWidth:"none", WebkitOverflowScrolling:"touch" }}>
        {TABS.map(([id, lbl]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding:"11px 16px", background:"none", border:"none", borderBottom:`2px solid ${tab===id?ac:"transparent"}`, color:tab===id?ac:"var(--text3)", cursor:"pointer", fontSize:13, fontFamily:"'DM Sans',sans-serif", fontWeight:tab===id?700:500, whiteSpace:"nowrap", flexShrink:0 }}>
            {lbl}
          </button>
        ))}
      </div>

      <div style={{ padding:"20px 24px", maxWidth:1100, margin:"0 auto" }}>
        {["dashboard","tips","schedule"].includes(tab) && (
          <div style={{ marginBottom: 20 }}><MonthNav year={year} month={month} onChange={(y,m)=>{setYear(y);setMonth(m);}} /></div>
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
          const dpNaoLidas = (data?.dpMessages??[]).filter(m=>m.restaurantId===rid&&!m.read).length;
          const commsSemCiencia = (data?.communications??[]).filter(c=>
            c.restaurantId===rid && !c.autoSchedule &&
            restEmps.some(e=>!(data?.commAcks??{})[`${c.id}_${e.id}`])
          ).length;

          const alerts = [];
          if (diasSemLancamento > 0)
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
            .filter(m=>m.restaurantId===rid)
            .sort((a,b)=>b.date.localeCompare(a.date))
            .slice(0,4);
          const recentNotifs = (data?.notifications??[])
            .filter(n=>n.restaurantId===rid)
            .sort((a,b)=>b.date.localeCompare(a.date))
            .slice(0,3);
          const CATS = { sugestao:"💡", elogio:"👏", reclamacao:"⚠️", denuncia:"🚨" };

          // — Resumo do dia —
          const todayTips = monthTips.filter(t => t.date === todayStr);
          const gorjetaHoje = todayTips.length > 0 ? todayTips[0].poolTotal : null;
          const escalaHoje = schedules?.[rid]?.[mk] ?? {};
          const trabalhando = restEmps.filter(e => {
            const status = (escalaHoje[e.id] ?? {})[todayStr];
            return !status || status === "C"; // sem marcação ou compensação = trabalhando
          }).length;

          return (
            <div>
              {/* Resumo do dia — só no mês atual */}
              {isCurrentMonth && (
                <div style={{...S.card, marginBottom:14, background:"var(--ac-bg)", border:"1px solid var(--ac)22"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                    <span style={{color:"var(--ac-text)",fontWeight:700,fontSize:13}}>📅 Hoje — {new Date().toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long"})}</span>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                    <div style={{background:"var(--card-bg)",borderRadius:10,padding:"12px 10px",textAlign:"center"}}>
                      <div style={{fontSize:20,marginBottom:4}}>👥</div>
                      <div style={{color:"var(--text)",fontWeight:700,fontSize:18}}>{trabalhando}</div>
                      <div style={{color:"var(--text3)",fontSize:10,marginTop:2}}>trabalhando</div>
                    </div>
                    <div style={{background:"var(--card-bg)",borderRadius:10,padding:"12px 10px",textAlign:"center"}}>
                      <div style={{fontSize:20,marginBottom:4}}>💸</div>
                      <div style={{color: gorjetaHoje!==null?"var(--green)":"var(--text3)", fontWeight:700,fontSize:gorjetaHoje!==null?15:13}}>
                        {gorjetaHoje !== null ? fmt(gorjetaHoje) : "—"}
                      </div>
                      <div style={{color:"var(--text3)",fontSize:10,marginTop:2}}>gorjeta lançada</div>
                    </div>
                    <div style={{background:"var(--card-bg)",borderRadius:10,padding:"12px 10px",textAlign:"center"}}>
                      <div style={{fontSize:20,marginBottom:4}}>{diasSemLancamento>0?"⚠️":"✅"}</div>
                      <div style={{color:diasSemLancamento>0?"#f59e0b":"var(--green)",fontWeight:700,fontSize:15}}>
                        {diasSemLancamento>0 ? `${diasSemLancamento}d` : "Em dia"}
                      </div>
                      <div style={{color:"var(--text3)",fontSize:10,marginTop:2}}>pendência gorjeta</div>
                    </div>
                  </div>
                  {gorjetaHoje === null && isCurrentMonth && (
                    <button onClick={()=>setTab("tips")}
                      style={{...S.btnPrimary, width:"100%", marginTop:10, padding:"10px", fontSize:13}}>
                      💸 Lançar gorjeta de hoje
                    </button>
                  )}
                </div>
              )}
              <div style={{...S.card, marginBottom:14}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <span style={{color:ac,fontWeight:700,fontSize:13}}>💸 Gorjetas — {monthLabel(year,month)}</span>
                  <button onClick={()=>setTab("tips")} style={{...S.btnSecondary,fontSize:11,padding:"4px 10px"}}>Ver tudo →</button>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8}}>
                  {[
                    ["Pool total",    fmt(tipPoolTotal), "#fff"],
                    ["Retenção",      fmt(totalTax),     "var(--red)"],
                    ["Distribuído",   fmt(totalNet),     ac],
                    ["Dias resolvidos", `${diasResolvidos}/${dim}`, diasResolvidos===dim?"var(--green)":diasResolvidos>=diasUteisPassados?"var(--green)":"#f59e0b"],
                  ].map(([lbl,val,col])=>(
                    <div key={lbl} style={{background:"var(--bg1)",borderRadius:10,padding:"10px 8px",textAlign:"center"}}>
                      <div style={{color:"var(--text3)",fontSize:9,marginBottom:4,lineHeight:1.2}}>{lbl}</div>
                      <div style={{color:col,fontWeight:700,fontSize:13}}>{val}</div>
                    </div>
                  ))}
                </div>
                {(restaurant.divisionMode ?? MODE_AREA_POINTS) === MODE_AREA_POINTS && totalNet > 0 && (
                  <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:5}}>
                    {AREAS.map(a=>{
                      const aNet = monthTips.filter(t=>t.area===a).reduce((s,t)=>s+t.myNet,0);
                      if(!aNet) return null;
                      return (
                        <div key={a} style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{color:AREA_COLORS[a],fontSize:11,minWidth:70,fontWeight:600}}>{a}</span>
                          <div style={{flex:1,background:"var(--bg2)",borderRadius:4,height:5,overflow:"hidden"}}>
                            <div style={{width:`${(aNet/totalNet)*100}%`,height:"100%",background:AREA_COLORS[a],borderRadius:4}}/>
                          </div>
                          <span style={{color:"var(--text2)",fontSize:11,minWidth:70,textAlign:"right"}}>{fmt(aNet)}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Pendências */}
              {alerts.length > 0 ? (
                <div style={{...S.card,marginBottom:14,border:"1px solid var(--red)33",background:"#fef2f2"}}>
                  <span style={{color:"var(--red)",fontWeight:700,fontSize:13,display:"block",marginBottom:10}}>⚡ Pendências</span>
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
                    <span style={{color:ac,fontWeight:700,fontSize:13}}>📬 Recentes</span>
                    <button onClick={()=>setTab("notificacoes")} style={{...S.btnSecondary,fontSize:11,padding:"4px 10px"}}>Ver tudo →</button>
                  </div>
                  {recentDp.map(m=>(
                    <div key={m.id} style={{display:"flex",gap:10,padding:"8px 0",borderBottom:"1px solid var(--border)",alignItems:"flex-start"}}>
                      <span style={{fontSize:14,flexShrink:0}}>{CATS[m.category]??"💬"}</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",justifyContent:"space-between",gap:6}}>
                          <span style={{color:m.read?"var(--text3)":"var(--text)",fontSize:12,fontWeight:m.read?400:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.empName}</span>
                          <span style={{color:"var(--text3)",fontSize:10,flexShrink:0}}>{new Date(m.date).toLocaleDateString("pt-BR")}</span>
                        </div>
                        <p style={{color:"var(--text3)",fontSize:11,margin:"2px 0 0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.body}</p>
                      </div>
                      {!m.read && <span style={{background:"#3b82f6",borderRadius:4,padding:"1px 5px",fontSize:9,color:"var(--text)",fontWeight:700,flexShrink:0}}>Novo</span>}
                    </div>
                  ))}
                  {recentNotifs.map(n=>(
                    <div key={n.id} style={{display:"flex",gap:10,padding:"8px 0",borderBottom:"1px solid var(--border)",alignItems:"flex-start"}}>
                      <span style={{fontSize:14,flexShrink:0}}>📋</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:"flex",justifyContent:"space-between",gap:6}}>
                          <span style={{color:n.read?"var(--text3)":"var(--text)",fontSize:12,fontWeight:n.read?400:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{n.body?.split("\n")[0]?.replace("📋 ","")}</span>
                          <span style={{color:"var(--text3)",fontSize:10,flexShrink:0}}>{new Date(n.date).toLocaleDateString("pt-BR")}</span>
                        </div>
                      </div>
                      {!n.read && <span style={{background:"#f59e0b",borderRadius:4,padding:"1px 5px",fontSize:9,color:"var(--text)",fontWeight:700,flexShrink:0}}>Novo</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* Ações rápidas */}
              <div style={{...S.card}}>
                <span style={{color:ac,fontWeight:700,fontSize:13,display:"block",marginBottom:10}}>⚡ Ações rápidas</span>
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
              </div>
            </div>
          );
        })()}

        {/* GORJETAS */}
        {tab === "tips" && (
          <div>
            {/* Export button inside tips tab */}
            {canTips && (
              <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginBottom:12}}>
                {isOwner && <button onClick={()=>{
                  const ok = resetTab("tips","Gorjetas",()=>({tips:tips.filter(t=>t.restaurantId===rid), splits:splits?.[rid]}));
                  if(ok){ onUpdate("tips",tips.filter(t=>t.restaurantId!==rid)); onUpdate("_toast","🗑️ Gorjetas enviadas para a lixeira"); }
                }} style={{...S.btnSecondary,fontSize:12,color:"var(--red)",borderColor:"var(--red)44"}}>🗑️ Resetar gorjetas</button>}
                <button onClick={() => setShowExport(true)} style={{ ...S.btnSecondary, fontSize: 12, color: ac, borderColor: ac }}>📤 Exportar Gorjeta</button>
              </div>
            )}
            <div style={{ ...S.card, marginBottom: 24 }}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <p style={{ color: ac, fontSize: 14, margin: 0, fontWeight: 700 }}>💸 Lançar Gorjeta</p>
                <button onClick={()=>setShowTipTable(!showTipTable)} style={{...S.btnSecondary,fontSize:11,padding:"4px 10px"}}>
                  {showTipTable ? "Modo simples" : "Modo tabela"}
                </button>
              </div>

              {!showTipTable ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div><label style={S.label}>Data</label><input type="date" value={tipDate} onChange={e => setTipDate(e.target.value)} style={S.input} /></div>
                <div><label style={S.label}>Valor Total (R$)</label><input type="number" min="0" step="0.01" value={tipTotal} onChange={e => setTipTotal(e.target.value)} placeholder="Ex: 1500.00" style={S.input} /></div>
                <div><label style={S.label}>Observação</label><input value={tipNote} onChange={e => setTipNote(e.target.value)} placeholder="Ex: Sábado à noite" style={S.input} /></div>
                <button onClick={() => { const n = calcTipForDate(tipDate, tipTotal, tipNote); if (n > 0) { setTipTotal(""); setTipNote(""); onUpdate("_toast", `✅ Distribuído para ${n} empregados!`); } }} style={S.btnPrimary}>Calcular e Distribuir</button>
              </div>
              ) : (
              /* MODO TABELA */
              (() => {
                const daysInMonth = new Date(year, month+1, 0).getDate();
                const taxRate = restaurant.taxRate ?? TAX;
                const tSplit = splits?.[rid]?.[mk] ?? DEFAULT_SPLIT;
                const mode = restaurant.divisionMode ?? MODE_AREA_POINTS;
                const noTipDays = data?.noTipDays?.[rid] ?? [];

                const allDays = Array.from({length: daysInMonth}, (_, i) => {
                  const d = i+1;
                  return `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                });

                const pendingRows = tipRows.filter(r => {
                  const v = parseFloat(r.total);
                  return v > 0 && !isNaN(v) && !monthTips.some(t=>t.date===r.date) && !noTipDays.includes(r.date);
                });

                const setNoTip = (date, checked) => {
                  const updated = { ...(data?.noTipDays??{}), [rid]: checked ? [...noTipDays.filter(d=>d!==date), date] : noTipDays.filter(d=>d!==date) };
                  onUpdate("noTipDays", updated);
                  if (checked) setTipRows(prev => prev.filter(r => r.date !== date));
                };

                return (
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <span style={{color:"var(--text3)",fontSize:12}}>{monthLabel(year,month)} — {daysInMonth} dias</span>
                      <MonthNav year={year} month={month} onChange={(y,m)=>{setYear(y);setMonth(m);}} />
                    </div>

                    {/* Cabeçalho */}
                    <div style={{display:"grid",gridTemplateColumns:"46px 1fr 1fr 100px 90px",gap:6,padding:"0 8px 4px",marginBottom:2}}>
                      {["","Valor (R$)","Observação","Sem gorjeta",""].map((h,i)=>(
                        <div key={i} style={{color:"var(--text3)",fontSize:10,fontWeight:700,textAlign:i===3?"center":"left"}}>{h}</div>
                      ))}
                    </div>

                    {allDays.map(date => {
                      const isNoTip    = noTipDays.includes(date);
                      const dayTips    = monthTips.filter(t => t.date === date);
                      const isLaunched = dayTips.length > 0;
                      const launchedPool = isLaunched ? dayTips[0].poolTotal : null;

                      const row = tipRows.find(r => r.date === date) ?? {
                        date,
                        total: launchedPool != null ? String(launchedPool) : "",
                        note:  isLaunched ? (dayTips[0].note ?? "") : ""
                      };
                      const val    = parseFloat(row.total);
                      const hasVal = val > 0 && !isNaN(val);
                      const isDirty = isLaunched && launchedPool != null && hasVal && val !== launchedPool;

                      const weekday  = new Date(date+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"short"});
                      const isWeekend = [0,6].includes(new Date(date+"T12:00:00").getDay());

                      let bg = "#fff", border = "var(--border)";
                      if      (isNoTip)               { bg = "#f5f0ff"; border = "#6366f133"; }
                      else if (isLaunched && !isDirty) { bg = "#f0fdf4"; border = "#10b98133"; }
                      else if (isDirty)                { bg = "#fffbeb"; border = "#f59e0b44"; }
                      else if (hasVal)                 { bg = "#faf8f4"; border = "var(--ac)33"; }

                      return (
                        <div key={date} style={{display:"grid",gridTemplateColumns:"46px 1fr 1fr 100px 90px",gap:6,padding:"5px 8px",marginBottom:4,borderRadius:10,background:bg,border:`1px solid ${border}`,alignItems:"center"}}>

                          {/* Data */}
                          <div style={{textAlign:"center"}}>
                            <div style={{color:isWeekend?"#f59e0b":isNoTip?"#818cf8":isLaunched?"var(--green)":"var(--text3)",fontSize:13,fontWeight:700}}>{parseInt(date.slice(-2))}</div>
                            <div style={{color:"var(--text3)",fontSize:9}}>{weekday}</div>
                          </div>

                          {/* Valor */}
                          <input
                            type="number" min="0" step="0.01"
                            value={isNoTip ? "" : row.total}
                            disabled={isNoTip}
                            onChange={e=>{ const nr=tipRows.filter(r=>r.date!==date); setTipRows([...nr,{...row,total:e.target.value}]); }}
                            placeholder="0,00"
                            style={{...S.input, fontSize:13, padding:"6px 8px",
                              background:  isNoTip?"#f5f0ff"  : isDirty?"#fef9e7" : isLaunched?"#e8faf0" : "var(--bg2)",
                              color:       isNoTip?"#6366f1"  : isDirty?"#f59e0b" : isLaunched?"var(--green)" : "var(--text)",
                              borderColor: isNoTip?"transparent": isDirty?"#f59e0b44": isLaunched?"#10b98133": "var(--border)",
                              cursor:      isNoTip?"not-allowed" : "text",
                            }}
                          />

                          {/* Observação */}
                          <input
                            value={isNoTip ? "" : row.note}
                            disabled={isNoTip}
                            onChange={e=>{ const nr=tipRows.filter(r=>r.date!==date); setTipRows([...nr,{...row,note:e.target.value}]); }}
                            placeholder={isNoTip ? "—" : "Observação"}
                            style={{...S.input, fontSize:12, padding:"6px 8px",
                              background: isNoTip?"#f5f0ff":"var(--input-bg)",
                              color:      isNoTip?"#6366f1":"var(--text)",
                              cursor:     isNoTip?"not-allowed":"text",
                            }}
                          />

                          {/* Checkbox sem gorjeta */}
                          <label style={{display:"flex",flexDirection:"column",alignItems:"center",gap:3,cursor:isLaunched?"default":"pointer",userSelect:"none",opacity:isLaunched?0.3:1}}>
                            <input
                              type="checkbox"
                              checked={isNoTip}
                              disabled={isLaunched}
                              onChange={e=>setNoTip(date, e.target.checked)}
                              style={{width:18,height:18,cursor:isLaunched?"default":"pointer",accentColor:"#6366f1"}}
                            />
                            <span style={{fontSize:9,color:isNoTip?"#818cf8":"#555",fontFamily:"'DM Mono',monospace"}}>Sem gorjeta</span>
                          </label>

                          {/* Ação */}
                          <div style={{display:"flex",justifyContent:"center",gap:4,alignItems:"center"}}>
                            {!isLaunched && !isNoTip && hasVal && (
                              <button onClick={()=>{
                                const n=calcTipForDate(date,val,row.note);
                                if(n>0){setTipRows(prev=>prev.filter(r=>r.date!==date));onUpdate("_toast",`✅ ${fmtDate(date)}: ${n} emp.`);}
                              }} style={{padding:"5px 12px",borderRadius:8,border:"none",background:ac,color:"#1c1710",fontWeight:700,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:11,whiteSpace:"nowrap"}}>
                                Lançar
                              </button>
                            )}
                            {isLaunched && isDirty && hasVal && (
                              <button onClick={()=>{
                                const n=calcTipForDate(date,val,row.note);
                                if(n>0){setTipRows(prev=>prev.filter(r=>r.date!==date));onUpdate("_toast",`✏️ atualizado`);}
                              }} style={{padding:"5px 10px",borderRadius:8,border:"none",background:"#f59e0b",color:"var(--text)",fontWeight:700,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:11,whiteSpace:"nowrap"}}>
                                Salvar
                              </button>
                            )}
                            {isLaunched && !isDirty && <span style={{color:"var(--green)",fontSize:16}}>✓</span>}
                            {isLaunched && (
                              <button onClick={()=>{
                                if(!window.confirm(`Zerar gorjeta de ${fmtDate(date)}?`)) return;
                                onUpdate("tips",tips.filter(t=>!(t.restaurantId===rid&&t.date===date)));
                                setTipRows(prev=>prev.filter(r=>r.date!==date));
                                onUpdate("_toast",`🗑️ ${fmtDate(date)}: removido`);
                              }} style={{padding:"4px 7px",borderRadius:7,border:"1px solid #ef444433",background:"transparent",color:"var(--red)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>
                                ✕
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {pendingRows.length > 0 && (
                      <button onClick={()=>{
                        let count=0;
                        pendingRows.forEach(row=>{ count+=calcTipForDate(row.date,parseFloat(row.total),row.note); });
                        setTipRows(prev=>prev.filter(r=>!pendingRows.some(p=>p.date===r.date)));
                        if(count>0) onUpdate("_toast",`✅ ${pendingRows.length} dias lançados!`);
                      }} style={{...S.btnPrimary,marginTop:8}}>
                        Lançar Todos Preenchidos ({pendingRows.length})
                      </button>
                    )}
                  </div>
                );
              })()
              )}
            </div>

            {/* Recalcular periodo */}
            <div style={{...S.card, marginBottom:16, background:"var(--bg2)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <p style={{color:"#f59e0b",fontSize:13,fontWeight:700,margin:0}}>🔄 Recalcular por Escala</p>
                  <p style={{color:"var(--text3)",fontSize:11,margin:"2px 0 0"}}>Recalcula lançamentos existentes respeitando a escala atual</p>
                </div>
                <button onClick={()=>setShowRecalc(!showRecalc)} style={{...S.btnSecondary,fontSize:12}}>{showRecalc?"Fechar":"Ver"}</button>
              </div>
              {showRecalc && (
                <div style={{marginTop:14}}>
                  {tipDates.length === 0 && <p style={{color:"var(--text3)",fontSize:13}}>Nenhum lançamento para recalcular neste mês.</p>}
                  {tipDates.map(d => (
                    <div key={d} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid var(--border)"}}>
                      <span style={{color:"var(--text2)",fontSize:13}}>{fmtDate(d)}</span>
                      <button onClick={()=>{const n=recalcTipDay(d);onUpdate("_toast",`🔄 Dia ${fmtDate(d)} recalculado para ${n} empregados`);}} style={{padding:"6px 14px",borderRadius:8,border:"1px solid #f59e0b44",background:"transparent",color:"#f59e0b",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>Recalcular</button>
                    </div>
                  ))}
                  {tipDates.length > 1 && (
                    <button onClick={()=>{let total=0;tipDates.forEach(d=>{total+=recalcTipDay(d);});onUpdate("_toast",`🔄 ${tipDates.length} dias recalculados!`);}} style={{...S.btnPrimary,marginTop:12,background:"#f59e0b"}}>Recalcular Todos os Dias do Mês</button>
                  )}
                </div>
              )}
            </div>

            {tipDates.length === 0 && <p style={{ color: "var(--text3)", textAlign: "center" }}>Nenhum lançamento neste mês.</p>}
            {tipDates.map(d => {
              const dT = monthTips.filter(t => t.date === d);
              return (
                <div key={d} style={{ ...S.card, marginBottom: 10 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",marginBottom:10 }}>
                    <span style={{color:"var(--text2)"}}>{fmtDate(d)}</span>
                    <div style={{textAlign:"right"}}><div style={{color:"var(--text)",fontSize:12}}>Pool: {fmt(dT[0]?.poolTotal)}</div><div style={{color:ac,fontSize:12}}>Dist: {fmt(dT.reduce((a,t)=>a+t.myNet,0))}</div></div>
                  </div>
                  {AREAS.map(a => {
                    const aT = dT.filter(t => t.area === a);
                    if (!aT.length) return null;
                    return (
                      <div key={a} style={{borderTop:"1px solid var(--border)",paddingTop:8,marginTop:8}}>
                        <div style={{marginBottom:4}}><AreaBadge area={a} /></div>
                        {aT.map(t => {
                          const emp = restEmps.find(e => e.id === t.employeeId);
                          return <div key={t.id} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"3px 0"}}><span style={{color:"var(--text2)"}}>{emp?.name??"—"}</span><div><span style={{color:"var(--text)"}}>{fmt(t.myShare)}</span><span style={{color:"var(--red)",marginLeft:8}}>-{fmt(t.myTax)}</span><span style={{color:ac,marginLeft:8,fontWeight:700}}>{fmt(t.myNet)}</span></div></div>;
                        })}
                      </div>
                    );
                  })}
                  <button onClick={()=>{const ids=new Set(dT.map(t=>t.id));onUpdate("tips",tips.filter(t=>!ids.has(t.id)));onUpdate("_toast","Lançamento removido.");}} style={{marginTop:10,background:"none",border:"1px solid #e74c3c33",borderRadius:8,color:"var(--red)",cursor:"pointer",fontSize:12,padding:"4px 12px",fontFamily:"'DM Mono',monospace"}}>Remover lançamento</button>
                </div>
              );
            })}
          </div>
        )}

        {/* EQUIPE */}
        {tab === "employees" && (
          <div>
            {isOwner && <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8,paddingRight:16,paddingTop:12}}>
              <button onClick={()=>{
                const emps = employees.filter(e=>e.restaurantId===rid);
                const ok = resetTab("employees","Equipe",()=>({employees:emps}));
                if(ok){ onUpdate("employees",employees.filter(e=>e.restaurantId!==rid)); onUpdate("_toast","🗑️ Equipe enviada para a lixeira"); }
              }} style={{...S.btnSecondary,fontSize:12,color:"var(--red)",borderColor:"var(--red)44"}}>🗑️ Resetar equipe</button>
            </div>}
            <EmployeeSpreadsheet
              restEmps={employees.filter(e => e.restaurantId === rid)}
              restRoles={restRoles} rid={rid}
              employees={employees} onUpdate={onUpdate} restCode={restaurant.shortCode}
              isOwner={isOwner} restaurant={restaurant}
              notifications={data?.notifications??[]}
            />
          </div>
        )}

        {/* CARGOS (super only) */}
        {tab === "roles" && (
          <div>
            {isOwner && <div style={{display:"flex",justifyContent:"flex-end",marginBottom:8,paddingRight:16,paddingTop:12}}>
              <button onClick={()=>{
                const ok = resetTab("roles","Cargos",()=>({roles:roles.filter(r=>r.restaurantId===rid)}));
                if(ok){ onUpdate("roles",roles.filter(r=>r.restaurantId!==rid)); onUpdate("_toast","🗑️ Cargos enviados para a lixeira"); }
              }} style={{...S.btnSecondary,fontSize:12,color:"var(--red)",borderColor:"var(--red)44"}}>🗑️ Resetar cargos</button>
            </div>}
            <RoleSpreadsheet
              restRoles={restRoles} rid={rid}
              roles={roles} onUpdate={onUpdate}
            />
          </div>
        )}

        {/* ESCALA */}
        {tab === "schedule" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
              <div style={{flex:1}}><PillBar options={["Todos", ...AREAS]} value={schedArea} onChange={setSchedArea}/></div>
              <div style={{display:"flex",gap:8}}>
                {isOwner && <button onClick={()=>{
                  const ok = resetTab("schedule","Escala",()=>({schedules:schedules?.[rid]}));
                  if(ok){ const s={...schedules}; delete s[rid]; onUpdate("schedules",s); onUpdate("_toast","🗑️ Escala enviada para a lixeira"); }
                }} style={{...S.btnSecondary,fontSize:12,color:"var(--red)",borderColor:"var(--red)44"}}>🗑️ Resetar escala</button>}
                <div style={{display:"flex",gap:4}}>
                  <button onClick={()=>{setYear(month===0?year-1:year);setMonth(month===0?11:month-1);}} style={{...S.btnSecondary,padding:"6px 10px",fontSize:13}}>‹</button>
                  <span style={{color:"var(--text2)",fontSize:12,padding:"6px 8px",background:"var(--card-bg)",borderRadius:8,whiteSpace:"nowrap"}}>{monthLabel(year,month)}</span>
                  <button onClick={()=>{setYear(month===11?year+1:year);setMonth(month===11?0:month+1);}} style={{...S.btnSecondary,padding:"6px 10px",fontSize:13}}>›</button>
                </div>

                {/* Pre-fill contract days off */}
                <button onClick={()=>{
                  const emps = areaEmps;
                  if (!emps.length) return;
                  const mesNome = monthLabel(year, month);
                  if (!window.confirm(`Aplicar folgas do contrato em ${mesNome}?\n\nIsso vai:\n• Marcar como Folga todos os dias do contrato\n• Remover folgas marcadas em dias que NÃO são de folga no contrato\n\nOutros status (férias, faltas, compensações) não serão alterados.`)) return;
                  const daysInMonth = new Date(year, month+1, 0).getDate();
                  let newSchedules = { ...schedules };
                  let added = 0, removed = 0;
                  emps.forEach(emp => {
                    const empScheds = data?.workSchedules?.[rid]?.[emp.id] ?? [];
                    const currentSched = empScheds[empScheds.length - 1];
                    if (!currentSched) return;
                    // Dias SEM turno no contrato = folga fixa
                    const folgaDays = new Set([0,1,2,3,4,5,6].filter(d => !currentSched.days[d]?.in || !currentSched.days[d]?.out));
                    const empDayMap = { ...(newSchedules?.[rid]?.[mk]?.[emp.id] ?? {}) };
                    for (let d = 1; d <= daysInMonth; d++) {
                      const date = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                      const weekday = new Date(date+"T12:00:00").getDay();
                      const current = empDayMap[date];
                      if (folgaDays.has(weekday)) {
                        // Dia de folga no contrato → marca como DAY_OFF (sobrescreve se já era DAY_OFF, senão só se estiver vazio)
                        if (!current) { empDayMap[date] = DAY_OFF; added++; }
                        else if (current === DAY_OFF) { /* já correto, não conta */ }
                        // se tiver outro status (férias, falta, etc.) respeita
                      } else {
                        // Dia de trabalho no contrato → se estiver marcado como DAY_OFF, remove
                        if (current === DAY_OFF) { delete empDayMap[date]; removed++; }
                      }
                    }
                    newSchedules = {
                      ...newSchedules,
                      [rid]: { ...(newSchedules?.[rid]??{}), [mk]: { ...(newSchedules?.[rid]?.[mk]??{}), [emp.id]: empDayMap } }
                    };
                  });
                  onUpdate("schedules", newSchedules);
                  const parts = [];
                  if (added) parts.push(`${added} folga(s) adicionada(s)`);
                  if (removed) parts.push(`${removed} folga(s) removida(s) fora do contrato`);
                  onUpdate("_toast", parts.length ? `✅ ${parts.join(" · ")}` : "Escala já está de acordo com o contrato");
                }} style={{padding:"8px 12px",borderRadius:10,border:"1px solid #e74c3c44",background:"transparent",color:"var(--red)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12,whiteSpace:"nowrap"}}>
                  📅 Folgas do contrato
                </button>
                <button onClick={async () => {
                  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
                  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
                  const { jsPDF } = window.jspdf;
                  const doc = new jsPDF({ orientation:"landscape", unit:"mm", format:"a4" });
                  const daysInMonth = new Date(year, month+1, 0).getDate();
                  const STATUS_SHORT = {off:"F",comp:"C",vac:"FÉR",faultj:"FJ",faultu:"FI"};
                  // Colors: work=green, off=red, comp=blue, vac=purple, faultj=orange, faultu=dark red
                  const STATUS_COLORS = {
                    work: [39,174,96],
                    off:  [231,76,60],
                    comp: [59,130,246],
                    vac:  [139,92,246],
                    faultj:[245,158,11],
                    faultu:[180,30,30],
                  };

                  doc.setFontSize(11);
                  doc.setTextColor(30,30,30);
                  doc.text(`Escala — ${schedArea} — ${monthLabel(year,month)} — ${restaurant.name}`, 14, 12);

                  // Legend
                  const legend = [
                    ["T  Trabalho", STATUS_COLORS.work],
                    ["F  Folga", STATUS_COLORS.off],
                    ["C  Compensação", STATUS_COLORS.comp],
                    ["FÉR  Férias", STATUS_COLORS.vac],
                    ["FJ  Falta Just.", STATUS_COLORS.faultj],
                    ["FI  Falta Injust.", STATUS_COLORS.faultu],
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

                  // Build head row: name + days + T
                  const head = [["Empregado", ...Array.from({length:daysInMonth},(_,i)=>String(i+1)), "T"]];

                  // Build body rows
                  const body = areaEmps.map(emp => {
                    const role = restRoles.find(r=>r.id===emp.roleId);
                    const dayMap = schedules?.[rid]?.[mk]?.[emp.id] ?? {};
                    let workDays = 0;
                    const dayCells = Array.from({length:daysInMonth},(_,i)=>{
                      const k = `${year}-${String(month+1).padStart(2,"0")}-${String(i+1).padStart(2,"0")}`;
                      const s = dayMap[k];
                      if(!s) { workDays++; return "T"; }
                      return STATUS_SHORT[s] ?? "";
                    });
                    return [`${emp.name}\n${role?.name??""}`, ...dayCells, String(workDays)];
                  });

                  doc.autoTable({
                    head, body,
                    startY: 21,
                    styles: { fontSize: 6, cellPadding: 1.2, halign:"center", textColor:[255,255,255], lineColor:[180,180,180], lineWidth:0.1 },
                    headStyles: { fillColor:[40,40,40], textColor:[220,220,220], fontStyle:"bold", fontSize:6 },
                    columnStyles: { 0: { halign:"left", cellWidth:30, fontSize:6.5, textColor:[30,30,30] } },
                    didDrawCell: (data) => {
                      if(data.section==="body" && data.column.index > 0 && data.column.index <= daysInMonth) {
                        const dayIdx = data.column.index - 1;
                        const emp = areaEmps[data.row.index];
                        if(!emp) return;
                        const k = `${year}-${String(month+1).padStart(2,"0")}-${String(dayIdx+1).padStart(2,"0")}`;
                        const s = schedules?.[rid]?.[mk]?.[emp.id]?.[k];
                        const {x,y,width,height} = data.cell;
                        // Work day (no status) = green
                        const color = !s ? STATUS_COLORS.work : STATUS_COLORS[s];
                        const label = !s ? "T" : (STATUS_SHORT[s] ?? "");
                        if(color) {
                          doc.setFillColor(...color);
                          doc.rect(x,y,width,height,"F");
                          doc.setTextColor(255,255,255);
                          doc.setFontSize(5);
                          doc.text(label, x+width/2, y+height/2+1.2, {align:"center"});
                        }
                      }
                      // Last column (T = work days count) - style it
                      if(data.section==="body" && data.column.index === daysInMonth+1) {
                        const {x,y,width,height} = data.cell;
                        doc.setFillColor(40,40,40);
                        doc.rect(x,y,width,height,"F");
                        doc.setTextColor(245,200,66);
                        doc.setFontSize(6);
                        doc.text(data.cell.text[0]??""  , x+width/2, y+height/2+1.2, {align:"center"});
                      }
                    },
                    theme: "grid",
                  });

                  doc.save(`escala_${schedArea}_${year}_${String(month+1).padStart(2,"0")}.pdf`);
                }} style={{padding:"8px 12px",borderRadius:10,border:"1px solid var(--border)",background:"transparent",color:"var(--text2)",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12,whiteSpace:"nowrap"}}>
                  📄 PDF
                </button>
              </div>
            </div>

            {/* Legend */}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
              {[["var(--green)","T","Trabalho"],["var(--red)","F","Folga"],["#3b82f6","C","Comp."],["#8b5cf6","Fér","Férias"],["#f59e0b","FJ","Falta Just."],["var(--red)","FI","Falta Injust."]].map(([c,s,l])=>(
                <div key={s} style={{display:"flex",alignItems:"center",gap:3}}>
                  <div style={{width:20,height:16,borderRadius:3,background:c+"33",border:`1px solid ${c}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <span style={{color:c,fontSize:9,fontWeight:700}}>{s}</span>
                  </div>
                  <span style={{color:"var(--text3)",fontSize:10,fontFamily:"'DM Mono',monospace"}}>{l}</span>
                </div>
              ))}
            </div>

            {/* Assistente IA de Escala */}
            {(()=>{
              const mesLabel = monthLabel(year, month);
              const mesKey = mk;

              // Helper: normalize escala keys from names → employee IDs
              function normalizeEscalaKeys(escala) {
                const nomeParaId = {};
                restEmps.forEach(e => {
                  nomeParaId[e.id] = e.id; // ID direto
                  nomeParaId[e.name.toLowerCase().trim()] = e.id;
                  nomeParaId[e.name.split(" ")[0].toLowerCase().trim()] = e.id;
                  // sem acentos
                  const semAcento = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
                  nomeParaId[semAcento(e.name)] = e.id;
                  nomeParaId[semAcento(e.name.split(" ")[0])] = e.id;
                });
                const normalized = {};
                Object.entries(escala).forEach(([key, days]) => {
                  const semAcento = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
                  const empId = nomeParaId[key] ?? nomeParaId[key.toLowerCase().trim()] ?? nomeParaId[semAcento(key)] ?? null;
                  if (empId && days && typeof days === "object") {
                    // Merge if same empId already exists (LLM might use name AND id)
                    normalized[empId] = { ...(normalized[empId] ?? {}), ...days };
                  } else {
                    console.warn("AI escala: chave não mapeada →", key);
                  }
                });
                return normalized;
              }

              async function gerarEscalaIA() {
                setAiSchedLoading(true); setAiSchedError(""); setAiSchedPreview(null);
                try {
                  const daysInMonth = new Date(year, month+1, 0).getDate();
                  const empList = areaEmps.map(e => {
                    const role = restRoles.find(r => r.id === e.roleId);
                    return `- id: "${e.id}" | nome: "${e.name}" | cargo: ${role?.name??"—"}`;
                  }).join("\n");

                  const diaSemana1 = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"][new Date(`${year}-${String(month+1).padStart(2,"0")}-01T12:00:00`).getDay()];

                  const prompt = `Você é um assistente de escalas de restaurante. Interprete a instrução abaixo e gere a escala.

EMPREGADOS:
${empList}

MÊS: ${mesLabel} de ${year} — ${daysInMonth} dias. Dia 1 = ${diaSemana1}.

INSTRUÇÃO DO GESTOR:
"${aiSchedInput.trim()}"

REGRAS:
- Chave de cada empregado no JSON = campo "id" exato (ex: "${areaEmps[0]?.id ?? "abc123"}")
- Status possíveis: "off"=folga, "vac"=férias, "faultj"=falta justificada, "faultu"=falta injustificada, "comp"=compensação
- Inclua APENAS dias com status especial (dias normais de trabalho não devem aparecer)
- Datas no formato YYYY-MM-DD (mês ${String(month+1).padStart(2,"0")}, ano ${year})
- "toda segunda" = calcule todas as segundas-feiras do mês
- "hoje" = ${new Date().toISOString().slice(0,10)}

Responda SOMENTE com JSON:
{"resumo":"resumo curto","escala":{"<id_do_empregado>":{"YYYY-MM-DD":"status"}}}`;

                  let result = null;

                  // Tenta Gemini primeiro (mais confiável para JSON)
                  if (GEMINI_KEY) {
                    try {
                      const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
                        method:"POST",
                        headers:{"Content-Type":"application/json"},
                        body:JSON.stringify({
                          contents:[{parts:[{text:prompt}]}],
                          generationConfig:{temperature:0.1,responseMimeType:"application/json"}
                        })
                      });
                      if (gRes.ok) {
                        const gData = await gRes.json();
                        const raw = gData?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
                        if (raw) result = JSON.parse(raw.replace(/```json|```/g,"").trim());
                      }
                    } catch(gemErr) {
                      console.warn("Gemini escala fallback:", gemErr);
                    }
                  }

                  // Fallback: Groq
                  if (!result?.escala && GROQ_KEY) {
                    const gqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                      method:"POST",
                      headers:{"Content-Type":"application/json","Authorization":`Bearer ${GROQ_KEY}`},
                      body:JSON.stringify({
                        model:"llama-3.3-70b-versatile",
                        temperature:0.1,
                        response_format:{type:"json_object"},
                        messages:[
                          {role:"system",content:"Você é um assistente especializado em escalas de restaurantes. Sempre responda APENAS com JSON válido, sem texto adicional."},
                          {role:"user",content:prompt}
                        ]
                      })
                    });
                    if (!gqRes.ok) {
                      const errBody = await gqRes.text().catch(()=>"");
                      console.error("Groq API error:", gqRes.status, errBody);
                      throw new Error(`API retornou erro ${gqRes.status}`);
                    }
                    const gqData = await gqRes.json();
                    const raw = gqData?.choices?.[0]?.message?.content ?? "";
                    if (!raw) throw new Error("Resposta vazia da API");
                    result = JSON.parse(raw.replace(/```json|```/g,"").trim());
                  }

                  if (!result?.escala) throw new Error("Sem escala no retorno da IA");

                  // Normaliza chaves: nome → id
                  const escalaNorm = normalizeEscalaKeys(result.escala);
                  const matched = Object.keys(escalaNorm).length;
                  const original = Object.keys(result.escala).length;
                  if (matched === 0 && original > 0) {
                    throw new Error("Nenhum empregado reconhecido na resposta da IA");
                  }
                  const warn = matched < original ? ` (${original - matched} empregado(s) não reconhecido(s))` : "";

                  setAiSchedPreview({ escala: escalaNorm, resumo: (result.resumo ?? "Escala interpretada.") + warn });
                } catch(e) {
                  console.error("AI sched error:", e);
                  setAiSchedError(e.message?.includes("API retornou") || e.message?.includes("Nenhum empregado")
                    ? `❌ ${e.message}`
                    : "Não foi possível interpretar. Reformule a instrução e tente novamente.");
                }
                setAiSchedLoading(false);
              }

              function confirmarEscala() {
                if (!aiSchedPreview) return;

                // As chaves já foram normalizadas para IDs reais no gerarEscalaIA
                let updatedSched = JSON.parse(JSON.stringify(schedules ?? {})); // deep copy
                Object.entries(aiSchedPreview.escala).forEach(([empId, days]) => {
                  // Verifica se o empId realmente existe
                  if (!restEmps.find(e => e.id === empId)) return;
                  if (!updatedSched[rid]) updatedSched[rid] = {};
                  if (!updatedSched[rid][mk]) updatedSched[rid][mk] = {};
                  const empDayMap = { ...(updatedSched[rid][mk][empId] ?? {}) };
                  Object.entries(days).forEach(([dateStr, status]) => {
                    if (status) empDayMap[dateStr] = status;
                    else delete empDayMap[dateStr];
                  });
                  updatedSched[rid][mk][empId] = empDayMap;
                });

                onUpdate("schedules", updatedSched);
                setShowAiSched(false);
                setAiSchedPreview(null);
                setAiSchedInput("");
                onUpdate("_toast", "✅ Escala aplicada com sucesso!");
              }

              return (
                <div style={{marginBottom:14}}>
                  <button onClick={()=>{setShowAiSched(!showAiSched);setAiSchedError("");setAiSchedPreview(null);setAiSchedInput("");}}
                    style={{...S.btnSecondary,fontSize:12,display:"inline-flex",alignItems:"center",gap:6,padding:"7px 14px",
                      background:showAiSched?"var(--ac-bg)":undefined,borderColor:showAiSched?"var(--ac)":undefined,color:showAiSched?"var(--ac-text)":undefined}}>
                    ✨ Assistente de escala
                  </button>

                  {showAiSched && (
                    <div style={{marginTop:10,padding:"16px",borderRadius:12,background:"var(--ac-bg)",border:"1px solid var(--ac)33"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                        <span style={{fontSize:16}}>✨</span>
                        <span style={{color:"var(--ac-text)",fontWeight:700,fontSize:14}}>Assistente de Escala — {mesLabel}</span>
                      </div>
                      <p style={{color:"var(--text3)",fontSize:12,margin:"0 0 12px",lineHeight:1.5}}>
                        Fale ou escreva livremente. Exemplos: <em>"João folga segunda e quarta, Maria de férias do dia 5 ao 20, Pedro faltou hoje sem justificativa"</em>
                      </p>

                      {/* Campo de texto + microfone */}
                      <textarea
                        value={aiSchedInput}
                        onChange={e=>setAiSchedInput(e.target.value)}
                        placeholder='Ex: "João folga toda segunda e quarta, Maria de férias do dia 5 ao 20, Pedro faltou hoje sem justificativa"'
                        rows={4}
                        style={{...S.input,resize:"vertical",fontSize:13,marginBottom:8}}
                      />
                      {aiSchedError && <p style={{color:"var(--red)",fontSize:12,margin:"0 0 8px"}}>{aiSchedError}</p>}

                      {/* Preview */}
                      {aiSchedPreview && (
                        <div style={{padding:"12px 14px",borderRadius:10,background:"var(--card-bg)",border:"1px solid var(--green)33",marginBottom:12}}>
                          <p style={{color:"var(--green)",fontWeight:700,fontSize:13,margin:"0 0 6px"}}>✅ Escala interpretada!</p>
                          <p style={{color:"var(--text2)",fontSize:13,margin:"0 0 10px",lineHeight:1.6}}>{aiSchedPreview.resumo}</p>
                          <div style={{maxHeight:180,overflowY:"auto"}}>
                            {Object.entries(aiSchedPreview.escala).map(([empId, days]) => {
                              const emp = restEmps.find(e => e.id === empId);
                              const entries = Object.entries(days);
                              if (!entries.length || !emp) return null;
                              return (
                                <div key={empId} style={{padding:"5px 0",borderBottom:"1px solid var(--border)",fontSize:12}}>
                                  <span style={{color:"var(--text)",fontWeight:600}}>{emp.name}:</span>{" "}
                                  <span style={{color:"var(--text3)"}}>
                                    {entries.sort((a,b)=>a[0].localeCompare(b[0])).map(([date,status])=>{
                                      const labels = {off:"Folga",comp:"Comp.",vac:"Férias",faultj:"Falta Just.",faultu:"Falta Injust."};
                                      return `${date.slice(8)}/${date.slice(5,7)} ${labels[status]??status}`;
                                    }).join(" · ")}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      <div style={{display:"flex",gap:8}}>
                        <button onClick={gerarEscalaIA} disabled={!aiSchedInput.trim()||aiSchedLoading}
                          style={{...S.btnPrimary,flex:1,fontSize:13,opacity:(!aiSchedInput.trim()||aiSchedLoading)?0.6:1}}>
                          {aiSchedLoading?"✨ Interpretando...":"✨ Interpretar"}
                        </button>
                        {aiSchedPreview && (
                          <button onClick={confirmarEscala} style={{...S.btnPrimary,flex:1,fontSize:13,background:"var(--green)"}}>
                            ✅ Aplicar
                          </button>
                        )}
                        <button onClick={()=>{setShowAiSched(false);setAiSchedPreview(null);setAiSchedInput("");}} style={S.btnSecondary}>Fechar</button>
                      </div>
                      <p style={{color:"var(--text3)",fontSize:11,margin:"10px 0 0",fontStyle:"italic"}}>Revise sempre antes de aplicar. Ajustes manuais podem ser feitos depois.</p>
                    </div>
                  )}
                </div>
              );
            })()}

            {areaEmps.length === 0 && <p style={{color:"var(--text3)",textAlign:"center"}}>Nenhum empregado {schedArea === "Todos" ? "cadastrado" : "nesta área"}.</p>}

            {areaEmps.length > 0 && (() => {
              const daysInMonth = dim;
              const STATUS_COLORS = {
                [DAY_OFF]:      "var(--red)",
                [DAY_COMP]:     "#3b82f6",
                [DAY_VACATION]: "#8b5cf6",
                [DAY_FAULT_J]:  "#f59e0b",
                [DAY_FAULT_U]:  "var(--red)",
              };
              const STATUS_SHORT = {
                [DAY_OFF]:"F",[DAY_COMP]:"C",[DAY_VACATION]:"Fér",
                [DAY_FAULT_J]:"FJ",[DAY_FAULT_U]:"FI",
              };

              function cycleStatus(empId, dateStr) {
                const empDayMap = schedules?.[rid]?.[mk]?.[empId] ?? {};
                const cur = empDayMap[dateStr];
                const idx = DAY_CYCLE.indexOf(cur);
                const next = idx === DAY_CYCLE.length - 1 ? null : DAY_CYCLE[idx + 1];
                const newMap = { ...empDayMap };
                if (next === null) delete newMap[dateStr]; else newMap[dateStr] = next;
                onUpdate("schedules", {
                  ...schedules,
                  [rid]: { ...(schedules?.[rid]??{}), [mk]: { ...(schedules?.[rid]?.[mk]??{}), [empId]: newMap } }
                });
              }

              return (
                <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
                  <table style={{borderCollapse:"collapse",fontFamily:"'DM Mono',monospace",fontSize:11,minWidth:"100%"}}>
                    <thead>
                      <tr>
                        <th style={{position:"sticky",left:0,background:"var(--card-bg)",zIndex:2,padding:"6px 10px",textAlign:"left",color:"var(--text3)",fontSize:11,borderBottom:"1px solid var(--border)",whiteSpace:"nowrap",minWidth:120}}>
                          Empregado
                        </th>
                        {Array.from({length:daysInMonth},(_,i)=>{
                          const d = i+1;
                          const date = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                          const wd = new Date(date+"T12:00:00").getDay();
                          const isWe = wd===0||wd===6;
                          return (
                            <th key={d} style={{padding:"3px 1px",textAlign:"center",color:isWe?"#f59e0b":"#555",fontSize:9,borderBottom:"1px solid var(--border)",minWidth:30,width:30}}>
                              <div>{d}</div>
                              <div style={{fontSize:8}}>{["D","S","T","Q","Q","S","S"][wd]}</div>
                            </th>
                          );
                        })}
                        <th style={{padding:"4px 6px",textAlign:"center",color:"var(--green)",fontSize:10,borderBottom:"1px solid var(--border)",minWidth:22}}>T</th>
                        <th style={{padding:"4px 6px",textAlign:"center",color:"var(--red)",fontSize:10,borderBottom:"1px solid var(--border)",minWidth:22}}>F</th>
                      </tr>
                    </thead>
                    <tbody>
                      {areaEmps.map((emp,ei) => {
                        const role = restRoles.find(r=>r.id===emp.roleId);
                        const dayMap = schedules?.[rid]?.[mk]?.[emp.id] ?? {};
                        let workC=0, offC=0;
                        Object.values(dayMap).forEach(v=>{ if(v===DAY_OFF||v===DAY_FAULT_J||v===DAY_FAULT_U||v===DAY_VACATION) offC++; });
                        workC = daysInMonth - offC - Object.values(dayMap).filter(v=>v===DAY_COMP).length;

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
                            <td style={{position:"sticky",left:0,background:ei%2===0?"var(--bg1)":"var(--bg2)",zIndex:1,padding:"5px 10px",borderRight:"1px solid var(--border)",minWidth:130}}>
                              <div style={{color:"var(--text)",fontSize:11,fontWeight:600}}>{emp.name}</div>
                              <div style={{color:"var(--text3)",fontSize:9}}>{role?.name}</div>
                            </td>
                            {Array.from({length:daysInMonth},(_,i)=>{
                              const d = i+1;
                              const date = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                              const status = dayMap[date];
                              const color = STATUS_COLORS[status] ?? "var(--green)";
                              const label = STATUS_SHORT[status] ?? "•";
                              const wd = new Date(date+"T12:00:00").getDay();
                              const isWe = wd===0||wd===6;
                              return (
                                <td key={d} onClick={()=>cycleStatus(emp.id, date)}
                                  style={{textAlign:"center",padding:"3px 2px",cursor:"pointer",background:status?color+"22":(isWe?"var(--bg3)":"transparent"),borderRight:"1px solid var(--border)",width:30}}>
                                  <span style={{color:color,fontSize:status?9:11,fontWeight:status?700:400}}>{label}</span>
                                </td>
                              );
                            })}
                            <td style={{textAlign:"center",color:"var(--green)",fontSize:11,fontWeight:700,padding:"3px 6px"}}>{workC}</td>
                            <td style={{textAlign:"center",color:"var(--red)",fontSize:11,padding:"3px 6px"}}>{offC}</td>
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
            {isOwner && <div style={{display:"flex",justifyContent:"flex-end",padding:"12px 16px 0"}}>
              <button onClick={()=>{
                const comms = (data?.communications??[]).filter(c=>c.restaurantId===rid);
                const ok = resetTab("comunicados","Comunicados",()=>({communications:comms}));
                if(ok){ onUpdate("communications",(data?.communications??[]).filter(c=>c.restaurantId!==rid)); onUpdate("_toast","🗑️ Comunicados enviados para a lixeira"); }
              }} style={{...S.btnSecondary,fontSize:12,color:"var(--red)",borderColor:"var(--red)44"}}>🗑️ Resetar comunicados</button>
            </div>}
            <ComunicadosManagerTab
              restaurantId={rid} communications={data?.communications ?? []}
              commAcks={data?.commAcks ?? {}} employees={employees}
              onUpdate={onUpdate} currentManagerName={currentUser?.name ?? "Gestor"}
            />
          </div>
        )}

        {/* FAQ */}
        {tab === "faq" && (
          <div>
            {isOwner && <div style={{display:"flex",justifyContent:"flex-end",padding:"12px 16px 0"}}>
              <button onClick={()=>{
                const faqRest = data?.faq?.[rid];
                const ok = resetTab("faq","FAQ",()=>({faq:faqRest}));
                if(ok){ const f={...data?.faq}; delete f[rid]; onUpdate("faq",f); onUpdate("_toast","🗑️ FAQ enviado para a lixeira"); }
              }} style={{...S.btnSecondary,fontSize:12,color:"var(--red)",borderColor:"var(--red)44"}}>🗑️ Resetar FAQ</button>
            </div>}

            {/* FAQs automáticas — expansíveis e com toggle */}
            {(()=>{
              const ac = "var(--ac)";
              const splitType = restaurant?.splitType ?? "points";
              const taxRate = restaurant?.taxRate ?? 0.33;
              const taxLabel = taxRate===0.20?"20% (Simples Nacional)":"33% (Lucro Real/Presumido)";
              const restRolesCom = (data?.roles??[]).filter(r=>r.restaurantId===rid&&!r.inactive&&!r.noTip);
              const restRolesSem = (data?.roles??[]).filter(r=>r.restaurantId===rid&&!r.inactive&&r.noTip);
              const totalPts = restRolesCom.reduce((s,r)=>s+(parseFloat(r.points)||0),0);
              const now2 = new Date();
              const mk2 = `${now2.getFullYear()}-${String(now2.getMonth()+1).padStart(2,"0")}`;
              const curSplit2 = splits?.[rid]?.[mk2] ?? {Bar:12,Cozinha:35,Salão:35,Limpeza:8,"Produção":10};
              const EX = 1000;
              const fmtR2 = n=>n.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});

              const FAQS_AUTO = [
                {
                  id:"__gorjeta__",
                  tabKey: null,
                  q:"💸 Como é calculada a minha gorjeta?",
                  a:`A gorjeta é distribuída entre todos que trabalharam no dia conforme os pontos do cargo e a escala.\n\nDedução aplicada: ${taxLabel}\n\nPasso a passo:\n1. Gestor lança o valor total do dia\n2. Sistema soma pontos de quem trabalhou\n3. Divide o total pelos pontos → valor por ponto\n4. Multiplica pelos pontos do cargo → bruto\n5. Deduz ${(taxRate*100).toFixed(0)}% → líquido\n\nExemplo (gorjeta R$${fmtR2(EX)}, ${totalPts}pt totais):\n• Valor por ponto: R$${totalPts>0?fmtR2(EX/totalPts):"—"}\n• Cargo com 6pt → R$${totalPts>0?fmtR2(EX/totalPts*6):"—"} bruto → R$${totalPts>0?fmtR2(EX/totalPts*6*(1-taxRate)):"—"} líquido`,
                },
                {
                  id:"__sistema__",
                  tabKey: null,
                  q: splitType==="area"?"🏢 Como funciona a divisão por área e pontos?":"📊 Como funciona a tabela de pontos?",
                  a: splitType==="area" ? (()=>{
                    const AREAS2=["Bar","Cozinha","Salão","Limpeza","Produção"];
                    const ativas=AREAS2.filter(a=>(curSplit2[a]??0)>0);
                    const linhas=ativas.map(a=>{
                      const pct=curSplit2[a]??0;
                      const cargos=restRolesCom.filter(r=>r.area===a);
                      const pts=cargos.reduce((s,r)=>s+(parseFloat(r.points)||0),0);
                      return `${a} — ${pct}%\n${cargos.map(r=>`   • ${r.name}: ${r.points}pt`).join("\n")}\n   Total: ${pts}pt`;
                    }).join("\n\n");
                    return `Sistema: Área + Pontos\nA gorjeta é dividida primeiro por área (%), depois por pontos internamente.\n\nDistribuição:\n${linhas}${restRolesSem.length>0?"\n\nSem gorjeta: "+restRolesSem.map(r=>r.name).join(", "):""}`;
                  })() : (()=>{
                    const linhas=restRolesCom.sort((a,b)=>(parseFloat(b.points)||0)-(parseFloat(a.points)||0)).map(r=>{
                      const pct=totalPts>0?((parseFloat(r.points)||0)/totalPts*100).toFixed(1):"0";
                      return `• ${r.name}: ${r.points}pt (${pct}%)`;
                    }).join("\n");
                    return `Sistema: Pontos Global\nTodos que trabalharam dividem a gorjeta proporcionalmente aos pontos do cargo.\n\nTabela de cargos:\n${linhas}${restRolesSem.length>0?"\n\nSem gorjeta: "+restRolesSem.map(r=>r.name).join(", "):""}`;
                  })(),
                },
                { id:"__escala__", tabKey:null, q:"📅 Como funciona a escala e por que ela importa?", a:"A escala registra a presença em cada dia e define quem recebe gorjeta.\n\nRecebe gorjeta: trabalhando normalmente ou compensação (C).\nNÃO recebe: folga, falta injustificada (F) + possível penalidade, falta justificada (FJ), atestado (A), férias (V)." },
                { id:"__recibos__", tabKey:"recibos", q:"📄 Como acesso meus recibos?", a:"Na aba Recibos do aplicativo o empregado encontra todos os recibos. Pode incluir gorjeta, adiantamento, férias, 13º e outros pagamentos. O gestor faz upload dos PDFs." },
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
            {isOwner && <div style={{display:"flex",justifyContent:"flex-end",padding:"12px 16px 0"}}>
              <button onClick={()=>{
                const msgs = (data?.dpMessages??[]).filter(m=>m.restaurantId===rid);
                const ok = resetTab("dp","Fale com DP",()=>({dpMessages:msgs}));
                if(ok){ onUpdate("dpMessages",(data?.dpMessages??[]).filter(m=>m.restaurantId!==rid)); onUpdate("_toast","🗑️ Mensagens DP enviadas para a lixeira"); }
              }} style={{...S.btnSecondary,fontSize:12,color:"var(--red)",borderColor:"var(--red)44"}}>🗑️ Resetar Fale com DP</button>
            </div>}
            <DpManagerTab restaurantId={rid} dpMessages={data?.dpMessages ?? []} onUpdate={onUpdate} isOwner={isOwner} />
          </div>
        )}

        {/* HORARIOS */}
        {tab === "horarios" && (
          <div>
            {isOwner && <div style={{display:"flex",justifyContent:"flex-end",padding:"12px 16px 0"}}>
              <button onClick={()=>{
                const ws = data?.workSchedules?.[rid];
                const ok = resetTab("horarios","Horários",()=>({workSchedules:ws}));
                if(ok){ const w={...data?.workSchedules}; delete w[rid]; onUpdate("workSchedules",w); onUpdate("_toast","🗑️ Horários enviados para a lixeira"); }
              }} style={{...S.btnSecondary,fontSize:12,color:"var(--red)",borderColor:"var(--red)44"}}>🗑️ Resetar horários</button>
            </div>}
            <WorkScheduleManagerTab restaurantId={rid} employees={employees} workSchedules={data?.workSchedules??{}} notifications={data?.notifications??[]} managers={data?.managers??[]} currentManagerName={currentUser?.name ?? (isOwner?"Admin AppTip":"Gestor")} onUpdate={onUpdate} communications={data?.communications??[]} isOwner={isOwner} />
          </div>
        )}

        {/* NOTIFICAÇÕES */}
        {tab === "notificacoes" && (
          <NotificacoesTab restaurantId={rid} dpMessages={data?.dpMessages??[]} notifications={data?.notifications??[]} onUpdate={onUpdate} />
        )}

        {/* RECIBOS */}
        {tab === "recibos" && (
          <ReceibosManagerTab restaurantId={rid} employees={employees} roles={restRoles} restaurants={restaurants} receipts={data?.receipts ?? []} onUpdate={onUpdate} onUpdateEmployees={newEmps=>onUpdate("employees",newEmps)} />
        )}

        {/* CONFIG */}
        {tab === "config" && (
          <div>
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
                    ["recibos",     "📄 Recibos"],
                    ["faq",         "❓ FAQ"],
                    ["comunicados", "📢 Comunicados"],
                    ["dp",          "💬 Fale com DP"],
                  ].map(([key, label]) => {
                    const isOn = restaurant.tabsConfig?.[key] !== false;
                    return (
                      <div key={key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"var(--bg1)",borderRadius:10,border:`1px solid ${isOn?"#10b98133":"var(--border)"}`}}>
                        <span style={{color:isOn?"var(--text)":"var(--text3)",fontSize:13,fontWeight:isOn?600:400}}>{label}</span>
                        <button onClick={()=>{
                          const novoValor = !isOn;
                          // Sincroniza FAQ automática relacionada quando admin desativa
                          const tabFaqMap = { recibos:"__recibos__", dp:"__dp__", comunicados:"__comunicados__" };
                          const faqId = tabFaqMap[key];
                          const curFaqAuto = restaurant.tabsGestor?.faqAuto ?? {};
                          const novoFaqAuto = faqId ? { ...curFaqAuto, [faqId]: novoValor } : curFaqAuto;
                          const updated = restaurants.map(r=>r.id===rid?{...r,
                            tabsConfig:{...(r.tabsConfig??{}),[key]:novoValor},
                            tabsGestor:{...(r.tabsGestor??{}),faqAuto:novoFaqAuto}
                          }:r);
                          onUpdate("restaurants",updated);
                        }} style={{padding:"5px 14px",borderRadius:20,border:"none",background:isOn?"var(--green)":"var(--border)",color:isOn?"#fff":"#555",fontWeight:700,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>
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
                    ["recibos",     "📄 Recibos"],
                    ["faq",         "❓ FAQ"],
                    ["comunicados", "📢 Comunicados"],
                    ["dp",          "💬 Fale com DP"],
                  ].filter(([key]) => restaurant.tabsConfig?.[key] !== false)
                  .map(([key, label]) => {
                    const gestorOn = restaurant.tabsGestor?.[key] !== false;
                    const isOn     = gestorOn;
                    return (
                      <div key={key} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",background:"var(--bg1)",borderRadius:10,border:`1px solid ${isOn?"#10b98133":"var(--border)"}`}}>
                        <div>
                          <span style={{color:isOn?"var(--text)":"var(--text3)",fontSize:13,fontWeight:isOn?600:400}}>{label}</span>
                        </div>
                        <button onClick={()=>{
                          const novoValor = !gestorOn;
                          const tabFaqMap = { recibos:"__recibos__", dp:"__dp__", comunicados:"__comunicados__" };
                          const faqId = tabFaqMap[key];
                          const curFaqAuto = restaurant.tabsGestor?.faqAuto ?? {};
                          const novoFaqAuto = faqId ? { ...curFaqAuto, [faqId]: novoValor } : curFaqAuto;
                          const updated = restaurants.map(r=>r.id===rid?{...r,tabsGestor:{...(r.tabsGestor??{}),[key]:novoValor,faqAuto:novoFaqAuto}}:r);
                          onUpdate("restaurants",updated);
                        }} style={{padding:"5px 14px",borderRadius:20,border:"none",background:isOn?"var(--green)":"var(--border)",color:isOn?"#fff":"#555",fontWeight:700,cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:12}}>
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
                  const sel = (restaurant.taxRate ?? TAX) === rate;
                  return (
                    <button key={rate} onClick={()=>{
                      onUpdate("restaurants", restaurants.map(r=>r.id===rid?{...r,taxRate:rate}:r));
                      onUpdate("_toast","Retenção salva!");
                    }} style={{flex:1,padding:"12px",borderRadius:12,border:`2px solid ${sel?ac:"var(--border)"}`,background:sel?ac+"11":"transparent",cursor:"pointer",fontFamily:"'DM Mono',monospace",fontSize:16,fontWeight:700,color:sel?ac:"#555"}}>
                      {lbl}
                    </button>
                  );
                })}
              </div>

              {/* Explicação das alíquotas */}
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                <div style={{padding:"12px 14px",borderRadius:10,background:(restaurant.taxRate??TAX)===0.33?"var(--ac-bg)":"var(--bg2)",border:`1px solid ${(restaurant.taxRate??TAX)===0.33?"var(--ac)33":"var(--border)"}`}}>
                  <div style={{fontWeight:700,fontSize:13,color:"var(--text)",marginBottom:4}}>33% — Lucro Real ou Lucro Presumido</div>
                  <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.6}}>
                    Aplica-se a empresas tributadas pelo Lucro Real ou Presumido. Incide INSS patronal (20%) + FGTS (8%) + RAT/terceiros (~5%). Base: art. 457 CLT e Lei 13.419/2017.
                  </div>
                </div>
                <div style={{padding:"12px 14px",borderRadius:10,background:(restaurant.taxRate??TAX)===0.20?"var(--ac-bg)":"var(--bg2)",border:`1px solid ${(restaurant.taxRate??TAX)===0.20?"var(--ac)33":"var(--border)"}`}}>
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
              <p style={{color:"var(--text3)",fontSize:12,marginBottom:14}}>% do pool mensal descontado por falta injustificada. Produção tem regra própria (sempre 4%). Configure as demais áreas abaixo.</p>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {AREAS.filter(a => a !== "Produção").map(area => {
                  const current = restaurant.faultPenalty?.[area] ?? 0;
                  return (
                    <div key={area} style={{display:"flex",alignItems:"center",gap:10}}>
                      <div style={{minWidth:80}}><AreaBadge area={area}/></div>
                      <input type="number" min="0" max="20" step="0.5" value={current}
                        onChange={e => {
                          const val = parseFloat(e.target.value) || 0;
                          const updated = restaurants.map(r => r.id===rid ? {...r, faultPenalty:{...(r.faultPenalty??{}), [area]: val}} : r);
                          onUpdate("restaurants", updated);
                        }}
                        style={{...S.input, width:70, textAlign:"center"}}
                      />
                      <span style={{color:"var(--text3)",fontSize:13}}>% do pool mensal</span>
                    </div>
                  );
                })}
                <div style={{display:"flex",alignItems:"center",gap:10}}>
                  <div style={{minWidth:80}}><AreaBadge area="Produção"/></div>
                  <div style={{...S.input,width:70,textAlign:"center",color:"var(--text3)",background:"var(--bg5)",border:"1px solid var(--border)"}}>4%</div>
                  <span style={{color:"var(--text3)",fontSize:12}}>fixo (regra Produção)</span>
                </div>
              </div>
            </div>
            <div style={{...S.card,marginBottom:20}}>
              <p style={{color:ac,fontSize:14,fontWeight:700,margin:"0 0 8px"}}>Modalidade de Divisão</p>
              <p style={{color:"var(--text3)",fontSize:12,marginBottom:14}}>Define como a gorjeta é dividida entre os empregados.</p>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {[[MODE_AREA_POINTS,"🏷️ Áreas + Pontos","Divide por área (%) e depois por pontos dentro de cada área"],[MODE_GLOBAL_POINTS,"⚡ Pontos Global","Divide diretamente pelos pontos de todos os empregados, sem separação por área"]].map(([mode,label,desc])=>{
                  const selected = (restaurant.divisionMode ?? MODE_AREA_POINTS) === mode;
                  return (
                    <button key={mode} onClick={()=>{
                      const updated = restaurants.map(r=>r.id===rid?{...r,divisionMode:mode}:r);
                      onUpdate("restaurants",updated);
                      onUpdate("_toast","Modalidade salva!");
                    }} style={{padding:"14px 16px",borderRadius:12,border:`2px solid ${selected?ac:"var(--border)"}`,background:selected?ac+"11":"transparent",cursor:"pointer",textAlign:"left",fontFamily:"'DM Mono',monospace"}}>
                      <div style={{color:selected?ac:"#fff",fontWeight:700,fontSize:14}}>{label}</div>
                      <div style={{color:"var(--text3)",fontSize:12,marginTop:4}}>{desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            {(restaurant.divisionMode ?? MODE_AREA_POINTS) === MODE_AREA_POINTS && (
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
    </div>
  );
}

//
// SUPER MANAGER PORTAL
//
function OwnerPortal({ data, onUpdate, onBack, currentUser, toggleTheme, theme }) {
  const { owners, managers, restaurants, employees, roles, tips, splits, schedules, noTipDays } = data;
  const [tab, setTab] = useState("dashboard");
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
  const [showRestModal, setShowRestModal]   = useState(false);
  const [editRestId, setEditRestId]         = useState(null);
  const [restForm, setRestForm]             = useState({ name:"",shortCode:"",cnpj:"",address:"",whatsappFin:"",whatsappOp:"" });
  const [showMgrModal, setShowMgrModal]     = useState(false);
  const [editMgrId, setEditMgrId]           = useState(null);
  const [mgrForm, setMgrForm]               = useState({ name:"",cpf:"",pin:"",restaurantIds:[],perms:{tips:true,schedule:true},isDP:false });
  const [showOwnerModal, setShowOwnerModal] = useState(false);
  const [editOwnerId, setEditOwnerId]       = useState(null);
  const [ownerForm, setOwnerForm]           = useState({ name:"",cpf:"",pin:"" });

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
    if (!mgrForm.name.trim()||!mgrForm.pin.trim()) return;
    const m = { ...mgrForm, id: editMgrId ?? Date.now().toString() };
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
    { id:"p10",  label:"Starter",     empMax:10,  mensal:97,    anual:87.30  },
    { id:"p20",  label:"Básico",      empMax:20,  mensal:187,   anual:168.30 },
    { id:"p50",  label:"Profissional",empMax:50,  mensal:397,   anual:357.30 },
    { id:"p999", label:"Enterprise",  empMax:100, mensal:null,  anual:null   },
    { id:"pOrc", label:"On Demand",    empMax:999, mensal:null,  anual:null   },
  ];
  function getPlano(r) { return PLANOS.find(p=>p.id===(r.planoId??"p10")) ?? PLANOS[0]; }

  const notifications = data?.notifications ?? [];
  const unreadNotifs = notifications.filter(n => !n.read && n.targetRole === "admin").length;
  const isMaster = currentUser?.isMaster === true;
  const trash = data?.trash ?? { restaurants:[], managers:[], employees:[], tabData:[] };
  const trashCount = (trash.restaurants?.length??0) + (trash.managers?.length??0) + (trash.employees?.length??0) + (trash.tabData?.length??0);
  const [restTab, setRestTab] = useState("operacional");
  const [filtroFinanceiro, setFiltroFinanceiro] = useState("todos");
  const PIX_PADRAO = "11985499821";
  const PIX_NOME   = "Gustavo Rodrigues da Silva";
  const [cobForma, setCobForma]   = useState("pix");
  const [cobChave, setCobChave]   = useState(PIX_PADRAO);
  const [cobLink,  setCobLink]    = useState("");
  const [cobValor, setCobValor]   = useState("");
  const [cobPeriodo, setCobPeriodo] = useState("");
  const [cobVenc,  setCobVenc]    = useState("");

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
    ["dashboard", "📊 Dashboard"],
    ["financeiro_geral", "💰 Financeiro"],
    ["restaurants","🏢 Restaurantes"],
    ["managers","👔 Gestores"],
    ["owners","⭐ Admins AppTip"],
    ["inbox", `📬 Caixa${unreadNotifs > 0 ? ` (${unreadNotifs})` : ""}`],
    ...(isMaster ? [["trash", `🗑️ Lixeira${trashCount > 0 ? ` (${trashCount})` : ""}`]] : []),
  ];

  if (selRestaurant) {
    const rest = restaurants.find(r => r.id === selRestaurant);
    const restMgrs = managers.filter(m => m.restaurantIds?.includes(selRestaurant));

    return (
      <div style={{ minHeight:"100vh", background:"var(--bg)", fontFamily:"'DM Sans',sans-serif" }}>
        {/* Header */}
        <div style={{ background:"var(--header-bg)", borderBottom:"1px solid var(--border)", padding:"12px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", boxShadow:"0 1px 4px rgba(0,0,0,0.04)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <button onClick={()=>setSelRestaurant(null)} style={{ ...S.btnSecondary, fontSize:12, padding:"6px 12px" }}>← Voltar</button>
            <span style={{ color:"var(--text)", fontWeight:700, fontSize:15 }}>{rest?.name}</span>
            <span style={{ background:"var(--ac-bg)", color:"var(--ac-text)", borderRadius:6, padding:"2px 8px", fontSize:11, fontWeight:700 }}>{getPlano(rest).label}</span>
          </div>
          <button onClick={onBack} style={{ ...S.btnSecondary, fontSize:12 }}>Sair</button>
        </div>

        {/* Sub-tabs */}
        <div style={{ display:"flex", borderBottom:"1px solid var(--border)", background:"var(--header-bg)", overflowX:"auto" }}>
          {[["operacional","⚙️ Operacional"],["gestores","👔 Gestores"],["financeiro","💳 Financeiro"]].map(([id,lbl])=>(
            <button key={id} onClick={()=>setRestTab(id)}
              style={{ padding:"10px 20px", background:"none", border:"none", borderBottom:`2px solid ${restTab===id?ac:"transparent"}`, color:restTab===id?ac:"var(--text3)", cursor:"pointer", fontSize:13, fontFamily:"'DM Sans',sans-serif", fontWeight:restTab===id?700:500, whiteSpace:"nowrap" }}>
              {lbl}
            </button>
          ))}
        </div>

        {/* Operacional */}
        {restTab === "operacional" && (
          <RestaurantPanel restaurant={rest} restaurants={restaurants} employees={employees} roles={roles} tips={tips} splits={splits} schedules={schedules} onUpdate={onUpdate} perms={{ tips:true, schedule:true }} isOwner data={data} currentUser={currentUser} />
        )}

        {/* Gestores deste restaurante */}
        {restTab === "gestores" && (
          <div style={{ padding:"24px", maxWidth:800, margin:"0 auto" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
              <div>
                <h3 style={{ color:"var(--text)", fontSize:16, fontWeight:700, margin:"0 0 4px" }}>Gestores de {rest?.name}</h3>
                <p style={{ color:"var(--text3)", fontSize:13, margin:0 }}>{restMgrs.length} gestor{restMgrs.length!==1?"es":""} com acesso</p>
              </div>
              <button onClick={()=>{
                setEditMgrId(null);
                setMgrForm({name:"",cpf:"",pin:"",restaurantIds:[selRestaurant],perms:{tips:true,schedule:true},isDP:false});
                setShowMgrModal(true);
              }} style={{...S.btnPrimary,width:"auto",padding:"10px 20px"}}>+ Novo Gestor</button>
            </div>

            {restMgrs.length === 0 && (
              <div style={{...S.card, textAlign:"center", padding:40}}>
                <div style={{fontSize:36,marginBottom:12}}>👔</div>
                <p style={{color:"var(--text3)",fontSize:14,marginBottom:16}}>Nenhum gestor atribuído a este restaurante.</p>
                <button onClick={()=>{
                  setEditMgrId(null);
                  setMgrForm({name:"",cpf:"",pin:"",restaurantIds:[selRestaurant],perms:{tips:true,schedule:true},isDP:false});
                  setShowMgrModal(true);
                }} style={{...S.btnPrimary,width:"auto",padding:"10px 24px"}}>Adicionar primeiro gestor</button>
              </div>
            )}

            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {restMgrs.map(m => (
                <div key={m.id} style={{...S.card}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div>
                      <div style={{color:"var(--text)",fontWeight:700,fontSize:15,marginBottom:2}}>{m.name}</div>
                      <div style={{color:"var(--text3)",fontSize:12,marginBottom:8}}>CPF: {m.cpf||"—"}</div>
                      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:6}}>
                        {[["tips","💸 Gorjetas"],["schedule","📅 Escala"],["roles","🏷️ Cargos"],["employees","👥 Equipe"],["comunicados","📢 Comuns."],["faq","❓ FAQ"],["dp","💬 DP"],["horarios","🕐 Horários"]].map(([k,lbl])=>
                          m.perms?.[k]!==false ? <span key={k} style={{background:"var(--green-bg)",color:"var(--green)",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:600}}>{lbl}</span> : null
                        )}
                        {m.isDP && <span style={{background:"var(--blue-bg)",color:"var(--blue)",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:600}}>📬 DP</span>}
                      </div>
                      {/* Outros restaurantes que esse gestor acessa */}
                      {(m.restaurantIds??[]).filter(rid=>rid!==selRestaurant).length > 0 && (
                        <div style={{color:"var(--text3)",fontSize:11}}>
                          Também acessa: {(m.restaurantIds??[]).filter(rid=>rid!==selRestaurant).map(rid=>restaurants.find(r=>r.id===rid)?.name).filter(Boolean).join(", ")}
                        </div>
                      )}
                    </div>
                    <div style={{display:"flex",gap:8,flexShrink:0}}>
                      <button onClick={()=>{setEditMgrId(m.id);setMgrForm({name:m.name,cpf:m.cpf??"",pin:m.pin??"",restaurantIds:m.restaurantIds??[],perms:m.perms??{tips:true,schedule:true},isDP:m.isDP??false});setShowMgrModal(true);}} style={{...S.btnSecondary,fontSize:12}}>Editar</button>
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
                      }} style={{background:"none",border:"1px solid var(--red)33",borderRadius:8,color:"var(--red)",cursor:"pointer",fontSize:12,padding:"6px 12px",fontFamily:"'DM Sans',sans-serif"}}>Remover</button>
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

          // Valor da cobrança — mensal = valor do mês, anual = total do ano
          const valorMensal = (() => {
            if (isOrc) return null;
            if (isEnt) {
              const porEmp = empMax * 7.99;
              return tipo === "anual" ? porEmp * 12 * 0.9 : porEmp;
            }
            if (tipo === "anual") return (plano.anual ?? 0) * 12;
            return plano.mensal;
          })();

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
          const proxLabel = `${fmt(proxIni)} a ${fmt(proxFim)}`;

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
                        style={{padding:"10px 14px",borderRadius:10,border:`1px solid ${sel?ac:"var(--border)"}`,background:sel?"var(--ac-bg)":"transparent",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",textAlign:"left",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <span style={{color:sel?"var(--ac-text)":"var(--text2)",fontWeight:sel?700:400}}>{sel?"✓":"○"} {p.label} {p.id==="p10"?"(até 10)":p.id==="p20"?"(até 20)":p.id==="p50"?"(até 50)":p.id==="p999"?"(51–100)":"(+100)"}</span>
                        <span style={{color:"var(--text3)",fontSize:11}}>{precos[p.id]}</span>
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
                <div style={{padding:"14px",borderRadius:12,background:"var(--ac-bg)",border:"1px solid var(--ac)33",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{color:"var(--text3)",fontSize:11,fontWeight:600,marginBottom:4}}>VALOR A COBRAR</div>
                    {isOrc
                      ? <div style={{color:"var(--ac-text)",fontWeight:800,fontSize:18}}>Sob orçamento</div>
                      : <div style={{color:"var(--ac-text)",fontWeight:800,fontSize:22,fontFamily:"'DM Mono',monospace"}}>
                          R$ {valorMensal?.toLocaleString("pt-BR",{minimumFractionDigits:2})}
                          <span style={{color:"var(--text3)",fontSize:13,fontWeight:400}}>
                            {tipo==="anual"?"/ano (12x)":"/mês"}
                          </span>
                        </div>
                    }
                    {isEnt && <div style={{color:"var(--text3)",fontSize:11,marginTop:2}}>
                      {tipo==="anual"
                        ? `${empMax} emp. × R$7,99 × 12 meses × 0,9 (−10%)`
                        : `${empMax} emp. × R$7,99/mês`}
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
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div><label style={S.label}>Nome completo</label><input value={mgrForm.name} onChange={e=>setMgrForm({...mgrForm,name:e.target.value})} style={S.input}/></div>
                <div><label style={S.label}>CPF (opcional)</label><input value={mgrForm.cpf} onChange={e=>setMgrForm({...mgrForm,cpf:maskCpf(e.target.value)})} placeholder="000.000.000-00" style={S.input} inputMode="numeric"/></div>
              </div>
              <div><label style={S.label}>PIN (4–6 dígitos)</label><input type="password" value={mgrForm.pin} onChange={e=>setMgrForm({...mgrForm,pin:e.target.value})} maxLength={6} style={S.input}/></div>
              <div>
                <label style={S.label}>Permissões</label>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                  {[["tips","💸 Gorjetas"],["schedule","📅 Escala"],["roles","🏷️ Cargos"],["employees","👥 Equipe"],["comunicados","📢 Comunicados"],["faq","❓ FAQ"],["dp","💬 Fale c/ DP"],["horarios","🕐 Horários"]].map(([k,lbl])=>{
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
              <button onClick={saveMgr} style={S.btnPrimary}>{editMgrId?"Salvar":"Criar Gestor"}</button>
            </div>
          </Modal>
        )}
      </div>
    );
  }

  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", fontFamily:"'DM Sans',sans-serif" }}>
      <div style={{ background:"var(--header-bg)", borderBottom:"1px solid var(--border)", padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", boxShadow:"0 1px 4px rgba(0,0,0,0.04)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:18 }}>⭐</span>
          <span style={{ color:"var(--text)", fontWeight:800, fontSize:16 }}>Admin AppTip</span>
          <span style={{ color:"var(--text3)", fontSize:12 }}>· {currentUser?.name}</span>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={toggleTheme} style={{background:"none",border:"1px solid var(--border)",borderRadius:20,padding:"6px 10px",cursor:"pointer",fontSize:16,color:"var(--text2)"}}>{theme==="dark"?"☀️":"🌙"}</button>
          <button onClick={onBack} style={{ ...S.btnSecondary, fontSize:12 }}>Sair</button>
        </div>
      </div>
      <div style={{ display:"flex", borderBottom:"1px solid var(--border)", background:"var(--header-bg)", overflowX:"auto" }}>
        {TABS.map(([id,lbl])=>(
          <button key={id} onClick={()=>setTab(id)} style={{ padding:"12px 20px", background:"none", border:"none", borderBottom:`2px solid ${tab===id?ac:"transparent"}`, color:tab===id?ac:"var(--text3)", cursor:"pointer", fontSize:14, fontFamily:"'DM Sans',sans-serif", fontWeight:tab===id?700:500, whiteSpace:"nowrap" }}>{lbl}</button>
        ))}
      </div>

      <div style={{ padding:"20px 24px", maxWidth:1100, margin:"0 auto" }}>

        {/* DASHBOARD */}
        {tab === "dashboard" && (() => {
          const totalRests = restaurants.length;
          const totalEmps = employees.filter(e=>!e.inactive).length;
          const totalMgrs = managers.length;
          const receitaMensal = restaurants.reduce((sum, r) => {
            const p = getPlano(r);
            return sum + (p.mensal ?? 0);
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
                      <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",borderRadius:10,background:"#fff",border:"1px solid #fde68a",marginBottom:8}}>
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
                        {!n.read && (
                          <button onClick={()=>{
                            const updated = notifications.map(x => x.id===n.id ? {...x,read:true} : x);
                            onUpdate("notifications", updated);
                          }} style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:18,flexShrink:0,padding:4}}>✓</button>
                        )}
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
          const hoje = today();
          const rows = restaurants.map(r => {
            const plano = getPlano(r);
            const fin = r.financeiro ?? {};
            const tipoCobranca = r.tipoCobranca ?? "mensal";
            const isEnt = r.planoId === "p999";
            const isOrc = r.planoId === "pOrc";
            const empMax = isEnt ? (r.empMaxCustom ?? 51) : (isOrc ? (r.empMaxCustom ?? 101) : plano.empMax);
            const valorBase = isEnt ? 0 : (tipoCobranca === "anual" ? plano.anual : plano.mensal);
            const valorAdicionais = isEnt ? empMax * 7.99 : 0;
            const valorTotal = isOrc ? null : (valorBase ?? 0) + valorAdicionais;
            const status = fin.status ?? "ativo";
            const venc = fin.proximoVencimento;
            const diasParaVencer = venc ? Math.ceil((new Date(venc+"T12:00:00") - new Date()) / (1000*60*60*24)) : null;
            const ultimoPag = fin.pagamentos?.[0];
            return { r, plano, fin, tipoCobranca, valorTotal, status, venc, diasParaVencer, ultimoPag };
          });

          const receitaTotal = rows.reduce((s, x) => s + (x.valorTotal ?? 0), 0);
          const inadimplentes = rows.filter(x => x.status === "inadimplente").length;
          const vencendo = rows.filter(x => x.status !== "inadimplente" && x.diasParaVencer !== null && x.diasParaVencer <= 7 && x.diasParaVencer >= 0).length;
          const vencidos = rows.filter(x => x.status !== "inadimplente" && x.diasParaVencer !== null && x.diasParaVencer < 0).length;

          const [filtro, setFiltro] = [filtroFinanceiro, setFiltroFinanceiro];
          const rowsFiltrados = rows.filter(x => {
            if (filtro === "inadimplente") return x.status === "inadimplente";
            if (filtro === "vencido") return x.status !== "inadimplente" && x.diasParaVencer !== null && x.diasParaVencer < 0;
            if (filtro === "vencendo") return x.status !== "inadimplente" && x.diasParaVencer !== null && x.diasParaVencer >= 0 && x.diasParaVencer <= 7;
            if (filtro === "emdia") return x.status === "ativo" && (x.diasParaVencer === null || x.diasParaVencer > 7);
            return true;
          });

          return (
            <div>
              {/* Métricas */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:14,marginBottom:24}}>
                {[
                  { label:"Receita mensal", value:`R$${receitaTotal.toLocaleString("pt-BR",{minimumFractionDigits:2})}`, color:"var(--ac)", icon:"💰" },
                  { label:"Em dia", value:rows.length - inadimplentes - vencidos - vencendo, color:"var(--green)", icon:"✅" },
                  { label:"Vencendo em 7d", value:vencendo, color:"#f59e0b", icon:"⚡" },
                  { label:"Vencidos", value:vencidos, color:"var(--red)", icon:"⏰" },
                  { label:"Inadimplentes", value:inadimplentes, color:"var(--red)", icon:"🔴" },
                ].map(m=>(
                  <div key={m.label} style={{...S.card,display:"flex",alignItems:"center",gap:12}}>
                    <span style={{fontSize:24}}>{m.icon}</span>
                    <div>
                      <div style={{color:"var(--text3)",fontSize:10,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5}}>{m.label}</div>
                      <div style={{color:m.color,fontSize:20,fontWeight:800,fontFamily:"'DM Mono',monospace"}}>{m.value}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Filtros */}
              <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
                {[
                  ["todos","Todos"],
                  ["emdia","✅ Em dia"],
                  ["vencendo","⚡ Vencendo"],
                  ["vencido","⏰ Vencidos"],
                  ["inadimplente","🔴 Inadimplentes"],
                ].map(([v,l])=>(
                  <button key={v} onClick={()=>setFiltro(v)}
                    style={{padding:"6px 16px",borderRadius:20,border:`1px solid ${filtro===v?ac:"var(--border)"}`,background:filtro===v?"var(--ac-bg)":"transparent",color:filtro===v?"var(--ac-text)":"var(--text3)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:filtro===v?700:400}}>
                    {l}
                  </button>
                ))}
              </div>

              {/* Tabela */}
              <div style={{...S.card,padding:0,overflow:"hidden"}}>
                {/* Header */}
                <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr 1fr",gap:0,padding:"10px 16px",background:"var(--bg2)",borderBottom:"1px solid var(--border)"}}>
                  {["Restaurante","Plano","Valor/mês","Último pag.","Próx. venc.","Status"].map(h=>(
                    <div key={h} style={{color:"var(--text3)",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:0.5}}>{h}</div>
                  ))}
                </div>

                {rowsFiltrados.length === 0 && (
                  <div style={{padding:"32px",textAlign:"center",color:"var(--text3)"}}>Nenhum restaurante neste filtro.</div>
                )}

                {rowsFiltrados.map(({r, plano, fin, valorTotal, status, venc, diasParaVencer, ultimoPag})=>{
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
                    ? <span style={{color:"var(--red)",fontWeight:700,fontSize:12}}>🔴 Inadimplente</span>
                    : isVencido
                    ? <span style={{color:"var(--red)",fontWeight:600,fontSize:12}}>⏰ Vencido {Math.abs(diasRow)}d</span>
                    : isVencendo
                    ? <span style={{color:"#f59e0b",fontWeight:600,fontSize:12}}>⚡ {diasRow}d</span>
                    : emTrialRow
                    ? <span style={{color:"#92400e",fontWeight:600,fontSize:12}}>🎯 Trial {diasTrialRow}d</span>
                    : !cicloInicioRow
                    ? <span style={{color:"var(--text3)",fontSize:12}}>⚙️ Não iniciado</span>
                    : <span style={{color:"var(--green)",fontWeight:600,fontSize:12}}>✅ Em dia</span>;

                  return (
                    <div key={r.id} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr 1fr 1fr",gap:0,padding:"12px 16px",borderBottom:"1px solid var(--border)",background:rowBg,alignItems:"center",cursor:"pointer"}}
                      onClick={()=>{ setSelRestaurant(r.id); setRestTab("financeiro"); }}>
                      <div>
                        <div style={{color:"var(--text)",fontWeight:700,fontSize:14}}>{r.name}</div>
                        <div style={{color:"var(--text3)",fontSize:11}}>{r.tipoCobranca==="anual"?"Anual":"Mensal"}</div>
                      </div>
                      <div style={{color:"var(--text2)",fontSize:13}}>{plano.label}</div>
                      <div style={{color:"var(--text)",fontWeight:700,fontSize:13,fontFamily:"'DM Mono',monospace"}}>
                        {valorTotal ? `R$${valorTotal.toLocaleString("pt-BR",{minimumFractionDigits:2})}` : "—"}
                      </div>
                      <div style={{color:"var(--text3)",fontSize:12}}>
                        {ultimoPag ? new Date(ultimoPag.data+"T12:00:00").toLocaleDateString("pt-BR") : "—"}
                      </div>
                      <div style={{color:isVencido||isInad?"var(--red)":isVencendo?"#f59e0b":"var(--text3)",fontSize:12,fontWeight:isVencido||isVencendo||isInad?700:400}}>
                        {venc ? new Date(venc+"T12:00:00").toLocaleDateString("pt-BR") : "—"}
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        {statusEl}
                        <span style={{color:"var(--text3)",fontSize:14,marginLeft:"auto"}}>›</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Resumo */}
              <div style={{marginTop:12,color:"var(--text3)",fontSize:12,textAlign:"right"}}>
                {rowsFiltrados.length} de {rows.length} restaurantes · Receita filtrada: R${rowsFiltrados.reduce((s,x)=>s+(x.valorTotal??0),0).toLocaleString("pt-BR",{minimumFractionDigits:2})}
              </div>
            </div>
          );
        })()}

        {/* RESTAURANTES */}
        {tab === "restaurants" && (
          <div>
            <button onClick={()=>{setEditRestId(null);setRestForm({name:"",cnpj:"",address:"",whatsappFin:"",whatsappOp:""});setShowRestModal(true);}} style={{...S.btnPrimary,marginBottom:20}}>+ Novo Restaurante</button>
            {restaurants.length === 0 && <p style={{color:"var(--text3)",textAlign:"center"}}>Nenhum restaurante cadastrado.</p>}
            {/* Export geral */}
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
              }} style={{...S.btnSecondary,marginBottom:16,fontSize:12,color:"var(--green)",borderColor:"var(--green)"}}>
                💾 Exportar backup completo
              </button>
            )}
            {restaurants.map(r => {
              const empCount = employees.filter(e=>e.restaurantId===r.id&&!e.inactive).length;
              const mgrCount = managers.filter(m=>m.restaurantIds?.includes(r.id)).length;
              const plano = getPlano(r);
              const atLimit = empCount >= plano.empMax;
              const pct = Math.min(100, Math.round((empCount/plano.empMax)*100));
              return (
                <div key={r.id} style={{...S.card,marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div style={{flex:1}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                        <span style={{color:ac,fontWeight:700,fontSize:13,background:"var(--ac)22",borderRadius:6,padding:"2px 8px"}}>{r.shortCode||"—"}</span>
                        <span style={{color:"var(--text)",fontWeight:700,fontSize:16}}>{r.name}</span>
                        <span style={{background:atLimit?"#ef444422":"#10b98122",color:atLimit?"var(--red)":"var(--green)",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700}}>{plano.label}</span>
                      </div>
                      {r.cnpj && <div style={{color:"var(--text3)",fontSize:12}}>CNPJ: {r.cnpj}</div>}
                      {r.address && <div style={{color:"var(--text3)",fontSize:12}}>{r.address}</div>}
                      <div style={{marginTop:8,display:"flex",alignItems:"center",gap:8}}>
                        <div style={{flex:1,background:"var(--bg1)",borderRadius:4,height:6,overflow:"hidden",maxWidth:120}}>
                          <div style={{width:`${pct}%`,height:"100%",background:atLimit?"var(--red)":pct>80?"#f59e0b":"var(--green)",borderRadius:4}}/>
                        </div>
                        <span style={{color:atLimit?"var(--red)":"var(--text3)",fontSize:12,fontWeight:atLimit?700:400}}>
                          {empCount}/{plano.empMax} emp. · {mgrCount} gestor{mgrCount!==1?"es":""}
                        </span>
                        {plano.mensal && <span style={{color:"var(--text3)",fontSize:11}}>R${plano.mensal}/mês</span>}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
                      <button onClick={()=>setSelRestaurant(r.id)} style={{...S.btnSecondary,fontSize:12,color:ac,borderColor:ac}}>Abrir →</button>
                      <button onClick={()=>{setSelRestaurant(r.id);setRestTab("financeiro");}} style={{...S.btnSecondary,fontSize:12,color:"var(--green)",borderColor:"var(--green)"}}>💳</button>
                      <button onClick={()=>{setEditRestId(r.id);setRestForm({name:r.name,shortCode:r.shortCode??"",cnpj:r.cnpj??"",address:r.address??"",whatsappFin:r.whatsappFin??"",whatsappOp:r.whatsappOp??""});setShowRestModal(true);}} style={{...S.btnSecondary,fontSize:12}}>Editar</button>
                      <button onClick={()=>{
                        if(!window.confirm(`Mover "${r.name}" para a lixeira? Você poderá restaurar depois.`)) return;
                        softDelete("restaurants", r);
                        onUpdate("restaurants", restaurants.filter(x=>x.id!==r.id));
                        onUpdate("_toast", `🗑️ ${r.name} movido para a lixeira.`);
                      }} style={{background:"none",border:"1px solid var(--red)33",borderRadius:8,color:"var(--red)",cursor:"pointer",fontSize:12,padding:"6px 12px",fontFamily:"'DM Sans',sans-serif"}}>🗑️</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* GESTORES */}
        {tab === "managers" && (
          <div>
            <div style={{...S.card,background:"var(--bg2)",marginBottom:20,display:"flex",alignItems:"center",gap:12}}>
              <span style={{fontSize:20}}>ℹ️</span>
              <p style={{color:"var(--text3)",fontSize:13,margin:0}}>Visão global de todos os gestores. Para criar ou editar gestores, acesse o restaurante correspondente → aba <strong>Gestores</strong>.</p>
            </div>
            {managers.length === 0 && <p style={{color:"var(--text3)",textAlign:"center"}}>Nenhum gestor cadastrado. Crie gestores dentro de cada restaurante.</p>}
            {managers.map(m=>(
              <div key={m.id} style={{...S.card,marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                      <span style={{color:"var(--text)",fontWeight:700,fontSize:15}}>{m.name}</span>
                      {m.isDP && <span style={{background:"var(--blue-bg)",color:"var(--blue)",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700}}>📬 DP</span>}
                    </div>
                    <div style={{color:"var(--text3)",fontSize:12,marginBottom:8}}>CPF: {m.cpf||"—"}</div>
                    <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                      {(m.restaurantIds??[]).map(rid=>{
                        const r=restaurants.find(x=>x.id===rid);
                        return r ? (
                          <button key={rid} onClick={()=>setSelRestaurant(rid)}
                            style={{background:"var(--ac-bg)",color:"var(--ac-text)",borderRadius:6,padding:"3px 10px",fontSize:12,fontWeight:600,border:"none",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                            {r.name} →
                          </button>
                        ) : null;
                      })}
                      {(!m.restaurantIds||m.restaurantIds.length===0)&&<span style={{color:"var(--text3)",fontSize:12}}>Sem restaurantes atribuídos</span>}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* SUPER GESTORES */}
        {tab === "owners" && (
          <div>
            <button onClick={()=>{setEditOwnerId(null);setOwnerForm({name:"",cpf:"",pin:""});setShowOwnerModal(true);}} style={{...S.btnPrimary,marginBottom:20}}>+ Novo Admin AppTip</button>
            {owners.map(s=>(
              <div key={s.id} style={{...S.card,marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center",border:s.isMaster?"1px solid var(--ac)44":"1px solid var(--border)"}}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{color:"var(--text)",fontWeight:700,fontSize:15}}>{s.name}</span>
                    {s.isMaster && <span style={{background:"var(--ac-bg)",color:"var(--ac-text)",borderRadius:6,padding:"2px 8px",fontSize:11,fontWeight:700}}>👑 Master</span>}
                    {s.id===currentUser?.id&&<span style={{color:"var(--text3)",fontSize:11}}>← você</span>}
                  </div>
                  <div style={{color:"var(--text3)",fontSize:12}}>CPF: {s.cpf||"—"}</div>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>{setEditOwnerId(s.id);setOwnerForm({name:s.name,cpf:s.cpf??"",pin:s.pin??"",isMaster:s.isMaster??false});setShowOwnerModal(true);}} style={{...S.btnSecondary,fontSize:12}}>Editar</button>
                  {/* Master não pode ser excluído */}
                  {!s.isMaster && owners.length>1 && isMaster && (
                    <button onClick={()=>{
                      if(!window.confirm(`Excluir admin "${s.name}"?`)) return;
                      onUpdate("owners",owners.filter(x=>x.id!==s.id));
                    }} style={{background:"none",border:"1px solid var(--red)33",borderRadius:8,color:"var(--red)",cursor:"pointer",fontSize:12,padding:"6px 12px",fontFamily:"'DM Sans',sans-serif"}}>✕</button>
                  )}
                  {s.isMaster && <span style={{color:"var(--text3)",fontSize:11,padding:"6px 8px"}}>🔒 Protegido</span>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* LIXEIRA — só master */}
        {tab === "trash" && isMaster && (() => {
          const cutoff7  = new Date(Date.now() - 7  * 24*60*60*1000).toISOString();
          const cutoff30 = new Date(Date.now() - 30 * 24*60*60*1000).toISOString();

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
            if (tabKey === "horarios") onUpdate("workSchedules", {...(data?.workSchedules??{}), [restaurantId]: snapshot.workSchedules});
            onUpdate("trash", {...trash, tabData:(trash.tabData??[]).filter(x=>x.id!==entry.id)});
            onUpdate("_toast", `↩ ${entry.tabLabel} restaurado!`);
          }

          function hardDeleteTab(entry) {
            if(!window.confirm(`Excluir permanentemente "${entry.tabLabel}" de ${entry.restaurantName}? Não tem volta.`)) return;
            onUpdate("trash", {...trash, tabData:(trash.tabData??[]).filter(x=>x.id!==entry.id)});
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
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div><label style={S.label}>Nome completo</label><input value={mgrForm.name} onChange={e=>setMgrForm({...mgrForm,name:e.target.value})} style={S.input}/></div>
              <div><label style={S.label}>CPF (opcional)</label><input value={mgrForm.cpf} onChange={e=>setMgrForm({...mgrForm,cpf:maskCpf(e.target.value)})} placeholder="000.000.000-00" style={S.input} inputMode="numeric"/></div>
            </div>
            <div><label style={S.label}>PIN (4–6 dígitos)</label><input type="password" value={mgrForm.pin} onChange={e=>setMgrForm({...mgrForm,pin:e.target.value})} maxLength={6} style={S.input}/></div>

            <div>
              <label style={S.label}>Permissões de acesso às abas</label>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[["tips","💸 Gorjetas"],["schedule","📅 Escala"],["roles","🏷️ Cargos"],["employees","👥 Equipe"],["comunicados","📢 Comunicados"],["faq","❓ FAQ"],["dp","💬 Fale c/ DP"],["horarios","🕐 Horários"]].map(([k,lbl])=>{
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
            <div><label style={S.label}>PIN (4–6 dígitos)</label><input type="password" value={ownerForm.pin} onChange={e=>setOwnerForm({...ownerForm,pin:e.target.value})} maxLength={6} style={S.input}/></div>
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
function ManagerPortal({ manager, data, onUpdate, onBack, toggleTheme, theme }) {
  const { restaurants, employees, roles, tips, splits, schedules } = data;
  const myRestaurants = restaurants.filter(r => manager.restaurantIds?.includes(r.id));
  const [selId, setSelId] = useState(() => {
    const saved = localStorage.getItem("apptip_selrest");
    if (myRestaurants.length === 1) return myRestaurants[0].id;
    if (saved && myRestaurants.find(r => r.id === saved)) return saved;
    return null;
  });
  const ac = "var(--ac)";

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
    const dpNaoLidas = (data?.dpMessages??[]).filter(m => m.restaurantId === rid && !m.read).length;
    const commsPendentes = (data?.communications??[]).filter(c =>
      c.restaurantId === rid &&
      employees.filter(e => e.restaurantId === rid).some(e => !(data?.commAcks??{})[`${c.id}_${e.id}`])
    ).length;
    return { empAtivos, diasComGorjeta, dpNaoLidas, commsPendentes };
  }

  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", fontFamily:"'DM Sans',sans-serif" }}>

      {/* Header melhorado */}
      <div style={{ background:"var(--header-bg)", borderBottom:"1px solid var(--border)", padding:"12px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", boxShadow:"0 1px 4px rgba(0,0,0,0.04)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          {selId && myRestaurants.length > 1 && (
            <button onClick={()=>setSelId(null)}
              style={{ background:"none", border:"1px solid var(--border)", borderRadius:8, padding:"5px 10px", cursor:"pointer", color:"var(--text3)", fontSize:12, display:"flex", alignItems:"center", gap:4 }}>
              ‹ Trocar
            </button>
          )}
          <div>
            <div style={{ display:"flex", alignItems:"center", gap:6 }}>
              <span style={{fontSize:16}}>📊</span>
              <span style={{color:"var(--text)",fontWeight:800,fontSize:15}}>
                {selRest ? selRest.name : "Gestor"}
              </span>
            </div>
            <div style={{color:"var(--text3)",fontSize:11,marginTop:1}}>{manager.name}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <button onClick={toggleTheme} style={{background:"none",border:"1px solid var(--border)",borderRadius:20,padding:"6px 10px",cursor:"pointer",fontSize:14,color:"var(--text2)"}}>
            {theme==="dark"?"☀️":"🌙"}
          </button>
          <a href="/guia-gestor" target="_blank" rel="noreferrer"
            style={{...S.btnSecondary,fontSize:12,textDecoration:"none",display:"flex",alignItems:"center",gap:4,padding:"6px 12px"}}>
            ❓ Ajuda
          </a>
          <button onClick={onBack} style={{...S.btnSecondary,fontSize:12}}>Sair</button>
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
          ) : (
            <RestaurantPanel
              restaurant={selRest} restaurants={restaurants} employees={employees}
              roles={roles} tips={tips} splits={splits} schedules={schedules}
              onUpdate={onUpdate}
              perms={{...(manager.perms ?? {tips:true,schedule:true}), isDP: manager.isDP ?? false}}
              isOwner={false} data={data} currentUser={manager}
            />
          )}
        </div>
      )}
    </div>
  );
}

//
// LOGIN
//
function UnifiedLogin({ owners, managers, employees, restaurants, onLoginOwner, onLoginManager, onLoginEmployee, onSetupFirst, onGoHome, toggleTheme, theme }) {
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

    // Coletar todos os papéis que batem com CPF/PIN
    const found = [];

    if (!isEmpId) {
      // Supergestor
      const superUser = owners.find(s => s.cpf?.replace(/\D/g,"") === cleanCpf && String(s.pin) === cleanPin);
      if (superUser) found.push({ label:"Admin AppTip", icon:"⭐", action:()=>{ setChoices(null); onLoginOwner(superUser); } });

      // Gestor (aceita PIN do gestor OU PIN do empregado com mesmo CPF)
      const empByCpf = employees.find(e => e.cpf?.replace(/\D/g,"") === cleanCpf);
      const mgr = managers.find(m => m.cpf?.replace(/\D/g,"") === cleanCpf && (String(m.pin) === cleanPin || (empByCpf && String(empByCpf.pin) === cleanPin)));
      if (mgr) {
        // Gestor sempre consegue logar — bloqueio por inadimplência acontece dentro do portal
        found.push({ label:"Gestor", icon:"📊", action:()=>{ setChoices(null); onLoginManager(mgr); } });
      }

      // Empregado por CPF (aceita PIN do empregado, do gestor OU do supergestor com mesmo CPF)
      const superByCpf = owners.find(s => s.cpf?.replace(/\D/g,"") === cleanCpf);
      const mgrByCpf = managers.find(m => m.cpf?.replace(/\D/g,"") === cleanCpf);
      const emp = employees.find(e => e.cpf?.replace(/\D/g,"") === cleanCpf && (
        String(e.pin) === cleanPin ||
        (mgrByCpf && String(mgrByCpf.pin) === cleanPin) ||
        (superByCpf && String(superByCpf.pin) === cleanPin)
      ));
      if (emp && !(emp.inactive && emp.inactiveFrom && emp.inactiveFrom <= today())) {
        // Verifica inadimplência do restaurante
        const restDoEmp = restaurants.find(r=>r.id===emp.restaurantId);
        if (restDoEmp?.financeiro?.status === "inadimplente") {
          setErr("⚠️ O acesso ao sistema está suspenso. Entre em contato com o administrador do restaurante.");
          return;
        }
        found.push({ label:"Empregado", icon:"👤", action:()=>{ setChoices(null); localStorage.setItem("apptip_empid", emp.id); localStorage.setItem("apptip_userid", emp.id); onLoginEmployee(emp); } });
      }
    } else {
      // Por ID — sempre empregado
      const emp = employees.find(e => e.empCode?.toUpperCase() === clean.toUpperCase() && String(e.pin) === cleanPin);
      if (emp) {
        if (emp.inactive && emp.inactiveFrom && emp.inactiveFrom <= today()) {
          setErr("Acesso desativado. Fale com o departamento pessoal."); return;
        }
        localStorage.setItem("apptip_empid", emp.id);
        localStorage.setItem("apptip_userid", emp.id);
        setErr(""); setAttempts(0); onLoginEmployee(emp); return;
      }
    }

    if (found.length === 1) {
      setErr(""); setAttempts(0); found[0].action(); return;
    }

    if (found.length > 1) {
      const cleanCpfForName = credential.replace(/\D/g,"");
      const name =
        owners.find(s => s.cpf?.replace(/\D/g,"") === cleanCpfForName)?.name ??
        managers.find(m => m.cpf?.replace(/\D/g,"") === cleanCpfForName)?.name ??
        employees.find(e => e.cpf?.replace(/\D/g,"") === cleanCpfForName)?.name ??
        "Usuário";
      setErr(""); setAttempts(0); setChoices({ name, options: found }); return;
    }

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
                  {opt.label==="Admin AppTip"&&"Gerenciar restaurantes e equipes"}
                  {opt.label==="Gestor"&&"Gerenciar gorjetas, escala e equipe"}
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
                type="password" inputMode="numeric" maxLength={6}
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
                  <button onClick={e=>{e.preventDefault();document.getElementById("apptip-privacy").style.display="flex";}}
                    style={{background:"none",border:"none",color:ac,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,padding:0,textDecoration:"underline"}}>
                    Política de Privacidade
                  </button>
                </span>
              </label>
            )}

            {err && (
              <div style={{background:isBlocked?"#f59e0b12":"var(--red-bg)",border:`1px solid ${isBlocked?"#f59e0b33":"var(--red)33"}`,borderRadius:8,padding:"10px 12px",color:isBlocked?"#d97706":"var(--red)",fontSize:13,fontWeight:500}}>
                {err}
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
            <button onClick={()=>document.getElementById("apptip-privacy").style.display="flex"}
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
    if (form.pin.length < 4) { setErr("PIN deve ter ao menos 4 dígitos."); return; }
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
            <div><label style={S.label}>PIN (4–6 dígitos)</label><input type="password" maxLength={6} value={form.pin} onChange={e=>setForm({...form,pin:e.target.value})} style={S.input}/></div>
            <div><label style={S.label}>Confirmar PIN</label><input type="password" maxLength={6} value={form.pin2} onChange={e=>setForm({...form,pin2:e.target.value})} style={S.input} onKeyDown={e=>e.key==="Enter"&&submit()}/></div>
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
    { icon:"❓", title:"FAQ com assistente de IA", desc:"Base de perguntas e respostas para sua equipe. Perguntas automáticas sobre gorjetas e regras, mais IA (Gemini) para ajudar o gestor a redigir." },
    { icon:"📢", title:"Comunicados com IA", desc:"Envie avisos para toda a equipe ou áreas específicas. Assistente de IA ajuda a redigir. Acompanhe quem leu e confirmou." },
    { icon:"💬", title:"Canal com o DP", desc:"Canal direto, inclusive anônimo, para comunicação entre equipe e departamento pessoal. Sugestões, denúncias, atestados e dúvidas trabalhistas." },

    { icon:"🔒", title:"Gestão financeira integrada", desc:"Controle de ciclos, cobranças e pagamentos. Página de fatura para o cliente confirmar o pagamento com um clique." },
    { icon:"📱", title:"100% no celular", desc:"Sem app para instalar. Acessa pelo navegador em qualquer smartphone. Gestor e empregado com portais distintos e seguros." },
  ];

  const PLANOS = [
    { nome:"Starter",      emp:"até 10",    precoAnual:"R$87,30",  precoMensal:"R$97",   anualSub:"por mês no plano anual", mensalSub:"ou R$97/mês no mensal",  destaque:false, cta:"Começar agora" },
    { nome:"Básico",       emp:"até 20",    precoAnual:"R$168,30", precoMensal:"R$187",  anualSub:"por mês no plano anual", mensalSub:"ou R$187/mês no mensal", destaque:true,  cta:"Começar agora" },
    { nome:"Profissional", emp:"até 50",    precoAnual:"R$357,30", precoMensal:"R$397",  anualSub:"por mês no plano anual", mensalSub:"ou R$397/mês no mensal", destaque:false, cta:"Começar agora" },
    { nome:"Enterprise",   emp:"51 a 100",  precoAnual:"R$7,99",   precoMensal:null,     anualSub:"por empregado/mês",      mensalSub:"pagamento mensal",       destaque:false, cta:"Falar com a gente" },
    { nome:"On Demand",    emp:"+100",      precoAnual:null,       precoMensal:null,     anualSub:"",                       mensalSub:"Solução personalizada",  destaque:false, cta:"Falar com a gente" },
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
            O AppTip automatiza o cálculo e distribuição de gorjetas, controla escala, comunicados e FAQ com IA — tudo pelo celular, sem app para instalar.
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
          {[["100%","Mobile first — sem app instalar"],["IA","FAQ e comunicados assistidos"],["LGPD","Conformidade e dados protegidos"]].map(([n,l])=>(
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
            <p style={{color:"#8c7a5e",fontSize:16}}>Um sistema completo — gorjetas, escala, comunicados com IA e muito mais</p>
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
              ["1","Configure o restaurante","Cadastre áreas, cargos com pontos, empregados e regras fiscais. Pronto para operar."],
              ["2","Lance as gorjetas","Informe o valor diário. O sistema distribui automaticamente por cargo, área e escala."],
              ["3","Comunique a equipe","Envie comunicados com IA, gerencie o FAQ automático e mantenha todos informados."],
              ["4","Equipe acompanha tudo","Cada empregado vê extrato, escala e comunicados direto pelo celular."],
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

      {/* PREÇOS */}
      <section id="precos" style={{padding:"80px 24px",background:"#faf8f4"}}>
        <div style={{maxWidth:1000,margin:"0 auto"}}>
          <div style={{textAlign:"center",marginBottom:48}}>
            <h2 style={{fontSize:"clamp(24px,4vw,38px)",fontWeight:800,margin:"0 0 12px",letterSpacing:-0.8,color:"#1c1208"}}>Planos e preços</h2>
            <p style={{color:"#8c7a5e",fontSize:16}}>Plano anual com <strong style={{color:ac}}>10% de desconto</strong></p>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:16}}>
            {PLANOS.map(p=>(
              <div key={p.nome} style={{borderRadius:16,border:p.destaque?`2px solid ${ac}`:"1px solid #ede8df",padding:"24px 18px",background:p.destaque?"#1c1208":"#fff",position:"relative",boxShadow:p.destaque?"0 8px 32px #d4a01733":"0 2px 12px rgba(0,0,0,0.04)",display:"flex",flexDirection:"column"}}>
                {p.destaque && <div style={{position:"absolute",top:-12,left:"50%",transform:"translateX(-50%)",background:ac,color:"#fff",fontSize:11,fontWeight:700,padding:"4px 14px",borderRadius:20,whiteSpace:"nowrap"}}>Mais popular</div>}
                <div style={{color:p.destaque?"#fff":"#1c1208",fontWeight:800,fontSize:16,marginBottom:4}}>{p.nome}</div>
                <div style={{color:p.destaque?"#d4c4a0":"#8c7a5e",fontSize:12,marginBottom:16}}>{p.emp} empregados</div>

                {/* Preço principal — anual */}
                {p.precoAnual ? (
                  <div style={{marginBottom:8,flex:1}}>
                    <div style={{display:"flex",alignItems:"baseline",gap:2,flexWrap:"wrap",marginBottom:2}}>
                      <span style={{color:p.destaque?ac:"#1c1208",fontSize:p.nome==="Enterprise"?20:26,fontWeight:800,fontFamily:"'DM Mono',monospace",letterSpacing:-0.5,lineHeight:1.1}}>{p.precoAnual}</span>
                      <span style={{color:p.destaque?"#d4c4a0":"#8c7a5e",fontSize:11,whiteSpace:"nowrap"}}>/mês</span>
                    </div>
                    <div style={{color:"#d4a017",fontSize:11,fontWeight:700,marginBottom:p.precoMensal?6:16}}>
                      {p.nome==="Enterprise" ? "por empregado/mês" : "✦ no plano anual"}
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

                <a href="#contato" style={{display:"block",textAlign:"center",padding:"11px",borderRadius:10,background:p.destaque?ac:"#f5f0e8",color:p.destaque?"#fff":"#5c4a2e",fontWeight:700,fontSize:14,textDecoration:"none",marginTop:"auto"}}>
                  {p.cta}
                </a>
              </div>
            ))}
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
          <button onClick={()=>document.getElementById("apptip-privacy").style.display="flex"} style={{background:"none",border:"none",color:"#8c7a5e",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:13}}>Política de Privacidade</button>
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
      <div style={{fontSize:32}}>🍽️</div>
      <div style={{color:"#8c7a5e",fontSize:15}}>Carregando fatura...</div>
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
  <a href="#bloqueio"><span class="ic">🔒</span> Acesso Suspenso</a>
</nav>
<div class="main">
  <div class="topbar">
    <div><h1>Guia do Gestor</h1><div class="sub">Manual completo de uso do AppTip para gestores de restaurante</div></div>
    <span class="ver">v4.6 · 2026</span>
  </div>
  <div class="content">

    <div class="hero">
      <h2>Bem-vindo ao AppTip 🍽️</h2>
      <p>O AppTip centraliza a gestão de gorjetas. Como gestor, você lança gorjetas, gerencia equipe, escala, comunicados, FAQ com IA e configura as regras do restaurante.</p>
      <div class="chips">
        <span class="chip">💸 Gorjetas automáticas</span><span class="chip">📅 Escala</span><span class="chip">👥 Equipe</span><span class="chip">❓ FAQ com IA</span><span class="chip">📢 Comunicados</span><span class="chip">⚙️ Configurações</span>
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
          <div class="step"><div class="sn">2</div><div class="sc"><strong>Digite seu PIN</strong><p>Código de 4 a 6 dígitos. Se também for empregado, pode usar o mesmo PIN.</p></div></div>
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
        <p style="margin-top:10px">Se a gorjeta de hoje ainda não foi lançada, aparece um botão direto <strong>"💸 Lançar gorjeta de hoje"</strong> que leva direto à aba Gorjetas.</p>
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
      <div class="ib warn"><span class="ico">⚠️</span><span>Apenas empregados com presença na escala do dia recebem gorjeta daquele dia. Mantenha a escala atualizada.</span></div>
    </div>

    <div class="sec" id="escala">
      <div class="sh"><div class="iw">📅</div><div><h2>Escala</h2><p>Dias trabalhados por empregado</p></div></div>
      <div class="card"><h3>Por que é fundamental?</h3><p>A escala define quem trabalhou em cada dia e determina quem recebe gorjeta. Manter a escala atualizada garante a distribuição correta.</p></div>
      <div class="card"><h3>Como preencher</h3>
        <div class="steps">
          <div class="step"><div class="sn">1</div><div class="sc"><strong>Filtre por área</strong><p>Salão, Cozinha, Bar, Limpeza, Produção.</p></div></div>
          <div class="step"><div class="sn">2</div><div class="sc"><strong>Marque os dias</strong><p><span class="tag gr">✓</span> trabalhado · <strong>F</strong> falta injustificada · <strong>FJ</strong> justificada · <strong>A</strong> atestado · <strong>V</strong> férias</p></div></div>
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
          <tr><td>Criar</td><td>Preencha nome, pontos e área → clique "Add"</td></tr>
          <tr><td>Editar</td><td>Edite diretamente na linha → clique "Salvar"</td></tr>
          <tr><td>Sem gorjeta</td><td>Marque "Sem gorjeta" para cargos que não participam (sócios, admin)</td></tr>
          <tr><td>Inativar</td><td>Clique "Inativar" — cargo some da lista ativa, histórico preservado</td></tr>
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
      <div class="sh"><div class="iw">🕐</div><div><h2>Horários</h2><p>Horários contratuais dos empregados</p></div></div>
      <div class="card"><h3>Para que serve?</h3><p>Registra o horário contratual (entrada, saída, intervalo) de cada empregado. Usado para controle interno e geração automática da escala base.</p></div>
      <div class="card"><h3>Aprovação de alterações</h3><p>Empregados podem solicitar alterações pelo app. As solicitações chegam como notificações na Caixa para o gestor de DP aprovar ou recusar.</p></div>
    </div>
      <div class="card"><h3>Como funciona?</h3><p>O gestor faz upload dos recibos em PDF. Cada empregado acessa o próprio recibo diretamente pelo app, sem necessidade de envio individual.</p>
        <div class="steps">
          <div class="step"><div class="sn">1</div><div class="sc"><strong>Selecione mês e empregado</strong><p>Escolha o mês de competência e a quem pertence.</p></div></div>
          <div class="step"><div class="sn">2</div><div class="sc"><strong>Faça o upload</strong><p>Selecione o arquivo PDF. O empregado tem acesso imediatamente.</p></div></div>
        </div>
      </div>
    </div>

    <div class="sec" id="comunicados">
      <div class="sh"><div class="iw">📢</div><div><h2>Comunicados</h2><p>Avisos e informações para a equipe</p></div></div>
      <div class="card"><h3>Criar comunicado</h3>
        <div class="steps">
          <div class="step"><div class="sn">1</div><div class="sc"><strong>Escreva título e mensagem</strong><p>O título aparece em destaque para os empregados.</p></div></div>
          <div class="step"><div class="sn">2</div><div class="sc"><strong>Escolha o destinatário</strong><p>Toda a equipe ou áreas específicas (Bar, Cozinha, Salão...).</p></div></div>
          <div class="step"><div class="sn">3</div><div class="sc"><strong>Publique</strong><p>Aparece imediatamente. Acompanhe confirmações de leitura na lista de enviados.</p></div></div>
        </div>
        <div class="ib green"><span class="ico">✅</span><span>Você visualiza quem leu e quem ainda não confirmou diretamente na lista de comunicados enviados.</span></div>
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
      <div class="card"><h3>✨ Assistente de IA (Gemini) <span class="new">NOVO</span></h3>
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
      <div class="card"><h3>Responder mensagens</h3><p>As mensagens aparecem na aba "Fale com DP". Clique em uma mensagem para ver o histórico e responder. As respostas chegam diretamente no app do empregado.</p></div>
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
      <div class="card"><h3>Penalidade por falta injustificada</h3><p>Configure um percentual de desconto no pool mensal para empregados com faltas injustificadas. A configuração é por área nas Configurações do restaurante.</p></div>
    </div>

    <div class="sec" id="permissoes">
      <div class="sh"><div class="iw">🔑</div><div><h2>Permissões</h2><p>O que cada gestor pode acessar</p></div></div>
      <div class="card"><h3>Permissões definidas pelo Administrador</h3>
        <table>
          <tr><th>Permissão</th><th>Dá acesso a</th></tr>
          <tr><td>💸 Gorjetas</td><td>Dashboard, aba Gorjetas, exportação</td></tr>
          <tr><td>📅 Escala</td><td>Aba Escala</td></tr>
          <tr><td>🏷️ Cargos</td><td>Aba Cargos (se admin autorizou)</td></tr>
          <tr><td>👥 Equipe</td><td>Aba Equipe (se admin autorizou)</td></tr>
          <tr><td>📬 Gestor do DP</td><td>Aba Caixa, recebe mensagens do Fale com DP</td></tr>
        </table>
        <div class="ib tip"><span class="ico">💡</span><span>Se alguma aba não aparece, seu perfil pode não ter permissão ou o admin não autorizou. Contate o administrador AppTip.</span></div>
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
      <div>AppTip · Guia do Gestor · v4.6 · Abril 2026</div>
      <div style="margin-top:4px">Dúvidas? <a href="/cdn-cgi/l/email-protection#9bf8f4f5effaeff4dbfaebebeff2ebb5faebeb" style="color:var(--ac)"><span class="__cf_email__" data-cfemail="3a5955544e5b4e557a5b4a4a4e534a145b4a4a">[email&#160;protected]</span></a> · Clientes: <strong style="color:var(--t2)">(11) 98549-9821</strong></div>
    </div>

  </div>
</div>
</div>
<script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script><script>
const secs=document.querySelectorAll('.sec'),links=document.querySelectorAll('.sidebar a');
const obs=new IntersectionObserver(e=>{e.forEach(en=>{if(en.isIntersecting){links.forEach(l=>l.cla`;
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
export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("apptip_theme") || "light");

  useEffect(() => {
    document.body.classList.toggle("dark-mode", theme === "dark");
    localStorage.setItem("apptip_theme", theme);
  }, [theme]);

  function toggleTheme() { setTheme(t => t === "dark" ? "light" : "dark"); }

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
  const [receipts,      setReceipts]      = useState([]);
  const [workSchedules, setWorkSchedules] = useState({});
  const [notifications, setNotifications] = useState([]);
  const [noTipDays,     setNoTipDays]     = useState({});
  const [trash,         setTrash]         = useState({ restaurants:[], managers:[], employees:[] });

  useEffect(() => {
    const savedId = currentUserId;
    (async () => {
      const vals = await Promise.all(Object.values(K).map(load));
      const keys = Object.keys(K);
      const map = { owners:setOwners, managers:setManagers, restaurants:setRestaurants, employees:setEmployees, roles:setRoles, tips:setTips, splits:setSplits, schedules:setSchedules, communications:setCommunications, commAcks:setCommAcks, faq:setFaq, dpMessages:setDpMessages, workSchedules:setWorkSchedules, notifications:setNotifications, noTipDays:setNoTipDays, trash:setTrash };
      const loaded_data = {};
      keys.forEach((k, i) => { if (k !== "receipts" && vals[i]) { map[k]?.(vals[i]); loaded_data[k] = vals[i]; } });

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
      const recs = await loadReceipts();
      if (recs.length) setReceipts(recs);

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

      setLoaded(true);
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const data = { owners, managers, restaurants, employees, roles, tips, splits, schedules, communications, commAcks, faq, dpMessages, receipts, workSchedules, notifications, noTipDays, trash };

  async function handleUpdate(field, value) {
    if (field === "_toast") { setToast(value); return; }
    if (field === "receipts") {
      const prev = receipts;
      setReceipts(value);
      const newOnes = value.filter(r => !prev.find(p => p.id === r.id));
      const updated = value.filter(r => { const old = prev.find(p => p.id === r.id); return old && old.empId !== r.empId; });
      const deleted = prev.filter(p => !value.find(r => r.id === p.id));
      await Promise.all([
        ...newOnes.map(r => saveReceipt(r)),
        ...updated.map(r => saveReceipt(r)),
        ...deleted.map(r => deleteReceipt(r.id)),
      ]);
      setToast("Recibos atualizados");
      return;
    }
    const setters = { owners:setOwners, managers:setManagers, restaurants:setRestaurants, employees:setEmployees, roles:setRoles, tips:setTips, splits:setSplits, schedules:setSchedules, communications:setCommunications, commAcks:setCommAcks, faq:setFaq, dpMessages:setDpMessages, workSchedules:setWorkSchedules, notifications:setNotifications, noTipDays:setNoTipDays, trash:setTrash };
    const keys    = { owners:K.owners, managers:K.managers, restaurants:K.restaurants, employees:K.employees, roles:K.roles, tips:K.tips, splits:K.splits, schedules:K.schedules, communications:K.communications, commAcks:K.commAcks, faq:K.faq, dpMessages:K.dpMessages, workSchedules:K.workSchedules, notifications:K.notifications, noTipDays:K.noTipDays, trash:K.trash };
    console.log("handleUpdate field:", field, "has setter:", !!setters[field], "has key:", !!keys[field]);
    setters[field]?.(value);
    if (keys[field]) await save(keys[field], value);
    const labels = { owners:"Admins atualizados", managers:"Gestores atualizados", restaurants:"Restaurantes atualizados", employees:"Empregados atualizados", roles:"Cargos atualizados", tips:"Gorjetas atualizadas", splits:"Percentuais salvos", schedules:"Escala atualizada", communications:"Comunicados atualizados", commAcks:"Ciências atualizadas", faq:"FAQ atualizado", dpMessages:"Mensagem enviada", workSchedules:"Horários salvos", notifications:"Notificações atualizadas" };
    setToast(labels[field] ?? value ?? "Salvo!");
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

  if (!loaded) return (
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{fontSize:32}}>🍽️</div>
      <div style={{color:"var(--text3)",fontFamily:"'DM Sans',sans-serif",fontSize:15}}>Carregando…</div>
    </div>
  );

  return (
    <>
      {view === "login" && (
        <UnifiedLogin
          owners={owners} managers={managers} employees={employees} restaurants={restaurants}
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
      {view === "super" && <OwnerPortal data={data} onUpdate={handleUpdate} onBack={doLogout} currentUser={currentUser} toggleTheme={toggleTheme} theme={theme} />}
      {view === "manager" && <ManagerPortal manager={currentUser} data={data} onUpdate={handleUpdate} onBack={doLogout} toggleTheme={toggleTheme} theme={theme} />}
      {view === "employee" && <EmployeePortal employees={employees} roles={roles} tips={tips} schedules={schedules} splits={splits} restaurants={restaurants} communications={communications} commAcks={commAcks} faq={faq} dpMessages={dpMessages} receipts={receipts} workSchedules={workSchedules} onBack={doLogout} onUpdateEmployee={emp=>{const next=employees.map(e=>e.id===emp.id?emp:e);handleUpdate("employees",next);}} onUpdate={handleUpdate} toggleTheme={toggleTheme} theme={theme} />}
      {view === "fatura" && <FaturaPage faturaId={faturaId} restaurants={restaurants} onUpdate={handleUpdate} loaded={loaded} />}
      {view === "guia-gestor" && <GuiaGestor />}
      {view === "home" && <Home onLogin={()=>setView("login")} />}
      <Toast msg={toast} onClose={()=>setToast("")} />
      {/* Rodapé de versão */}
      <div style={{position:"fixed",bottom:8,right:12,fontSize:10,color:"var(--text3)",fontFamily:"'DM Mono',monospace",opacity:0.45,pointerEvents:"none",zIndex:100}}>v4.6i</div>

      {/* Modal Política de Privacidade */}
      <div id="apptip-privacy" style={{display:"none",position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:9999,alignItems:"center",justifyContent:"center",padding:20}} onClick={e=>{if(e.target===e.currentTarget)e.currentTarget.style.display="none";}}>
        <div style={{background:"var(--card-bg)",borderRadius:16,padding:28,maxWidth:480,width:"100%",maxHeight:"85vh",overflowY:"auto",border:"1px solid var(--border)",fontFamily:"'DM Sans',sans-serif",boxShadow:"0 20px 60px rgba(0,0,0,.2)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
            <h2 style={{color:"var(--text)",margin:0,fontSize:18,fontWeight:700}}>🔒 Política de Privacidade</h2>
            <button onClick={()=>document.getElementById("apptip-privacy").style.display="none"} style={{background:"none",border:"none",color:"var(--text3)",cursor:"pointer",fontSize:20}}>✕</button>
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
          <button onClick={()=>document.getElementById("apptip-privacy").style.display="none"} style={{...S.btnPrimary,marginTop:16}}>Entendi</button>
        </div>
      </div>
    </>
  );
}

