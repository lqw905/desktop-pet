const fs = require('fs');
const path = require('path');

const hooksDir = path.resolve(__dirname, '..', '.git', 'hooks');
const scriptsDir = path.resolve(__dirname);

// 确保 .git/hooks 目录存在
if (!fs.existsSync(hooksDir)) {
  console.log('[install-hooks] 非 git 仓库，跳过 hook 安装');
  process.exit(0);
}

const hooks = fs.readdirSync(scriptsDir).filter(f => !f.endsWith('.js'));
let installed = 0;

for (const hook of hooks) {
  const src = path.join(scriptsDir, hook);
  const dest = path.join(hooksDir, hook);
  if (fs.statSync(src).isFile()) {
    fs.copyFileSync(src, dest);
    // 设置可执行权限
    try { fs.chmodSync(dest, 0o755); } catch {}
    installed++;
  }
}

console.log(`[install-hooks] 已安装 ${installed} 个 git hook: ${hooks.join(', ')}`);
