#!/bin/zsh
set -e
cd -- "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 24，再重新打开。'
  read -r '?按回车退出'
  exit 1
fi
if [ ! -d node_modules ]; then npm ci; fi
npm run build
npm run local:start
open http://localhost:3000
echo '服务已在后台运行，现在可以关闭此窗口。账号密码见项目 .env。'
