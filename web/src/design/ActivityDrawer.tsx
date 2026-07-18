// Panneau du CENTRE D'ACTIVITÉ — chargé en LAZY (n'apparaît qu'à l'ouverture) pour garder le chunk
// d'entrée léger (garde-fou check-bundle). Le lanceur (petit) vit dans components.tsx ; ce panneau
// (portail + liste des opérations) est isolé ici et importé à la demande.
import { createPortal } from "react-dom";
import { Activity, CheckCircle2, XCircle, Loader2, X } from "lucide-react";
import { useActivityLog, clearActivityLog, type ActivityEntry, type ActivityStatus } from "../lib/activity";

// Temps relatif court (« à l'instant », « il y a 3 min », « il y a 2 h »).
function relAgo(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 10) return "à l'instant";
  if (s < 60) return `il y a ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}
const ACT_SKIN: Record<ActivityStatus, { Icon: typeof CheckCircle2; cls: string; spin?: boolean }> = {
  running: { Icon: Loader2, cls: "text-gold", spin: true },
  done: { Icon: CheckCircle2, cls: "text-emerald" },
  error: { Icon: XCircle, cls: "text-clay" },
};
const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

export default function ActivityDrawer({ onClose }: { onClose: () => void }) {
  const log = useActivityLog();
  const running = log.filter((e) => e.status === "running").length;
  return createPortal(
    <div className="fixed inset-0 z-drawer" role="dialog" aria-label="Centre d'activité">
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full sm:max-w-[380px] bg-panel border-l border-line shadow-xl flex flex-col animate-slide-in">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-hair">
          <div className="flex items-center gap-2">
            <Activity size={16} className="text-gold" />
            <h2 className="font-display text-[15px] text-ink">Activité</h2>
            {running > 0 && <span className="text-[11px] text-faint">{running} en cours…</span>}
          </div>
          <div className="flex items-center gap-1">
            {log.some((e) => e.status !== "running") && <button onClick={() => clearActivityLog()} className="text-[11px] text-faint hover:text-ink">Effacer</button>}
            <button onClick={onClose} aria-label="Fermer" className="p-1 text-faint hover:text-ink"><X size={16} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-1">
          {log.length === 0 && <div className="text-[12px] text-faint px-3 py-6 text-center">Aucune activité récente. Les enregistrements, imports et corrections apparaîtront ici.</div>}
          {log.map((e: ActivityEntry) => {
            const sk = ACT_SKIN[e.status];
            return (
              <div key={e.id} className="flex items-start gap-2.5 rounded-lg px-3 py-2 hover:bg-panel2/60">
                <span className={cx("shrink-0 mt-0.5", sk.cls)}><sk.Icon size={15} className={sk.spin ? "animate-spin" : undefined} /></span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] text-ink truncate">{e.label}</div>
                  <div className="text-[11px] text-faint">
                    {e.status === "running" ? "en cours…" : e.status === "done" ? "terminé" : "échec"} · {relAgo(e.endedAt || e.startedAt)}
                  </div>
                  {e.status === "error" && e.detail && <div className="text-[11px] text-clay mt-0.5 break-words">{e.detail}</div>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="px-4 py-2.5 border-t border-hair text-[10px] text-faint">
          Une correction ou un enregistrement déclenche un <b className="text-muted">recalcul des agrégats</b> côté serveur ; les listes se rafraîchissent automatiquement à la fin.
        </div>
      </div>
    </div>,
    document.body,
  );
}
