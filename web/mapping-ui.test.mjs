/**
 * 双列映射编辑器界面级回归：宿主机/容器/协议分列填写 → 保存 → 精确核对落盘 → 还原。
 * 运行：node web/mapping-ui.test.mjs（需后端在 BASE 运行且 APP_PASSWORD 一致）
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE || 'http://localhost:3001';
const PASSWORD = process.env.APP_PASSWORD || 'test123';
const FILE = fileURLToPath(new URL('../test-compose/legacy/docker-compose.yml', import.meta.url));

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
};

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

async function pick(rowIndex, label) {
  await page.locator('.map-row').nth(rowIndex).locator('.el-select').click();
  await page.waitForTimeout(250);
  await page.locator('.el-select-dropdown__item:visible').filter({ hasText: label }).first().click();
  await page.waitForTimeout(250);
}

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.locator('input[type="password"]').fill(PASSWORD);
await page.locator('button:has-text("登录")').click();
await page.waitForSelector('.project-card');
await page.locator('.project-card:has-text("legacy")').first().click();
await page.waitForSelector('.ce-rail');
await page.waitForTimeout(900);

// 1) 网络分组：端口双列 + 协议
await page.locator('.ce-nav-item:has-text("网络")').click();
await page.waitForTimeout(500);
await page.locator('.map-host input').first().fill('9090');
await page.locator('.map-container input').first().fill('90');
await pick(0, 'UDP');

// 2) 存储分组：挂载权限
await page.locator('.ce-nav-item:has-text("存储")').click();
await page.waitForTimeout(500);
await pick(0, '读写 rw');

// 3) 保存并核对
await page.locator('.ce-savebar button:has-text("保存全部配置")').click();
await page.waitForTimeout(1800);
const after = readFileSync(FILE, 'utf8');
check('端口精确落盘为 9090:90/udp', after.includes('9090:90/udp'));
check('旧端口 8080:80 已消失', !after.includes('8080:80'));
check('挂载权限精确落盘为 rw', after.includes('./html:/usr/share/nginx/html:rw'));
check('其他端口未受影响', after.includes('8443:443'));

// 4) 还原测试数据
await page.locator('.ce-nav-item:has-text("网络")').click();
await page.waitForTimeout(400);
await page.locator('.map-host input').first().fill('8080');
await page.locator('.map-container input').first().fill('80');
await pick(0, '默认 TCP');
await page.locator('.ce-nav-item:has-text("存储")').click();
await page.waitForTimeout(400);
await pick(0, '只读 ro');
await page.locator('.ce-savebar button:has-text("保存全部配置")').click();
await page.waitForTimeout(1800);
const restored = readFileSync(FILE, 'utf8');
check('测试数据已还原', restored.includes('8080:80') && restored.includes(':ro'));

console.log('\n控制台错误:', errors.length ? errors.join(' | ') : '无');
check('无控制台错误', errors.length === 0);

await browser.close();
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
