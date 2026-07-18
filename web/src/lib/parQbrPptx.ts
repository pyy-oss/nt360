// Export PowerPoint d'une synthèse QBR partenaire. Génération CÔTÉ CLIENT : pptxgenjs chargé À LA DEMANDE
// (import dynamique) → zéro impact sur le chunk d'entrée. Montants en FCFA (jamais l'euro du kit). Reprend
// la charte des tokens de l'ERP (pas la charte parallèle du script du kit). Patron : lib/codirPptx.ts.
import { fmt } from "../design/tokens";

export type ParQbr = {
  titre: string; synthese_executive: string; points_forts: string[]; statut_certifications: string;
  points_attention: string[]; engagements_neurones: string[]; demandes_constructeur: string[];
};
export type ParQbrSnapshot = { partenaire?: string; periode?: string; statut_conformite?: string; ca_realise_ytd_fcfa?: number; quotas?: string[] };

// Palette (hex sans #, format pptxgenjs) alignée sur les tokens de l'ERP.
const C = { ink: "1A2B2B", muted: "5B6B6B", emerald: "10996B", gold: "C79A3C", clay: "C0574E", panel: "EEF2F1", line: "D6DEDC", white: "FFFFFF" };

export async function exportParQbrPptx(qbr: ParQbr, snap: ParQbrSnapshot): Promise<void> {
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "W", width: 10, height: 5.63 });
  pptx.layout = "W";
  pptx.author = "nt360"; pptx.company = "nt360"; pptx.title = qbr.titre;

  const bullets = (items: string[]) => (items || []).map((t) => ({ text: t, options: { bullet: true, color: C.ink, fontSize: 12, paraSpaceAfter: 4 } }));

  // Slide 1 — couverture
  const s1 = pptx.addSlide();
  s1.background = { color: C.ink };
  s1.addText("REVUE TRIMESTRIELLE DE PARTENARIAT", { x: 0.6, y: 1.6, w: 8.8, h: 0.5, color: C.gold, bold: true, fontSize: 14, charSpacing: 2 });
  s1.addText(String(snap.partenaire || ""), { x: 0.6, y: 2.1, w: 8.8, h: 0.9, color: C.white, bold: true, fontSize: 40 });
  s1.addText(String(snap.periode || ""), { x: 0.6, y: 3.1, w: 8.8, h: 0.5, color: C.white, fontSize: 16 });
  s1.addText(`CA réalisé : ${fmt(snap.ca_realise_ytd_fcfa || 0)} FCFA`, { x: 0.6, y: 3.7, w: 8.8, h: 0.4, color: C.emerald, fontSize: 14, bold: true });

  // Bandeau réutilisé
  const header = (slide: any, title: string) => {
    slide.background = { color: C.white };
    slide.addShape("rect", { x: 0, y: 0, w: 10, h: 0.7, fill: { color: C.ink } });
    slide.addText(title, { x: 0.4, y: 0.1, w: 9.2, h: 0.5, color: C.white, bold: true, fontSize: 16, valign: "middle" });
  };

  // Slide 2 — synthèse + points forts
  const s2 = pptx.addSlide(); header(s2, "Synthèse & points forts");
  s2.addText(qbr.synthese_executive || "", { x: 0.4, y: 0.9, w: 9.2, h: 1.1, color: C.ink, fontSize: 13, italic: true });
  s2.addText("Points forts", { x: 0.4, y: 2.1, w: 9.2, h: 0.35, color: C.emerald, bold: true, fontSize: 13 });
  s2.addText(bullets(qbr.points_forts), { x: 0.5, y: 2.5, w: 9.1, h: 2.8 });

  // Slide 3 — statut certifs + points d'attention
  const s3 = pptx.addSlide(); header(s3, "Certifications & points d'attention");
  s3.addText("Statut des certifications", { x: 0.4, y: 0.9, w: 9.2, h: 0.35, color: C.gold, bold: true, fontSize: 13 });
  s3.addText(qbr.statut_certifications || "", { x: 0.4, y: 1.25, w: 9.2, h: 0.9, color: C.ink, fontSize: 12 });
  if ((snap.quotas || []).length) s3.addText((snap.quotas || []).join("  ·  "), { x: 0.4, y: 2.05, w: 9.2, h: 0.5, color: C.muted, fontSize: 10 });
  s3.addText("Points d'attention", { x: 0.4, y: 2.7, w: 9.2, h: 0.35, color: C.clay, bold: true, fontSize: 13 });
  s3.addText(bullets(qbr.points_attention), { x: 0.5, y: 3.1, w: 9.1, h: 2.2 });

  // Slide 4 — engagements vs demandes
  const s4 = pptx.addSlide(); header(s4, "Engagements & demandes");
  s4.addText("Engagements Neurones", { x: 0.4, y: 0.9, w: 4.5, h: 0.35, color: C.emerald, bold: true, fontSize: 13 });
  s4.addText(bullets(qbr.engagements_neurones), { x: 0.5, y: 1.3, w: 4.4, h: 3.9 });
  s4.addText("Demandes au constructeur", { x: 5.1, y: 0.9, w: 4.5, h: 0.35, color: C.gold, bold: true, fontSize: 13 });
  s4.addText(bullets(qbr.demandes_constructeur), { x: 5.2, y: 1.3, w: 4.4, h: 3.9 });

  const safe = String(snap.partenaire || "qbr").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  await pptx.writeFile({ fileName: `QBR-${safe}-${(snap.periode || "").replace(/[^a-z0-9]+/gi, "-")}.pptx` });
}
