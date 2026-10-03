#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js，请安装 Node.js 20.19+ 或 22.12+。"
  exit 1
fi

if [[ ! -d node_modules ]]; then
  echo "首次运行，正在安装依赖…"
  npm install
fi

echo "正在启动流绘 FlowSketch…"
npm start
