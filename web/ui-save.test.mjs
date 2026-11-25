/**
 * 界面级保存验证：在重做后的可视化编辑器中改值 → 保存 → 读回文件确认落盘。
 * 运行：node web/ui-save.test.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE || 'http://localhost:3001';
const PASSWORD = process.env.APP_PASSWORD || 'test123';
// 路径以本文件所在目录为基准，避免受运行目录影响
const FILE = process.env.COMPOSE_FILE
  || fileURLToPath(new URL('../test-compose/legacy/docker-compose.yml', import.meta.url));

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

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.locator('input[type="password"]').fill(PASSWORD);
await page.locator('button:has-text("登录")').click();
await page.waitForSelector('.project-card');
await page.locator('.project-card:has-text("legacy")').first().click();
await page.waitForSelector('.ce-form');
await page.waitForTimeout(800);

const before = readFileSync(FILE, 'utf8');

// 1) 在「基础」分组修改镜像字段
const imageInput = page.locator('.ce-row:has-text("镜像") input').first();
await imageInput.fill('nginx:1.27-redesign');
await page.waitForTimeout(300);

const dirty = await page.locator('.ce-save-status').innerText();
check('保存栏提示出现未保存状态', /未保存/.test(dirty), dirty);

// 2) 切到「网络」分组改端口
await page.locator('.ce-nav-item:has-text("网络")').click();
await page.waitForTimeout(300);
const portInput = page.locator('.ce-row:has-text("端口映射") input').first();
await portInput.fill('9090:80');
await page.waitForTimeout(300);

// 3) 保存
await page.locator('.ce-savebar button:has-text("保存全部配置")').click();
await page.waitForTimeout(1500);

const after = readFileSync(FILE, 'utf8');
check('镜像改动已落盘', after.includes('nginx:1.27-redesign'), after.slice(0, 120));
check('端口改动已落盘', after.includes('9090:80'));
check('文件内容确实发生变化', before !== after);

// 4) 保存后状态复位
const status = await page.locator('.ce-save-status').innerText();
check('保存后提示回到已保存', /已保存/.test(status), status);

// 5) 还原文件，避免污染测试数据
await page.locator('.ce-nav-item:has-text("基础")').click();
await page.waitForTimeout(300);
await page.locator('.ce-row:has-text("镜像") input').first().fill('nginx:1.25');
await page.locator('.ce-nav-item:has-text("网络")').click();
await page.waitForTimeout(300);
await page.locator('.ce-row:has-text("端口映射") input').first().fill('8080:80');
await page.locator('.ce-savebar button:has-text("保存全部配置")').click();
await page.waitForTimeout(1500);
const restored = readFileSync(FILE, 'utf8');
check('测试数据已还原', restored.includes('nginx:1.25') && restored.includes('8080:80'));

console.log('\n控制台错误:', errors.length ? errors.join(' | ') : '无');
check('无控制台错误', errors.length === 0);

await browser.close();
console.log(`\n通过 ${pass} / ${pass + fail}`);
process.exit(fail ? 1 : 0);
