#!/usr/bin/env bash
# Inventaire mécanique d'un dépôt. Agnostique de la pile.
# Ne modifie rien. Sortie destinée à amorcer docs/contrats/01-EXISTANT.md.
set -uo pipefail
R="${1:-.}"; cd "$R" || exit 1
t() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

t "IDENTITÉ"
if [ -d .git ]; then
  echo "Premier commit : $(git log --reverse --format='%ad · %an' --date=short 2>/dev/null | head -1)"
  echo "Dernier commit : $(git log -1 --format='%ad · %an' --date=short 2>/dev/null)"
  echo "Commits        : $(git rev-list --count HEAD 2>/dev/null)"
  echo "Branche        : $(git branch --show-current 2>/dev/null)"
else
  echo "Pas de dépôt git."
fi

t "CONTRIBUTEURS"
git log --format='%an' 2>/dev/null | sort | uniq -c | sort -rn | head -12

t "MANIFESTES DÉTECTÉS"
for f in package.json composer.json pom.xml build.gradle requirements.txt Pipfile pyproject.toml Gemfile go.mod Cargo.toml *.csproj *.sln Makefile docker-compose.yml Dockerfile; do
  find . -maxdepth 3 -name "$f" -not -path '*/node_modules/*' -not -path '*/vendor/*' 2>/dev/null
done | sort -u

t "VOLUME PAR EXTENSION (top 18)"
find . -type f \
  -not -path '*/node_modules/*' -not -path '*/vendor/*' -not -path '*/.git/*' \
  -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/.venv/*' \
  2>/dev/null | sed 's/.*\.//' | grep -E '^[a-zA-Z0-9]{1,8}$' \
  | sort | uniq -c | sort -rn | head -18

t "ARBORESCENCE (2 niveaux)"
find . -maxdepth 2 -type d \
  -not -path '*/node_modules*' -not -path '*/vendor*' -not -path '*/.git*' \
  -not -path '*/dist*' -not -path '*/build*' 2>/dev/null | sort | head -50

t "MIGRATIONS"
find . -type d \( -iname '*migration*' -o -iname '*migrate*' -o -iname '*schema*' -o -iname '*liquibase*' -o -iname '*flyway*' \) \
  -not -path '*/node_modules/*' -not -path '*/vendor/*' 2>/dev/null | head -10

t "TESTS"
find . -type d \( -iname 'test*' -o -iname 'spec*' -o -iname '__tests__' \) \
  -not -path '*/node_modules/*' -not -path '*/vendor/*' 2>/dev/null | head -10

t "PISTES — DOMAINES MÉTIER (nommage fr/en/abrégé)"
for k in tiers client customer facture invoice reglement paiement payment achat purchase fournisseur supplier compta account analytique devise currency taux employe salarie payroll paie temps timesheet projet affaire calendrier ferie holiday role permission droit workflow validation notification audit sequence numerotation piece document; do
  n=$(grep -ril --include='*.*' \
        --exclude-dir=node_modules --exclude-dir=vendor --exclude-dir=.git \
        --exclude-dir=dist --exclude-dir=build \
        -e "$k" . 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] && printf '  %-14s %s fichiers\n' "$k" "$n"
done

t "FICHIERS LES PLUS MODIFIÉS (zones sensibles)"
git log --format=format: --name-only 2>/dev/null | grep -v '^$' \
  | sort | uniq -c | sort -rn | head -15

t "SIGNAUX D'ALERTE"
grep -rn --include='*.*' \
  --exclude-dir=node_modules --exclude-dir=vendor --exclude-dir=.git \
  -iE 'ne pas toucher|do not touch|HACK|FIXME|XXX' . 2>/dev/null | head -12

t "FIN"
echo "Cet inventaire est un point de départ mécanique, pas un audit."
echo "→ /0-empreinte pour la lecture."
