#!/usr/bin/env python3
"""Garde-fou anti-dérive de coûts GCP — hook PreToolUse sur Bash.

Bloque, AVANT exécution, les deux commandes de déploiement qui ont déjà provoqué (ou peuvent
provoquer) un empilement de Cloud Builds ou un service Cloud Run surdimensionné :

  1) `firebase deploy` qui touche les fonctions SANS cible nommée
     → `firebase deploy` seul, ou `--only functions` (codebase entier = ~205 conteneurs rebâtis).
       Autorisé : `--only functions:maFonction[,functions:autre]` (cibles nommées, cf. deployed-functions.txt).
  2) `gcloud run deploy --source …` SANS `--machine-type`
     → laisse GCP choisir/hériter une machine Cloud Build potentiellement coûteuse.

Contrat hook Claude Code : lit un JSON sur stdin ({tool_name, tool_input:{command}}),
exit 0 = laisse passer, exit 2 = BLOQUE (le message stderr est renvoyé au modèle).
Voir docs : RUNBOOK-COUTS.md.
"""
import json
import re
import sys

def _block(msg: str) -> None:
    sys.stderr.write("⛔ Déploiement bloqué (garde-fou coûts GCP) :\n" + msg + "\n")
    sys.exit(2)

def _quote_mask(s: str):
    """Retourne un tableau de booléens : True si le caractère i est DANS un span entre quotes
    (' ou "). Sert à ignorer une mention de `firebase deploy` qui n'est qu'une chaîne (echo,
    test, doc) et non une vraie invocation — sinon le garde-fou crierait au loup."""
    mask = [False] * len(s)
    q = None
    for i, c in enumerate(s):
        if q:
            mask[i] = True
            if c == q:
                q = None
        elif c in "\"'":
            q = c
            mask[i] = True
    return mask

def _real_invocation(cmd: str, pattern: str):
    """Vrai ssi `pattern` apparaît HORS d'un span entre quotes (= vraie invocation shell)."""
    mask = _quote_mask(cmd)
    for m in re.finditer(pattern, cmd):
        if not mask[m.start()]:
            return True
    return False

def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # entrée illisible → ne bloque pas (fail-open)
    if data.get("tool_name") != "Bash":
        sys.exit(0)
    cmd = (data.get("tool_input") or {}).get("command") or ""
    if not cmd.strip():
        sys.exit(0)

    # --- Règle 1 : firebase deploy touchant les fonctions sans cible nommée ---
    if _real_invocation(cmd, r"\bfirebase\s+deploy\b"):
        m = re.search(r"--only[=\s]+[\"']?([^\"'\s]+)", cmd)
        if not m:
            # `firebase deploy` sans --only = déploie TOUT (functions incluses).
            _block(
                "`firebase deploy` sans `--only` redéploie TOUTES les fonctions (~205 conteneurs Cloud Build).\n"
                "→ Utilise le déploiement scopé de la CI (functions/scripts/deploy-targets.mjs) ou nomme les cibles :\n"
                "  firebase deploy --only functions:maFonction,hosting"
            )
        targets = m.group(1).split(",")
        if any(t.strip() == "functions" for t in targets):
            _block(
                "`--only functions` déploie le codebase ENTIER (~205 conteneurs Cloud Build).\n"
                "→ Nomme les cibles : `--only functions:maFonction[,functions:autre]`.\n"
                "  La CI dérive automatiquement les cibles depuis deployed-functions.txt / le git diff."
            )

    # --- Règle 2 : gcloud run deploy --source sans --machine-type ---
    if _real_invocation(cmd, r"\bgcloud\s+run\s+deploy\b") and re.search(r"--source\b", cmd):
        if not re.search(r"--machine-type\b", cmd):
            _block(
                "`gcloud run deploy --source` SANS `--machine-type` laisse une machine Cloud Build par défaut\n"
                "potentiellement coûteuse (et non reproductible).\n"
                "→ Ajoute p. ex. `--machine-type=e2-standard-2` (ou la valeur validée dans RUNBOOK-COUTS.md)."
            )

    sys.exit(0)

if __name__ == "__main__":
    main()
