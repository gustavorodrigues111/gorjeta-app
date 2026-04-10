import { useState, useEffect } from "react";
import { db } from "./firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

// ─── Storage (Firebase Firestore) ────────────────────────────────────────────
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

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmt = (v) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);
const fmtBR = (v) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v ?? 0);
const fmtDate = (d) => d ? new Date(d + "T12:00:00").toLocaleDateString("pt-BR") : "—";
const today = () => new Date().toISOString().slice(0, 10);
const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
const monthLabel = (y, m) => new Date(y, m, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const AREAS = ["Bar", "Cozinha", "Salão", "Limpeza"];
const AREA_COLORS = { Bar: "#3b82f6", Cozinha: "#f59e0b", Salão: "#10b981", Limpeza: "#8b5cf6" };
const DEFAULT_SPLIT = { Bar: 12, Cozinha: 40, Salão: 40, Limpeza: 8 };
const TAX = 0.33;
const DAY_OFF = "off";
const DAY_COMP = "comp";

// Division mode constants
const MODE_AREA_POINTS = "area_points"; // default: split by area % then by points within area
const MODE_GLOBAL_POINTS = "global_points"; // split only by total points across all employees

// ─── Storage keys (all data scoped by restaurantId where relevant) ─────────────
const K = {
  superManagers: "v4:superManagers",   // [{id, name, cpf, pin}]
  managers:      "v4:managers",        // [{id, name, cpf, pin, restaurantIds:[], perms:{tips,schedule}}]
  restaurants:   "v4:restaurants",     // [{id, name, cnpj, address, divisionMode}]
  employees:     "v4:employees",       // [{id, restaurantId, name, cpf, pin, roleId, admission}]
  roles:         "v4:roles",           // [{id, restaurantId, name, area, points}]
  tips:          "v4:tips",            // [{id, restaurantId, employeeId, date, monthKey, ...}]
  splits:        "v4:splits",          // {restaurantId: {"2026-04": {Bar:12,...}}}
  schedules:     "v4:schedules",       // {restaurantId: {"2026-04": {empId: {"2026-04-01": "off"}}}}
};

// ─── Shared styles ────────────────────────────────────────────────────────────
const S = {
  input: { width: "100%", boxSizing: "border-box", padding: "11px 14px", borderRadius: 10, border: "1px solid #2a2a2a", background: "#111", color: "#fff", fontSize: 14, fontFamily: "DM Mono,monospace", outline: "none" },
  btnPrimary: { width: "100%", padding: "12px", borderRadius: 12, background: "#f5c842", border: "none", color: "#111", fontWeight: 700, fontSize: 14, cursor: "pointer", fontFamily: "DM Mono,monospace" },
  btnSecondary: { padding: "8px 18px", borderRadius: 10, border: "1px solid #2a2a2a", background: "transparent", color: "#aaa", cursor: "pointer", fontFamily: "DM Mono,monospace", fontSize: 13 },
  card: { background: "#1a1a1a", borderRadius: 16, padding: "18px 20px", border: "1px solid #2a2a2a" },
  label: { color: "#555", fontSize: 12, marginBottom: 4, display: "block" },
};

// ─── Shared UI ────────────────────────────────────────────────────────────────
function Toast({ msg, onClose }) {
  useEffect(() => { if (msg) { const t = setTimeout(onClose, 3200); return () => clearTimeout(t); } }, [msg, onClose]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!msg) return null;
  return <div style={{ position: "fixed", bottom: 32, left: "50%", transform: "translateX(-50%)", background: "#1a1a1a", color: "#f5c842", padding: "12px 28px", borderRadius: 40, fontFamily: "DM Mono,monospace", fontSize: 14, boxShadow: "0 8px 32px rgba(0,0,0,.5)", zIndex: 9999, letterSpacing: 1, whiteSpace: "nowrap" }}>{msg}</div>;
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.8)", zIndex: 8000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, overflowY: "auto" }}>
      <div style={{ background: "#1a1a1a", borderRadius: 20, padding: 28, width: "100%", maxWidth: wide ? 680 : 480, border: "1px solid #2a2a2a", maxHeight: "92vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h3 style={{ color: "#f5c842", margin: 0, fontFamily: "DM Mono,monospace", fontSize: 16 }}>{title}</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", fontSize: 20, cursor: "pointer" }}>✕</button>
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
      <span style={{ color: "#fff", fontFamily: "DM Mono,monospace", fontSize: 14, minWidth: 140, textAlign: "center", textTransform: "capitalize" }}>{monthLabel(year, month)}</span>
      <button onClick={next} style={{ ...S.btnSecondary, padding: "6px 12px" }}>›</button>
    </div>
  );
}

function PermBadge({ label, on }) {
  return <span style={{ background: on ? "#10b98122" : "#e74c3c22", color: on ? "#10b981" : "#e74c3c", borderRadius: 6, padding: "2px 10px", fontSize: 11, fontWeight: 700 }}>{on ? "✓" : "✗"} {label}</span>;
}

// ─── Calendar ─────────────────────────────────────────────────────────────────
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
    if (s === DAY_OFF)  return { bg: "#e74c3c22", border: "#e74c3c", text: "#e74c3c" };
    if (s === DAY_COMP) return { bg: "#3b82f622", border: "#3b82f6", text: "#3b82f6" };
    return { bg: "#10b98122", border: "#10b981", text: "#10b981" };
  };

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 3, marginBottom: 3 }}>
        {WEEKDAYS.map(w => <div key={w} style={{ textAlign: "center", color: "#555", fontSize: 10, fontFamily: "DM Mono,monospace", padding: "4px 0" }}>{w}</div>)}
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
      <div style={{ display: "flex", gap: 14, marginTop: 14, flexWrap: "wrap" }}>
        {[["#10b981", "Trabalho"], ["#e74c3c", "Folga"], ["#3b82f6", "Comp. banco"]].map(([c, lbl]) => (
          <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: c + "33", border: `1px solid ${c}` }} />
            <span style={{ color: "#555", fontSize: 11, fontFamily: "DM Mono,monospace" }}>{lbl}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScheduleCalendar({ empId, restaurantId, year, month, schedules, onUpdate }) {
  const mk = monthKey(year, month);
  const dayMap = schedules?.[restaurantId]?.[mk]?.[empId] ?? {};
  function cycleDay(dateStr) {
    const cur = dayMap[dateStr];
    let next = !cur ? DAY_OFF : cur === DAY_OFF ? DAY_COMP : null;
    const newMap = { ...dayMap };
    if (next === null) delete newMap[dateStr]; else newMap[dateStr] = next;
    onUpdate("schedules", {
      ...schedules,
      [restaurantId]: { ...(schedules?.[restaurantId] ?? {}), [mk]: { ...(schedules?.[restaurantId]?.[mk] ?? {}), [empId]: newMap } }
    });
  }
  return <CalendarGrid year={year} month={month} dayMap={dayMap} onDayClick={cycleDay} />;
}

// ─── Script loader ────────────────────────────────────────────────────────────
function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

// ─── Export Modal ─────────────────────────────────────────────────────────────
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
          <div style={{ background: "#111", borderRadius: 10, padding: 12, fontSize: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#aaa", marginBottom: 3 }}><span>Dias com gorjeta</span><span style={{ color: "#fff" }}>{preview.dias}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#aaa", marginBottom: 3 }}><span>Empregados</span><span style={{ color: "#fff" }}>{preview.emps}</span></div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "#aaa" }}><span>Total bruto</span><span style={{ color: "#f5c842", fontWeight: 700 }}>{fmt(preview.total)}</span></div>
          </div>
        )}
        {status === "loading" && <p style={{ color: "#f5c842", textAlign: "center", fontSize: 13 }}>⏳ Gerando arquivo…</p>}
        {status === "done"    && <p style={{ color: "#10b981", textAlign: "center", fontSize: 13 }}>✅ Arquivo salvo nos seus downloads!</p>}
        {status === "error"   && <p style={{ color: "#e74c3c", textAlign: "center", fontSize: 13 }}>❌ Erro ao gerar. Tente novamente.</p>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <button onClick={exportExcel} disabled={status === "loading" || !preview} style={{ ...S.btnPrimary, background: "#217346", color: "#fff", opacity: !preview ? 0.5 : 1 }}>📊 Excel</button>
          <button onClick={exportPDF}   disabled={status === "loading" || !preview} style={{ ...S.btnPrimary, background: "#c0392b", color: "#fff", opacity: !preview ? 0.5 : 1 }}>📄 PDF</button>
        </div>
        <button onClick={onClose} style={{ ...S.btnSecondary, textAlign: "center" }}>Fechar</button>
      </div>
    </Modal>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// EMPLOYEE PORTAL
// ══════════════════════════════════════════════════════════════════════════════
function EmployeePortal({ employees, roles, tips, schedules, restaurants, onBack }) {
  const [cpf, setCpf] = useState("");
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [empId, setEmpId] = useState(null);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [tab, setTab] = useState("extrato");

  const emp = employees.find(e => e.id === empId);
  const role = emp ? roles.find(r => r.id === emp.roleId) : null;
  const restaurant = emp ? restaurants.find(r => r.id === emp.restaurantId) : null;

  function tryLogin() {
    const cleanCpf = cpf.replace(/\D/g, "");
    const found = employees.find(e => e.cpf?.replace(/\D/g, "") === cleanCpf && String(e.pin) === String(pin));
    if (found) { setErr(""); setEmpId(found.id); }
    else setErr("CPF ou PIN incorretos.");
  }

  const mk = monthKey(year, month);
  const myTips = tips.filter(t => t.employeeId === empId && t.monthKey === mk);
  const grossTotal = myTips.reduce((a, t) => a + (t.myShare ?? 0), 0);
  const taxTotal   = myTips.reduce((a, t) => a + (t.myTax   ?? 0), 0);
  const netTotal   = myTips.reduce((a, t) => a + (t.myNet   ?? 0), 0);
  const dayMap = emp ? (schedules?.[emp.restaurantId]?.[mk]?.[empId] ?? {}) : {};
  const ac = "#f5c842"; const bg = "#0f0f0f";

  if (!empId) return (
    <div style={{ minHeight: "100vh", background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "DM Mono,monospace", padding: 24 }}>
      <div style={{ ...S.card, maxWidth: 340, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 8 }}>👤</div>
        <h2 style={{ color: ac, margin: "0 0 4px" }}>Área do Empregado</h2>
        <p style={{ color: "#555", fontSize: 13, marginBottom: 22 }}>Entre com CPF e PIN</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 14, textAlign: "left" }}>
          <div><label style={S.label}>CPF</label><input value={cpf} onChange={e => setCpf(e.target.value)} placeholder="000.000.000-00" style={S.input} inputMode="numeric" /></div>
          <div><label style={S.label}>PIN</label><input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={e => setPin(e.target.value)} placeholder="••••" style={{ ...S.input, letterSpacing: 6, fontSize: 18, textAlign: "center" }} onKeyDown={e => e.key === "Enter" && tryLogin()} /></div>
        </div>
        {err && <p style={{ color: "#e74c3c", fontSize: 13, marginBottom: 10 }}>{err}</p>}
        <button onClick={tryLogin} style={{ ...S.btnPrimary, marginBottom: 12 }}>Entrar</button>
        <button onClick={onBack} style={{ ...S.btnSecondary, width: "100%" }}>← Voltar</button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: bg, fontFamily: "DM Mono,monospace" }}>
      <div style={{ background: "#111", borderBottom: "1px solid #1e1e1e", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ color: ac, fontWeight: 700 }}>{emp?.name}</div>
          <div style={{ color: "#555", fontSize: 11 }}>{role?.name} · {restaurant?.name}</div>
        </div>
        <button onClick={() => { setEmpId(null); setCpf(""); setPin(""); }} style={{ ...S.btnSecondary, fontSize: 12 }}>Sair</button>
      </div>
      <div style={{ display: "flex", borderBottom: "1px solid #1e1e1e", background: "#111" }}>
        {[["extrato", "💸 Extrato"], ["escala", "📅 Minha Escala"]].map(([id, lbl]) => (
          <button key={id} onClick={() => setTab(id)} style={{ flex: 1, padding: "12px 0", background: "none", border: "none", borderBottom: `2px solid ${tab === id ? ac : "transparent"}`, color: tab === id ? ac : "#555", cursor: "pointer", fontSize: 13, fontFamily: "DM Mono,monospace", fontWeight: tab === id ? 700 : 400 }}>{lbl}</button>
        ))}
      </div>
      <div style={{ padding: "24px 20px", maxWidth: 540, margin: "0 auto" }}>
        <div style={{ marginBottom: 20 }}><MonthNav year={year} month={month} onChange={(y, m) => { setYear(y); setMonth(m); }} /></div>
        {tab === "extrato" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
              {[["Bruto", grossTotal, "#fff"], ["Imposto 33%", taxTotal, "#e74c3c"], ["Líquido", netTotal, ac]].map(([lbl, val, col]) => (
                <div key={lbl} style={{ ...S.card, textAlign: "center" }}>
                  <div style={{ color: "#555", fontSize: 10, marginBottom: 4 }}>{lbl}</div>
                  <div style={{ color: col, fontWeight: 700, fontSize: 14 }}>{fmt(val)}</div>
                </div>
              ))}
            </div>
            {myTips.length === 0 && <p style={{ color: "#555", textAlign: "center" }}>Nenhuma gorjeta neste mês.</p>}
            {[...myTips].reverse().map(t => (
              <div key={t.id} style={{ ...S.card, marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ color: "#aaa", fontSize: 13 }}>{fmtDate(t.date)}</span>
                  <span style={{ color: "#555", fontSize: 12 }}>Pool: {fmt(t.poolTotal)}</span>
                </div>
                <div style={{ background: "#111", borderRadius: 10, padding: 12, fontSize: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#aaa", marginBottom: 3 }}><span>Pool da área ({t.area})</span><span style={{ color: "#fff" }}>{fmt(t.areaPool)}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#aaa", marginBottom: 3 }}><span>Sua parte (bruto)</span><span style={{ color: "#fff" }}>{fmt(t.myShare)}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#aaa", marginBottom: 3 }}><span>Retenção fiscal (33%)</span><span style={{ color: "#e74c3c" }}>-{fmt(t.myTax)}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", color: "#aaa", borderTop: "1px solid #2a2a2a", paddingTop: 6, marginTop: 4 }}><span style={{ fontWeight: 700 }}>Valor líquido</span><span style={{ color: ac, fontWeight: 700 }}>{fmt(t.myNet)}</span></div>
                </div>
                {t.note && <div style={{ color: "#555", fontSize: 12, marginTop: 6 }}>📝 {t.note}</div>}
              </div>
            ))}
          </div>
        )}
        {tab === "escala" && (
          <div>
            <p style={{ color: "#555", fontSize: 13, marginBottom: 16, textTransform: "capitalize" }}>Sua escala em {monthLabel(year, month)}</p>
            <CalendarGrid year={year} month={month} dayMap={dayMap} readOnly />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 20 }}>
              {(() => {
                const dim = new Date(year, month + 1, 0).getDate();
                let work = 0, off = 0, comp = 0;
                for (let d = 1; d <= dim; d++) {
                  const k = `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
                  const s = dayMap[k];
                  if (s === DAY_OFF) off++; else if (s === DAY_COMP) comp++; else work++;
                }
                return [["Trabalho", work, "#10b981"], ["Folga", off, "#e74c3c"], ["Compensação", comp, "#3b82f6"]].map(([lbl, val, col]) => (
                  <div key={lbl} style={{ ...S.card, textAlign: "center" }}>
                    <div style={{ color: "#555", fontSize: 10, marginBottom: 4 }}>{lbl}</div>
                    <div style={{ color: col, fontWeight: 700, fontSize: 22 }}>{val}</div>
                    <div style={{ color: "#555", fontSize: 10 }}>dias</div>
                  </div>
                ));
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// RESTAURANT PANEL (shared by manager and super manager, with permission guard)
// ══════════════════════════════════════════════════════════════════════════════
function RestaurantPanel({ restaurant, restaurants, employees, roles, tips, splits, schedules, onUpdate, perms, isSuperManager }) {
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

  const restEmps  = employees.filter(e => e.restaurantId === rid);
  const restRoles = roles.filter(r => r.restaurantId === rid);

  // forms
  const [tipDate, setTipDate]   = useState(today());
  const [tipTotal, setTipTotal] = useState("");
  const [tipNote, setTipNote]   = useState("");
  const [showEmpModal, setShowEmpModal]   = useState(false);
  const [editEmpId, setEditEmpId]         = useState(null);
  const [empForm, setEmpForm]             = useState({ name: "", cpf: "", roleId: "", admission: today(), pin: "" });
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editRoleId, setEditRoleId]       = useState(null);
  const [roleForm, setRoleForm]           = useState({ name: "", area: "Salão", points: "1" });
  const [splitForm, setSplitForm]         = useState(null);
  const [schedArea, setSchedArea]         = useState("Salão");
  const [showExport, setShowExport]       = useState(false);

  const empSummary = restEmps.map(e => {
    const eT = monthTips.filter(t => t.employeeId === e.id);
    const r = restRoles.find(r => r.id === e.roleId);
    return { ...e, roleName: r?.name, area: r?.area, gross: eT.reduce((a, t) => a + t.myShare, 0), net: eT.reduce((a, t) => a + t.myNet, 0) };
  }).sort((a, b) => b.net - a.net);

  function calcTip() {
    const total = parseFloat(tipTotal);
    if (!total || isNaN(total) || total <= 0) return 0;
    const td = new Date(tipDate + "T12:00:00");
    const tKey = monthKey(td.getFullYear(), td.getMonth());
    const totalTaxAmt = total * TAX;
    const toDistribute = total - totalTaxAmt;
    const newTips = [];
    const mode = restaurant.divisionMode ?? MODE_AREA_POINTS;

    const activeEmps = restEmps.filter(emp => {
      const r = restRoles.find(r => r.id === emp.roleId);
      return r && (!emp.admission || emp.admission <= tipDate);
    }).map(emp => ({ ...emp, points: parseFloat(restRoles.find(r => r.id === emp.roleId)?.points) || 1, area: restRoles.find(r => r.id === emp.roleId)?.area }));

    if (mode === MODE_GLOBAL_POINTS) {
      // Mode 2: divide by total points of all employees, no area split
      const totalPoints = activeEmps.reduce((a, e) => a + e.points, 0);
      if (!totalPoints) return 0;
      activeEmps.forEach(emp => {
        const myGross    = total * (emp.points / totalPoints);
        const myTaxShare = totalTaxAmt * (emp.points / totalPoints);
        newTips.push({
          id: `${Date.now()}-${emp.id}-${Math.random().toString(36).slice(2,6)}`,
          restaurantId: rid, employeeId: emp.id, date: tipDate, monthKey: tKey,
          poolTotal: total, areaPool: toDistribute, area: emp.area ?? "—",
          myShare: myGross, myTax: myTaxShare, myNet: myGross - myTaxShare, note: tipNote,
        });
      });
    } else {
      // Mode 1 (default): split by area % then by points within area
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
            poolTotal: total, areaPool, area, myShare: myGross, myTax: myTaxShare, myNet: myGross - myTaxShare, note: tipNote,
          });
        });
      });
    }
    onUpdate("tips", [...tips, ...newTips]);
    setTipTotal(""); setTipNote("");
    return newTips.length;
  }

  function saveEmp() {
    if (!empForm.name.trim()) return;
    const e = { ...empForm, restaurantId: rid, id: editEmpId ?? Date.now().toString() };
    onUpdate("employees", editEmpId ? employees.map(x => x.id === editEmpId ? e : x) : [...employees, e]);
    setShowEmpModal(false);
  }
  function saveRole() {
    if (!roleForm.name.trim()) return;
    const r = { ...roleForm, points: parseFloat(roleForm.points) || 1, restaurantId: rid, id: editRoleId ?? Date.now().toString() };
    onUpdate("roles", editRoleId ? roles.map(x => x.id === editRoleId ? r : x) : [...roles, r]);
    setShowRoleModal(false);
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
  const canTips = perms.tips || isSuperManager;
  const canSched = perms.schedule || isSuperManager;

  const TABS = [
    canTips   && ["dashboard", "📊 Dashboard"],
    canTips   && ["tips",      "💸 Gorjetas"],
    (canTips || isSuperManager) && ["employees", "👥 Equipe"],
    isSuperManager && ["roles", "🏷️ Cargos"],
    canSched  && ["schedule",  "📅 Escala"],
    (canTips || isSuperManager) && ["config",    "⚙️ Config"],
  ].filter(Boolean);

  return (
    <div style={{ fontFamily: "DM Mono,monospace" }}>
      {/* Restaurant sub-header */}
      <div style={{ background: "#141414", borderBottom: "1px solid #1e1e1e", padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ color: "#fff", fontWeight: 600 }}>{restaurant.name}</span>
          {restaurant.cnpj && <span style={{ color: "#555", fontSize: 12, marginLeft: 10 }}>{restaurant.cnpj}</span>}
        </div>
        {canTips && <button onClick={() => setShowExport(true)} style={{ ...S.btnSecondary, fontSize: 12, color: ac, borderColor: ac }}>📤 Exportar</button>}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #1e1e1e", background: "#111", overflowX: "auto" }}>
        {TABS.map(([id, lbl]) => (
          <button key={id} onClick={() => setTab(id)} style={{ padding: "11px 14px", background: "none", border: "none", borderBottom: `2px solid ${tab === id ? ac : "transparent"}`, color: tab === id ? ac : "#555", cursor: "pointer", fontSize: 12, fontFamily: "DM Mono,monospace", fontWeight: tab === id ? 700 : 400, whiteSpace: "nowrap" }}>{lbl}</button>
        ))}
      </div>

      <div style={{ padding: "20px 16px", maxWidth: 640, margin: "0 auto" }}>
        {["dashboard","tips","schedule"].includes(tab) && (
          <div style={{ marginBottom: 20 }}><MonthNav year={year} month={month} onChange={(y,m)=>{setYear(y);setMonth(m);}} /></div>
        )}

        {/* DASHBOARD */}
        {tab === "dashboard" && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20 }}>
              {[["Pool Bruto",totalGross,"#fff"],["Impostos 33%",totalTax,"#e74c3c"],["Distribuído",totalNet,ac]].map(([lbl,val,col])=>(
                <div key={lbl} style={{ ...S.card, textAlign: "center" }}>
                  <div style={{ color: "#555", fontSize: 10, marginBottom: 4 }}>{lbl}</div>
                  <div style={{ color: col, fontWeight: 700, fontSize: 14 }}>{fmt(val)}</div>
                </div>
              ))}
            </div>
            <div style={{ ...S.card, marginBottom: 20 }}>
              <p style={{ color: "#555", fontSize: 12, margin: "0 0 12px" }}>Distribuição por Área</p>
              {AREAS.map(a => {
                const aNet = monthTips.filter(t => t.area === a).reduce((s,t) => s + t.myNet, 0);
                return (
                  <div key={a} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <div style={{ minWidth: 70 }}><AreaBadge area={a} /></div>
                    <div style={{ flex: 1, background: "#111", borderRadius: 4, height: 6, overflow: "hidden" }}>
                      <div style={{ width: `${curSplit[a]}%`, height: "100%", background: AREA_COLORS[a] }} />
                    </div>
                    <span style={{ color: "#aaa", fontSize: 12, minWidth: 36 }}>{curSplit[a]}%</span>
                    <span style={{ color: ac, fontSize: 13, fontWeight: 600, minWidth: 80, textAlign: "right" }}>{fmt(aNet)}</span>
                  </div>
                );
              })}
            </div>
            {empSummary.map((e, i) => (
              <div key={e.id} style={{ ...S.card, marginBottom: 8, display: "flex", alignItems: "center", gap: 12 }}>
                <span style={{ color: ac, minWidth: 24 }}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":`${i+1}`}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: "#fff", fontSize: 14, fontWeight: 600 }}>{e.name}</div>
                  <div style={{ color: "#555", fontSize: 12 }}>{e.roleName}{e.area&&` · `}{e.area&&<span style={{color:AREA_COLORS[e.area]}}>{e.area}</span>}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ color: ac, fontWeight: 700 }}>{fmt(e.net)}</div>
                  <div style={{ color: "#555", fontSize: 11 }}>bruto {fmt(e.gross)}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* GORJETAS */}
        {tab === "tips" && (
          <div>
            <div style={{ ...S.card, marginBottom: 24 }}>
              <p style={{ color: ac, fontSize: 14, margin: "0 0 14px", fontWeight: 700 }}>+ Lançar Gorjeta do Dia</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div><label style={S.label}>Data</label><input type="date" value={tipDate} onChange={e => setTipDate(e.target.value)} style={S.input} /></div>
                <div><label style={S.label}>Valor Total (R$)</label><input type="number" min="0" step="0.01" value={tipTotal} onChange={e => setTipTotal(e.target.value)} placeholder="Ex: 1500.00" style={S.input} /></div>
                {tipTotal && !isNaN(parseFloat(tipTotal)) && (() => {
                  const total = parseFloat(tipTotal);
                  const tax = total * TAX;
                  const tSplit = splits?.[rid]?.[monthKey(new Date(tipDate+"T12:00:00").getFullYear(), new Date(tipDate+"T12:00:00").getMonth())] ?? DEFAULT_SPLIT;
                  return (
                    <div style={{ background: "#111", borderRadius: 10, padding: 12, fontSize: 12 }}>
                      <div style={{ display:"flex",justifyContent:"space-between",color:"#aaa",marginBottom:4 }}><span>Total bruto</span><span style={{color:"#fff"}}>{fmt(total)}</span></div>
                      <div style={{ display:"flex",justifyContent:"space-between",color:"#aaa",marginBottom:4 }}><span>Retenção (33%)</span><span style={{color:"#e74c3c"}}>-{fmt(tax)}</span></div>
                      <div style={{ display:"flex",justifyContent:"space-between",color:"#aaa",borderTop:"1px solid #2a2a2a",paddingTop:6,marginTop:4,marginBottom:10 }}><span>A distribuir</span><span style={{color:ac,fontWeight:700}}>{fmt(total-tax)}</span></div>
                      {(() => {
                        const mode = restaurant.divisionMode ?? MODE_AREA_POINTS;
                        const activeEmps = restEmps.filter(e => {
                          const r = restRoles.find(r=>r.id===e.roleId);
                          return r && (!e.admission||e.admission<=tipDate);
                        });
                        if (mode === MODE_GLOBAL_POINTS) {
                          const totalPts = activeEmps.reduce((s,e)=>s+(parseFloat(restRoles.find(r=>r.id===e.roleId)?.points)||1),0);
                          return <div style={{color:"#aaa",fontSize:12}}>
                            <span style={{color:"#f5c842"}}>Pontos Global</span> · {activeEmps.length} emp · {totalPts}pt total
                            <div style={{marginTop:4,color:"#555"}}>Cada ponto vale: {fmt((total-tax)/totalPts)}</div>
                          </div>;
                        }
                        return AREAS.map(a => {
                          const emps = activeEmps.filter(e => restRoles.find(r=>r.id===e.roleId)?.area===a);
                          if (!emps.length) return null;
                          const pts = emps.reduce((s,e)=>s+(parseFloat(restRoles.find(r=>r.id===e.roleId)?.points)||1),0);
                          return <div key={a} style={{display:"flex",justifyContent:"space-between",color:"#aaa",marginBottom:2}}><span style={{color:AREA_COLORS[a]}}>{a} ({tSplit[a]}%)</span><span>{fmt((total-tax)*(tSplit[a]/100))} · {emps.length} emp · {pts}pt</span></div>;
                        });
                      })()}
                    </div>
                  );
                })()}
                <div><label style={S.label}>Observação</label><input value={tipNote} onChange={e => setTipNote(e.target.value)} placeholder="Ex: Sábado à noite" style={S.input} /></div>
                <button onClick={() => { const n = calcTip(); if (n > 0) onUpdate("_toast", `✅ Distribuído para ${n} empregados!`); }} style={S.btnPrimary}>Calcular e Distribuir</button>
              </div>
            </div>
            {tipDates.length === 0 && <p style={{ color: "#555", textAlign: "center" }}>Nenhum lançamento neste mês.</p>}
            {tipDates.map(d => {
              const dT = monthTips.filter(t => t.date === d);
              return (
                <div key={d} style={{ ...S.card, marginBottom: 10 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",marginBottom:10 }}>
                    <span style={{color:"#aaa"}}>{fmtDate(d)}</span>
                    <div style={{textAlign:"right"}}><div style={{color:"#fff",fontSize:12}}>Pool: {fmt(dT[0]?.poolTotal)}</div><div style={{color:ac,fontSize:12}}>Dist: {fmt(dT.reduce((a,t)=>a+t.myNet,0))}</div></div>
                  </div>
                  {AREAS.map(a => {
                    const aT = dT.filter(t => t.area === a);
                    if (!aT.length) return null;
                    return (
                      <div key={a} style={{borderTop:"1px solid #222",paddingTop:8,marginTop:8}}>
                        <div style={{marginBottom:4}}><AreaBadge area={a} /></div>
                        {aT.map(t => {
                          const emp = restEmps.find(e => e.id === t.employeeId);
                          return <div key={t.id} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"3px 0"}}><span style={{color:"#aaa"}}>{emp?.name??"—"}</span><div><span style={{color:"#fff"}}>{fmt(t.myShare)}</span><span style={{color:"#e74c3c",marginLeft:8}}>-{fmt(t.myTax)}</span><span style={{color:ac,marginLeft:8,fontWeight:700}}>{fmt(t.myNet)}</span></div></div>;
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
          <div>
            <button onClick={() => { setEditEmpId(null); setEmpForm({ name:"",cpf:"",roleId:"",admission:today(),pin:"" }); setShowEmpModal(true); }} style={{ ...S.btnPrimary, marginBottom: 20 }}>+ Novo Empregado</button>
            {restEmps.length === 0 && <p style={{ color: "#555", textAlign: "center" }}>Nenhum empregado cadastrado.</p>}
            {restEmps.map(e => {
              const r = restRoles.find(r => r.id === e.roleId);
              return (
                <div key={e.id} style={{ ...S.card, marginBottom: 10, display:"flex",justifyContent:"space-between",alignItems:"flex-start" }}>
                  <div>
                    <div style={{color:"#fff",fontWeight:600}}>{e.name}</div>
                    <div style={{color:"#555",fontSize:12}}>CPF: {e.cpf||"—"} · Admissão: {fmtDate(e.admission)}</div>
                    <div style={{marginTop:4,display:"flex",gap:6,alignItems:"center"}}>{r?<><span style={{color:"#aaa",fontSize:12}}>{r.name}</span><AreaBadge area={r.area}/><span style={{color:"#555",fontSize:12}}>{r.points}pt</span></>:<span style={{color:"#555",fontSize:12}}>Sem cargo</span>}</div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>{setEditEmpId(e.id);setEmpForm({name:e.name,cpf:e.cpf??"",roleId:e.roleId??"",admission:e.admission??today(),pin:e.pin??""});setShowEmpModal(true);}} style={{...S.btnSecondary,fontSize:12}}>Editar</button>
                    <button onClick={()=>onUpdate("employees",employees.filter(x=>x.id!==e.id))} style={{background:"none",border:"1px solid #e74c3c33",borderRadius:8,color:"#e74c3c",cursor:"pointer",fontSize:12,padding:"6px 12px",fontFamily:"DM Mono,monospace"}}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* CARGOS (super only) */}
        {tab === "roles" && (
          <div>
            <button onClick={() => { setEditRoleId(null); setRoleForm({ name:"",area:"Salão",points:"1" }); setShowRoleModal(true); }} style={{ ...S.btnPrimary, marginBottom: 16 }}>+ Novo Cargo</button>
            {AREAS.map(a => {
              const aR = restRoles.filter(r => r.area === a);
              if (!aR.length) return null;
              return <div key={a} style={{marginBottom:20}}><div style={{marginBottom:8}}><AreaBadge area={a}/></div>{aR.map(r=><div key={r.id} style={{...S.card,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}><div><div style={{color:"#fff",fontWeight:600}}>{r.name}</div><div style={{color:AREA_COLORS[a],fontSize:13}}>{r.points}pt</div></div><div style={{display:"flex",gap:8}}><button onClick={()=>{setEditRoleId(r.id);setRoleForm({name:r.name,area:r.area,points:String(r.points)});setShowRoleModal(true);}} style={{...S.btnSecondary,fontSize:12}}>Editar</button><button onClick={()=>onUpdate("roles",roles.filter(x=>x.id!==r.id))} style={{background:"none",border:"1px solid #e74c3c33",borderRadius:8,color:"#e74c3c",cursor:"pointer",fontSize:12,padding:"6px 12px",fontFamily:"DM Mono,monospace"}}>✕</button></div></div>)}</div>;
            })}
            {restRoles.length === 0 && <p style={{color:"#555",textAlign:"center"}}>Nenhum cargo.</p>}
          </div>
        )}

        {/* ESCALA */}
        {tab === "schedule" && (
          <div>
            <div style={{marginBottom:16}}><PillBar options={AREAS} value={schedArea} onChange={setSchedArea}/></div>
            <p style={{color:"#555",fontSize:12,marginBottom:16}}>Clique: <span style={{color:"#10b981"}}>Trabalho</span> → <span style={{color:"#e74c3c"}}>Folga</span> → <span style={{color:"#3b82f6"}}>Comp.</span> → Trabalho</p>
            {areaEmps.length === 0 && <p style={{color:"#555",textAlign:"center"}}>Nenhum empregado nesta área.</p>}
            {areaEmps.map(emp => {
              const dayMap = schedules?.[rid]?.[mk]?.[emp.id] ?? {};
              const offC  = Object.values(dayMap).filter(v=>v===DAY_OFF).length;
              const compC = Object.values(dayMap).filter(v=>v===DAY_COMP).length;
              return (
                <div key={emp.id} style={{...S.card,marginBottom:20}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
                    <div><div style={{color:"#fff",fontWeight:600}}>{emp.name}</div><div style={{color:"#555",fontSize:12}}>{restRoles.find(r=>r.id===emp.roleId)?.name}</div></div>
                    <div style={{fontSize:12}}><span style={{color:"#10b981"}}>{dim-offC-compC}T</span><span style={{color:"#555",margin:"0 4px"}}>·</span><span style={{color:"#e74c3c"}}>{offC}F</span><span style={{color:"#555",margin:"0 4px"}}>·</span><span style={{color:"#3b82f6"}}>{compC}C</span></div>
                  </div>
                  <ScheduleCalendar empId={emp.id} restaurantId={rid} year={year} month={month} schedules={schedules} onUpdate={onUpdate}/>
                </div>
              );
            })}
          </div>
        )}

        {/* CONFIG */}
        {tab === "config" && (
          <div>
            <div style={{...S.card,marginBottom:20}}>
              <p style={{color:ac,fontSize:14,fontWeight:700,margin:"0 0 8px"}}>Modalidade de Divisão</p>
              <p style={{color:"#555",fontSize:12,marginBottom:14}}>Define como a gorjeta é dividida entre os empregados.</p>
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
                      <div style={{color:"#555",fontSize:12,marginTop:4}}>{desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{...S.card,marginBottom:20}}>
              <p style={{color:ac,fontSize:14,fontWeight:700,margin:"0 0 4px"}}>Distribuição por Área</p>
              <p style={{color:"#555",fontSize:11,margin:"0 0 14px"}}>(Usado apenas na modalidade Áreas + Pontos)</p>
              <div style={{marginBottom:14}}><MonthNav year={year} month={month} onChange={(y,m)=>{setYear(y);setMonth(m);setSplitForm(null);}}/></div>
              {splitForm ? (
                <div>
                  {AREAS.map(a=><div key={a} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}><div style={{minWidth:70}}><AreaBadge area={a}/></div><input type="number" min="0" max="100" step="0.5" value={splitForm[a]} onChange={e=>setSplitForm({...splitForm,[a]:e.target.value})} style={{...S.input,width:80,textAlign:"center"}}/><span style={{color:"#555",fontSize:13}}>%</span></div>)}
                  <div style={{color:Math.abs(AREAS.reduce((a,k)=>a+parseFloat(splitForm[k]||0),0)-100)<0.01?"#10b981":"#e74c3c",fontSize:13,marginBottom:10}}>Total: {AREAS.reduce((a,k)=>a+parseFloat(splitForm[k]||0),0).toFixed(1)}%</div>
                  <div style={{display:"flex",gap:8}}><button onClick={saveSplit} style={{...S.btnPrimary,flex:1}}>Salvar</button><button onClick={()=>setSplitForm(null)} style={S.btnSecondary}>Cancelar</button></div>
                </div>
              ) : (
                <div>
                  {AREAS.map(a=><div key={a} style={{display:"flex",justifyContent:"space-between",marginBottom:8,alignItems:"center"}}><AreaBadge area={a}/><span style={{color:"#aaa",fontSize:14}}>{curSplit[a]}%</span></div>)}
                  <button onClick={()=>setSplitForm({...curSplit})} style={{...S.btnSecondary,marginTop:12,width:"100%",textAlign:"center"}}>Editar percentuais</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showEmpModal && (
        <Modal title={editEmpId?"Editar Empregado":"Novo Empregado"} onClose={()=>setShowEmpModal(false)}>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {[["name","Nome completo","text"],["cpf","CPF","text"],["admission","Data de Admissão","date"],["pin","PIN (4–6 dígitos)","password"]].map(([f,lbl,t])=>(
              <div key={f}><label style={S.label}>{lbl}</label><input type={t} value={empForm[f]} onChange={e=>setEmpForm({...empForm,[f]:e.target.value})} style={S.input}/></div>
            ))}
            <div><label style={S.label}>Cargo</label>
              <select value={empForm.roleId} onChange={e=>setEmpForm({...empForm,roleId:e.target.value})} style={S.input}>
                <option value="">Selecionar cargo…</option>
                {AREAS.map(a=><optgroup key={a} label={a}>{restRoles.filter(r=>r.area===a).map(r=><option key={r.id} value={r.id}>{r.name} ({r.points}pt)</option>)}</optgroup>)}
              </select>
            </div>
            <button onClick={saveEmp} style={S.btnPrimary}>{editEmpId?"Salvar":"Cadastrar"}</button>
          </div>
        </Modal>
      )}
      {showRoleModal && (
        <Modal title={editRoleId?"Editar Cargo":"Novo Cargo"} onClose={()=>setShowRoleModal(false)}>
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            <div><label style={S.label}>Nome</label><input value={roleForm.name} onChange={e=>setRoleForm({...roleForm,name:e.target.value})} placeholder="Ex: Garçom, Chef…" style={S.input}/></div>
            <div><label style={S.label}>Área</label><select value={roleForm.area} onChange={e=>setRoleForm({...roleForm,area:e.target.value})} style={S.input}>{AREAS.map(a=><option key={a} value={a}>{a}</option>)}</select></div>
            <div><label style={S.label}>Pontuação</label><input type="number" min="0.5" step="0.5" value={roleForm.points} onChange={e=>setRoleForm({...roleForm,points:e.target.value})} style={S.input}/></div>
            <button onClick={saveRole} style={S.btnPrimary}>{editRoleId?"Salvar":"Criar"}</button>
          </div>
        </Modal>
      )}
      {showExport && <ExportModal onClose={()=>setShowExport(false)} employees={employees} roles={roles} tips={tips} restaurant={restaurant}/>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SUPER MANAGER PORTAL
// ══════════════════════════════════════════════════════════════════════════════
function SuperManagerPortal({ data, onUpdate, onBack, currentUser }) {
  const { superManagers, managers, restaurants, employees, roles, tips, splits, schedules } = data;
  const [tab, setTab] = useState("restaurants");
  const [selRestaurant, setSelRestaurant] = useState(null);

  // forms
  const [showRestModal, setShowRestModal]   = useState(false);
  const [editRestId, setEditRestId]         = useState(null);
  const [restForm, setRestForm]             = useState({ name:"",cnpj:"",address:"" });
  const [showMgrModal, setShowMgrModal]     = useState(false);
  const [editMgrId, setEditMgrId]           = useState(null);
  const [mgrForm, setMgrForm]               = useState({ name:"",cpf:"",pin:"",restaurantIds:[],perms:{tips:true,schedule:true} });
  const [showSuperModal, setShowSuperModal] = useState(false);
  const [editSuperId, setEditSuperId]       = useState(null);
  const [superForm, setSuperForm]           = useState({ name:"",cpf:"",pin:"" });

  function saveRest() {
    if (!restForm.name.trim()) return;
    const r = { ...restForm, id: editRestId ?? Date.now().toString() };
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
      <div style={{ minHeight:"100vh", background:"#0f0f0f", fontFamily:"DM Mono,monospace" }}>
        <div style={{ background:"#111", borderBottom:"1px solid #1e1e1e", padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <button onClick={()=>setSelRestaurant(null)} style={{ ...S.btnSecondary, fontSize:12, padding:"6px 12px" }}>← Voltar</button>
            <span style={{ color:"#555", fontSize:12 }}>⭐ {currentUser?.name}</span>
          </div>
          <button onClick={onBack} style={{ ...S.btnSecondary, fontSize:12 }}>Sair</button>
        </div>
        <RestaurantPanel restaurant={rest} restaurants={restaurants} employees={employees} roles={roles} tips={tips} splits={splits} schedules={schedules} onUpdate={onUpdate} perms={{ tips:true, schedule:true }} isSuperManager />
      </div>
    );
  }

  return (
    <div style={{ minHeight:"100vh", background:"#0f0f0f", fontFamily:"DM Mono,monospace" }}>
      <div style={{ background:"#111", borderBottom:"1px solid #1e1e1e", padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:18 }}>⭐</span>
          <span style={{ color:ac, fontWeight:700 }}>Super Gestor</span>
          <span style={{ color:"#555", fontSize:12 }}>· {currentUser?.name}</span>
        </div>
        <button onClick={onBack} style={{ ...S.btnSecondary, fontSize:12 }}>Sair</button>
      </div>
      <div style={{ display:"flex", borderBottom:"1px solid #1e1e1e", background:"#111", overflowX:"auto" }}>
        {TABS.map(([id,lbl])=>(
          <button key={id} onClick={()=>setTab(id)} style={{ padding:"12px 16px", background:"none", border:"none", borderBottom:`2px solid ${tab===id?ac:"transparent"}`, color:tab===id?ac:"#555", cursor:"pointer", fontSize:13, fontFamily:"DM Mono,monospace", fontWeight:tab===id?700:400, whiteSpace:"nowrap" }}>{lbl}</button>
        ))}
      </div>

      <div style={{ padding:"20px 16px", maxWidth:640, margin:"0 auto" }}>

        {/* RESTAURANTES */}
        {tab === "restaurants" && (
          <div>
            <button onClick={()=>{setEditRestId(null);setRestForm({name:"",cnpj:"",address:""});setShowRestModal(true);}} style={{...S.btnPrimary,marginBottom:20}}>+ Novo Restaurante</button>
            {restaurants.length === 0 && <p style={{color:"#555",textAlign:"center"}}>Nenhum restaurante cadastrado.</p>}
            {restaurants.map(r => {
              const empCount = employees.filter(e=>e.restaurantId===r.id).length;
              const mgrCount = managers.filter(m=>m.restaurantIds?.includes(r.id)).length;
              return (
                <div key={r.id} style={{...S.card,marginBottom:10}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div>
                      <div style={{color:"#fff",fontWeight:700,fontSize:16}}>{r.name}</div>
                      {r.cnpj && <div style={{color:"#555",fontSize:12}}>CNPJ: {r.cnpj}</div>}
                      {r.address && <div style={{color:"#555",fontSize:12}}>{r.address}</div>}
                      <div style={{marginTop:6,color:"#555",fontSize:12}}>{empCount} empregado{empCount!==1?"s":""} · {mgrCount} gestor{mgrCount!==1?"es":""}</div>
                    </div>
                    <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
                      <button onClick={()=>setSelRestaurant(r.id)} style={{...S.btnSecondary,fontSize:12,color:ac,borderColor:ac}}>Abrir →</button>
                      <button onClick={()=>{setEditRestId(r.id);setRestForm({name:r.name,cnpj:r.cnpj??"",address:r.address??""});setShowRestModal(true);}} style={{...S.btnSecondary,fontSize:12}}>Editar</button>
                      <button onClick={()=>onUpdate("restaurants",restaurants.filter(x=>x.id!==r.id))} style={{background:"none",border:"1px solid #e74c3c33",borderRadius:8,color:"#e74c3c",cursor:"pointer",fontSize:12,padding:"6px 12px",fontFamily:"DM Mono,monospace"}}>✕</button>
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
            <button onClick={()=>{setEditMgrId(null);setMgrForm({name:"",cpf:"",pin:"",restaurantIds:[],perms:{tips:true,schedule:true}});setShowMgrModal(true);}} style={{...S.btnPrimary,marginBottom:20}}>+ Novo Gestor</button>
            {managers.length === 0 && <p style={{color:"#555",textAlign:"center"}}>Nenhum gestor cadastrado.</p>}
            {managers.map(m=>(
              <div key={m.id} style={{...S.card,marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                  <div>
                    <div style={{color:"#fff",fontWeight:600,fontSize:15}}>{m.name}</div>
                    <div style={{color:"#555",fontSize:12}}>CPF: {m.cpf||"—"}</div>
                    <div style={{marginTop:6,display:"flex",gap:6,flexWrap:"wrap"}}>
                      <PermBadge label="Gorjetas" on={m.perms?.tips}/>
                      <PermBadge label="Escala" on={m.perms?.schedule}/>
                    </div>
                    <div style={{marginTop:6,display:"flex",gap:4,flexWrap:"wrap"}}>
                      {(m.restaurantIds??[]).map(rid=>{const r=restaurants.find(x=>x.id===rid);return r?<span key={rid} style={{background:"#2a2a2a",color:"#aaa",borderRadius:6,padding:"2px 8px",fontSize:11}}>{r.name}</span>:null;})}
                      {(!m.restaurantIds||m.restaurantIds.length===0)&&<span style={{color:"#555",fontSize:12}}>Sem restaurantes</span>}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>{setEditMgrId(m.id);setMgrForm({name:m.name,cpf:m.cpf??"",pin:m.pin??"",restaurantIds:m.restaurantIds??[],perms:m.perms??{tips:true,schedule:true}});setShowMgrModal(true);}} style={{...S.btnSecondary,fontSize:12}}>Editar</button>
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
                  <div style={{color:"#fff",fontWeight:600}}>{s.name}</div>
                  <div style={{color:"#555",fontSize:12}}>CPF: {s.cpf||"—"}</div>
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
            <div><label style={S.label}>CNPJ</label><input value={restForm.cnpj} onChange={e=>setRestForm({...restForm,cnpj:e.target.value})} placeholder="00.000.000/0000-00" style={S.input}/></div>
            <div><label style={S.label}>Endereço</label><input value={restForm.address} onChange={e=>setRestForm({...restForm,address:e.target.value})} style={S.input}/></div>
            <button onClick={saveRest} style={S.btnPrimary}>{editRestId?"Salvar":"Cadastrar"}</button>
          </div>
        </Modal>
      )}

      {showMgrModal && (
        <Modal title={editMgrId?"Editar Gestor":"Novo Gestor"} onClose={()=>setShowMgrModal(false)} wide>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <div><label style={S.label}>Nome completo</label><input value={mgrForm.name} onChange={e=>setMgrForm({...mgrForm,name:e.target.value})} style={S.input}/></div>
              <div><label style={S.label}>CPF</label><input value={mgrForm.cpf} onChange={e=>setMgrForm({...mgrForm,cpf:e.target.value})} placeholder="000.000.000-00" style={S.input} inputMode="numeric"/></div>
            </div>
            <div><label style={S.label}>PIN (4–6 dígitos)</label><input type="password" value={mgrForm.pin} onChange={e=>setMgrForm({...mgrForm,pin:e.target.value})} maxLength={6} style={S.input}/></div>

            <div>
              <label style={S.label}>Permissões</label>
              <div style={{display:"flex",gap:10}}>
                {[["tips","Gorjetas"],["schedule","Escala"]].map(([k,lbl])=>(
                  <button key={k} onClick={()=>setMgrForm({...mgrForm,perms:{...mgrForm.perms,[k]:!mgrForm.perms?.[k]}})}
                    style={{flex:1,padding:"10px",borderRadius:10,border:`1px solid ${mgrForm.perms?.[k]?"#10b981":"#2a2a2a"}`,background:mgrForm.perms?.[k]?"#10b98122":"transparent",color:mgrForm.perms?.[k]?"#10b981":"#555",cursor:"pointer",fontFamily:"DM Mono,monospace",fontSize:13}}>
                    {mgrForm.perms?.[k]?"✓":"✗"} {lbl}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label style={S.label}>Restaurantes com acesso</label>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {restaurants.length===0&&<p style={{color:"#555",fontSize:13}}>Nenhum restaurante cadastrado ainda.</p>}
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

// ══════════════════════════════════════════════════════════════════════════════
// MANAGER PORTAL (regular manager, single or multi restaurant)
// ══════════════════════════════════════════════════════════════════════════════
function ManagerPortal({ manager, data, onUpdate, onBack }) {
  const { restaurants, employees, roles, tips, splits, schedules } = data;
  const myRestaurants = restaurants.filter(r => manager.restaurantIds?.includes(r.id));
  const [selId, setSelId] = useState(myRestaurants.length === 1 ? myRestaurants[0].id : null);
  const ac = "#f5c842";

  const selRest = myRestaurants.find(r => r.id === selId);

  return (
    <div style={{ minHeight:"100vh", background:"#0f0f0f", fontFamily:"DM Mono,monospace" }}>
      <div style={{ background:"#111", borderBottom:"1px solid #1e1e1e", padding:"14px 20px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{fontSize:18}}>📊</span>
          <span style={{color:ac,fontWeight:700}}>Gestor</span>
          <span style={{color:"#555",fontSize:12}}>· {manager.name}</span>
        </div>
        <button onClick={onBack} style={{...S.btnSecondary,fontSize:12}}>Sair</button>
      </div>

      {/* Restaurant picker if multiple */}
      {!selId && (
        <div style={{padding:"40px 20px",maxWidth:480,margin:"0 auto"}}>
          <p style={{color:"#555",fontSize:13,marginBottom:20,textAlign:"center"}}>Selecione o restaurante</p>
          {myRestaurants.length === 0 && <p style={{color:"#555",textAlign:"center"}}>Nenhum restaurante atribuído.</p>}
          {myRestaurants.map(r=>(
            <button key={r.id} onClick={()=>setSelId(r.id)} style={{...S.card,width:"100%",cursor:"pointer",textAlign:"left",display:"block",marginBottom:10,border:"1px solid #2a2a2a"}}>
              <div style={{color:"#fff",fontWeight:600,fontSize:15}}>{r.name}</div>
              {r.address&&<div style={{color:"#555",fontSize:12}}>{r.address}</div>}
              <div style={{marginTop:6,display:"flex",gap:6}}>
                <PermBadge label="Gorjetas" on={manager.perms?.tips}/>
                <PermBadge label="Escala" on={manager.perms?.schedule}/>
              </div>
            </button>
          ))}
        </div>
      )}

      {selId && selRest && (
        <div>
          {myRestaurants.length > 1 && (
            <div style={{padding:"10px 16px",background:"#0a0a0a",borderBottom:"1px solid #1e1e1e"}}>
              <button onClick={()=>setSelId(null)} style={{...S.btnSecondary,fontSize:12,padding:"4px 12px"}}>← Trocar restaurante</button>
            </div>
          )}
          <RestaurantPanel restaurant={selRest} restaurants={restaurants} employees={employees} roles={roles} tips={tips} splits={splits} schedules={schedules} onUpdate={onUpdate} perms={manager.perms ?? {tips:true,schedule:true}} isSuperManager={false}/>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LOGIN
// ══════════════════════════════════════════════════════════════════════════════
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
    <div style={{minHeight:"100vh",background:"#0f0f0f",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"DM Mono,monospace",padding:24}}>
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

// ══════════════════════════════════════════════════════════════════════════════
// FIRST SETUP
// ══════════════════════════════════════════════════════════════════════════════
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
    <div style={{minHeight:"100vh",background:"#0f0f0f",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"DM Mono,monospace",padding:24}}>
      <div style={{...S.card,maxWidth:360,width:"100%"}}>
        <div style={{textAlign:"center",marginBottom:20}}>
          <div style={{fontSize:40}}>🍽️</div>
          <h2 style={{color:"#f5c842",margin:"8px 0 4px"}}>Bem-vindo!</h2>
          <p style={{color:"#555",fontSize:13}}>Cadastre o primeiro Super Gestor para começar.</p>
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

// ══════════════════════════════════════════════════════════════════════════════
// HOME
// ══════════════════════════════════════════════════════════════════════════════
function Home({ onManager, onEmployee }) {
  return (
    <div style={{minHeight:"100vh",background:"#0f0f0f",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",fontFamily:"DM Mono,monospace",padding:24}}>
      <div style={{fontSize:52,marginBottom:10}}>🍽️</div>
      <h1 style={{color:"#f5c842",fontSize:28,fontWeight:700,margin:"0 0 4px",letterSpacing:-1}}>GorjetaApp</h1>
      <p style={{color:"#555",fontSize:13,marginBottom:48,textAlign:"center"}}>Gestão transparente de gorjetas</p>
      <div style={{display:"flex",flexDirection:"column",gap:14,width:"100%",maxWidth:300}}>
        <button onClick={onManager} style={{...S.btnPrimary,padding:"18px",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>📊 Área de Gestão</button>
        <button onClick={onEmployee} style={{padding:"18px",borderRadius:16,border:"2px solid #2a2a2a",background:"transparent",color:"#fff",fontWeight:600,fontSize:16,cursor:"pointer",fontFamily:"DM Mono,monospace",display:"flex",alignItems:"center",justifyContent:"center",gap:10}}>👤 Área do Empregado</button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// APP ROOT
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [view, setView] = useState("home"); // home|login|setup|super|manager|employee
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

  useEffect(() => {
    (async () => {
      const [sm,mg,rs,em,ro,ti,sp,sc] = await Promise.all(Object.values(K).map(load));
      if (sm) setSuperManagers(sm);
      if (mg) setManagers(mg);
      if (rs) setRestaurants(rs);
      if (em) setEmployees(em);
      if (ro) setRoles(ro);
      if (ti) setTips(ti);
      if (sp) setSplits(sp);
      if (sc) setSchedules(sc);
      setLoaded(true);
    })();
  }, []);

  const data = { superManagers, managers, restaurants, employees, roles, tips, splits, schedules };

  async function handleUpdate(field, value) {
    if (field === "_toast") { setToast(value); return; }
    const setters = { superManagers:setSuperManagers, managers:setManagers, restaurants:setRestaurants, employees:setEmployees, roles:setRoles, tips:setTips, splits:setSplits, schedules:setSchedules };
    const keys    = { superManagers:K.superManagers,  managers:K.managers,  restaurants:K.restaurants,  employees:K.employees,  roles:K.roles,  tips:K.tips,  splits:K.splits,  schedules:K.schedules };
    setters[field]?.(value);
    await save(keys[field], value);
    const labels = { superManagers:"Super Gestores atualizados", managers:"Gestores atualizados", restaurants:"Restaurantes atualizados", employees:"Empregados atualizados", roles:"Cargos atualizados", tips:"Gorjetas atualizadas", splits:"Percentuais salvos", schedules:"Escala atualizada" };
    setToast(labels[field] ?? "Salvo!");
  }

  function doLogout() { setCurrentUser(null); setUserRole(null); setView("home"); }

  if (!loaded) return <div style={{minHeight:"100vh",background:"#0f0f0f",display:"flex",alignItems:"center",justifyContent:"center",color:"#f5c842",fontFamily:"DM Mono,monospace",fontSize:18}}>Carregando…</div>;

  return (
    <>
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
      {view === "employee" && <EmployeePortal employees={employees} roles={roles} tips={tips} schedules={schedules} restaurants={restaurants} onBack={()=>setView("home")} />}
      <Toast msg={toast} onClose={()=>setToast("")} />
    </>
  );
}
