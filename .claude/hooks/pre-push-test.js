/**
 * PreToolUse hook: 在 git push 之前运行 npm test
 * 测试不通过则阻止 push
 */
const { execSync } = require('child_process');
const path = require('path');

// 读取 hook 输入 JSON
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const parsed = JSON.parse(input);
    const cmd = (parsed.tool_input && parsed.tool_input.command) || '';

    // 只拦截 git push 命令
    if (!/^git\s+push\b/.test(cmd.trim())) {
      process.exit(0);
    }

    const projectDir = path.resolve(__dirname, '..', '..');
    console.error('[pre-push hook] 检测到 git push，运行 npm test...');

    try {
      execSync('npm test', {
        cwd: projectDir,
        stdio: 'inherit',
        timeout: 120000
      });
      console.error('[pre-push hook] npm test 通过，允许 push');
      process.exit(0);
    } catch (err) {
      console.error('[pre-push hook] npm test 失败，阻止 push');
      // 输出 JSON 阻止 push
      process.stdout.write(JSON.stringify({
        continue: false,
        stopReason: 'npm test 失败，push 已被阻止。请修复失败的测试后再 push。'
      }));
      process.exit(0);
    }
  } catch (err) {
    // JSON 解析失败等异常，放行
    console.error('[pre-push hook] 异常:', err.message);
    process.exit(0);
  }
});
