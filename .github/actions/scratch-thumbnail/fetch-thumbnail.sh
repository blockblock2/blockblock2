#!/usr/bin/env bash
# Downloads a Scratch project thumbnail, trying several sources with retries,
# and only succeeds if the file on disk is a real image.
set -euo pipefail

fail() { echo "::error title=Scratch thumbnail::$*"; exit 1; }

# ---- Resolve inputs --------------------------------------------------------
raw="${INPUT_PROJECT:-}"
if [[ "$raw" =~ projects/([0-9]+) ]]; then
  id="${BASH_REMATCH[1]}"
elif [[ "$raw" =~ ^[[:space:]]*([0-9]+)[[:space:]]*$ ]]; then
  id="${BASH_REMATCH[1]}"
else
  fail "Couldn't find a project ID in '$raw'. Pass a number or a scratch.mit.edu/projects/<id> URL."
fi

w="${INPUT_WIDTH:-480}"
h="${INPUT_HEIGHT:-360}"
attempts="${INPUT_ATTEMPTS:-4}"
[[ "$w" =~ ^[0-9]+$ && "$h" =~ ^[0-9]+$ ]] || fail "width/height must be whole numbers (got '$w' x '$h')."
[[ "$attempts" =~ ^[1-9][0-9]*$ ]] || fail "attempts must be a positive whole number (got '$attempts')."

default_out='thumbnails/{id}.png'
out="${INPUT_OUTPUT:-$default_out}"
placeholder='{id}'
out="${out//"$placeholder"/$id}"
mkdir -p "$(dirname "$out")"

echo "Project $id -> $out (${w}x${h})"

# ---- Helpers ---------------------------------------------------------------
ua="Mozilla/5.0 (X11; Linux x86_64) scratch-thumbnail-action/1.0"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

get() { # get <url> <dest>
  curl --fail --silent --show-error --location \
       --retry 3 --retry-all-errors --retry-delay 2 \
       --connect-timeout 10 --max-time 60 \
       -A "$ua" -o "$2" "$1"
}

json_image() { # pull the "image" field out of a project JSON blob
  if command -v jq >/dev/null 2>&1; then
    jq -r '.image // empty' 2>/dev/null
  else
    sed -nE 's/.*"image":"([^"]+)".*/\1/p' | head -n1
  fi
}

resize() { sed -E "s/_[0-9]+x[0-9]+\./_${w}x${h}./"; }

is_image() { # is_image <file>
  [[ -s "$1" ]] || return 1
  local size mime
  size=$(wc -c < "$1" | tr -d ' ')
  (( size >= 100 )) || return 1
  mime=$(file --mime-type -b "$1")
  [[ "$mime" == image/* ]]
}

# ---- Build the list of sources --------------------------------------------
build_candidates() {
  candidates=()

  # 1. Official API: gives the exact image URL Scratch itself uses.
  local api_json api_img
  if api_json=$(curl -fsSL --retry 2 --retry-all-errors --connect-timeout 10 --max-time 30 \
                     -A "$ua" "https://api.scratch.mit.edu/projects/$id" 2>/dev/null); then
    api_img=$(printf '%s' "$api_json" | json_image || true)
    [[ -n "$api_img" ]] && candidates+=("$(printf '%s' "$api_img" | resize)")
  else
    echo "::notice::Scratch API didn't return project $id (it may be unshared, or the API may be blocking this runner). Trying direct sources."
  fi

  # 2-3. Scratch's image CDN, directly.
  candidates+=("https://cdn2.scratch.mit.edu/get_image/project/${id}_${w}x${h}.png")
  candidates+=("https://uploads.scratch.mit.edu/get_image/project/${id}_${w}x${h}.png")

  # 4-5. TurboWarp's Scratch proxy, useful when Scratch blocks cloud IPs.
  candidates+=("https://trampoline.turbowarp.org/thumbnails/${id}?width=${w}&height=${h}")
  local tw_json tw_img
  if tw_json=$(curl -fsSL --retry 2 --retry-all-errors --connect-timeout 10 --max-time 30 \
                    -A "$ua" "https://trampoline.turbowarp.org/api/projects/$id" 2>/dev/null); then
    tw_img=$(printf '%s' "$tw_json" | json_image || true)
    [[ -n "$tw_img" ]] && candidates+=("$(printf '%s' "$tw_img" | resize)")
  fi
}

# ---- Try everything, several times ----------------------------------------
for (( pass = 1; pass <= attempts; pass++ )); do
  echo "::group::Pass $pass of $attempts"
  build_candidates
  for url in "${candidates[@]}"; do
    echo "Trying $url"
    rm -f "$tmp"
    if get "$url" "$tmp" 2>&1 && is_image "$tmp"; then
      mv "$tmp" "$out"
      mime=$(file --mime-type -b "$out")
      echo "Saved $(wc -c < "$out" | tr -d ' ') bytes ($mime) from $url"
      echo "::endgroup::"

      case "$mime:$out" in
        image/jpeg:*.png|image/png:*.jpg|image/png:*.jpeg)
          echo "::warning::File is $mime but was saved as '$out'. Consider changing the extension." ;;
      esac

      {
        echo "path=$out"
        echo "url=$url"
        echo "mime-type=$mime"
        echo "project-id=$id"
      } >> "${GITHUB_OUTPUT:-/dev/null}"

      if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
        {
          echo "### Scratch thumbnail for project $id"
          echo "- Saved to \`$out\` ($mime)"
          echo "- Source: $url"
          echo ""
          echo "![thumbnail](https://cdn2.scratch.mit.edu/get_image/project/${id}_${w}x${h}.png)"
        } >> "$GITHUB_STEP_SUMMARY"
      fi
      exit 0
    fi
    echo "  -> no valid image"
  done
  echo "::endgroup::"
  if (( pass < attempts )); then
    delay=$(( pass * 10 ))
    echo "All sources failed on pass $pass, waiting ${delay}s..."
    sleep "$delay"
  fi
done

fail "Couldn't get a thumbnail for project $id from any source after $attempts passes. Check that the project exists and is shared."
