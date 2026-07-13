// Export PowerPoint du Bilan hebdomadaire CODIR (deck « Projection CAF » + « Hot Topics Opérations »).
// Génération CÔTÉ CLIENT : pptxgenjs est chargé À LA DEMANDE (import dynamique) → zéro impact sur le
// bundle initial, aucun callable/stockage serveur. La vue CODIR passe ici les agrégats déjà chargés.
import type { BulletinSection } from "./writes";

export type CodirPptxData = {
  fy: number; week: number;
  cafYtd: number; backlogYtd: number; cafEst: number; cafEstYcForecast: number; forecast: number; objectifCaf: number;
  topClients: { name: string; cas: number; forecast: number }[]; // top clients (certitudes + forecast)
  backlog: { client?: string; affaire?: string; raf?: number }[]; // top 10 backlog
  months: { name: string; realise: number; planifie: number }[]; // projection facturation
  bulletin: BulletinSection[]; // Hot Topics Opérations
};

// Palette (hex sans #, format pptxgenjs).
const C = { ink: "1A2B2B", muted: "5B6B6B", emerald: "10996B", gold: "C79A3C", steel: "5B8AA6", clay: "C0574E", panel: "EEF2F1", line: "D6DEDC", white: "FFFFFF" };
const mMd = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(2)} Md` : `${Math.round((v || 0) / 1e6)} M`);
const M = (v: number) => Math.round((v || 0) / 1e6); // millions (échelle des graphes)

export async function exportCodirPptx(d: CodirPptxData): Promise<void> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "W", width: 10, height: 5.63 });
  pptx.layout = "W";
  pptx.author = "nt360"; pptx.company = "nt360"; pptx.title = `Bilan CODIR S${d.week} FY${d.fy}`;

  // Bandeau de titre réutilisé sur chaque slide (imite le tableau de bord source).
  const header = (slide: any, sub: string) => {
    slide.addShape("rect", { x: 0, y: 0, w: 10, h: 0.7, fill: { color: C.ink } });
    slide.addText("BILAN HEBDOMADAIRE", { x: 0.3, y: 0.1, w: 4, h: 0.5, color: C.white, bold: true, fontSize: 16, valign: "middle" });
    slide.addText(sub, { x: 4, y: 0.1, w: 4.6, h: 0.5, color: C.gold, bold: true, fontSize: 16, align: "center", valign: "middle" });
    slide.addText(`S${d.week}`, { x: 8.7, y: 0.1, w: 1, h: 0.5, color: C.white, bold: true, fontSize: 16, align: "center", valign: "middle" });
  };

  // ── Slide 1 : Projection CAF (KPI + top clients) ─────────────────────────────
  const s1 = pptx.addSlide();
  header(s1, "Projection CAF");
  const kpis = [
    { label: "CAF YTD", value: mMd(d.cafYtd), color: C.emerald },
    { label: "Backlog YTD", value: mMd(d.backlogYtd), color: C.clay },
    { label: "CAF Estimé", value: mMd(d.cafEst), color: C.steel },
    { label: "CAF Estimé yc Certitude", value: mMd(d.cafEstYcForecast), color: C.gold },
  ];
  kpis.forEach((k, i) => {
    const x = 0.3 + i * 2.4;
    s1.addShape("roundRect", { x, y: 0.9, w: 2.25, h: 1.0, fill: { color: C.panel }, line: { color: C.line }, rectRadius: 0.05 });
    s1.addText(k.label, { x: x + 0.1, y: 0.98, w: 2.05, h: 0.3, color: C.muted, fontSize: 9, valign: "middle" });
    s1.addText(k.value, { x: x + 0.1, y: 1.28, w: 2.05, h: 0.5, color: k.color, bold: true, fontSize: 22, valign: "middle" });
  });
  s1.addText(`Objectif CAF ${d.fy} : ${mMd(d.objectifCaf)}  ·  Atteinte ${d.objectifCaf > 0 ? Math.round((d.cafEstYcForecast / d.objectifCaf) * 100) : 0}%  ·  Certitude annuelle (pipeline pondéré) : ${mMd(d.forecast)}`,
    { x: 0.3, y: 2.05, w: 9.4, h: 0.3, color: C.muted, fontSize: 11, italic: true });

  const cl = d.topClients.slice(0, 8);
  if (cl.length) {
    const labels = cl.map((c) => c.name);
    s1.addText("Top clients — Commandes (M XOF)", { x: 0.3, y: 2.45, w: 9.4, h: 0.3, color: C.ink, bold: true, fontSize: 12 });
    s1.addChart(pptx.ChartType.bar, [
      { name: "Commandes (CAS)", labels, values: cl.map((c) => M(c.cas)) },
    ], {
      x: 0.3, y: 2.75, w: 9.4, h: 2.7, barDir: "bar",
      chartColors: [C.steel], showLegend: false, showValue: false,
      catAxisLabelFontSize: 9, valAxisLabelFontSize: 8, showTitle: false,
    });
  }

  // ── Slide 2 : Backlog & Projection facturation ───────────────────────────────
  const s2 = pptx.addSlide();
  header(s2, "Backlog & Facturation");
  s2.addText("Top 10 Backlog", { x: 0.3, y: 0.85, w: 4.6, h: 0.3, color: C.ink, bold: true, fontSize: 12 });
  const rows: any[] = [[
    { text: "Client", options: { bold: true, color: C.white, fill: { color: C.ink }, fontSize: 9 } },
    { text: "Projet", options: { bold: true, color: C.white, fill: { color: C.ink }, fontSize: 9 } },
    { text: "RAF", options: { bold: true, color: C.white, fill: { color: C.ink }, fontSize: 9, align: "right" } },
  ]];
  d.backlog.slice(0, 10).forEach((b) => rows.push([
    { text: b.client || "—", options: { fontSize: 8 } },
    { text: (b.affaire || "—").slice(0, 44), options: { fontSize: 8 } },
    { text: mMd(b.raf || 0), options: { fontSize: 8, align: "right" } },
  ]));
  s2.addTable(rows, { x: 0.3, y: 1.15, w: 4.6, colW: [1.3, 2.5, 0.8], border: { type: "solid", color: C.line, pt: 0.5 }, valign: "middle" });

  const mo = d.months.filter((m) => m.realise + m.planifie > 0);
  s2.addText("Projection facturation (M XOF)", { x: 5.1, y: 0.85, w: 4.6, h: 0.3, color: C.ink, bold: true, fontSize: 12 });
  if (mo.length) {
    const labels = mo.map((m) => m.name);
    s2.addChart(pptx.ChartType.bar, [
      { name: "Réalisé", labels, values: mo.map((m) => M(m.realise)) },
      { name: "Planifié", labels, values: mo.map((m) => M(m.planifie)) },
    ], {
      x: 5.1, y: 1.15, w: 4.6, h: 3.9, barDir: "col", barGrouping: "stacked",
      chartColors: [C.emerald, C.gold], showLegend: true, legendPos: "b",
      catAxisLabelFontSize: 8, valAxisLabelFontSize: 8, showTitle: false,
    });
  } else {
    s2.addText("Indisponible (dates ClickUp à synchroniser).", { x: 5.1, y: 1.15, w: 4.6, h: 0.4, color: C.muted, fontSize: 10, italic: true });
  }

  // ── Slide 3 : Hot Topics Opérations (bulletin) ───────────────────────────────
  const s3 = pptx.addSlide();
  header(s3, "Hot Topics Opérations");
  s3.addText("Commentaires / points clés", { x: 0.3, y: 0.85, w: 9.4, h: 0.3, color: C.gold, bold: true, fontSize: 13 });
  const body: any[] = [];
  for (const sec of d.bulletin) {
    if (sec.title) body.push({ text: sec.title, options: { bold: true, color: C.ink, fontSize: 13, paraSpaceBefore: 8, paraSpaceAfter: 2 } });
    for (const it of sec.items) {
      if (it.text) body.push({ text: it.text, options: { color: C.muted, fontSize: 11, bullet: { indent: 15 }, indentLevel: 1 } });
      for (const sub of it.sub || []) body.push({ text: sub, options: { color: C.muted, fontSize: 10, bullet: { characterCode: "25E6", indent: 15 }, indentLevel: 2 } });
    }
  }
  if (!body.length) body.push({ text: "Aucun point clé saisi pour cette semaine.", options: { color: C.muted, italic: true, fontSize: 11 } });
  s3.addText(body, { x: 0.4, y: 1.2, w: 9.2, h: 4.2, valign: "top" });

  await pptx.writeFile({ fileName: `nt360-bilan-codir-S${d.week}-${d.fy}.pptx` });
}
