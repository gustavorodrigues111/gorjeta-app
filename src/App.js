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
async function save(key, value) {
  try {
    await setDoc(doc(db, "appdata", key), { value });
  } catch (e) { console.error("save error", e); }
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
const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
const monthLabel = (y, m) => new Date(y, m, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const AREAS = ["Bar", "Cozinha", "Salão", "Limpeza", "Produção"];
const AREA_COLORS = { Bar: "#3b82f6", Cozinha: "#f59e0b", Salão: "#10b981", Limpeza: "#8b5cf6", "Produção": "#ec4899" };
const DEFAULT_SPLIT = { Bar: 12, Cozinha: 35, Salão: 35, Limpeza: 8, "Produção": 10 };
const TAX = 0.33;
const DAY_OFF       = "off";    // folga programada
const DAY_COMP      = "comp";   // compensacao banco de horas
const DAY_VACATION  = "vac";    // ferias
const DAY_FAULT_J   = "faultj"; // falta justificada
const DAY_FAULT_U   = "faultu"; // falta injustificada

// eslint-disable-next-line no-unused-vars
const DAY_LABELS = {
  [DAY_OFF]:      { label: "Folga",          color: "#e74c3c" },
  [DAY_COMP]:     { label: "Compensação",    color: "#3b82f6" },
  [DAY_VACATION]: { label: "Férias",         color: "#8b5cf6" },
  [DAY_FAULT_J]:  { label: "Falta Just.",    color: "#f59e0b" },
  [DAY_FAULT_U]:  { label: "Falta Injust.",  color: "#ef4444" },
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
  superManagers: "v4:superManagers",
  managers:      "v4:managers",
  restaurants:   "v4:restaurants",  // added taxRate, enabledTabs
  employees:     "v4:employees",    // added inactiveFrom, inactive
  roles:         "v4:roles",
  tips:          "v4:tips",
  splits:        "v4:splits",
  schedules:     "v4:schedules",
  communications:"v4:communications", // [{id,restaurantId,title,body,createdAt,createdBy}]
  commAcks:      "v4:commAcks",       // {commId: {empId: isoDate}}
  faq:           "v4:faq",            // {restaurantId: [{id,q,a}]}
  dpMessages:    "v4:dpMessages",     // [{id,restaurantId,empId|null,name|null,category,body,date,read}]
  receipts:      "v4:receipts",       // [{id,restaurantId,empId,empName,month,type,dataUrl,uploadedAt}]
  workSchedules: "v4:workSchedules",  // {restaurantId: {empId: [{id,days:{0-6:{in,out,break}},validFrom,createdBy,createdAt}]}}
  notifications: "v4:notifications",  // [{id,restaurantId,type,body,date,read,targetRole:'dp'}]
};

//
const S = {
  input: { width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--input-bg)", color: "var(--text)", fontSize: 14, fontFamily: "DM Mono,monospace", outline: "none" },
  btnPrimary: { width: "100%", padding: "12px", borderRadius: 12, background: "#f5c842", border: "none", color: "#111", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "DM Mono,monospace" },
  btnSecondary: { padding: "8px 18px", borderRadius: 10, border: "1px solid var(--border)", background: "transparent", color: "var(--text2)", cursor: "pointer", fontFamily: "DM Mono,monospace", fontSize: 13 },
  card: { background: "var(--card-bg)", borderRadius: 16, padding: "18px 20px", border: "1px solid var(--border)" },
  label: { color: "var(--text3)", fontSize: 12, marginBottom: 4, display: "block" },
};

//
function Toast({ msg, onClose }) {
  useEffect(() => { if (msg) { const t = setTimeout(onClose, 3200); return () => clearTimeout(t); } }, [msg, onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!msg) return null;
  return <div style={{ position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)", background: "var(--bg3)", color: "#f5c842", padding: "12px 28px", borderRadius: 40, fontFamily: "DM Mono,monospace", fontSize: 14, boxShadow: "0 8px 32px rgba(0,0,0,.3)", zIndex: 9999, letterSpacing: 1, whiteSpace: "nowrap" }}>{msg}</div>;
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 8000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, overflowY: "auto" }}>
      <div style={{ background: "var(--card-bg)", borderRadius: 20, padding: 28, width: "100%", maxWidth: wide ? 680 : 480, border: "1px solid var(--border)", maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ color: "#f5c842", margin: 0, fontFamily: "DM Mono,monospace", fontSize: 16 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text3)", fontSize: 20, cursor: "pointer" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AreaBadge({ area }) {
  return <span style={{ background: AREA_COLORS[area] + "22", color: AREA_COLORS[area], borderRadius: 6, padding: "2px 9px", fontSize: 11, fontWeight: 700 }}>{area}</span>;
}

function PillBar({ options, value, onChange }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map(o => (
        <button key={o} onClick={() => onChange(o)} style={{ padding: "6px 14px", borderRadius: 20, border: `1px solid ${value === o ? "#f5c842" : "#2a2a2a"}`, background: value === o ? "#f5c842" : "transparent", color: value === o ? "#111" : "#555", cursor: "pointer", fontFamily: "DM Mono,monospace", fontSize: 12, fontWeight: value === o ? 700 : 400 }}>{o}</button>
      ))}
    </div>
  );
}

function MonthNav({ year, month, onChange }) {
  const prev = () => { let m = month - 1, y = year; if (m < 0) { m = 11; y--; } onChange(y, m); };
  const next = () => { let m = month + 1, y = year; if (m > 11) { m = 0; y++; } onChange(y, m); };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <button onClick={prev} style={{ ...S.btnSecondary, padding: "6px 12px" }}>‹</button>
      <span style={{ color: "var(--text)", fontFamily: "DM Mono,monospace", fontSize: 14, minWidth: 140, textAlign: "center", textTransform: "capitalize" }}>{monthLabel(year, month)}</span>
      <button onClick={next} style={{ ...S.btnSecondary, padding: "6px 12px" }}>›</button>
    </div>
  );
}

function PermBadge({ label, on }) {
  if (!on) return null; // só mostra o que tem acesso
  return <span style={{ background: "#10b98122", color: "#10b981", borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>✓ {label}</span>;
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
    if (s === DAY_OFF)      return { bg: "#e74c3c22", border: "#e74c3c",  text: "#e74c3c"  };
    if (s === DAY_COMP)     return { bg: "#3b82f622", border: "#3b82f6",  text: "#3b82f6"  };
    if (s === DAY_VACATION) return { bg: "#8b5cf622", border: "#8b5cf6",  text: "#8b5cf6"  };
    if (s === DAY_FAULT_J)  return { bg: "#f59e0b22", border: "#f59e0b",  text: "#f59e0b"  };
    if (s === DAY_FAULT_U)  return { bg: "#ef444422", border: "#ef4444",  text: "#ef4444"  };
    return { bg: "#10b98122", border: "#10b981", text: "#10b981" };
  };

  const LEGEND = [
    ["#10b981", "Trabalho"],
    ["#e74c3c", "Folga"],
    ["#3b82f6", "Compensação"],
    ["#8b5cf6", "Férias"],
    ["#f59e0b", "Falta Just."],
    ["#ef4444", "Falta Injust."],
  ];

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 3 }}>
        {WEEKDAYS.map(w => <div key={w} style={{ textAlign: "center", color: "var(--text3)", fontSize: 10, fontFamily: "DM Mono,monospace", padding: "4px 0" }}>{w}</div>)}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3 }}>
        {cells.map((dateStr, idx) => {
          if (!dateStr) return <div key={`e-${idx}`} />;
          const d = parseInt(dateStr.slice(-2));
          const col = colorOf(dateStr);
          return (
            <button key={dateStr} onClick={() => !readOnly && onDayClick && onDayClick(dateStr)}
              style={{ aspectRatio: "1", borderRadius: 8, border: `1px solid ${col.border}`, background: col.bg, color: col.text, cursor: readOnly ? "default" : "pointer", fontFamily: "DM Mono,monospace", fontSize: 12, fontWeight: 600, padding: 0 }}>
              {d}
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
        {LEGEND.map(([c, lbl]) => (
          <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <div style={{ width: 11, height: 11, borderRadius: 3, background: c + "33", border: `1px solid ${c}`, flexShrink: 0 }} />
            <span style={{ color: "var(--text3)", fontSize: 10, fontFamily: "DM Mono,monospace" }}>{lbl}</span>
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
      doc.setFontSize(14); doc.setFont("helvetica", "bold");
      doc.text(restaurant.name, 14, 14);
      doc.setFontSize(10); doc.setFont("helvetica", "normal");
      doc.text(`Relatório de Gorjetas: ${fmtDate(dateFrom)} a ${fmtDate(dateTo)}`, 14, 21);
      doc.text(`Gerado em: ${new Date().toLocaleDateString("pt-BR")}`, 14, 27);
      const head = [["Nome", "Cargo", "Área", ...dates.map(ds), "Total Bruto", "Dedução 33%", "Líquido"]];
      const body = [
        ...rows.map(r => [r.name, r.role, r.area, ...dates.map(d => r.byDay[d] ? fmtBR(r.byDay[d]) : "-"), fmtBR(r.totalBruto), fmtBR(r.deducao), fmtBR(r.liquido)]),
        ["TOTAL", "", "", ...dates.map(d => fmtBR(dayTotals[d])), fmtBR(grandBruto), fmtBR(grandDeducao), fmtBR(grandLiquido)],
      ];
      doc.autoTable({
        head, body, startY: 32,
        styles: { fontSize: 7, font: "helvetica", cellPadding: 2 },
        headStyles: { fillColor: [20, 20, 20], textColor: [245, 200, 66], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [245, 245, 245] },
        columnStyles: {
          0: { cellWidth: 30 }, 1: { cellWidth: 22 }, 2: { cellWidth: 16 },
          ...Object.fromEntries(dates.map((_, i) => [i + 3, { cellWidth: 13, halign: "right" }])),
          [dates.length + 3]: { cellWidth: 20, halign: "right", fontStyle: "bold" },
          [dates.length + 4]: { cellWidth: 18, halign: "right", textColor: [200, 50, 50] },
          [dates.length + 5]: { cellWidth: 18, halign: "right", textColor: [10, 130, 80], fontStyle: "bold" },
        },
        didParseCell: (data) => {
          if (data.row.index === body.length - 1) { data.cell.styles.fillColor = [20,20,20]; data.cell.styles.textColor = [245,200,66]; data.cell.styles.fontStyle = "bold"; }
        },
      });
      doc.setFontSize(8); doc.setTextColor(120);
      doc.text("* Valores brutos sem dedução fiscal. Documento gerado pelo GorjetaApp.", 14, doc.lastAutoTable.finalY + 6);
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
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text2)" }}><span>Total bruto</span><span style={{ color: "#f5c842", fontWeight: 700 }}>{fmt(preview.total)}</span></div>
          </div>
        )}
        {status === "loading" && <p style={{ color: "#f5c842", textAlign: "center", fontSize: 13 }}>⏳ Gerando arquivo…</p>}
        {status === "done"    && <p style={{ color: "#10b981", textAlign: "center", fontSize: 13 }}>✅ Arquivo salvo nos seus downloads!</p>}
        {status === "error"   && <p style={{ color: "#e74c3c", textAlign: "center", fontSize: 13 }}>❌ Erro ao gerar. Tente novamente.</p>}
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
function ComunicadosTab({ empId, restaurantId, communications, commAcks, onUpdate }) {
  const myComms = communications.filter(c => c.restaurantId === restaurantId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const pending = myComms.filter(c => !commAcks?.[c.id]?.[empId]);
  const done    = myComms.filter(c =>  commAcks?.[c.id]?.[empId]);
  const [tab, setTab] = useState("pending");
  const ac = "#f5c842";

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
        <div style={{ background: "#e74c3c22", border: "1px solid #e74c3c44", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 12, color: "#e74c3c", fontFamily: "DM Mono,monospace" }}>
          ⚠️ Você tem <strong>{pending.length}</strong> comunicado{pending.length > 1 ? "s" : ""} pendente{pending.length > 1 ? "s" : ""} de ciência.
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[["pending", `Pendentes (${pending.length})`], ["done", `Lidos (${done.length})`]].map(([id, lbl]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex: 1, padding: "8px", borderRadius: 10, border: `1px solid ${tab === id ? ac : "#2a2a2a"}`, background: tab === id ? ac + "22" : "transparent", color: tab === id ? ac : "#555", cursor: "pointer", fontFamily: "DM Mono,monospace", fontSize: 12 }}>{lbl}</button>
        ))}
      </div>
      {list.length === 0 && <p style={{ color: "var(--text3)", textAlign: "center", fontSize: 14 }}>Nenhum comunicado {tab === "pending" ? "pendente" : "lido"}.</p>}
      {list.map(c => (
        <div key={c.id} style={{ background: "var(--card-bg)", borderRadius: 14, padding: 16, marginBottom: 12, border: `1px solid ${!commAcks?.[c.id]?.[empId] ? "#e74c3c44" : "#2a2a2a"}` }}>
          <div style={{ color: "var(--text)", fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{c.title}</div>
          <div style={{ color: "var(--text2)", fontSize: 13, marginBottom: 12, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{c.body}</div>
          <div style={{ color: "var(--text3)", fontSize: 11, marginBottom: commAcks?.[c.id]?.[empId] ? 0 : 12 }}>
            Publicado em {fmtDate(c.createdAt?.slice(0,10))}
            {commAcks?.[c.id]?.[empId] && <span style={{ color: "#10b981", marginLeft: 12 }}>✓ Ciência em {new Date(commAcks[c.id][empId]).toLocaleString("pt-BR")}</span>}
          </div>
          {!commAcks?.[c.id]?.[empId] && (
            <button onClick={() => ack(c.id)} style={{ width: "100%", padding: "11px", borderRadius: 10, background: "#f5c842", border: "none", color: "#111", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "DM Mono,monospace" }}>
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
function FaqTab({ restaurantId, faq }) {
  const items = faq?.[restaurantId] ?? [];
  const [open, setOpen] = useState(null);
  if (items.length === 0) return <p style={{ color: "var(--text3)", textAlign: "center", fontSize: 14, marginTop: 20 }}>Nenhuma pergunta cadastrada ainda.</p>;
  return (
    <div>
      {items.map((item, i) => (
        <div key={item.id ?? i} style={{ background: "var(--card-bg)", borderRadius: 12, marginBottom: 8, border: "1px solid var(--border)", overflow: "hidden" }}>
          <button onClick={() => setOpen(open === i ? null : i)} style={{ width: "100%", padding: "14px 16px", background: "none", border: "none", color: open === i ? "#f5c842" : "#fff", textAlign: "left", cursor: "pointer", fontFamily: "DM Mono,monospace", fontSize: 14, fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>{item.q}</span>
            <span style={{ fontSize: 18, color: "var(--text3)" }}>{open === i ? "−" : "+"}</span>
          </button>
          {open === i && <div style={{ padding: "0 16px 14px", color: "var(--text2)", fontSize: 13, lineHeight: 1.6, borderTop: "1px solid var(--border)", paddingTop: 12, whiteSpace: "pre-wrap" }}>{item.a}</div>}
        </div>
      ))}
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
  const ac = "#f5c842";

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
          <button key={val} onClick={() => setCategory(val)} style={{ padding: "10px", borderRadius: 10, border: `1px solid ${category === val ? ac : "#2a2a2a"}`, background: category === val ? ac + "22" : "transparent", color: category === val ? ac : "#555", cursor: "pointer", fontFamily: "DM Mono,monospace", fontSize: 12, fontWeight: category === val ? 700 : 400 }}>{lbl}</button>
        ))}
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={S.label}>Mensagem</label>
        <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Escreva sua mensagem aqui…" rows={5} style={{ ...S.input, resize: "vertical", lineHeight: 1.5 }} />
      </div>
      <div style={{ marginBottom: 14 }}>
        <button onClick={() => setAnon(!anon)} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", fontFamily: "DM Mono,monospace", color: anon ? ac : "#555", fontSize: 13, padding: 0 }}>
          <div style={{ width: 18, height: 18, borderRadius: 4, border: `2px solid ${anon ? ac : "#555"}`, background: anon ? ac : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#111" }}>{anon ? "✓" : ""}</div>
          Enviar de forma anônima
        </button>
        {!anon && <p style={{ color: "var(--text3)", fontSize: 11, marginTop: 4, marginLeft: 26 }}>Identificado como: <strong style={{ color: "var(--text2)" }}>{emp?.name}</strong></p>}
      </div>
      {sent && <p style={{ color: "#10b981", fontSize: 13, marginBottom: 10 }}>✅ Mensagem enviada com sucesso!</p>}
      <button onClick={send} disabled={!body.trim()} style={{ width: "100%", padding: "12px", borderRadius: 12, background: body.trim() ? ac : "#2a2a2a", border: "none", color: "#111", fontWeight: 700, fontSize: 14, cursor: body.trim() ? "pointer" : "default", fontFamily: "DM Mono,monospace" }}>
        Enviar Mensagem
      </button>
    </div>
  );
}

//
// COMUNICADOS MANAGER TAB (manager/super view)
//
function ComunicadosManagerTab({ restaurantId, communications, commAcks, employees, onUpdate, currentManagerName }) {
  const myComms = communications.filter(c => c.restaurantId === restaurantId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const restEmps = employees.filter(e => e.restaurantId === restaurantId && !(e.inactive && e.inactiveFrom && e.inactiveFrom <= today()));
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody]   = useState("");
  const [selComm, setSelComm] = useState(null);
  const ac = "#f5c842";

  function publish() {
    if (!title.trim() || !body.trim()) return;
    const c = { id: Date.now().toString(), restaurantId, title: title.trim(), body: body.trim(), createdAt: new Date().toISOString(), createdBy: currentManagerName };
    onUpdate("communications", [...communications, c]);
    setTitle(""); setBody(""); setShowNew(false);
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
          <div style={{ color: "var(--text3)", fontSize: 12, marginBottom: 12 }}>Publicado em {new Date(c.createdAt).toLocaleString("pt-BR")} por {c.createdBy}</div>
          <div style={{ color: "var(--text2)", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", marginBottom: 12 }}>{c.body}</div>
        </div>
        <p style={{ color: "var(--text3)", fontSize: 12, marginBottom: 10 }}>Tabela de ciências ({restEmps.length} empregados)</p>
        <div style={{ ...S.card }}>
          {/* Header */}
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 6, marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
            {["Empregado", "Envio", "Ciência"].map(h => <div key={h} style={{ color: "var(--text3)", fontSize: 11 }}>{h}</div>)}
          </div>
          {restEmps.map(e => {
            const ackDate = commAcks?.[c.id]?.[e.id];
            return (
              <div key={e.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 6, padding: "6px 0", borderBottom: "1px solid #1a1a1a" }}>
                <div style={{ color: "var(--text)", fontSize: 13 }}>{e.name}</div>
                <div style={{ color: "var(--text3)", fontSize: 11 }}>{fmtDate(c.createdAt?.slice(0,10))}</div>
                <div style={{ color: ackDate ? "#10b981" : "#e74c3c", fontSize: 11 }}>{ackDate ? new Date(ackDate).toLocaleDateString("pt-BR") : "Pendente"}</div>
              </div>
            );
          })}
          <div style={{ marginTop: 12, color: "var(--text3)", fontSize: 12 }}>
            ✓ {restEmps.filter(e => commAcks?.[c.id]?.[e.id]).length} de {restEmps.length} confirmados
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => setShowNew(!showNew)} style={{ ...S.btnPrimary, marginBottom: 16 }}>
        {showNew ? "Cancelar" : "+ Novo Comunicado"}
      </button>
      {showNew && (
        <div style={{ ...S.card, marginBottom: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
                <button onClick={() => remove(c.id)} style={{ background: "none", border: "1px solid #e74c3c33", borderRadius: 8, color: "#e74c3c", cursor: "pointer", fontSize: 12, padding: "6px 12px", fontFamily: "DM Mono,monospace" }}>✕</button>
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
function FaqManagerTab({ restaurantId, faq, onUpdate }) {
  const items = faq?.[restaurantId] ?? [];
  const [editIdx, setEditIdx] = useState(null);
  const [form, setForm] = useState({ q: "", a: "" });
  const ac = "#f5c842";

  function saveItem() {
    if (!form.q.trim() || !form.a.trim()) return;
    const newItem = { id: Date.now().toString(), q: form.q.trim(), a: form.a.trim() };
    const newItems = editIdx === "new" ? [...items, newItem] : items.map((x, i) => i === editIdx ? newItem : x);
    onUpdate("faq", { ...faq, [restaurantId]: newItems });
    setEditIdx(null); setForm({ q: "", a: "" });
  }
  function removeItem(i) { onUpdate("faq", { ...faq, [restaurantId]: items.filter((_, idx) => idx !== i) }); }

  return (
    <div>
      <button onClick={() => { setEditIdx("new"); setForm({ q: "", a: "" }); }} style={{ ...S.btnPrimary, marginBottom: 16 }}>+ Nova Pergunta</button>
      {(editIdx === "new" || editIdx !== null) && (
        <div style={{ ...S.card, marginBottom: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div><label style={S.label}>Pergunta</label><input value={form.q} onChange={e => setForm(p => ({...p, q: e.target.value}))} placeholder="Ex: Como funciona o rateio?" style={S.input} /></div>
            <div><label style={S.label}>Resposta</label><textarea value={form.a} onChange={e => setForm(p => ({...p, a: e.target.value}))} rows={4} placeholder="Resposta detalhada…" style={{ ...S.input, resize: "vertical" }} /></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={saveItem} style={{ ...S.btnPrimary, flex: 1 }}>Salvar</button>
              <button onClick={() => setEditIdx(null)} style={S.btnSecondary}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
      {items.length === 0 && <p style={{ color: "var(--text3)", textAlign: "center" }}>Nenhuma pergunta cadastrada.</p>}
      {items.map((item, i) => (
        <div key={item.id ?? i} style={{ ...S.card, marginBottom: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div style={{ color: ac, fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{item.q}</div>
              <div style={{ color: "var(--text3)", fontSize: 12 }}>{item.a.slice(0, 80)}{item.a.length > 80 ? "…" : ""}</div>
            </div>
            <div style={{ display: "flex", gap: 8, marginLeft: 8 }}>
              <button onClick={() => { setEditIdx(i); setForm({ q: item.q, a: item.a }); }} style={{ ...S.btnSecondary, fontSize: 12 }}>Editar</button>
              <button onClick={() => removeItem(i)} style={{ background: "none", border: "1px solid #e74c3c33", borderRadius: 8, color: "#e74c3c", cursor: "pointer", fontSize: 12, padding: "6px 12px", fontFamily: "DM Mono,monospace" }}>✕</button>
            </div>
          </div>
        </div>
      ))}
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
    <div style={{fontFamily:"DM Mono,monospace"}}>
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
          <div key={item.id} style={{...S.card,marginBottom:10,opacity:item.read?0.65:1,borderColor:item.read?"#2a2a2a":isDP?"#f5c84244":"#3b82f644"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                {isDP && <span style={{background:"#f5c84222",color:"#f5c842",borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:700}}>💬 Fale com DP</span>}
                {isSys && <span style={{background:"#3b82f622",color:"#3b82f6",borderRadius:6,padding:"2px 8px",fontSize:10,fontWeight:700}}>⚙️ Sistema</span>}
                {isDP && item.category && <span style={{color:"var(--text3)",fontSize:11}}>{CATS[item.category]??item.category}</span>}
                {!item.read && <span style={{background:isDP?"#f5c842":"#3b82f6",color:"#111",borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:700}}>Novo</span>}
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
function WorkScheduleManagerTab({ restaurantId, employees, workSchedules, notifications, managers, currentManagerName, onUpdate }) {
  const ac = "#f5c842";
  const restEmps = employees.filter(e => e.restaurantId === restaurantId && !e.inactive);
  const [selEmpId, setSelEmpId] = useState(null);
  const [editDays, setEditDays] = useState({});
  const [errors, setErrors] = useState([]);
  const [showValidFrom, setShowValidFrom] = useState(false);
  const [validFrom, setValidFrom] = useState(today());

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
      const body = `📋 Horário alterado\n\nEmpregado: ${selEmp?.name}\nAlterado por: ${currentManagerName}\nVigência a partir de: ${fmtDate(validFrom)}\n\nNovo horário:\n${Object.entries(editDays).filter(([,d])=>d?.in&&d?.out).sort((a,b)=>parseInt(a[0])-parseInt(b[0])).map(([i,d])=>`${WEEK_DAYS_LABEL[i]}: ${d.in} – ${d.out} (intervalo ${d.break??0}min)`).join("\n")}`;
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
            {[...empSchedules].reverse().slice(1).map(s => (
              <div key={s.id} style={{padding:"6px 12px",borderBottom:"1px solid #1a1a1a",fontSize:12}}>
                <span style={{color:"var(--text2)"}}>Vigente de {fmtDate(s.validFrom)}</span>
                <span style={{color:"var(--text3)",marginLeft:12}}>por {s.createdBy}</span>
                <span style={{color:"var(--text3)",marginLeft:12}}>{fmtHHMM(s.totalContract)}/sem</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {/* Weekly schedule table */}
      <div style={{...S.card,marginBottom:16,overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"DM Mono,monospace",fontSize:13}}>
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
                <tr key={dayIdx} style={{background:dayIdx%2===0?"#111":"#141414",opacity:hasDay?1:0.5}}>
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
                  <td style={{padding:"6px 10px",color:calc&&calc.totalContract>10*60?"#ef4444":"#10b981",fontWeight:calc?600:400}}>{calc?fmtHHMM(calc.worked):"—"}</td>
                  <td style={{padding:"6px 10px",color:"var(--text2)"}}>{calc?fmtHHMM(calc.diurnal):"—"}</td>
                  <td style={{padding:"6px 10px",color:"#8b5cf6"}}>{calc?fmtHHMM(calc.nocturnal):"—"}</td>
                  <td style={{padding:"6px 10px",color:"#ec4899"}}>{calc?fmtHHMM(calc.nocturnalFicta):"—"}</td>
                  <td style={{padding:"6px 10px",color:calc&&calc.totalContract>10*60?"#ef4444":"#f5c842",fontWeight:700}}>{calc?fmtHHMM(calc.totalContract):"—"}</td>
                  <td style={{padding:"4px 6px"}}>
                    {hasDay && <button onClick={()=>clearDay(dayIdx)} style={{background:"none",border:"1px solid #e74c3c33",borderRadius:6,color:"#e74c3c",cursor:"pointer",padding:"3px 8px",fontSize:11,fontFamily:"DM Mono,monospace"}}>Folga</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{borderTop:"2px solid var(--border)"}}>
              <td colSpan={4} style={{padding:"8px 10px",color:"var(--text3)",fontSize:12}}>Total semanal (contratual)</td>
              <td colSpan={4} style={{padding:"8px 10px",color:"var(--text3)",fontSize:11}}></td>
              <td style={{padding:"8px 10px",color:weekOk?"#10b981":"#ef4444",fontWeight:700,fontSize:14}}>{fmtHHMM(totalContract)}</td>
              <td style={{padding:"8px 10px",color:"var(--text3)",fontSize:11}}>{weekOk?"✅ OK":"⚠️ Fora do limite (43:55–44:00)"}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Validation errors */}
      {errors.length > 0 && (
        <div style={{background:"#e74c3c11",border:"1px solid #e74c3c44",borderRadius:10,padding:"12px 16px",marginBottom:16}}>
          <p style={{color:"#e74c3c",fontWeight:700,fontSize:13,margin:"0 0 8px"}}>⚠️ Corrija os seguintes erros antes de salvar:</p>
          {errors.map((e,i)=><div key={i} style={{color:"#e74c3c",fontSize:12,marginBottom:4}}>• {e}</div>)}
        </div>
      )}

      {/* Valid from modal */}
      {showValidFrom && (
        <div style={{...S.card,border:"1px solid #f5c84244",marginBottom:16}}>
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
  const ac = "#f5c842";
  const empScheds = workSchedules?.[restaurantId]?.[empId] ?? [];
  const current = empScheds[empScheds.length - 1];

  if (!current) return (
    <div style={{textAlign:"center",marginTop:40}}>
      <div style={{fontSize:32,marginBottom:12}}>🕐</div>
      <p style={{color:"var(--text3)",fontSize:14}}>Nenhum horário cadastrado ainda.</p>
    </div>
  );

  return (
    <div style={{fontFamily:"DM Mono,monospace"}}>
      <p style={{color:ac,fontSize:14,fontWeight:700,margin:"0 0 4px"}}>Seu Horário</p>
      <p style={{color:"var(--text3)",fontSize:12,marginBottom:16}}>Vigente desde {fmtDate(current.validFrom)}</p>

      {[0,1,2,3,4,5,6].map(dayIdx => {
        const d = current.days[dayIdx];
        if (!d?.in || !d?.out) return (
          <div key={dayIdx} style={{display:"flex",justifyContent:"space-between",padding:"10px 14px",background:"var(--bg1)",borderRadius:8,marginBottom:6,opacity:0.4}}>
            <span style={{color:([0,6].includes(dayIdx))?"#f59e0b":"#555",fontWeight:600}}>{WEEK_DAYS_LABEL[dayIdx]}</span>
            <span style={{color:"var(--text3)",fontSize:12}}>Folga</span>
          </div>
        );
        const calc = calcDayHours(d.in, d.out, parseInt(d.break)||0);
        return (
          <div key={dayIdx} style={{background:"var(--card-bg)",borderRadius:10,padding:"12px 14px",marginBottom:8,border:"1px solid var(--border)"}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <span style={{color:([0,6].includes(dayIdx))?"#f59e0b":"#fff",fontWeight:700,fontSize:14}}>{WEEK_DAYS_LABEL[dayIdx]}</span>
              <span style={{color:ac,fontWeight:700,fontSize:14}}>{fmtHHMM(calc.totalContract)}h</span>
            </div>
            <div style={{display:"flex",gap:16,fontSize:12,flexWrap:"wrap"}}>
              <span style={{color:"#10b981"}}>🟢 Entrada: {d.in}</span>
              <span style={{color:"#e74c3c"}}>🔴 Saída: {d.out}</span>
              <span style={{color:"var(--text3)"}}>☕ Intervalo: {d.break||0}min</span>
              {calc.nocturnal > 0 && <span style={{color:"#8b5cf6"}}>🌙 Noturno: {fmtHHMM(calc.nocturnal)}</span>}
            </div>
          </div>
        );
      })}

      {empScheds.length > 1 && (
        <details style={{marginTop:20}}>
          <summary style={{color:"var(--text3)",fontSize:12,cursor:"pointer",padding:"8px 12px",background:"var(--bg1)",borderRadius:8}}>
            📂 Horários anteriores ({empScheds.length - 1})
          </summary>
          <div style={{paddingTop:8}}>
            {[...empScheds].reverse().slice(1).map(s => (
              <div key={s.id} style={{...S.card,marginBottom:8,opacity:0.7}}>
                <p style={{color:"var(--text3)",fontSize:12,margin:"0 0 8px"}}>Vigente desde {fmtDate(s.validFrom)}</p>
                {[0,1,2,3,4,5,6].filter(i=>s.days[i]?.in&&s.days[i]?.out).map(i=>{
                  const d=s.days[i];
                  return <div key={i} style={{color:"var(--text3)",fontSize:12,marginBottom:2}}>{WEEK_DAYS_LABEL[i]}: {d.in} – {d.out}</div>;
                })}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function DpManagerTab({ restaurantId, dpMessages, onUpdate }) {
  const msgs = dpMessages.filter(m => m.restaurantId === restaurantId)
    .sort((a, b) => b.date.localeCompare(a.date));
  const [filter, setFilter] = useState("all");
  const CATS = { all: "Todos", sugestao: "💡 Sugestões", elogio: "👏 Elogios", reclamacao: "⚠️ Reclamações", denuncia: "🚨 Denúncias" };
  const filtered = filter === "all" ? msgs : msgs.filter(m => m.category === filter);
  const unread = msgs.filter(m => !m.read).length;
  const ac = "#f5c842";

  function markRead(id) {
    onUpdate("dpMessages", dpMessages.map(m => m.id === id ? { ...m, read: true } : m));
  }

  return (
    <div>
      {unread > 0 && <div style={{ background: "#f5c84222", border: "1px solid #f5c84244", borderRadius: 10, padding: "8px 14px", marginBottom: 12, fontSize: 12, color: ac, fontFamily: "DM Mono,monospace" }}>📬 {unread} mensagem{unread > 1 ? "s" : ""} não lida{unread > 1 ? "s" : ""}</div>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {Object.entries(CATS).map(([val, lbl]) => (
          <button key={val} onClick={() => setFilter(val)} style={{ padding: "6px 12px", borderRadius: 20, border: `1px solid ${filter === val ? ac : "#2a2a2a"}`, background: filter === val ? ac + "22" : "transparent", color: filter === val ? ac : "#555", cursor: "pointer", fontFamily: "DM Mono,monospace", fontSize: 11 }}>{lbl}</button>
        ))}
      </div>
      {filtered.length === 0 && <p style={{ color: "var(--text3)", textAlign: "center" }}>Nenhuma mensagem.</p>}
      {filtered.map(m => (
        <div key={m.id} style={{ ...S.card, marginBottom: 10, opacity: m.read ? 0.7 : 1, borderColor: m.read ? "#2a2a2a" : "#f5c84244" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
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
  const ac = "#f5c842";

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
      const pageTexts = []; // store text of each page to detect duplicates

      for (let p = 1; p <= numPages; p++) {
        setProgress(`Processando página ${p} de ${numPages}...`);
        const page = await pdf.getPage(p);
        const textContent = await page.getTextContent();
        const text = textContent.items.map(i => i.str).join(" ");

        // Duplicate detection: compare normalized text with previous pages
        // Use first 300 chars as fingerprint (enough to detect same content)
        const fingerprint = text.replace(/\s+/g," ").trim().slice(0, 300);
        const isDuplicate = pageTexts.some(prev => {
          // Calculate similarity: count matching characters in fingerprint
          if (Math.abs(prev.length - fingerprint.length) > 50) return false;
          let matches = 0;
          const shorter = fingerprint.length < prev.length ? fingerprint : prev;
          for (let i = 0; i < shorter.length; i++) {
            if (fingerprint[i] === prev[i]) matches++;
          }
          return (matches / shorter.length) > 0.85; // 85% similarity = duplicate
        });

        if (isDuplicate) {
          setProgress(`Página ${p} de ${numPages} — cópia ignorada ✓`);
          continue; // skip duplicate
        }
        pageTexts.push(fingerprint);

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

        // Auto-detect type from text
        let detectedType = type; // fallback to selected
        const tLow = text.toLowerCase();
        if (tLow.includes("adiantamento") || tLow.includes("antecipação") || tLow.includes("1ª parcela") || tLow.includes("1a parcela")) {
          detectedType = "adiantamento";
        } else if (tLow.includes("13") || tLow.includes("décimo") || tLow.includes("decimo")) {
          detectedType = "13salario";
        } else if (tLow.includes("salário") || tLow.includes("salario") || tLow.includes("pagamento") || tLow.includes("holerite") || tLow.includes("contra-cheque") || tLow.includes("contracheque")) {
          detectedType = "pagamento";
        }
        let matchedEmp = null;
        let extractedName = "";
        let extractedCpf = "";
        let extractedAdmission = "";

        for (const emp of restEmps) {
          if (emp.cpf) {
            const cleanCpf = emp.cpf.replace(/\D/g, "");
            if (cleanCpf.length >= 11 && text.replace(/\D/g,"").includes(cleanCpf)) {
              matchedEmp = emp; break;
            }
          }
        }
        if (!matchedEmp) {
          for (const emp of restEmps) {
            const firstName = emp.name.split(" ")[0].toUpperCase();
            if (firstName.length >= 3 && text.toUpperCase().includes(firstName)) {
              matchedEmp = emp; break;
            }
          }
        }

        // Extract name: try multiple patterns for Brazilian payroll PDFs
        // Pattern 1: "Código Nome do Colaborador\n000058 NOME COMPLETO"
        const codeNameMatch = text.match(/\d{5,6}\s+([A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇÀÜ]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇÀÜa-záéíóúãõâêîôûçàü]{2,})+)/);
        // Pattern 2: after "Nome do Colaborador" or "Colaborador:"
        const namedMatch = text.match(/(?:nome\s+do\s+colaborador|colaborador|funcionário)[:\s]+([A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇÀÜ]{2,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇÀÜ]{2,})+)/i);
        if (namedMatch) {
          extractedName = namedMatch[1].trim();
        } else if (codeNameMatch) {
          extractedName = codeNameMatch[1].trim();
        } else {
          // Fallback: longest sequence of capitalized words (at least 2 words)
          const allNames = [...text.matchAll(/[A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇÀÜ]{3,}(?:\s+[A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇÀÜ]{2,}){1,5}/g)];
          // Filter out known non-name patterns and pick longest
          const filtered = allNames.map(m=>m[0]).filter(n => !n.match(/^(RECIBO|SALÁRIO|PAGAMENTO|CNPJ|LTDA|FUNC|SENADOR|CEP|SAO|SÃO|RUA|AV|PAULO)/i));
          if (filtered.length) extractedName = filtered.reduce((a,b) => b.split(" ").length > a.split(" ").length ? b : a, "");
        }

        // Extract CPF: pattern 000.000.000-00 — look for labeled one first
        const cpfLabelMatch = text.match(/CPF[:\s]+(\d{3}[.-]\d{3}[.-]\d{3}[.-]\d{2})/i);
        const cpfRawMatch = text.match(/\d{3}[.-]\d{3}[.-]\d{3}[.-]\d{2}/);
        const cpfFound = cpfLabelMatch ? cpfLabelMatch[1] : (cpfRawMatch ? cpfRawMatch[0] : null);
        if (cpfFound) {
          const digits = cpfFound.replace(/\D/g,"");
          if (digits.length === 11) extractedCpf = `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9)}`;
        }

        // Extract admission date
        const admMatch = text.match(/(?:admiss[aã]o|admitido\s+em|data\s+de\s+admiss[aã]o)[:\s]+(\d{2}[/]\d{2}[/]\d{4})/i);
        if (admMatch) {
          const [d,m,y] = admMatch[1].split("/");
          extractedAdmission = `${y}-${m}-${d}`;
        }

        // Extract role/function: "Função: GARCOM III" or "Cargo: ..." or "CBO: 5134-05 Função: GARCOM III"
        let extractedRole = "";
        const funcMatch = text.match(/(?:fun[çc][aã]o|cargo)[:\s]+([A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇÀÜa-záéíóúãõâêîôûçàü][A-ZÁÉÍÓÚÃÕÂÊÎÔÛÇÀÜa-záéíóúãõâêîôûçàü\s]{1,30}?)(?=\s{2,}|CPF|CBO|PIS|$)/i);
        if (funcMatch) extractedRole = funcMatch[1].trim();

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
    <div style={{fontFamily:"DM Mono,monospace"}}>
      <div style={{...S.card, marginBottom:20}}>
        <p style={{color:ac,fontSize:14,fontWeight:700,margin:"0 0 6px"}}>📤 Importar Recibos</p>
        <p style={{color:"var(--text3)",fontSize:12,marginBottom:14}}>O sistema detecta mês e tipo automaticamente pelo PDF. Os campos abaixo são usados só se não conseguir detectar.</p>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <div>
              <label style={S.label}>Mês (fallback)</label>
              <input type="month" value={selMonth} onChange={e=>setSelMonth(e.target.value)} style={S.input}/>
            </div>
            <div>
              <label style={S.label}>Tipo (fallback)</label>
              <select value={type} onChange={e=>setType(e.target.value)} style={{...S.input,cursor:"pointer"}}>
                <option value="pagamento">💰 Pagamento</option>
                <option value="adiantamento">💵 Adiantamento</option>
                <option value="13salario">🎄 13º Salário</option>
              </select>
            </div>
          </div>
          <div>
            <label style={S.label}>Arquivo PDF</label>
            <input type="file" accept=".pdf" onChange={handleUpload} disabled={uploading}
              style={{...S.input, cursor:"pointer"}}/>
          </div>
          {progress && (
            <div style={{background:"var(--bg1)",borderRadius:8,padding:"10px 12px",fontSize:12,color:progress.startsWith("✅")?"#10b981":progress.startsWith("❌")?"#e74c3c":"#aaa",whiteSpace:"pre-line"}}>
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
                      }} style={{padding:"8px 16px",borderRadius:8,border:"none",background:"#10b981",color:"#fff",cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:12,fontWeight:700}}>
                        ➕ Criar novo empregado
                      </button>
                      <button onClick={()=>setUnmatchedAction(p=>({...p,[r.id]:"assign"}))} style={{padding:"8px 16px",borderRadius:8,border:"1px solid var(--border)",background:"transparent",color:"var(--text2)",cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:12}}>
                        🔗 Associar a existente
                      </button>
                      <button onClick={()=>onUpdate("receipts",receipts.filter(x=>x.id!==r.id))} style={{padding:"8px 12px",borderRadius:8,border:"1px solid #e74c3c33",background:"transparent",color:"#e74c3c",cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:12}}>
                        ✕ Descartar
                      </button>
                    </div>
                  </div>
                )}

                {/* Create new employee */}
                {action === "create" && (
                  <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:4}}>
                    <p style={{color:"#10b981",fontSize:12,fontWeight:700,margin:0}}>➕ Criar novo empregado</p>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                      <div>
                        <label style={S.label}>Nome completo</label>
                        <input value={form.name} onChange={e=>setNewEmpForm(p=>({...p,[r.id]:{...form,name:e.target.value}}))} style={S.input} placeholder="Nome extraído do recibo"/>
                      </div>
                      <div>
                        <label style={S.label}>CPF</label>
                        <input value={form.cpf} onChange={e=>setNewEmpForm(p=>({...p,[r.id]:{...form,cpf:e.target.value}}))} placeholder="000.000.000-00" style={S.input}/>
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
                              title="Criar novo cargo" style={{padding:"8px 10px",borderRadius:8,border:"1px solid #10b98144",background:"#10b98111",color:"#10b981",cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:13,whiteSpace:"nowrap"}}>+ Novo</button>
                          </div>
                        ) : (
                          <div style={{display:"flex",flexDirection:"column",gap:6,padding:"10px 12px",background:"var(--bg3)",borderRadius:8,border:"1px solid #10b98133"}}>
                            <p style={{color:"#10b981",fontSize:11,fontWeight:700,margin:"0 0 4px"}}>Novo cargo</p>
                            <input value={form.newRoleName} onChange={e=>setNewEmpForm(p=>({...p,[r.id]:{...form,newRoleName:e.target.value}}))} placeholder={r.extractedRole||"Nome do cargo"} style={{...S.input,fontSize:12}}/>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                              <select value={form.newRoleArea} onChange={e=>setNewEmpForm(p=>({...p,[r.id]:{...form,newRoleArea:e.target.value}}))} style={{...S.input,fontSize:12}}>
                                {AREAS.map(a=><option key={a} value={a}>{a}</option>)}
                              </select>
                              <input type="number" min="0.5" step="0.5" value={form.newRolePoints} onChange={e=>setNewEmpForm(p=>({...p,[r.id]:{...form,newRolePoints:e.target.value}}))} placeholder="Pontos" style={{...S.input,fontSize:12}}/>
                            </div>
                            <div style={{display:"flex",gap:6}}>
                              <button onClick={()=>{
                                if(!form.newRoleName.trim()){alert("Nome do cargo obrigatório");return;}
                                const newRole = { id:`role-${Date.now()}-${Math.random().toString(36).slice(2,5)}`, restaurantId, name:form.newRoleName.trim(), area:form.newRoleArea, points:parseFloat(form.newRolePoints)||1, inactive:false };
                                onUpdate("roles", [...roles, newRole]);
                                setNewEmpForm(p=>({...p,[r.id]:{...form,roleId:newRole.id,creatingRole:false}}));
                              }} style={{flex:1,padding:"6px",borderRadius:8,border:"none",background:"#10b981",color:"#fff",cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:12,fontWeight:700}}>✅ Criar cargo</button>
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
                      }} style={{padding:"8px 16px",borderRadius:8,border:"none",background:"#10b981",color:"#fff",cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:12,fontWeight:700}}>
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
                      }} disabled={!assignTarget[r.id]} style={{padding:"8px 14px",borderRadius:8,border:"none",background:assignTarget[r.id]?ac:"var(--bg4)",color:"#111",fontWeight:700,cursor:assignTarget[r.id]?"pointer":"default",fontFamily:"DM Mono,monospace",fontSize:12}}>
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
          pagamento:   { label:"💰 Pagamento",    color:"#10b981" },
          adiantamento:{ label:"💵 Adiantamento", color:"#3b82f6" },
          "13salario": { label:"🎄 13º Salário",  color:"#f59e0b" },
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
                      <button onClick={e=>{e.preventDefault();e.stopPropagation();if(window.confirm(`Excluir TODOS os ${tReceipts.length} recibos de ${label} de ${mLabel}?`)) onUpdate("receipts", receipts.filter(r=>!(r.month===m&&r.type===t&&r.restaurantId===restaurantId)));}} style={{background:"none",border:"1px solid #e74c3c33",borderRadius:6,color:"#e74c3c",cursor:"pointer",fontSize:11,padding:"2px 8px",fontFamily:"DM Mono,monospace"}}>
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
                          </select>
                          <button onClick={()=>{if(window.confirm(`Excluir recibo de ${r.empName}?`)) onUpdate("receipts", receipts.filter(x=>x.id!==r.id));}} style={{background:"none",border:"1px solid #e74c3c33",borderRadius:6,color:"#e74c3c",cursor:"pointer",fontSize:12,padding:"4px 8px",fontFamily:"DM Mono,monospace",flexShrink:0}}>✕</button>
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
  const ac = "#f5c842";

  if (selReceipt) {
    return (
      <div>
        <button onClick={()=>setSelReceipt(null)} style={{...S.btnSecondary,marginBottom:16}}>← Voltar</button>
        <div style={{color:"var(--text)",fontWeight:700,marginBottom:4}}>{selReceipt.empName}</div>
        <div style={{color:"var(--text3)",fontSize:12,marginBottom:12}}>{selReceipt.month} · {selReceipt.type==="pagamento"?"💰 Pagamento":"💵 Adiantamento"}</div>
        <img src={selReceipt.dataUrl} alt="Recibo" style={{width:"100%",borderRadius:10,border:"1px solid var(--border)"}}/>
        <a href={selReceipt.dataUrl} download={`recibo_${selReceipt.month}_${selReceipt.type}.jpg`}
          style={{display:"block",marginTop:12,...S.btnPrimary,textAlign:"center",textDecoration:"none",padding:"12px",borderRadius:12,background:ac,color:"#111",fontWeight:700,fontFamily:"DM Mono,monospace",fontSize:14}}>
          ⬇️ Baixar Recibo
        </a>
      </div>
    );
  }

  if (myReceipts.length === 0) return (
    <div style={{textAlign:"center",marginTop:30}}>
      <div style={{fontSize:32,marginBottom:12}}>📄</div>
      <p style={{color:"var(--text3)",fontSize:14}}>Nenhum recibo disponível ainda.</p>
      <p style={{color:"#333",fontSize:12,marginTop:8}}>Quando o gestor importar os recibos do mês, eles aparecerão aqui.</p>
      {(receipts??[]).length > 0 && <p style={{color:"#333",fontSize:11,marginTop:4}}>({(receipts??[]).length} recibos no sistema, nenhum para você)</p>}
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
                style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px",borderRadius:10,border:"1px solid var(--border)",background:"var(--bg1)",cursor:"pointer",fontFamily:"DM Mono,monospace",marginBottom:6}}>
                <span style={{color:"var(--text)",fontSize:13}}>{r.type==="pagamento"?"💰 Recibo de Pagamento":r.type==="adiantamento"?"💵 Recibo de Adiantamento":"🎄 13º Salário"}</span>
                <span style={{color:"var(--text3)",fontSize:11}}>Ver →</span>
              </button>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function EmployeePortal({ employees, roles, tips, schedules, restaurants, communications, commAcks, faq, dpMessages, receipts, workSchedules, onBack, onUpdateEmployee, onUpdate }) {
  const [cpf, setCpf] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [empId, setEmpId] = useState(null);
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
  const isFirstAccess = emp && (String(emp.pin) === String(emp.empCode?.slice(-4)) || String(emp.pin) === String(emp.empCode));
  const needsCpf = emp && !emp.cpf;

  const mk = monthKey(year, month);
  const myTips = tips.filter(t => t.employeeId === empId && t.monthKey === mk);
  const grossTotal = myTips.reduce((a, t) => a + (t.myShare ?? 0), 0);
  const taxTotal   = myTips.reduce((a, t) => a + (t.myTax   ?? 0), 0);
  const netTotal   = myTips.reduce((a, t) => a + (t.myNet   ?? 0), 0);
  const dayMap = emp ? (schedules?.[emp.restaurantId]?.[mk]?.[empId] ?? {}) : {};
  const ac = "#f5c842"; const bg = "#0f0f0f";

  // Pending communications
  const myComms = emp ? communications.filter(c => c.restaurantId === emp.restaurantId) : [];
  const pendingComms = myComms.filter(c => !commAcks?.[c.id]?.[empId]);
  const hasPending = pendingComms.length > 0;

  // Force comunicados tab if there are pending
  const TABS = [["comunicados","📢 Comunicados"],["escala","📅 Escala"],["extrato","💸 Gorjeta"],["horarios","🕐 Horários"],["recibos","📄 Recibos"],["faq","❓ FAQ"],["dp","💬 Fale com DP"]];

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

  function tryLogin() {
    const cleanInput = cpf.trim().toUpperCase().replace(/\s/g,"");
    const cleanPin = pin.trim();
    const found = employees.find(e =>
      (e.empCode && e.empCode.toUpperCase() === cleanInput && String(e.pin) === cleanPin) ||
      (e.cpf && e.cpf.replace(/\D/g,"") === cleanInput.replace(/\D/g,"") && String(e.pin) === cleanPin)
    );
    if (!found) { setErr("ID/CPF ou PIN incorretos."); return; }
    // Block inactive employees
    if (found.inactive && found.inactiveFrom && found.inactiveFrom <= today()) {
      setErr("Acesso desativado. Entre em contato com o departamento pessoal.");
      return;
    }
    setErr("");
    setEmpId(found.id);
  }

  function completeFirstAccess() {
    if (needsCpf && !firstCpf.trim()) { setFirstErr("Informe seu CPF."); return; }
    if (firstPin.length !== 4 || !/^\d{4}$/.test(firstPin)) { setFirstErr("PIN deve ter exatamente 4 dígitos numéricos."); return; }
    if (firstPin !== firstPin2) { setFirstErr("PINs não coincidem."); return; }
    const updated = { ...emp, pin: firstPin, cpf: firstCpf.trim() || emp.cpf };
    onUpdateEmployee(updated);
  }

  if (!empId) return (
    <div style={{ minHeight: "100vh", background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "DM Mono,monospace", padding: 24 }}>
      <div style={{ ...S.card, maxWidth: 340, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>👤</div>
        <h2 style={{ color: ac, margin: "0 0 4px" }}>Área do Empregado</h2>
        <p style={{ color: "var(--text3)", fontSize: 13, marginBottom: 22 }}>Use seu ID (ex: QUI0001) ou CPF + PIN</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14, textAlign: "left" }}>
          <div><label style={S.label}>ID ou CPF</label><input value={cpf} onChange={e => setCpf(e.target.value)} placeholder="QUI0001 ou 000.000.000-00" style={S.input} /></div>
          <div><label style={S.label}>PIN (4 dígitos)</label><input type="password" inputMode="numeric" maxLength={4} value={pin} onChange={e => setPin(e.target.value)} placeholder="••••" style={{ ...S.input, letterSpacing: 6, fontSize: 18, textAlign: "center" }} onKeyDown={e => e.key === "Enter" && tryLogin()} /></div>
        </div>
        {err && <p style={{ color: "#e74c3c", fontSize: 13, marginBottom: 10 }}>{err}</p>}
        <button onClick={tryLogin} style={{ ...S.btnPrimary, marginBottom: 12 }}>Entrar</button>
        <button onClick={onBack} style={{ ...S.btnSecondary, width: "100%" }}>← Voltar</button>
      </div>
    </div>
  );

  if (empId && isFirstAccess) return (
    <div style={{ minHeight:"100vh", background:bg, display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"DM Mono,monospace", padding:24 }}>
      <div style={{ ...S.card, maxWidth:360, width:"100%" }}>
        <div style={{ textAlign:"center", marginBottom:20 }}>
          <div style={{ fontSize:32 }}>🔑</div>
          <h2 style={{ color:ac, margin:"8px 0 4px" }}>Primeiro Acesso</h2>
          <p style={{ color:"var(--text3)", fontSize:13 }}>Bem-vindo, {emp?.name}!{needsCpf?" Complete seu cadastro e defina seu PIN.":" Defina seu PIN de acesso."}</p>
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {needsCpf && <div><label style={S.label}>Seu CPF</label><input value={firstCpf} onChange={e=>setFirstCpf(e.target.value)} placeholder="000.000.000-00" style={S.input} inputMode="numeric"/></div>}
          <div><label style={S.label}>Novo PIN (4 dígitos)</label><input type="password" inputMode="numeric" maxLength={4} value={firstPin} onChange={e=>setFirstPin(e.target.value)} placeholder="••••" style={{ ...S.input, letterSpacing:6, fontSize:20, textAlign:"center" }}/></div>
          <div><label style={S.label}>Confirmar PIN</label><input type="password" inputMode="numeric" maxLength={4} value={firstPin2} onChange={e=>setFirstPin2(e.target.value)} placeholder="••••" style={{ ...S.input, letterSpacing:6, fontSize:20, textAlign:"center" }} onKeyDown={e=>e.key==="Enter"&&completeFirstAccess()}/></div>
          {firstErr && <p style={{ color:"#e74c3c", fontSize:13, margin:0 }}>{firstErr}</p>}
          <button onClick={completeFirstAccess} style={S.btnPrimary}>Confirmar e Entrar</button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: bg, fontFamily: "DM Mono,monospace" }}>
      <div style={{ background: "var(--bg1)", borderBottom: "1px solid var(--border)", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ color: ac, fontWeight: 700 }}>{emp?.name}</div>
          <div style={{ color: "var(--text3)", fontSize: 11 }}>{role?.name} · {restaurant?.name}</div>
        </div>
        <button onClick={() => { setEmpId(null); setCpf(""); setPin(""); }} style={{ ...S.btnSecondary, fontSize: 12 }}>Sair</button>
      </div>
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--bg1)", overflowX: "auto" }}>
        {TABS.map(([id, lbl]) => {
          const blocked = hasPending && id !== "comunicados";
          return (
            <button key={id} onClick={() => handleTabChange(id)}
              style={{ padding: "11px 12px", background: "none", border: "none", borderBottom: `2px solid ${tab === id ? ac : "transparent"}`, color: tab === id ? ac : blocked ? "#333" : "#555", cursor: blocked ? "not-allowed" : "pointer", fontSize: 11, fontFamily: "DM Mono,monospace", fontWeight: tab === id ? 700 : 400, whiteSpace: "nowrap" }}>
              {lbl}
              {id === "comunicados" && pendingComms.length > 0 && <span style={{ background: "#e74c3c", color: "var(--text)", borderRadius: 10, padding: "1px 5px", fontSize: 9, marginLeft: 4 }}>{pendingComms.length}</span>}
            </button>
          );
        })}
      </div>
      {hasPending && (
        <div style={{ background: "#e74c3c22", padding: "8px 16px", fontSize: 12, color: "#e74c3c", fontFamily: "DM Mono,monospace", textAlign: "center" }}>
          ⚠️ Dê ciência nos comunicados pendentes para acessar as outras abas.
        </div>
      )}
      <div style={{ padding: "20px 16px", maxWidth: 540, margin: "0 auto" }}>

        {tab === "extrato" && (
          <div>
            <div style={{ marginBottom: 20 }}><MonthNav year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} /></div>
            {/* Legal disclaimer */}
            <div style={{ background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 11, color: "var(--text3)", lineHeight: 1.5 }}>
              ⚠️ <strong style={{ color: "#666" }}>Aviso:</strong> Os valores exibidos são aproximados, apurados até o momento atual e sujeitos a alterações. Esta tela tem caráter informativo e de transparência, podendo conter imprecisões. Os valores definitivos serão apurados pela empresa e comunicados pelos canais oficiais.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
              {[["Bruto", grossTotal, "#fff"], ["Imposto", taxTotal, "#e74c3c"], ["Líquido", netTotal, ac]].map(([lbl, val, col]) => (
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
                      <div key={t.id} style={{background:"var(--card-bg)",borderBottom:"1px solid #222",padding:"8px",borderRadius:0}}>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:4,marginBottom: statusOfDay||t.note?4:0}}>
                          <div style={{color:"var(--text2)",fontSize:12}}>{fmtDate(t.date)}</div>
                          <div style={{color:"var(--text)",fontSize:12}}>{fmt(t.myShare)}</div>
                          <div style={{color:"#e74c3c",fontSize:12}}>-{fmt(t.myTax)}</div>
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
                    <div style={{color:"#e74c3c",fontSize:11}}>-{fmt(myTips.reduce((a,t)=>a+t.myTax,0))}</div>
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
              <button onClick={()=>setEmpSchedView("mine")} style={{flex:1,padding:"8px",borderRadius:10,border:`1px solid ${empSchedView==="mine"?ac:"#2a2a2a"}`,background:empSchedView==="mine"?ac+"22":"transparent",color:empSchedView==="mine"?ac:"#555",cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:12}}>Minha Escala</button>
              <button onClick={()=>setEmpSchedView("area")} style={{flex:1,padding:"8px",borderRadius:10,border:`1px solid ${empSchedView==="area"?ac:"#2a2a2a"}`,background:empSchedView==="area"?ac+"22":"transparent",color:empSchedView==="area"?ac:"#555",cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:12}}>Escala da Área</button>
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
                      ["Trabalho", counts.work, "#10b981"], ["Folga", counts.off, "#e74c3c"],
                      ["Compensação", counts.comp, "#3b82f6"], ["Férias", counts.vac, "#8b5cf6"],
                      ["Falta Just.", counts.fj, "#f59e0b"], ["Falta Injust.", counts.fu, "#ef4444"],
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
              });
              return (
                <div>
                  <p style={{color:"var(--text3)",fontSize:12,marginBottom:16}}>Escala da área <span style={{color:AREA_COLORS[empArea]??ac}}>{empArea}</span> — {monthLabel(year,month)}</p>
                  {areaEmpsList.map(e => {
                    const dm = schedules?.[emp?.restaurantId]?.[mk]?.[e.id] ?? {};
                    return (
                      <div key={e.id} style={{...S.card,marginBottom:16}}>
                        <div style={{color: e.id===empId?ac:"#fff",fontWeight:600,marginBottom:8,fontSize:13}}>
                          {e.name}{e.id===empId?" (você)":""}
                        </div>
                        <CalendarGrid year={year} month={month} dayMap={dm} readOnly />
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {tab === "comunicados" && (
          <ComunicadosTab empId={empId} restaurantId={emp?.restaurantId} communications={communications} commAcks={commAcks} onUpdate={onUpdate} />
        )}

        {tab === "faq" && (
          <FaqTab restaurantId={emp?.restaurantId} faq={faq} />
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

  const sorted = [...restRoles].sort((a, b) => a.area.localeCompare(b.area) || a.name.localeCompare(b.name));

  function getRow(r) { return editRows[r.id] ?? { name: r.name, area: r.area, points: String(r.points) }; }
  function setRow(id, field, val) { setEditRows(prev => ({ ...prev, [id]: { ...getRow({ id }), [field]: val } })); }

  function saveRole(r) {
    const row = getRow(r);
    if (!row.name.trim()) return;
    const updated = { ...r, name: row.name.trim(), area: row.area, points: parseFloat(row.points) || 1 };
    onUpdate("roles", roles.map(x => x.id === r.id ? updated : x));
    setSaved(p => ({ ...p, [r.id]: true }));
    setTimeout(() => setSaved(p => ({ ...p, [r.id]: false })), 1500);
  }

  function saveNew() {
    if (!newRow.name.trim()) return;
    const r = { ...newRow, id: Date.now().toString(), points: parseFloat(newRow.points) || 1 };
    onUpdate("roles", [...roles, r]);
    setNewRow(blank());
  }

  function inactivateRole(id) { onUpdate("roles", roles.map(x => x.id === id ? {...x, inactive: true} : x)); }
  function reactivateRole(id) { onUpdate("roles", roles.map(x => x.id === id ? {...x, inactive: false} : x)); }

  const inStyle = { background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontFamily: "DM Mono,monospace", fontSize: 12, padding: "8px 10px", outline: "none", width: "100%" };
  const sel = { ...inStyle, cursor: "pointer" };
  const ac = "#f5c842";

  return (
    <div style={{ fontFamily: "DM Mono,monospace" }}>
      <p style={{ color: "var(--text3)", fontSize: 12, marginBottom: 16 }}>Edite inline e clique em Salvar na linha. Nova linha no topo para adicionar.</p>

      {/* Header */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 80px 80px", gap: 6, marginBottom: 8, padding: "0 6px" }}>
        {["Nome do Cargo", "Área", "Pontos", ""].map(h => <div key={h} style={{ color: "var(--text3)", fontSize: 11 }}>{h}</div>)}
      </div>

      {/* New row */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 80px 80px", gap: 6, marginBottom: 6, background: "#1a2a1a", borderRadius: 10, padding: 8, border: "1px solid #10b98144" }}>
        <input value={newRow.name} onChange={e => setNewRow(p => ({ ...p, name: e.target.value }))} placeholder="Nome do cargo…" style={inStyle} />
        <select value={newRow.area} onChange={e => setNewRow(p => ({ ...p, area: e.target.value }))} style={sel}>
          {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input type="number" min="0.5" step="0.5" value={newRow.points} onChange={e => setNewRow(p => ({ ...p, points: e.target.value }))} style={inStyle} />
        <button onClick={saveNew} style={{ background: "#10b981", border: "none", borderRadius: 8, color: "var(--text)", fontWeight: 700, fontSize: 12, cursor: "pointer", padding: "8px 4px", fontFamily: "DM Mono,monospace" }}>+ Add</button>
      </div>

      {/* Existing rows */}
      {sorted.length === 0 && <p style={{ color: "var(--text3)", textAlign: "center", marginTop: 20 }}>Nenhum cargo cadastrado.</p>}
      {sorted.map(r => {
        const row = getRow(r);
        const isSaved = saved[r.id];
        return (
          <div key={r.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 80px 80px", gap: 6, marginBottom: 6, background: "var(--card-bg)", borderRadius: 10, padding: 8, border: `1px solid ${isSaved ? "#10b98166" : "#2a2a2a"}`, transition: "border-color 0.3s" }}>
            <input value={row.name} onChange={e => setRow(r.id, "name", e.target.value)} style={inStyle} />
            <select value={row.area} onChange={e => setRow(r.id, "area", e.target.value)} style={sel}>
              {AREAS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <input type="number" min="0.5" step="0.5" value={row.points} onChange={e => setRow(r.id, "points", e.target.value)} style={inStyle} />
            <div style={{ display: "flex", gap: 4 }}>
              <button onClick={() => saveRole(r)} style={{ flex: 1, background: isSaved ? "#10b981" : ac, border: "none", borderRadius: 8, color: "#111", fontWeight: 700, fontSize: 11, cursor: "pointer", padding: "4px 2px", fontFamily: "DM Mono,monospace" }}>{isSaved ? "✓" : "Salvar"}</button>
              {r.inactive
                ? <button onClick={() => reactivateRole(r.id)} style={{ padding:"4px 8px", borderRadius:8, border:"1px solid #10b98144", background:"transparent", color:"#10b981", cursor:"pointer", fontSize:11, fontFamily:"DM Mono,monospace" }}>Reativar</button>
                : <button onClick={() => inactivateRole(r.id)} style={{ padding:"4px 8px", borderRadius:8, border:"1px solid #f59e0b44", background:"transparent", color:"#f59e0b", cursor:"pointer", fontSize:11, fontFamily:"DM Mono,monospace" }}>Inativar</button>
              }
            </div>
          </div>
        );
      })}
    </div>
  );
}

//
// EmpRowCard defined OUTSIDE to prevent focus loss on re-render
const empInS = { background: "var(--bg1)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontFamily: "DM Mono,monospace", fontSize: 12, padding: "8px 10px", outline: "none", width: "100%", boxSizing: "border-box" };

function EmpRowCard({ row, onChange, onSave, onDelete, onToggleInactive, isSaved, isNew, restRoles }) {
  const ac = "#f5c842";
  const isInactive = row.inactive && row.inactiveFrom && row.inactiveFrom <= today();
  return (
    <div style={{ background: isNew ? "#1a2a1a" : isInactive ? "#1a1a2a" : "#1a1a1a", borderRadius: 12, padding: 12, marginBottom: 8, border: `1px solid ${isSaved ? "#10b98166" : isNew ? "#10b98144" : isInactive ? "#8b5cf644" : "#2a2a2a"}`, transition: "border-color 0.3s", opacity: isInactive ? 0.7 : 1 }}>
      {isInactive && <div style={{ color: "#8b5cf6", fontSize: 11, marginBottom: 8, fontFamily: "DM Mono,monospace" }}>⚫ Inativo desde {fmtDate(row.inactiveFrom)}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
        <div><div style={{ color: "var(--text3)", fontSize: 10, marginBottom: 3 }}>Nome</div><input value={row.name} onChange={e => onChange("name", e.target.value)} placeholder="Nome completo" style={empInS} /></div>
        <div><div style={{ color: "var(--text3)", fontSize: 10, marginBottom: 3 }}>CPF</div><input value={row.cpf} onChange={e => onChange("cpf", e.target.value)} placeholder="000.000.000-00" style={empInS} inputMode="numeric" /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
        <div><div style={{ color: "var(--text3)", fontSize: 10, marginBottom: 3 }}>Admissão</div><input type="date" value={row.admission} onChange={e => onChange("admission", e.target.value)} style={empInS} /></div>
        <div><div style={{ color: "var(--text3)", fontSize: 10, marginBottom: 3 }}>PIN</div><input type="password" value={row.pin} onChange={e => onChange("pin", e.target.value)} maxLength={4} placeholder="••••" style={empInS} /></div>
      </div>
      <div style={{ marginBottom: 6 }}>
        <div style={{ color: "var(--text3)", fontSize: 10, marginBottom: 3 }}>Cargo</div>
        <select value={row.roleId} onChange={e => onChange("roleId", e.target.value)} style={{ ...empInS, cursor: "pointer" }}>
          <option value="">Selecionar cargo…</option>
          {AREAS.map(a => (
            <optgroup key={a} label={a}>
              {restRoles.filter(r => r.area === a).map(r => <option key={r.id} value={r.id}>{r.name} ({r.points}pt)</option>)}
            </optgroup>
          ))}
        </select>
      </div>
      {!isNew && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ color: "var(--text3)", fontSize: 10, marginBottom: 3 }}>Inativar a partir de</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="date" value={row.inactiveFrom ?? ""} onChange={e => onChange("inactiveFrom", e.target.value)} style={{ ...empInS, flex: 1 }} />
            <button onClick={onToggleInactive} style={{ padding: "8px 12px", borderRadius: 8, border: `1px solid ${row.inactive ? "#10b981" : "#e74c3c44"}`, background: "transparent", color: row.inactive ? "#10b981" : "#e74c3c", cursor: "pointer", fontFamily: "DM Mono,monospace", fontSize: 11, whiteSpace: "nowrap" }}>
              {row.inactive ? "Reativar" : "Inativar"}
            </button>
          </div>
        </div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onSave} style={{ flex: 1, background: isSaved ? "#10b981" : isNew ? "#10b981" : ac, border: "none", borderRadius: 8, color: "#111", fontWeight: 700, fontSize: 13, cursor: "pointer", padding: "10px", fontFamily: "DM Mono,monospace" }}>
          {isSaved ? "✓ Salvo!" : isNew ? "+ Adicionar" : "Salvar"}
        </button>
        {!isNew && onDelete && <button onClick={onDelete} style={{ background: "none", border: "1px solid #e74c3c44", borderRadius: 8, color: "#e74c3c", cursor: "pointer", fontSize: 13, padding: "10px 14px" }}>✕</button>}
      </div>
    </div>
  );
}

function EmployeeSpreadsheet({ restEmps, restRoles, rid, employees, onUpdate, restCode: restCode_ }) {
  const blank = () => ({ id: null, name: "", cpf: "", admission: "", pin: "", roleId: "", restaurantId: rid });
  const [newRow, setNewRow] = useState(blank());
  const [editRows, setEditRows] = useState({});
  const [saved, setSaved] = useState({});

  const sorted = [...restEmps].sort((a, b) => {
    const rA = restRoles.find(r => r.id === a.roleId);
    const rB = restRoles.find(r => r.id === b.roleId);
    return (rA?.area ?? "z").localeCompare(rB?.area ?? "z") || a.name.localeCompare(b.name);
  });

  function getRow(e) { return editRows[e.id] ?? { name: e.name, cpf: e.cpf ?? "", admission: e.admission ?? "", pin: e.pin ?? "", roleId: e.roleId ?? "" }; }
  function setRow(id, field, val) { setEditRows(prev => ({ ...prev, [id]: { ...(prev[id] ?? getRow({ id, name:"", cpf:"", admission:"", pin:"", roleId:"" })), [field]: val } })); }

  function saveEmp(e) {
    const row = getRow(e);
    if (!row.name.trim()) return;
    const updated = { ...e, name: row.name.trim(), cpf: row.cpf, admission: row.admission, pin: row.pin, roleId: row.roleId };
    onUpdate("employees", employees.map(x => x.id === e.id ? updated : x));
    setSaved(p => ({ ...p, [e.id]: true }));
    setTimeout(() => setSaved(p => ({ ...p, [e.id]: false })), 1500);
  }

  function saveNew() {
    if (!newRow.name.trim()) return;
    const restCode = restCode_ || "XXX";
    const seq = nextEmpSeq(employees, restCode);
    const empCode = makeEmpCode(restCode, seq);
    const pin = String(seq).padStart(4, "0");
    onUpdate("employees", [...employees, { ...newRow, id: Date.now().toString(), empCode, pin, restaurantId: rid }]);
    setNewRow(blank());
  }

  // Employees are never deleted, only inactivated via EmpRowCard

  function toggleInactive(e) {
    const row = getRow(e);
    const updated = { ...e, inactive: !e.inactive, inactiveFrom: row.inactiveFrom || today() };
    onUpdate("employees", employees.map(x => x.id === e.id ? updated : x));
  }

  const activeEmps   = sorted.filter(e => !e.inactive || (e.inactiveFrom && e.inactiveFrom > today()));
  const inactiveEmps = sorted.filter(e => e.inactive && e.inactiveFrom && e.inactiveFrom <= today());
  const [showInactive, setShowInactive] = useState(false);

  const renderEmpList = (list) => list.map(e => {
    const row = getRow(e);
    const role = restRoles.find(r => r.id === (editRows[e.id]?.roleId ?? e.roleId));
    return (
      <div key={e.id}>
        {role && <div style={{ color: AREA_COLORS[role.area] ?? "#555", fontSize: 11, fontWeight: 700, marginBottom: 4, marginTop: 12, paddingLeft: 4 }}>{role.area}</div>}
        {e.empCode && <div style={{ color: "var(--text3)", fontSize: 11, marginBottom: 2, paddingLeft: 4 }}>ID: <span style={{color:"#f5c842"}}>{e.empCode}</span></div>}
        <EmpRowCard row={row} isSaved={saved[e.id]} isNew={false} restRoles={restRoles}
          onChange={(f, v) => setRow(e.id, f, v)}
          onSave={() => saveEmp(e)}
          onDelete={null}
          onToggleInactive={() => toggleInactive(e)}
        />
      </div>
    );
  });

  return (
    <div style={{ fontFamily: "DM Mono,monospace" }}>
      <p style={{ color: "var(--text3)", fontSize: 12, marginBottom: 16 }}>Card verde para novo empregado. Edite e clique Salvar em cada card.</p>
      <EmpRowCard row={newRow} isNew restRoles={restRoles}
        onChange={(f, v) => setNewRow(p => ({ ...p, [f]: v }))}
        onSave={saveNew} isSaved={false} />

      {/* Active / Inactive toggle */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, marginTop: 8 }}>
        <button onClick={() => setShowInactive(false)} style={{ flex: 1, padding: "8px", borderRadius: 10, border: `1px solid ${!showInactive ? "#10b981" : "#2a2a2a"}`, background: !showInactive ? "#10b98122" : "transparent", color: !showInactive ? "#10b981" : "#555", cursor: "pointer", fontFamily: "DM Mono,monospace", fontSize: 13 }}>
          Ativos ({activeEmps.length})
        </button>
        <button onClick={() => setShowInactive(true)} style={{ flex: 1, padding: "8px", borderRadius: 10, border: `1px solid ${showInactive ? "#8b5cf6" : "#2a2a2a"}`, background: showInactive ? "#8b5cf622" : "transparent", color: showInactive ? "#8b5cf6" : "#555", cursor: "pointer", fontFamily: "DM Mono,monospace", fontSize: 13 }}>
          Inativos ({inactiveEmps.length})
        </button>
      </div>

      {!showInactive && activeEmps.length === 0 && <p style={{ color: "var(--text3)", textAlign: "center" }}>Nenhum empregado ativo.</p>}
      {showInactive && inactiveEmps.length === 0 && <p style={{ color: "var(--text3)", textAlign: "center" }}>Nenhum empregado inativo.</p>}
      {!showInactive && renderEmpList(activeEmps)}
      {showInactive && renderEmpList(inactiveEmps)}
    </div>
  );
}


function RestaurantPanel({ restaurant, restaurants, employees, roles, tips, splits, schedules, onUpdate, perms, isSuperManager, data }) {
  const [tab, setTab] = useState(perms.tips ? "dashboard" : "schedule");
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
  const [schedArea, setSchedArea]         = useState("Salão");
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
    }).map(emp => ({ ...emp, points: parseFloat(restRoles.find(r=>r.id===emp.roleId)?.points)||1, area: restRoles.find(r=>r.id===emp.roleId)?.area }));
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
    onUpdate("tips", [...tips, ...newTips]);
    return newTips.length;
  }

  function calcTip() {
    const total = parseFloat(tipTotal);
    if (!total || isNaN(total) || total <= 0) return 0;
    const td = new Date(tipDate + "T12:00:00");
    const tKey = monthKey(td.getFullYear(), td.getMonth());
    const taxRate = restaurant.taxRate ?? TAX;
    const totalTaxAmt = total * taxRate;
    const toDistribute = total - totalTaxAmt;
    const newTips = [];
    const mode = restaurant.divisionMode ?? MODE_AREA_POINTS;

    // Get schedule dayMap for the tip date
    const empDayStatus = (empId) => {
      const empDayMap = schedules?.[rid]?.[tKey]?.[empId] ?? {};
      return empDayMap[tipDate]; // undefined = work
    };

    const isProdArea = (area) => area === "Produção";

    const activeEmps = restEmps.filter(emp => {
      // Must have a role and be admitted
      const r = restRoles.find(r => r.id === emp.roleId);
      if (!r) return false;
      if (emp.admission && emp.admission > tipDate) return false;
      // Must not be inactive
      if (emp.inactive && emp.inactiveFrom && emp.inactiveFrom <= tipDate) return false;
      // Check schedule
      const status = empDayStatus(emp.id);
      if (!status) return true; // trabalho = entra
      if (status === DAY_COMP) return true; // compensacao = entra
      if (status === DAY_FAULT_J || status === DAY_FAULT_U) return false; // faltas = nao entra
      if (status === DAY_VACATION) return false; // ferias = nao entra (inclusive Producao)
      // Folga: so Producao entra
      if (isProdArea(r.area)) return true;
      return false; // demais: folga = nao entra
    }).map(emp => ({
      ...emp,
      points: parseFloat(restRoles.find(r => r.id === emp.roleId)?.points) || 1,
      area: restRoles.find(r => r.id === emp.roleId)?.area,
      dayStatus: empDayStatus(emp.id),
    }));

    if (mode === MODE_GLOBAL_POINTS) {
      const totalPoints = activeEmps.reduce((a, e) => a + e.points, 0);
      if (!totalPoints) return 0;
      activeEmps.forEach(emp => {
        const myGross    = total * (emp.points / totalPoints);
        const myTaxShare = totalTaxAmt * (emp.points / totalPoints);
        newTips.push({
          id: `${Date.now()}-${emp.id}-${Math.random().toString(36).slice(2,6)}`,
          restaurantId: rid, employeeId: emp.id, date: tipDate, monthKey: tKey,
          poolTotal: total, areaPool: toDistribute, area: emp.area ?? "—",
          myShare: myGross, myTax: myTaxShare, myNet: myGross - myTaxShare,
          note: tipNote, taxRate,
        });
      });
    } else {
      const tSplit = splits?.[rid]?.[tKey] ?? DEFAULT_SPLIT;
      const empsByArea = {};
      AREAS.forEach(a => { empsByArea[a] = []; });
      activeEmps.forEach(emp => { if (emp.area) empsByArea[emp.area].push(emp); });
      AREAS.forEach(area => {
        const areaPool = toDistribute * (tSplit[area] / 100);
        const emps = empsByArea[area];
        const totalPoints = emps.reduce((a, e) => a + e.points, 0);
        if (!totalPoints) return;
        emps.forEach(emp => {
          const myGross    = total * (tSplit[area] / 100) * (emp.points / totalPoints);
          const myTaxShare = totalTaxAmt * (tSplit[area] / 100) * (emp.points / totalPoints);
          newTips.push({
            id: `${Date.now()}-${emp.id}-${Math.random().toString(36).slice(2,6)}`,
            restaurantId: rid, employeeId: emp.id, date: tipDate, monthKey: tKey,
            poolTotal: total, areaPool, area,
            myShare: myGross, myTax: myTaxShare, myNet: myGross - myTaxShare,
            note: tipNote, taxRate,
          });
        });
      });
    }
    onUpdate("tips", [...tips, ...newTips]);
    setTipTotal(""); setTipNote("");
    // Apply 4% penalty for Producao employees with falta injustificada this month
    applyFaultPenalty(tKey, [...tips, ...newTips]);
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
      if (!r) return false;
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
      points: parseFloat(restRoles.find(r => r.id === emp.roleId)?.points) || 1,
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

  const areaEmps = restEmps.filter(e => restRoles.find(r => r.id === e.roleId)?.area === schedArea);
  const dim = new Date(year, month + 1, 0).getDate();

  const ac = "#f5c842";
  const canTips  = perms.tips     || isSuperManager;
  const canSched = perms.schedule || isSuperManager;
  const isDP     = perms.isDP === true;
  const canComms = perms.comunicados !== false || isSuperManager;
  const canFaq   = perms.faq   !== false || isSuperManager;
  const canDp    = perms.dp    !== false || isSuperManager;

  const TABS = [
    canTips   && ["dashboard",    "📊 Dashboard"],
    canTips   && ["tips",         "💸 Gorjetas"],
    (canTips || isSuperManager) && ["employees", "👥 Equipe"],
    isSuperManager && ["roles",   "🏷️ Cargos"],
    canSched  && ["schedule",     "📅 Escala"],
    canComms  && ["comunicados",  "📢 Comunicados"],
    canFaq    && ["faq",          "❓ FAQ"],
    canDp     && ["dp",           "💬 Fale com DP"],
    (perms.horarios !== false || isSuperManager) && ["horarios", "🕐 Horários"],
    isDP      && ["notificacoes", `📬 Notificações${((data?.notifications??[]).filter(n=>n.restaurantId===rid&&!n.read).length+(data?.dpMessages??[]).filter(m=>m.restaurantId===rid&&!m.read).length)>0?" ●":"" }`],
    (canTips || isSuperManager) && ["recibos", "📄 Recibos"],
    (canTips || isSuperManager) && ["config", "⚙️ Config"],
  ].filter(Boolean);

  return (
    <div style={{ fontFamily: "DM Mono,monospace" }}>
      {/* Restaurant sub-header */}
      <div style={{ background: "var(--bg2)", borderBottom: "1px solid var(--border)", padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ color: "var(--text)", fontWeight: 600 }}>{restaurant.name}</span>
          {restaurant.cnpj && <span style={{ color: "var(--text3)", fontSize: 12, marginLeft: 10 }}>{restaurant.cnpj}</span>}
        </div>
        {canTips && <button onClick={() => setShowExport(true)} style={{ ...S.btnSecondary, fontSize: 12, color: ac, borderColor: ac }}>📤 Exportar</button>}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--bg1)", overflowX: "auto" }}>
        {TABS.map(([id, lbl]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding: "11px 14px", background: "none", border: "none", borderBottom: `2px solid ${tab === id ? ac : "transparent"}`, color: tab === id ? ac : "#555", cursor: "pointer", fontSize: 12, fontFamily: "DM Mono,monospace", fontWeight: tab === id ? 700 : 400, whiteSpace: "nowrap" }}>{lbl}</button>
        ))}
      </div>

      <div style={{ padding: "20px 24px" }}>
        {["dashboard","tips","schedule"].includes(tab) && (
          <div style={{ marginBottom: 20 }}><MonthNav year={year} month={month} onChange={(y,m)=>{setYear(y);setMonth(m);}} /></div>
        )}

        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
              {[["Pool Bruto",totalGross,"#fff"],["Impostos 33%",totalTax,"#e74c3c"],["Distribuído",totalNet,ac]].map(([lbl,val,col])=>(
                <div key={lbl} style={{ ...S.card, textAlign: "center" }}>
                  <div style={{ color: "var(--text3)", fontSize: 10, marginBottom: 4 }}>{lbl}</div>
                  <div style={{ color: col, fontWeight: 700, fontSize: 14 }}>{fmt(val)}</div>
                </div>
              ))}
            </div>
            {(restaurant.divisionMode ?? MODE_AREA_POINTS) === MODE_AREA_POINTS && (
              <div style={{ ...S.card, marginBottom: 20 }}>
                <p style={{ color: "var(--text3)", fontSize: 12, margin: "0 0 12px" }}>Distribuição por Área</p>
                {AREAS.map(a => {
                  const aNet = monthTips.filter(t => t.area === a).reduce((s,t) => s + t.myNet, 0);
                  return (
                    <div key={a} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      <div style={{ minWidth: 70 }}><AreaBadge area={a} /></div>
                      <div style={{ flex: 1, background: "var(--bg1)", borderRadius: 4, height: 6, overflow: "hidden" }}>
                        <div style={{ width: `${curSplit[a]}%`, height: "100%", background: AREA_COLORS[a] }} />
                      </div>
                      <span style={{ color: "var(--text2)", fontSize: 12, minWidth: 36 }}>{curSplit[a]}%</span>
                      <span style={{ color: ac, fontSize: 13, fontWeight: 600, minWidth: 80, textAlign: "right" }}>{fmt(aNet)}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {empSummary.map((e, i) => (
              <div key={e.id} style={{ ...S.card, marginBottom: 8, display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ color: ac, minWidth: 24 }}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":`${i+1}`}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 600 }}>{e.name}</div>
                  <div style={{ color: "var(--text3)", fontSize: 12 }}>{e.roleName}{e.area&&` · `}{e.area&&<span style={{color:AREA_COLORS[e.area]}}>{e.area}</span>}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: ac, fontWeight: 700 }}>{fmt(e.net)}</div>
                  <div style={{ color: "var(--text3)", fontSize: 11 }}>bruto {fmt(e.gross)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* GORJETAS */}
        {tab === "tips" && (
          <div>
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
                <button onClick={() => { const n = calcTip(); if (n > 0) onUpdate("_toast", `✅ Distribuído para ${n} empregados!`); }} style={S.btnPrimary}>Calcular e Distribuir</button>
              </div>
              ) : (
              /* MODO TABELA — pré-carregado com todos os dias do mês */
              (() => {
                const daysInMonth = new Date(year, month+1, 0).getDate();
                const allDays = Array.from({length: daysInMonth}, (_, i) => {
                  const d = i+1;
                  return `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                });
                const taxRate = restaurant.taxRate ?? TAX;
                const tSplit = splits?.[rid]?.[mk] ?? DEFAULT_SPLIT;
                const mode = restaurant.divisionMode ?? MODE_AREA_POINTS;
                // Already-launched dates this month
                const launchedDates = new Set(tipDates);

                // Helper: get active emps for a date
                const getActiveEmps = (date) => restEmps.filter(emp => {
                  const r = restRoles.find(r=>r.id===emp.roleId);
                  if (!r || (emp.admission && emp.admission > date)) return false;
                  const status = schedules?.[rid]?.[mk]?.[emp.id]?.[date];
                  if (!status) return true;
                  if (status === DAY_COMP) return true;
                  if (status === DAY_FAULT_J || status === DAY_FAULT_U || status === DAY_VACATION) return false;
                  if (r.area === "Produção") return true;
                  return false;
                });

                return (
                  <div>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <span style={{color:"var(--text3)",fontSize:12}}>{monthLabel(year,month)} — {daysInMonth} dias</span>
                      <MonthNav year={year} month={month} onChange={(y,m)=>{setYear(y);setMonth(m);}} />
                    </div>

                    {/* Day rows */}
                    {allDays.map(date => {
                      const row = tipRows.find(r=>r.date===date) ?? {date,total:"",note:""};
                      const val = parseFloat(row.total);
                      const hasVal = val > 0 && !isNaN(val);
                      const launched = launchedDates.has(date);
                      const activeEmps = getActiveEmps(date);
                      const weekday = new Date(date+"T12:00:00").toLocaleDateString("pt-BR",{weekday:"short"});
                      const isWeekend = [0,6].includes(new Date(date+"T12:00:00").getDay());

                      return (
                        <div key={date} style={{marginBottom:8,borderRadius:10,border:`1px solid ${launched?"#10b98133":hasVal?"#f5c84233":"#1a1a1a"}`,background:launched?"#0a1a0a":hasVal?"#1a1a0a":"#111",overflow:"hidden"}}>
                          {/* Row header */}
                          <div style={{display:"grid",gridTemplateColumns:"50px 1fr 1.5fr auto",gap:8,padding:"8px 10px",alignItems:"center"}}>
                            <div style={{textAlign:"center"}}>
                              <div style={{color:isWeekend?"#f59e0b":"#aaa",fontSize:13,fontWeight:700}}>{parseInt(date.slice(-2))}</div>
                              <div style={{color:"var(--text3)",fontSize:10}}>{weekday}</div>
                            </div>
                            <input
                              type="number" min="0" step="0.01"
                              value={row.total}
                              onChange={e=>{
                                const newRows = tipRows.filter(r=>r.date!==date);
                                setTipRows([...newRows, {...row, total:e.target.value}]);
                              }}
                              placeholder={launched?"Já lançado":"R$ 0,00"}
                              style={{...S.input,fontSize:13,padding:"6px 8px",background:launched?"#0d1a0d":"#1a1a1a",color:launched?"#10b981":"#fff"}}
                            />
                            <input
                              value={row.note}
                              onChange={e=>{
                                const newRows = tipRows.filter(r=>r.date!==date);
                                setTipRows([...newRows, {...row, note:e.target.value}]);
                              }}
                              placeholder="Observação"
                              style={{...S.input,fontSize:12,padding:"6px 8px"}}
                            />
                            {hasVal && !launched && (
                              <button onClick={()=>{
                                const n = calcTipForDate(date, val, row.note);
                                if(n>0) onUpdate("_toast",`✅ ${fmtDate(date)}: ${n} empregados`);
                              }} style={{padding:"6px 12px",borderRadius:8,border:"none",background:ac,color:"#111",fontWeight:700,cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:12,whiteSpace:"nowrap"}}>
                                Lançar
                              </button>
                            )}
                            {launched && <span style={{color:"#10b981",fontSize:11,whiteSpace:"nowrap"}}>✓ Lançado</span>}
                          </div>

                          {/* Rateio preview */}
                          {hasVal && !launched && (
                            <div style={{padding:"6px 10px 8px",borderTop:"1px solid var(--border)",background:"#0d0d0d"}}>
                              <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text3)",marginBottom:4}}>
                                <span>Pool: {fmt(val)} → Retenção {Math.round(taxRate*100)}%: -{fmt(val*taxRate)} → Distribuir: {fmt(val*(1-taxRate))}</span>
                                <span>{activeEmps.length} empregados</span>
                              </div>
                              {mode === MODE_GLOBAL_POINTS ? (
                                <div style={{fontSize:11,color:"var(--text3)"}}>
                                  {activeEmps.length > 0 && `Cada ponto vale: ${fmt(val*(1-taxRate)/(activeEmps.reduce((s,e)=>s+(parseFloat(restRoles.find(r=>r.id===e.roleId)?.points)||1),0)||1))}`}
                                </div>
                              ) : (
                                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                                  {AREAS.map(a => {
                                    const emps = activeEmps.filter(e=>restRoles.find(r=>r.id===e.roleId)?.area===a);
                                    if(!emps.length) return null;
                                    const pts = emps.reduce((s,e)=>s+(parseFloat(restRoles.find(r=>r.id===e.roleId)?.points)||1),0);
                                    const aPool = val*(1-taxRate)*(tSplit[a]/100);
                                    return <span key={a} style={{fontSize:11,color:AREA_COLORS[a]}}>{a}: {fmt(aPool)} ({emps.length}emp/{pts}pt)</span>;
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {/* Lançar todos button */}
                    {tipRows.filter(r=>parseFloat(r.total)>0&&!launchedDates.has(r.date)).length > 0 && (
                      <button onClick={()=>{
                        let count = 0;
                        tipRows.filter(r=>parseFloat(r.total)>0&&!launchedDates.has(r.date)).forEach(row=>{
                          count += calcTipForDate(row.date, parseFloat(row.total), row.note);
                        });
                        if(count>0) onUpdate("_toast",`✅ ${tipRows.filter(r=>parseFloat(r.total)>0).length} dias distribuídos!`);
                      }} style={{...S.btnPrimary,marginTop:8}}>
                        Lançar Todos os Dias Preenchidos
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
                      <button onClick={()=>{const n=recalcTipDay(d);onUpdate("_toast",`🔄 Dia ${fmtDate(d)} recalculado para ${n} empregados`);}} style={{padding:"6px 14px",borderRadius:8,border:"1px solid #f59e0b44",background:"transparent",color:"#f59e0b",cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:12}}>Recalcular</button>
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
                      <div key={a} style={{borderTop:"1px solid #222",paddingTop:8,marginTop:8}}>
                        <div style={{marginBottom:4}}><AreaBadge area={a} /></div>
                        {aT.map(t => {
                          const emp = restEmps.find(e => e.id === t.employeeId);
                          return <div key={t.id} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"3px 0"}}><span style={{color:"var(--text2)"}}>{emp?.name??"—"}</span><div><span style={{color:"var(--text)"}}>{fmt(t.myShare)}</span><span style={{color:"#e74c3c",marginLeft:8}}>-{fmt(t.myTax)}</span><span style={{color:ac,marginLeft:8,fontWeight:700}}>{fmt(t.myNet)}</span></div></div>;
                        })}
                      </div>
                    );
                  })}
                  <button onClick={()=>{const ids=new Set(dT.map(t=>t.id));onUpdate("tips",tips.filter(t=>!ids.has(t.id)));onUpdate("_toast","Lançamento removido.");}} style={{marginTop:10,background:"none",border:"1px solid #e74c3c33",borderRadius:8,color:"#e74c3c",cursor:"pointer",fontSize:12,padding:"4px 12px",fontFamily:"DM Mono,monospace"}}>Remover lançamento</button>
                </div>
              );
            })}
          </div>
        )}

        {/* EQUIPE */}
        {tab === "employees" && (
          <EmployeeSpreadsheet
            restEmps={employees.filter(e => e.restaurantId === rid)}
            restRoles={restRoles} rid={rid}
            employees={employees} onUpdate={onUpdate} restCode={restaurant.shortCode}
          />
        )}

        {/* CARGOS (super only) */}
        {tab === "roles" && (
          <RoleSpreadsheet
            restRoles={restRoles} rid={rid}
            roles={roles} onUpdate={onUpdate}
          />
        )}

        {/* ESCALA */}
        {tab === "schedule" && (
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
              <div style={{flex:1}}><PillBar options={AREAS} value={schedArea} onChange={setSchedArea}/></div>
              <div style={{display:"flex",gap:8}}>
                <div style={{display:"flex",gap:4}}>
                  <button onClick={()=>{setYear(month===0?year-1:year);setMonth(month===0?11:month-1);}} style={{...S.btnSecondary,padding:"6px 10px",fontSize:13}}>‹</button>
                  <span style={{color:"var(--text2)",fontSize:12,padding:"6px 8px",background:"var(--card-bg)",borderRadius:8,whiteSpace:"nowrap"}}>{monthLabel(year,month)}</span>
                  <button onClick={()=>{setYear(month===11?year+1:year);setMonth(month===11?0:month+1);}} style={{...S.btnSecondary,padding:"6px 10px",fontSize:13}}>›</button>
                </div>
                <button onClick={async () => {
                  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
                  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
                  const { jsPDF } = window.jspdf;
                  const doc = new jsPDF({ orientation:"landscape", unit:"mm", format:"a4" });
                  const daysInMonth = new Date(year, month+1, 0).getDate();
                  const STATUS_SHORT = {off:"F",comp:"C",vac:"Fér",faultj:"FJ",faultu:"FI"};
                  const STATUS_COLORS = {off:[231,76,60],comp:[59,130,246],vac:[139,92,246],faultj:[245,158,11],faultu:[239,68,68]};

                  doc.setFontSize(11);
                  doc.setTextColor(30,30,30);
                  doc.text(`Escala — ${schedArea} — ${monthLabel(year,month)} — ${restaurant.name}`, 14, 12);

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
                      if(!s) { workDays++; return ""; }
                      return STATUS_SHORT[s] ?? "";
                    });
                    return [`${emp.name}\n${role?.name??""}`, ...dayCells, String(workDays)];
                  });

                  doc.autoTable({
                    head, body,
                    startY: 16,
                    styles: { fontSize: 6, cellPadding: 1.5, halign:"center", textColor:[30,30,30], lineColor:[200,200,200], lineWidth:0.1 },
                    headStyles: { fillColor:[40,40,40], textColor:[220,220,220], fontStyle:"bold", fontSize:6 },
                    columnStyles: { 0: { halign:"left", cellWidth:30, fontSize:7 } },
                    didDrawCell: (data) => {
                      if(data.section==="body" && data.column.index > 0 && data.column.index <= daysInMonth) {
                        const dayIdx = data.column.index - 1;
                        const emp = areaEmps[data.row.index];
                        if(!emp) return;
                        const k = `${year}-${String(month+1).padStart(2,"0")}-${String(dayIdx+1).padStart(2,"0")}`;
                        const s = schedules?.[rid]?.[mk]?.[emp.id]?.[k];
                        if(s && STATUS_COLORS[s]) {
                          const {x,y,width,height} = data.cell;
                          doc.setFillColor(...STATUS_COLORS[s]);
                          doc.rect(x,y,width,height,"F");
                          doc.setTextColor(255,255,255);
                          doc.setFontSize(5);
                          doc.text(STATUS_SHORT[s], x+width/2, y+height/2+1, {align:"center"});
                        }
                      }
                    },
                    theme: "grid",
                  });

                  doc.save(`escala_${schedArea}_${year}_${String(month+1).padStart(2,"0")}.pdf`);
                }} style={{padding:"8px 12px",borderRadius:10,border:"1px solid var(--border)",background:"transparent",color:"var(--text2)",cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:12,whiteSpace:"nowrap"}}>
                  📄 PDF
                </button>
              </div>
            </div>

            {/* Legend */}
            <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:12}}>
              {[["#10b981","T","Trabalho"],["#e74c3c","F","Folga"],["#3b82f6","C","Comp."],["#8b5cf6","Fér","Férias"],["#f59e0b","FJ","Falta Just."],["#ef4444","FI","Falta Injust."]].map(([c,s,l])=>(
                <div key={s} style={{display:"flex",alignItems:"center",gap:3}}>
                  <div style={{width:20,height:16,borderRadius:3,background:c+"33",border:`1px solid ${c}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <span style={{color:c,fontSize:9,fontWeight:700}}>{s}</span>
                  </div>
                  <span style={{color:"var(--text3)",fontSize:10,fontFamily:"DM Mono,monospace"}}>{l}</span>
                </div>
              ))}
            </div>

            {areaEmps.length === 0 && <p style={{color:"var(--text3)",textAlign:"center"}}>Nenhum empregado nesta área.</p>}

            {areaEmps.length > 0 && (() => {
              const daysInMonth = dim;
              const STATUS_COLORS = {
                [DAY_OFF]:      "#e74c3c",
                [DAY_COMP]:     "#3b82f6",
                [DAY_VACATION]: "#8b5cf6",
                [DAY_FAULT_J]:  "#f59e0b",
                [DAY_FAULT_U]:  "#ef4444",
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
                  <table style={{borderCollapse:"collapse",fontFamily:"DM Mono,monospace",fontSize:11,minWidth:"100%"}}>
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
                        <th style={{padding:"4px 6px",textAlign:"center",color:"#10b981",fontSize:10,borderBottom:"1px solid var(--border)",minWidth:22}}>T</th>
                        <th style={{padding:"4px 6px",textAlign:"center",color:"#e74c3c",fontSize:10,borderBottom:"1px solid var(--border)",minWidth:22}}>F</th>
                      </tr>
                    </thead>
                    <tbody>
                      {areaEmps.map((emp,ei) => {
                        const role = restRoles.find(r=>r.id===emp.roleId);
                        const dayMap = schedules?.[rid]?.[mk]?.[emp.id] ?? {};
                        let workC=0, offC=0;
                        Object.values(dayMap).forEach(v=>{ if(v===DAY_OFF||v===DAY_FAULT_J||v===DAY_FAULT_U||v===DAY_VACATION) offC++; });
                        workC = daysInMonth - offC - Object.values(dayMap).filter(v=>v===DAY_COMP).length;
                        return (
                          <tr key={emp.id} style={{background:ei%2===0?"#111":"#141414"}}>
                            <td style={{position:"sticky",left:0,background:ei%2===0?"#111":"#141414",zIndex:1,padding:"5px 10px",borderRight:"1px solid var(--border)",minWidth:130}}>
                              <div style={{color:"var(--text)",fontSize:11,fontWeight:600}}>{emp.name}</div>
                              <div style={{color:"var(--text3)",fontSize:9}}>{role?.name}</div>
                            </td>
                            {Array.from({length:daysInMonth},(_,i)=>{
                              const d = i+1;
                              const date = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                              const status = dayMap[date];
                              const color = STATUS_COLORS[status] ?? "#10b981";
                              const label = STATUS_SHORT[status] ?? "•";
                              const wd = new Date(date+"T12:00:00").getDay();
                              const isWe = wd===0||wd===6;
                              return (
                                <td key={d} onClick={()=>cycleStatus(emp.id, date)}
                                  style={{textAlign:"center",padding:"3px 2px",cursor:"pointer",background:status?color+"33":(isWe?"#1a1a0a":"transparent"),borderRight:"1px solid #1a1a1a",width:30}}>
                                  <span style={{color:color,fontSize:status?9:11,fontWeight:status?700:400}}>{label}</span>
                                </td>
                              );
                            })}
                            <td style={{textAlign:"center",color:"#10b981",fontSize:11,fontWeight:700,padding:"3px 6px"}}>{workC}</td>
                            <td style={{textAlign:"center",color:"#e74c3c",fontSize:11,padding:"3px 6px"}}>{offC}</td>
                          </tr>
                        );
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
          <ComunicadosManagerTab
            restaurantId={rid} communications={data?.communications ?? []}
            commAcks={data?.commAcks ?? {}} employees={employees}
            onUpdate={onUpdate} currentManagerName="Gestor"
          />
        )}

        {/* FAQ */}
        {tab === "faq" && (
          <FaqManagerTab restaurantId={rid} faq={data?.faq ?? {}} onUpdate={onUpdate} />
        )}

        {/* FALE COM DP */}
        {tab === "dp" && (
          <DpManagerTab restaurantId={rid} dpMessages={data?.dpMessages ?? []} onUpdate={onUpdate} />
        )}

        {/* HORARIOS */}
        {tab === "horarios" && (
          <WorkScheduleManagerTab restaurantId={rid} employees={employees} workSchedules={data?.workSchedules??{}} notifications={data?.notifications??[]} managers={data?.managers??[]} currentManagerName={isSuperManager?"Super Gestor":"Gestor"} onUpdate={onUpdate} />
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
            {/* Tax Rate */}
            <div style={{...S.card,marginBottom:20}}>
              <p style={{color:ac,fontSize:14,fontWeight:700,margin:"0 0 8px"}}>Retenção Fiscal</p>
              <p style={{color:"var(--text3)",fontSize:12,marginBottom:14}}>Percentual retido do pool total antes da distribuição.</p>
              <div style={{display:"flex",gap:10}}>
                {[[0.33,"33%"],[0.20,"20%"]].map(([rate,lbl])=>{
                  const sel = (restaurant.taxRate ?? TAX) === rate;
                  return (
                    <button key={rate} onClick={()=>{
                      onUpdate("restaurants", restaurants.map(r=>r.id===rid?{...r,taxRate:rate}:r));
                      onUpdate("_toast","Retenção salva!");
                    }} style={{flex:1,padding:"12px",borderRadius:12,border:`2px solid ${sel?ac:"#2a2a2a"}`,background:sel?ac+"11":"transparent",cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:16,fontWeight:700,color:sel?ac:"#555"}}>
                      {lbl}
                    </button>
                  );
                })}
              </div>
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
                  <div style={{...S.input,width:70,textAlign:"center",color:"var(--text3)",background:"var(--bg5)",border:"1px solid #1a1a1a"}}>4%</div>
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
                    }} style={{padding:"14px 16px",borderRadius:12,border:`2px solid ${selected?ac:"#2a2a2a"}`,background:selected?ac+"11":"transparent",cursor:"pointer",textAlign:"left",fontFamily:"DM Mono,monospace"}}>
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
                    <div style={{color:Math.abs(AREAS.reduce((a,k)=>a+parseFloat(splitForm[k]||0),0)-100)<0.01?"#10b981":"#e74c3c",fontSize:13,marginBottom:10}}>Total: {AREAS.reduce((a,k)=>a+parseFloat(splitForm[k]||0),0).toFixed(1)}%</div>
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
function SuperManagerPortal({ data, onUpdate, onBack, currentUser }) {
  const { superManagers, managers, restaurants, employees, roles, tips, splits, schedules } = data;
  const [tab, setTab] = useState("restaurants");
  const [selRestaurant, setSelRestaurant] = useState(null);

  // forms
  const [showRestModal, setShowRestModal]   = useState(false);
  const [editRestId, setEditRestId]         = useState(null);
  const [restForm, setRestForm]             = useState({ name:"",shortCode:"",cnpj:"",address:"" });
  const [showMgrModal, setShowMgrModal]     = useState(false);
  const [editMgrId, setEditMgrId]           = useState(null);
  const [mgrForm, setMgrForm]               = useState({ name:"",cpf:"",pin:"",restaurantIds:[],perms:{tips:true,schedule:true},isDP:false });
  const [showSuperModal, setShowSuperModal] = useState(false);
  const [editSuperId, setEditSuperId]       = useState(null);
  const [superForm, setSuperForm]           = useState({ name:"",cpf:"",pin:"" });

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
  function saveSuper() {
    if (!superForm.name.trim()||!superForm.pin.trim()) return;
    const s = { ...superForm, id: editSuperId ?? Date.now().toString() };
    onUpdate("superManagers", editSuperId ? superManagers.map(x=>x.id===editSuperId?s:x) : [...superManagers,s]);
    setShowSuperModal(false);
  }

  const ac = "#f5c842";
  const TABS = [["restaurants","🏢 Restaurantes"],["managers","👔 Gestores"],["superManagers","⭐ Super Gestores"]];

  if (selRestaurant) {
    const rest = restaurants.find(r => r.id === selRestaurant);
    return (
      <div style={{ minHeight:"100vh", background:"var(--bg)", fontFamily:"DM Mono,monospace" }}>
        <div style={{ background:"var(--bg1)", borderBottom:"1px solid var(--border)", padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <button onClick={()=>setSelRestaurant(null)} style={{ ...S.btnSecondary, fontSize:12, padding:"6px 12px" }}>← Voltar</button>
            <span style={{ color:"var(--text3)", fontSize:12 }}>⭐ {currentUser?.name}</span>
          </div>
          <button onClick={onBack} style={{ ...S.btnSecondary, fontSize:12 }}>Sair</button>
        </div>
        <RestaurantPanel restaurant={rest} restaurants={restaurants} employees={employees} roles={roles} tips={tips} splits={splits} schedules={schedules} onUpdate={onUpdate} perms={{ tips:true, schedule:true }} isSuperManager data={data} />
      </div>
    );
  }

  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", fontFamily:"DM Mono,monospace" }}>
      <div style={{ background:"var(--bg1)", borderBottom:"1px solid var(--border)", padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:18 }}>⭐</span>
          <span style={{ color:ac, fontWeight:700 }}>Super Gestor</span>
          <span style={{ color:"var(--text3)", fontSize:12 }}>· {currentUser?.name}</span>
        </div>
        <button onClick={onBack} style={{ ...S.btnSecondary, fontSize:12 }}>Sair</button>
      </div>
      <div style={{ display:"flex", borderBottom:"1px solid var(--border)", background:"var(--bg1)", overflowX:"auto" }}>
        {TABS.map(([id,lbl])=>(
          <button key={id} onClick={()=>setTab(id)} style={{ padding:"12px 16px", background:"none", border:"none", borderBottom:`2px solid ${tab===id?ac:"transparent"}`, color:tab===id?ac:"#555", cursor:"pointer", fontSize:13, fontFamily:"DM Mono,monospace", fontWeight:tab===id?700:400, whiteSpace:"nowrap" }}>{lbl}</button>
        ))}
      </div>

      <div style={{ padding:"20px 24px" }}>

        {/* RESTAURANTES */}
        {tab === "restaurants" && (
          <div>
            <button onClick={()=>{setEditRestId(null);setRestForm({name:"",cnpj:"",address:""});setShowRestModal(true);}} style={{...S.btnPrimary,marginBottom:20}}>+ Novo Restaurante</button>
            {restaurants.length === 0 && <p style={{color:"var(--text3)",textAlign:"center"}}>Nenhum restaurante cadastrado.</p>}
            {restaurants.map(r => {
              const empCount = employees.filter(e=>e.restaurantId===r.id).length;
              const mgrCount = managers.filter(m=>m.restaurantIds?.includes(r.id)).length;
              return (
                <div key={r.id} style={{...S.card,marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div>
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{color:"#f5c842",fontWeight:700,fontSize:13,background:"#f5c84222",borderRadius:6,padding:"2px 8px"}}>{r.shortCode||"—"}</span>
                      <span style={{color:"var(--text)",fontWeight:700,fontSize:16}}>{r.name}</span>
                    </div>
                      {r.cnpj && <div style={{color:"var(--text3)",fontSize:12}}>CNPJ: {r.cnpj}</div>}
                      {r.address && <div style={{color:"var(--text3)",fontSize:12}}>{r.address}</div>}
                      <div style={{marginTop:6,color:"var(--text3)",fontSize:12}}>{empCount} empregado{empCount!==1?"s":""} · {mgrCount} gestor{mgrCount!==1?"es":""}</div>
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
                      <button onClick={()=>setSelRestaurant(r.id)} style={{...S.btnSecondary,fontSize:12,color:ac,borderColor:ac}}>Abrir →</button>
                      <button onClick={()=>{setEditRestId(r.id);setRestForm({name:r.name,shortCode:r.shortCode??"",cnpj:r.cnpj??"",address:r.address??""});setShowRestModal(true);}} style={{...S.btnSecondary,fontSize:12}}>Editar</button>
                      <button onClick={()=>{
                        if(!window.confirm(`Tem certeza que deseja EXCLUIR o restaurante "${r.name}"? Esta ação não pode ser desfeita.`)) return;
                        const saveData = window.confirm("Deseja baixar os dados do restaurante (gorjetas e empregados) antes de excluir?");
                        if(saveData) {
                          // Export basic data as JSON text for safety
                          const data = {
                            restaurante: r,
                            empregados: employees.filter(e=>e.restaurantId===r.id),
                            gorjetas: tips.filter(t=>t.restaurantId===r.id),
                            cargos: roles.filter(ro=>ro.restaurantId===r.id),
                          };
                          const blob = new Blob([JSON.stringify(data, null, 2)], {type:"application/json"});
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href=url; a.download=`backup_${r.shortCode||r.id}_${today()}.json`; a.click();
                          URL.revokeObjectURL(url);
                        }
                        onUpdate("restaurants",restaurants.filter(x=>x.id!==r.id));
                        onUpdate("_toast","Restaurante excluído.");
                      }} style={{background:"none",border:"1px solid #e74c3c33",borderRadius:8,color:"#e74c3c",cursor:"pointer",fontSize:12,padding:"6px 12px",fontFamily:"DM Mono,monospace"}}>✕</button>
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
            <button onClick={()=>{setEditMgrId(null);setMgrForm({name:"",cpf:"",pin:"",restaurantIds:[],perms:{tips:true,schedule:true},isDP:false});setShowMgrModal(true);}} style={{...S.btnPrimary,marginBottom:20}}>+ Novo Gestor</button>
            {managers.length === 0 && <p style={{color:"var(--text3)",textAlign:"center"}}>Nenhum gestor cadastrado.</p>}
            {managers.map(m=>(
              <div key={m.id} style={{...S.card,marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div>
                    <div style={{color:"var(--text)",fontWeight:600,fontSize:15}}>{m.name}</div>
                    <div style={{color:"var(--text3)",fontSize:12}}>CPF: {m.cpf||"—"}</div>
                    <div style={{marginTop:6,display:"flex",gap:6,flexWrap:"wrap"}}>
      {[["tips","Gorjetas"],["schedule","Escala"],["comunicados","Comuns."],["faq","FAQ"],["dp","DP"],["horarios","Horários"]].map(([k,lbl])=><PermBadge key={k} label={lbl} on={m.perms?.[k]!==false}/>)}{m.isDP&&<span style={{background:"#3b82f622",color:"#3b82f6",borderRadius:6,padding:"2px 10px",fontSize:11,fontWeight:700}}>📬 DP</span>}
                    </div>
                    <div style={{marginTop:6,display:"flex",gap:4,flexWrap:"wrap"}}>
                      {(m.restaurantIds??[]).map(rid=>{const r=restaurants.find(x=>x.id===rid);return r?<span key={rid} style={{background:"var(--bg4)",color:"var(--text2)",borderRadius:6,padding:"2px 8px",fontSize:11}}>{r.name}</span>:null;})}
                      {(!m.restaurantIds||m.restaurantIds.length===0)&&<span style={{color:"var(--text3)",fontSize:12}}>Sem restaurantes</span>}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>{setEditMgrId(m.id);setMgrForm({name:m.name,cpf:m.cpf??"",pin:m.pin??"",restaurantIds:m.restaurantIds??[],perms:m.perms??{tips:true,schedule:true},isDP:m.isDP??false});setShowMgrModal(true);}} style={{...S.btnSecondary,fontSize:12}}>Editar</button>
                    <button onClick={()=>onUpdate("managers",managers.filter(x=>x.id!==m.id))} style={{background:"none",border:"1px solid #e74c3c33",borderRadius:8,color:"#e74c3c",cursor:"pointer",fontSize:12,padding:"6px 12px",fontFamily:"DM Mono,monospace"}}>✕</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* SUPER GESTORES */}
        {tab === "superManagers" && (
          <div>
            <button onClick={()=>{setEditSuperId(null);setSuperForm({name:"",cpf:"",pin:""});setShowSuperModal(true);}} style={{...S.btnPrimary,marginBottom:20}}>+ Novo Super Gestor</button>
            {superManagers.map(s=>(
              <div key={s.id} style={{...S.card,marginBottom:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{color:"var(--text)",fontWeight:600}}>{s.name}</div>
                  <div style={{color:"var(--text3)",fontSize:12}}>CPF: {s.cpf||"—"}</div>
                  {s.id===currentUser?.id&&<span style={{color:ac,fontSize:11}}>← você</span>}
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>{setEditSuperId(s.id);setSuperForm({name:s.name,cpf:s.cpf??"",pin:s.pin??""});setShowSuperModal(true);}} style={{...S.btnSecondary,fontSize:12}}>Editar</button>
                  {superManagers.length>1&&<button onClick={()=>onUpdate("superManagers",superManagers.filter(x=>x.id!==s.id))} style={{background:"none",border:"1px solid #e74c3c33",borderRadius:8,color:"#e74c3c",cursor:"pointer",fontSize:12,padding:"6px 12px",fontFamily:"DM Mono,monospace"}}>✕</button>}
                </div>
              </div>
            ))}
          </div>
        )}
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
            <button onClick={saveRest} style={S.btnPrimary}>{editRestId?"Salvar":"Cadastrar"}</button>
          </div>
        </Modal>
      )}

      {showMgrModal && (
        <Modal title={editMgrId?"Editar Gestor":"Novo Gestor"} onClose={()=>setShowMgrModal(false)} wide>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div><label style={S.label}>Nome completo</label><input value={mgrForm.name} onChange={e=>setMgrForm({...mgrForm,name:e.target.value})} style={S.input}/></div>
              <div><label style={S.label}>CPF (opcional)</label><input value={mgrForm.cpf} onChange={e=>setMgrForm({...mgrForm,cpf:e.target.value})} placeholder="000.000.000-00" style={S.input} inputMode="numeric"/></div>
            </div>
            <div><label style={S.label}>PIN (4–6 dígitos)</label><input type="password" value={mgrForm.pin} onChange={e=>setMgrForm({...mgrForm,pin:e.target.value})} maxLength={6} style={S.input}/></div>

            <div>
              <label style={S.label}>Permissões de acesso às abas</label>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                {[["tips","💸 Gorjetas"],["schedule","📅 Escala"],["comunicados","📢 Comunicados"],["faq","❓ FAQ"],["dp","💬 Fale c/ DP"],["horarios","🕐 Horários"]].map(([k,lbl])=>{
                  const on = mgrForm.perms?.[k] !== false;
                  return (
                    <button key={k} onClick={()=>setMgrForm({...mgrForm,perms:{...mgrForm.perms,[k]:!on}})}
                      style={{padding:"10px",borderRadius:10,border:`1px solid ${on?"#10b981":"#2a2a2a"}`,background:on?"#10b98122":"transparent",color:on?"#10b981":"#555",cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:12,textAlign:"left"}}>
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
                      style={{padding:"10px 14px",borderRadius:10,border:`1px solid ${sel?"#f5c842":"#2a2a2a"}`,background:sel?"#f5c84222":"transparent",color:sel?"#f5c842":"#555",cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:13,textAlign:"left"}}>
                      {sel?"✓":"○"} {r.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <button onClick={saveMgr} style={S.btnPrimary}>{editMgrId?"Salvar":"Criar Gestor"}</button>
          </div>
        </Modal>
      )}

      {showSuperModal && (
        <Modal title={editSuperId?"Editar Super Gestor":"Novo Super Gestor"} onClose={()=>setShowSuperModal(false)}>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div><label style={S.label}>Nome completo</label><input value={superForm.name} onChange={e=>setSuperForm({...superForm,name:e.target.value})} style={S.input}/></div>
            <div><label style={S.label}>CPF</label><input value={superForm.cpf} onChange={e=>setSuperForm({...superForm,cpf:e.target.value})} placeholder="000.000.000-00" style={S.input} inputMode="numeric"/></div>
            <div><label style={S.label}>PIN (4–6 dígitos)</label><input type="password" value={superForm.pin} onChange={e=>setSuperForm({...superForm,pin:e.target.value})} maxLength={6} style={S.input}/></div>
            <button onClick={saveSuper} style={S.btnPrimary}>{editSuperId?"Salvar":"Criar"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

//
// MANAGER PORTAL (regular manager, single or multi restaurant)
//
function ManagerPortal({ manager, data, onUpdate, onBack }) {
  const { restaurants, employees, roles, tips, splits, schedules } = data;
  const myRestaurants = restaurants.filter(r => manager.restaurantIds?.includes(r.id));
  const [selId, setSelId] = useState(myRestaurants.length === 1 ? myRestaurants[0].id : null);
  const ac = "#f5c842";

  const selRest = myRestaurants.find(r => r.id === selId);

  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", fontFamily:"DM Mono,monospace" }}>
      <div style={{ background:"var(--bg1)", borderBottom:"1px solid var(--border)", padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{fontSize:18}}>📊</span>
          <span style={{color:ac,fontWeight:700}}>Gestor</span>
          <span style={{color:"var(--text3)",fontSize:12}}>· {manager.name}</span>
        </div>
        <button onClick={onBack} style={{...S.btnSecondary,fontSize:12}}>Sair</button>
      </div>

      {/* Restaurant picker if multiple */}
      {!selId && (
        <div style={{padding:"40px 20px",maxWidth:480,margin:"0 auto"}}>
          <p style={{color:"var(--text3)",fontSize:13,marginBottom:20,textAlign:"center"}}>Selecione o restaurante</p>
          {myRestaurants.length === 0 && <p style={{color:"var(--text3)",textAlign:"center"}}>Nenhum restaurante atribuído.</p>}
          {myRestaurants.map(r=>(
            <button key={r.id} onClick={()=>setSelId(r.id)} style={{...S.card,width:"100%",cursor:"pointer",textAlign:"left",display:"block",marginBottom:10,border:"1px solid var(--border)"}}>
              <div style={{color:"var(--text)",fontWeight:600,fontSize:15}}>{r.name}</div>
              {r.address&&<div style={{color:"var(--text3)",fontSize:12}}>{r.address}</div>}
              <div style={{marginTop:6,display:"flex",gap:6}}>
                {[["tips","Gorjetas"],["schedule","Escala"],["comunicados","Comuns."],["faq","FAQ"],["dp","DP"]].map(([k,lbl])=><PermBadge key={k} label={lbl} on={manager.perms?.[k]!==false}/>)}
              </div>
            </button>
          ))}
        </div>
      )}

      {selId && selRest && (
        <div>
          {myRestaurants.length > 1 && (
            <div style={{padding:"10px 16px",background:"var(--bg5)",borderBottom:"1px solid var(--border)"}}>
              <button onClick={()=>setSelId(null)} style={{...S.btnSecondary,fontSize:12,padding:"4px 12px"}}>← Trocar restaurante</button>
            </div>
          )}
          <RestaurantPanel restaurant={selRest} restaurants={restaurants} employees={employees} roles={roles} tips={tips} splits={splits} schedules={schedules} onUpdate={onUpdate} perms={{...(manager.perms ?? {tips:true,schedule:true}), isDP: manager.isDP ?? false}} isSuperManager={false} data={data}/>
        </div>
      )}
    </div>
  );
}

//
// LOGIN
//
function LoginScreen({ superManagers, managers, onLoginSuper, onLoginManager, onBack, onSetupFirst }) {
  const [role, setRole] = useState("manager"); // "manager" | "super"
  const [cpf, setCpf]   = useState("");
  const [pin, setPin]   = useState("");
  const [err, setErr]   = useState("");
  const ac = "#f5c842";

  function tryLogin() {
    const clean = cpf.replace(/\D/g,"");
    if (role === "super") {
      const u = superManagers.find(s => s.cpf?.replace(/\D/g,"")===clean && String(s.pin)===String(pin));
      if (u) { setErr(""); onLoginSuper(u); }
      else setErr("CPF ou PIN incorretos.");
    } else {
      const u = managers.find(m => m.cpf?.replace(/\D/g,"")===clean && String(m.pin)===String(pin));
      if (u) { setErr(""); onLoginManager(u); }
      else setErr("CPF ou PIN incorretos.");
    }
  }

  return (
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"DM Mono,monospace",padding:24}}>
      <div style={{...S.card,maxWidth:360,width:"100%"}}>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:32}}>{role==="super"?"⭐":"📊"}</div>
          <h2 style={{color:ac,margin:"8px 0 4px"}}>{role==="super"?"Super Gestor":"Gestor"}</h2>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:20}}>
          {[["manager","Gestor"],["super","Super Gestor"]].map(([r,lbl])=>(
            <button key={r} onClick={()=>{setRole(r);setErr("");}} style={{flex:1,padding:"8px",borderRadius:10,border:`1px solid ${role===r?ac:"#2a2a2a"}`,background:role===r?ac+"22":"transparent",color:role===r?ac:"#555",cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:12,fontWeight:role===r?700:400}}>{lbl}</button>
          ))}
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:14}}>
          <div><label style={S.label}>CPF</label><input value={cpf} onChange={e=>setCpf(e.target.value)} placeholder="000.000.000-00" style={S.input} inputMode="numeric"/></div>
          <div><label style={S.label}>PIN</label><input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={e=>setPin(e.target.value)} placeholder="••••" style={{...S.input,letterSpacing:6,fontSize:18,textAlign:"center"}} onKeyDown={e=>e.key==="Enter"&&tryLogin()}/></div>
        </div>
        {err && <p style={{color:"#e74c3c",fontSize:13,marginBottom:10}}>{err}</p>}
        <button onClick={tryLogin} style={{...S.btnPrimary,marginBottom:10}}>Entrar</button>
        {superManagers.length===0&&<button onClick={onSetupFirst} style={{...S.btnSecondary,width:"100%",textAlign:"center",marginBottom:10}}>Criar primeiro Super Gestor</button>}
        <button onClick={onBack} style={{...S.btnSecondary,width:"100%",textAlign:"center"}}>← Voltar</button>
      </div>
    </div>
  );
}

//
// FIRST SETUP
//
function FirstSetup({ onDone }) {
  const [form, setForm] = useState({ name:"",cpf:"",pin:"",pin2:"" });
  const [err, setErr] = useState("");
  function submit() {
    if (!form.name.trim()) { setErr("Informe o nome."); return; }
    if (!form.cpf.trim()) { setErr("Informe o CPF."); return; }
    if (form.pin.length < 4) { setErr("PIN deve ter ao menos 4 dígitos."); return; }
    if (form.pin !== form.pin2) { setErr("PINs não coincidem."); return; }
    onDone({ id: Date.now().toString(), name: form.name.trim(), cpf: form.cpf.trim(), pin: form.pin });
  }
  return (
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"DM Mono,monospace",padding:24}}>
      <div style={{...S.card,maxWidth:360,width:"100%"}}>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:40}}>🍽️</div>
          <h2 style={{color:"#f5c842",margin:"8px 0 4px"}}>Bem-vindo!</h2>
          <p style={{color:"var(--text3)",fontSize:13}}>Cadastre o primeiro Super Gestor para começar.</p>
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div><label style={S.label}>Nome completo</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} style={S.input}/></div>
          <div><label style={S.label}>CPF</label><input value={form.cpf} onChange={e=>setForm({...form,cpf:e.target.value})} placeholder="000.000.000-00" style={S.input} inputMode="numeric"/></div>
          <div><label style={S.label}>PIN (4–6 dígitos)</label><input type="password" maxLength={6} value={form.pin} onChange={e=>setForm({...form,pin:e.target.value})} style={S.input}/></div>
          <div><label style={S.label}>Confirmar PIN</label><input type="password" maxLength={6} value={form.pin2} onChange={e=>setForm({...form,pin2:e.target.value})} style={S.input} onKeyDown={e=>e.key==="Enter"&&submit()}/></div>
          {err && <p style={{color:"#e74c3c",fontSize:13,margin:0}}>{err}</p>}
          <button onClick={submit} style={S.btnPrimary}>Criar e Entrar</button>
        </div>
      </div>
    </div>
  );
}

//
// HOME
//
function Home({ onManager, onEmployee }) {
  return (
    <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"DM Mono,monospace",padding:24}}>
      <div style={{fontSize:52,marginBottom:10}}>🍽️</div>
      <h1 style={{color:"#f5c842",fontSize:28,fontWeight:700,margin:"0 0 4px",letterSpacing:-1}}>GorjetaApp</h1>
      <p style={{color:"var(--text3)",fontSize:13,marginBottom:48,textAlign:"center"}}>Gestão transparente de gorjetas</p>
      <div style={{display:"flex",flexDirection:"column",gap:14,width:"100%",maxWidth:300}}>
        <button onClick={onManager} style={{...S.btnPrimary,padding:"18px",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>📊 Área de Gestão</button>
        <button onClick={onEmployee} style={{padding:"18px",borderRadius:16,border:"2px solid #2a2a2a",background:"transparent",color:"var(--text)",fontWeight:600,fontSize:16,cursor:"pointer",fontFamily:"DM Mono,monospace",display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>👤 Área do Empregado</button>
      </div>
    </div>
  );
}

//
// APP ROOT
//
export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");

  useEffect(() => {
    document.body.classList.toggle("light-mode", theme === "light");
    localStorage.setItem("theme", theme);
  }, [theme]);

  function toggleTheme() { setTheme(t => t === "dark" ? "light" : "dark"); }
  const [view, setView] = useState("home");
  const [loaded, setLoaded] = useState(false);
  const [toast, setToast] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  // eslint-disable-next-line no-unused-vars
  const [userRole, setUserRole] = useState(null);

  const [superManagers, setSuperManagers] = useState([]);
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

  useEffect(() => {
    (async () => {
      const vals = await Promise.all(Object.values(K).map(load));
      const keys = Object.keys(K);
      const map = { superManagers:setSuperManagers, managers:setManagers, restaurants:setRestaurants, employees:setEmployees, roles:setRoles, tips:setTips, splits:setSplits, schedules:setSchedules, communications:setCommunications, commAcks:setCommAcks, faq:setFaq, dpMessages:setDpMessages, workSchedules:setWorkSchedules, notifications:setNotifications };
      keys.filter(k => k !== "receipts").forEach((k, i) => { if (vals[i]) map[k]?.(vals[i]); });
      // Load receipts from separate collection
      const recs = await loadReceipts();
      if (recs.length) setReceipts(recs);
      setLoaded(true);
    })();
  }, []);

  const data = { superManagers, managers, restaurants, employees, roles, tips, splits, schedules, communications, commAcks, faq, dpMessages, receipts, workSchedules, notifications };

  async function handleUpdate(field, value) {
    if (field === "_toast") { setToast(value); return; }
    if (field === "receipts") {
      // Save each receipt as separate Firestore document
      const prev = receipts;
      setReceipts(value);
      // Find new/updated receipts
      const prevIds = new Set(prev.map(r => r.id));
      const newOnes = value.filter(r => !prevIds.has(r.id));
      // Find deleted receipts
      const newIds = new Set(value.map(r => r.id));
      const deleted = prev.filter(r => !newIds.has(r.id));
      // Find updated (empId changed - manual assignment)
      const updated = value.filter(r => {
        const old = prev.find(p => p.id === r.id);
        return old && old.empId !== r.empId;
      });
      await Promise.all([
        ...newOnes.map(r => saveReceipt(r)),
        ...updated.map(r => saveReceipt(r)),
        ...deleted.map(r => deleteReceipt(r.id)),
      ]);
      setToast("Recibos atualizados");
      return;
    }
    const setters = { superManagers:setSuperManagers, managers:setManagers, restaurants:setRestaurants, employees:setEmployees, roles:setRoles, tips:setTips, splits:setSplits, schedules:setSchedules, communications:setCommunications, commAcks:setCommAcks, faq:setFaq, dpMessages:setDpMessages, workSchedules:setWorkSchedules, notifications:setNotifications };
    const keys    = { superManagers:K.superManagers, managers:K.managers, restaurants:K.restaurants, employees:K.employees, roles:K.roles, tips:K.tips, splits:K.splits, schedules:K.schedules, communications:K.communications, commAcks:K.commAcks, faq:K.faq, dpMessages:K.dpMessages, workSchedules:K.workSchedules, notifications:K.notifications };
    setters[field]?.(value);
    await save(keys[field], value);
    const labels = { superManagers:"Super Gestores atualizados", managers:"Gestores atualizados", restaurants:"Restaurantes atualizados", employees:"Empregados atualizados", roles:"Cargos atualizados", tips:"Gorjetas atualizadas", splits:"Percentuais salvos", schedules:"Escala atualizada", communications:"Comunicados atualizados", commAcks:"Ciências atualizadas", faq:"FAQ atualizado", dpMessages:"Mensagem enviada", workSchedules:"Horários salvos", notifications:"Notificações atualizadas" };
    setToast(labels[field] ?? "Salvo!");
  }

  function doLogout() { setCurrentUser(null); setUserRole(null); setView("home"); }

  if (!loaded) return <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",color:"#f5c842",fontFamily:"DM Mono,monospace",fontSize:18}}>Carregando…</div>;

  // Theme toggle button - fixed position
  const ThemeBtn = () => (
    <button onClick={toggleTheme} style={{position:"fixed",bottom:24,right:24,zIndex:9990,width:42,height:42,borderRadius:"50%",border:"1px solid var(--border)",background:"var(--card-bg)",color:"var(--text2)",cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 2px 12px rgba(0,0,0,.2)"}}>
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );

  return (
    <>
      <ThemeBtn />
      {view === "home"     && <Home onManager={()=>setView("login")} onEmployee={()=>setView("employee")} />}
      {view === "setup"    && <FirstSetup onDone={sm=>{handleUpdate("superManagers",[sm]);setCurrentUser(sm);setUserRole("super");setView("super");}} />}
      {view === "login"    && (
        <LoginScreen
          superManagers={superManagers} managers={managers}
          onLoginSuper={u=>{setCurrentUser(u);setUserRole("super");setView("super");}}
          onLoginManager={u=>{setCurrentUser(u);setUserRole("manager");setView("manager");}}
          onBack={()=>setView("home")}
          onSetupFirst={()=>setView("setup")}
        />
      )}
      {view === "super"    && <SuperManagerPortal data={data} onUpdate={handleUpdate} onBack={doLogout} currentUser={currentUser} />}
      {view === "manager"  && <ManagerPortal manager={currentUser} data={data} onUpdate={handleUpdate} onBack={doLogout} />}
      {view === "employee" && <EmployeePortal employees={employees} roles={roles} tips={tips} schedules={schedules} restaurants={restaurants} communications={communications} commAcks={commAcks} faq={faq} dpMessages={dpMessages} receipts={receipts} workSchedules={workSchedules} onBack={()=>setView("home")} onUpdateEmployee={emp=>{const next=employees.map(e=>e.id===emp.id?emp:e);handleUpdate("employees",next);}} onUpdate={handleUpdate} />}
      <Toast msg={toast} onClose={()=>setToast("")} />
    </>
  );
}
