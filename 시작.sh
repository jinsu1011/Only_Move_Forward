#!/bin/bash
# 노트북에 앉으면 이것부터 실행한다:  ./시작.sh
#
# 이 폴더는 iCloud 로 여러 노트북이 함께 쓴다. 소스는 따라오지만 설치물(node_modules, .venv)은
# 노트북마다 달라야 해서 동기화에서 뺐다(.nosync). 이 스크립트는 이 노트북의 설치물이 멀쩡한지 보고,
# 아니면 그 자리에서 다시 만든다. 멀쩡하면 아무것도 바꾸지 않는다. 몇 번을 실행해도 된다.

set -u
ROOT="$(cd "$(dirname "$0")" && pwd)"
FE="$ROOT/web/frontend"
BE="$ROOT/web/backend"

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fix()  { printf '  \033[33m→\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAILED=1; }
FAILED=0

require_ports_free() {
  local busy="" p
  for p in 8010 5180; do
    lsof -iTCP:$p -sTCP:LISTEN -t >/dev/null 2>&1 && busy="$busy $p"
  done
  if [ -n "$busy" ]; then
    fail "다시 설치해야 하는데 포트가 사용 중이다:$busy — ./정리.sh 로 끄고 다시 실행한다"
    exit 1
  fi
}

clean_conflict_copies() {
  local dir="$1" name="$2" c
  for c in "$dir/$name "[0-9]*; do
    [ -e "$c" ] || continue
    if rmdir "$c" 2>/dev/null; then fix "빈 충돌 사본 삭제: ${c#$ROOT/}"; else fail "비어 있지 않은 충돌 사본(직접 확인): ${c#$ROOT/}"; fi
  done
}

echo "▶ 이 노트북: $(whoami)@$(hostname -s)"

echo "▶ 화면 (web/frontend)"
clean_conflict_copies "$FE" "node_modules"
fe_ok=1
[ -L "$FE/node_modules" ] || fe_ok=0
[ -x "$FE/node_modules/.bin/vite" ] && [ -x "$FE/node_modules/.bin/tsc" ] || fe_ok=0
cmp -s "$FE/package-lock.json" "$FE/deps.nosync/package-lock.json" || fe_ok=0
if [ $fe_ok = 1 ]; then
  ok "node_modules 정상"
else
  require_ports_free
  fix "node_modules 재설치 (1~2분)"
  rm -rf "$FE/node_modules" "$FE/deps.nosync"
  mkdir -p "$FE/deps.nosync"
  cp "$FE/package.json" "$FE/package-lock.json" "$FE/deps.nosync/"
  (cd "$FE/deps.nosync" && npm ci --no-audit --no-fund) || fail "npm ci 실패"
  ln -s deps.nosync/node_modules "$FE/node_modules"
  [ -x "$FE/node_modules/.bin/vite" ] && ok "node_modules 설치 완료" || fail "vite 실행 파일이 없다"
fi

echo "▶ 서버 (web/backend)"
clean_conflict_copies "$BE" ".venv"
be_ok=1
[ -x "$BE/.venv/bin/python" ] || be_ok=0
cmp -s "$BE/requirements.txt" "$BE/.venv.nosync/requirements.txt" || be_ok=0
if [ $be_ok = 1 ] && "$BE/.venv/bin/python" -c "import fastapi, uvicorn, httpx" 2>/dev/null; then
  ok ".venv 정상"
else
  require_ports_free
  fix ".venv 재생성"
  rm -rf "$BE/.venv" "$BE/.venv.nosync"
  PY="$(command -v python3.11 || command -v python3)"
  "$PY" -m venv "$BE/.venv.nosync" && ln -s .venv.nosync "$BE/.venv"
  "$BE/.venv/bin/pip" install -q -r "$BE/requirements.txt" || fail "pip 설치 실패"
  cp "$BE/requirements.txt" "$BE/.venv.nosync/requirements.txt"
  "$BE/.venv/bin/python" -c "import fastapi" 2>/dev/null && ok ".venv 설치 완료" || fail "fastapi 가 설치되지 않았다"
fi
[ -f "$BE/.env" ] && ok ".env 있음 (AI 키는 이 노트북에만)" || fix ".env 없음 → web/backend/.env.example 을 복사해 LLM 값을 채운다 (없어도 규칙 기반으로 동작)"

echo "▶ 데이터 (data/local)"
mkdir -p "$ROOT/data/local"
[ -f "$ROOT/data/local/license_fit.db" ] && ok "DB 있음" || fix "DB 없음 → 서버를 처음 켜면 기준 데이터로 자동 생성된다"

echo
if [ $FAILED = 0 ]; then
  printf '\033[32m준비 완료\033[0m\n'
  echo "  서버:  cd web/backend && ./.venv/bin/python -m uvicorn app.main:app --port 8010"
  echo "  화면:  npm --prefix web/frontend run dev   → http://localhost:5180 (센서는 Chrome)"
else
  printf '\033[31m위 빨간 줄을 먼저 해결한다\033[0m\n'
  exit 1
fi
