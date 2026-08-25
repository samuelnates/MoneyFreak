#!/bin/bash
set -euo pipefail

# Solo tiene sentido en Claude Code on the web: cada sesion arranca en un
# container nuevo y efimero, asi que el .env con las claves de ai-media-gen
# (KIE_API_KEY / FAL_KEY) se pierde entre sesiones. Este hook lo reconstruye
# a partir de las "Environment variables" persistentes del entorno.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

ENV_FILE="$CLAUDE_PROJECT_DIR/.env"

upsert_env_var() {
  local key="$1" value="$2"
  [ -z "$value" ] && return 0

  touch "$ENV_FILE"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

upsert_env_var "KIE_API_KEY" "${KIE_API_KEY:-}"
upsert_env_var "FAL_KEY" "${FAL_KEY:-}"

if [ -f "$ENV_FILE" ]; then
  echo "session-start: .env listo ($(grep -c '=' "$ENV_FILE") claves)"
else
  echo "session-start: KIE_API_KEY/FAL_KEY no estan configuradas como Environment variables del entorno; ai-media-gen no va a tener claves." >&2
fi
