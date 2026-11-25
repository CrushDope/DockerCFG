/**
 * 浏览器渲染验证：确认页面无控制台报错、项目列表与可视化编辑器能正常渲染。
 * 运行：node web/render-check.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:3001';
const PASSWORD = process.env.APP_PASSWORD || 'test123';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));

async function shot(name) {
  await page.screenshot({ path: `web/shots/${name}.png`, fullPage: true });
  console.log('  截图 -> web/shots/' + name + '.png');
}

await page.goto(BASE, { waitUntil: 'networkidle' });

// 登录
if (await page.locator('.login-shell').count()) {
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.locator('button:has-text("登录")').click();
  await page.waitForSelector('.project-card', { timeout: 10000 });
}
await page.waitForTimeout(800);

console.log('\n=== 项目列表页 ===');
console.log('  项目条目数:', await page.locator('.project-card').count());
console.log('  项目名:', (await page.locator('.project-name').allTextContents()).join(', '));
console.log('  统计:', (await page.locator('.fleet-metric dd').allTextContents()).join(' / '));
await shot('01-projects');

// 进入 legacy 项目
await page.locator('.project-card:has-text("legacy")').first().click();
await page.waitForSelector('.detail', { timeout: 10000 });
await page.waitForTimeout(1200);

console.log('\n=== 可视化编辑页（三栏工作台）===');
console.log('  服务栏条目:', await page.locator('.ce-rail .ce-svc-item').count());
console.log('  分组导航:', (await page.locator('.ce-nav-item .ce-nav-label').allTextContents()).join(' | '));
console.log('  分组计数:', (await page.locator('.ce-nav-count').allTextContents()).join(', '));

const labels = await page.locator('.ce-row-label .sf-cn').allTextContents();
console.log('  基础分组中文字段名:', labels.join('、'));
const enKeys = await page.locator('.ce-row-label .sf-en').allTextContents();
console.log('  对应英文键名:', enKeys.join('、'));
await shot('02-editor-basic');

// 网络分组
await page.locator('.ce-nav-item:has-text("网络")').click();
await page.waitForTimeout(400);
console.log('\n=== 网络分组 ===');
console.log('  字段:', (await page.locator('.ce-row-label .sf-cn').allTextContents()).join('、'));
await shot('03-editor-network');

// 构建与资源分组（结构化子表单）
await page.locator('.ce-nav-item:has-text("构建与资源")').click();
await page.waitForTimeout(400);
console.log('\n=== 构建与资源分组 ===');
console.log('  结构化子表单数:', await page.locator('.struct-editor').count());
await shot('04-editor-build');

// 环境变量分组
await page.locator('.ce-nav-item:has-text("环境变量")').click();
await page.waitForTimeout(400);
console.log('\n=== 环境变量分组 ===');
console.log('  表格行数(含表头):', await page.locator('.env-tr').count());
await shot('05-editor-env');

// 字段搜索
await page.locator('.ce-search input').fill('端口');
await page.waitForTimeout(500);
console.log('\n=== 字段搜索「端口」===');
console.log('  命中分组:', (await page.locator('.ce-nav-item .ce-nav-label').allTextContents()).join(' | '));
console.log('  命中字段:', (await page.locator('.ce-row-label .sf-cn').allTextContents()).join('、'));
await shot('06-editor-search');
await page.locator('.ce-search input').fill('');
await page.waitForTimeout(400);

// 顶层配置
await page.locator('.ce-seg .el-radio-button:has-text("顶层配置")').click();
await page.waitForTimeout(600);
console.log('\n=== 顶层配置 ===');
console.log('  卡片数:', await page.locator('.ce-card').count());
await shot('07-top-level');

// 回到服务配置并检查吸底保存栏
await page.locator('.ce-seg .el-radio-button:has-text("服务配置")').click();
await page.waitForTimeout(500);
const savebar = await page.locator('.ce-savebar').count();
console.log('\n=== 保存栏 ===');
console.log('  吸底保存栏存在:', savebar === 1);
console.log('  状态文案:', (await page.locator('.ce-save-status').innerText()).replace(/\s+/g, ' ').trim());
await shot('08-editor-savebar');

// 吸附检查：缩短视口让页面有足够滚动余量，再滚到底部，
// 左侧服务栏、中间分组导航应固定在顶栏下方 74px，保存栏固定在底部 12px。
await page.setViewportSize({ width: 1600, height: 700 });
await page.waitForTimeout(400);
await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
await page.waitForTimeout(600);
const stuck = await page.evaluate(() => {
  const top = (s) => Math.round(document.querySelector(s).getBoundingClientRect().top);
  const bottom = (s) => Math.round(document.querySelector(s).getBoundingClientRect().bottom);
  return {
    nav: top('.ce-nav'), rail: top('.ce-rail'), saveBottom: bottom('.ce-savebar'),
    vh: window.innerHeight, scrollY: window.scrollY,
    maxScroll: Math.round(document.documentElement.scrollHeight - window.innerHeight),
  };
});
const navStuck = Math.abs(stuck.nav - 74) < 6;
const railStuck = Math.abs(stuck.rail - 74) < 6;
// 保存栏：短页面滚动余量不足时会停在编辑器末尾，只需保证始终完整可见且不被顶栏遮挡
const saveVisible = stuck.saveBottom > 0 && stuck.saveBottom <= stuck.vh;
console.log('\n=== 吸附检查（视口 700px，滚到底部）===');
console.log(`  分组导航 top=${stuck.nav}px  服务栏 top=${stuck.rail}px  保存栏 bottom=${stuck.saveBottom}px / 视口 ${stuck.vh}px`);
console.log(`  滚动位置 ${stuck.scrollY}/${stuck.maxScroll}px`);
console.log(`  吸附生效: 分组导航=${navStuck ? '是' : '否'}  服务栏=${railStuck ? '是' : '否'}  保存栏可见=${saveVisible ? '是' : '否'}`);
await shot('09-editor-sticky');
await page.evaluate(() => window.scrollTo(0, 0));
await page.setViewportSize({ width: 1600, height: 1000 });
await page.waitForTimeout(400);

// 路由检查
console.log('\n=== 路由 ===');
console.log('  当前路径:', new URL(page.url()).pathname);
await page.goto(BASE + '/project/chaseTV', { waitUntil: 'networkidle' });
await page.waitForSelector('.ce-rail', { timeout: 10000 });
await page.waitForTimeout(800);
console.log('  深链接路径:', new URL(page.url()).pathname);
console.log('  深链接渲染服务条目:', await page.locator('.ce-svc-item').count());
await page.goBack();
await page.waitForTimeout(900);
console.log('  浏览器后退后路径:', new URL(page.url()).pathname);

// 返回列表，确认导航正常
await page.locator('.detail-breadcrumb button').click();
await page.waitForTimeout(800);
console.log('\n=== 返回列表 ===');
console.log('  当前路径:', new URL(page.url()).pathname);
console.log('  项目条目数:', await page.locator('.project-card').count());

console.log('\n=== 控制台错误 ===');
if (errors.length) {
  errors.forEach((e) => console.log('  ' + e));
} else {
  console.log('  无');
}

await browser.close();
process.exit(errors.length ? 1 : 0);
