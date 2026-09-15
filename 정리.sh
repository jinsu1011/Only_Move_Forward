#!/bin/bash
# 노트북을 떠나기 전에 실행한다:  ./정리.sh
#
# 이 노트북에서 띄운 서버(8010)·화면(5180)을 끈다.
# 이유: DB(data/local/license_fit.db)는 iCloud 로 함께 쓴다. 서버가 켜진 채로 다른 노트북에서 열면
# 쓰다 만 DB 조각(-wal, -shm)이 넘어가 기록이 깨질 수 있다. 끄고 몇 초 기다리면 iCloud 가 완성본을 올린다.

set -u
stopped=0
for p in 8010 5180; do
  pids=$(lsof -iTCP:$p -sTCP:LISTEN -t 2>/dev/null)
  if [ -n "$pids" ]; then
    kill $pids 2>/dev/null && echo "  ✓ $p 포트 종료 (PID $pids)"
    stopped=1
  fi
done
[ $stopped = 0 ] && echo "  ✓ 떠 있는 서버·화면 없음"

sleep 1
for p in 8010 5180; do
  if lsof -iTCP:$p -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "  ✗ $p 가 아직 떠 있다. 그 창에서 Ctrl+C 로 끈다"
  fi
done

echo
echo "커밋·push 는 따로 한다. 다른 노트북에서는 git pull → ./시작.sh"
