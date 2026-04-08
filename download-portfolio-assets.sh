#!/usr/bin/env bash
# download-portfolio-assets.sh
# Run from the ROOT of the PersonalPage repo:
#   chmod +x download-portfolio-assets.sh
#   ./download-portfolio-assets.sh

set -e
BASE="https://vezzanileonardo.wordpress.com/wp-content/uploads/2021/10"

echo "Creating folders..."
mkdir -p Assets/portfolio/photography
mkdir -p Assets/portfolio/3d
mkdir -p Assets/portfolio/game

echo ""
echo "=== Photography ==="
PHOTOS=(
  "aurora-peaky-blinders.png"
  "mg_3898-modifica.jpg"
  "dsc2640-2-1.jpg"
  "tramonto-nel-tempio-che-brucia.jpg"
  "dsc3990.jpg"
  "dsc0351.jpg"
  "whispering-secrets-in-the-dark.jpg"
  "dsc3872.jpg"
  "mattia-peaky-blinders.jpg"
)
for f in "${PHOTOS[@]}"; do
  echo "  ↓ $f"
  curl -sSL "$BASE/$f" -o "Assets/portfolio/photography/$f"
done

echo ""
echo "=== 3D Portfolio ==="
ASSETS_3D=(
  "moka-2.png"
  "torta.png"
  "roombedcmj.png"
  "psj_bokeh-no-color-1.png"
  "crawling-turret.png"
  "grandaes-3-4-2.png"
  "jagdwalker.png"
  "bm38-custom-side.png"
  "broken-glass.png"
  "molle-1.png"
  "monsterskin.png"
  "reptileskin-2.png"
  "lion-head-marble.png"
  "avatar-topoflow-169.png"
)
for f in "${ASSETS_3D[@]}"; do
  echo "  ↓ $f"
  curl -sSL "$BASE/$f" -o "Assets/portfolio/3d/$f"
done

echo ""
echo "=== Game Portfolio ==="
GAME=(
  "sam-dark-2.png"
  "sam-spacediver-by-vezzani-3.png"
  "sam-fly-2.png"
  "sam-light-2.png"
)
for f in "${GAME[@]}"; do
  echo "  ↓ $f"
  curl -sSL "$BASE/$f" -o "Assets/portfolio/game/$f"
done

echo ""
echo "Done. $(find Assets/portfolio -type f | wc -l) files downloaded."
