import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import sharp from "sharp";
const dir = await mkdtemp(join(tmpdir(), "lottery-e2e-"));
const port = Number(process.env.E2E_PORT ?? 3107),
  origin = `http://localhost:${port}`;
let logs = "",
  browser;
const server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
  env: {
    ...process.env,
    ADMIN_USER: "admin",
    ADMIN_PASSWORD: "test-e2e-password-123",
    PORT: String(port),
    APP_ORIGIN: origin,
    DATA_DIR: dir,
    HOST: "127.0.0.1",
  },
});
server.stdout.on("data", (d) => (logs += d));
server.stderr.on("data", (d) => (logs += d));
try {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin + "/api/health")).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
    if (i === 99) throw Error(logs);
  }
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1080 },
    }),
    page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mkdir("test-results", { recursive: true });
  await page.goto(origin);
  await page.screenshot({
    path: "test-results/login.png",
    fullPage: true,
  });
  await page.getByLabel("登录密码").fill("test-e2e-password-123");
  await page.getByRole("button", { name: "登录工作台" }).click();
  await page.getByRole("button", { name: "体验示例活动" }).click();
  await page
    .getByRole("heading", { name: "美好相聚 · 幸运盛典", exact: true })
    .waitFor();
  const req = async (path, method = "GET", body) => {
    const r = await context.request.fetch(origin + "/api" + path, {
      method,
      headers: { Origin: origin, "X-Requested-With": "lottery" },
      ...(body !== undefined ? { data: body } : {}),
    });
    const data = await r.json();
    assert.ok(r.ok(), JSON.stringify(data));
    return data;
  };
  const activities = await req("/activities"),
    id = activities[0].id,
    base = "/activities/" + id;
  const state = () => req(base),
    view = () => req(base + "/stage");
  await page.getByRole("button", { name: "礼品管理", exact: true }).click();
  await page.getByRole("button", { name: "从礼品库选择" }).click();
  await page.getByRole("button", { name: "小米电暖气", exact: true }).click();
  await page.getByLabel("礼品总数量").fill("4");
  await page.getByRole("button", { name: "保存礼品" }).click();
  await page.getByText("礼品已保存").waitFor();
  const libraryGift = (await state()).gifts.find(g => g.name === "小米电暖气");
  assert.equal(libraryGift.total, 4);
  assert.match(libraryGift.image, /^\/api\/images\//);
  assert.equal((await context.request.get(origin + libraryGift.image)).status(), 200);
  await req(base + "/gifts/" + libraryGift.id, "DELETE");
  await page.getByRole("button", { name: "参与名单", exact: true }).click();
  const importBook = new ExcelJS.Workbook();
  for (const sheetName of ["一区", "二区"]) {
    const sheet = importBook.addWorksheet(sheetName);
    sheet.addRow(["姓名", "电话", "门店名称"]);
    sheet.addRow(["虚构导入来宾", "TEST-IMPORT-01", "测试门店"]);
  }
  await page.locator('input[type="file"][accept=".xlsx"]').setInputFiles({name:"名单.xlsx", mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer:Buffer.from(await importBook.xlsx.writeBuffer())});
  await page.getByText(/共读取 2 个工作表、2 行，合并为 1 人/).waitFor();
  await page.getByRole("button", { name: "确认导入 1 人" }).click();
  await page.getByText("名单已全部导入").waitFor();
  const imported = (await state()).people.find(p => p.phone === "TEST-IMPORT-01");
  assert.equal(imported.drawChances, 2);
  await req(base + "/people/" + imported.id, "DELETE");
  const filterPeople = await req(base + "/people", "POST", {rows:[
    {name:"筛选甲",phone:"FILTER-01",store:"筛选门店甲",salesperson:"筛选销售甲"},
    {name:"筛选乙",phone:"FILTER-02",store:"筛选门店甲",salesperson:"筛选销售乙"},
    {name:"筛选丙",phone:"FILTER-03",store:"筛选门店乙",salesperson:"筛选销售甲"},
  ]});
  await page.reload();
  await page.getByRole("button", {name:"参与名单", exact:true}).click();
  await page.getByLabel("按门店筛选").selectOption({label:"筛选门店甲"});
  await page.getByLabel("按对应销售筛选").selectOption({label:"筛选销售甲"});
  assert.equal(await page.getByText("筛选甲", {exact:true}).count(),1);
  assert.equal(await page.getByText("筛选乙", {exact:true}).count(),0);
  assert.equal(await page.getByText("筛选丙", {exact:true}).count(),0);
  await page.getByRole("button", {name:"清除筛选"}).click();
  assert.equal(await page.getByText("筛选乙", {exact:true}).count(),1);
  await page.getByRole("button", {name:"抽奖控制台", exact:true}).click();
  await page.getByLabel("查找销售").selectOption({label:"筛选销售甲"});
  const guestList = page.getByLabel("选择可抽来宾");
  assert.equal(await guestList.locator("option").filter({hasText:"筛选甲"}).count(), 1);
  assert.equal(await guestList.locator("option").filter({hasText:"筛选丙"}).count(), 1);
  assert.equal(await guestList.locator("option").filter({hasText:"筛选乙"}).count(), 0);
  await guestList.selectOption(filterPeople[0].id);
  await page.getByLabel("查找销售").selectOption({label:"全部销售"});
  for (const person of filterPeople) await req(base + "/people/" + person.id, "DELETE");
  const clearActivity = await req("/testing/activities", "POST", {});
  await req(`/activities/${clearActivity.id}/testing`, "POST", {action:"people",count:20,requestId:crypto.randomUUID()});
  const clearContext = await browser.newContext({storageState:await context.storageState()});
  const clearPage = await clearContext.newPage();
  await clearPage.addInitScript(id => localStorage.setItem("lottery-activity", id), clearActivity.id);
  await clearPage.goto(origin);
  await clearPage.getByRole("button", {name:"参与名单",exact:true}).click();
  await clearPage.getByLabel("参与名单统计").getByText("20",{exact:true}).first().waitFor();
  await clearPage.getByRole("button", {name:"一键清空名单"}).click();
  await clearPage.getByLabel("请输入“清空”确认").fill("清空");
  await clearPage.getByRole("button", {name:"确认清空全部名单"}).click();
  await clearPage.getByText("参与名单已清空").waitFor();
  assert.equal((await req(`/activities/${clearActivity.id}`)).people.length,0);
  await clearContext.close();
  await req(`/activities/${clearActivity.id}`, "DELETE");
  const command = async (action, extra = {}) =>
    req(base + "/stage-command", "POST", {
      requestId: crypto.randomUUID(),
      expectedVersion: (await view()).session.version,
      action,
      ...extra,
    });
  const stage = await context.newPage();
  stage.on("pageerror", (e) => errors.push(e.message));
  await stage.setViewportSize({ width: 1920, height: 1080 });
  await stage.goto(origin + "/stage/" + id);
  await stage.locator('[data-scene="welcome"]').waitFor();
  await page.getByRole("button", { name: "参与名单", exact: true }).click();
  await page
    .getByRole("button", { name: "标记到场", exact: true })
    .first()
    .click();
  assert.equal((await state()).people.filter((p) => p.checkedIn).length, 1);
  await page.getByRole("button", { name: "抽奖控制台", exact: true }).click();
  await page.getByTestId("scene-gifts").click();
  await stage.locator('[data-scene="gifts"]').waitFor();
  await stage.screenshot({
    path: "test-results/v2-gift-wall.png",
    fullPage: true,
  });
  await page.getByTestId("scene-draw").click();
  const initial = await state();
  const person = initial.people[0];
  assert.equal(
    await page.getByLabel("仅已到场来宾", { exact: true }).count(),
    0,
  );
  await page.getByLabel("查找来宾", { exact: true }).fill(person.name);
  await page.getByRole("button", { name: "预览本轮", exact: true }).click();
  await stage.locator('.stage[data-phase="idle"]').waitFor();
  // Input focus and held keys must not start a round.
  await page.getByLabel("查找来宾", { exact: true }).focus();
  await page.keyboard.press("Space");
  assert.equal((await state()).rounds.length, 0);
  await page
    .getByRole("heading", { name: "主持工作台", exact: false })
    .first()
    .click()
    .catch(() => page.locator("h1").first().click());
  await page.getByTestId("host-start").click();
  await stage.locator('.stage[data-phase="rolling"]').waitFor();
  const pending = await view();
  assert.equal(pending.currentRound, null);
  assert.equal(pending.rounds.length, 0);
  assert.equal((await state()).rounds.length, 1);
  await page.keyboard.down("Space");
  await page.keyboard.down("Space");
  await page.keyboard.up("Space");
  // Space may stop, but must never commit a second round.
  assert.equal((await state()).rounds.length, 1);
  if ((await view()).session.phase === "rolling")
    await page.getByTestId("host-stop").click();
  await stage.locator('.stage[data-phase="revealed"]').waitFor();
  await page.locator(".host-preview .prize-machine").waitFor();
  await stage.locator(".winner-person b").first().waitFor();
  assert.notEqual(
    await stage.locator(".winner-person b").first().innerText(),
    person.name,
  );
  assert.ok(!(await stage.locator("body").innerText()).includes(person.phone));
  await stage.screenshot({
    path: "test-results/v2-single.png",
    fullPage: true,
  });
  await page.getByTestId("host-replay").click();
  await stage.locator('.stage[data-phase="decelerating"]').waitFor();
  await page.getByTestId("host-skip").click();
  await stage.locator('.stage[data-phase="revealed"]').waitFor();
  assert.equal((await state()).rounds.length, 1);
  assert.equal(await page.getByTestId("host-next").count(), 0);

  await page.locator(".host-selection").getByRole("button", { name: "按奖项抽人", exact: true }).click();
  const fixedGift = (await state()).gifts.find(gift => gift.remaining >= 2 && (gift.batchLimit ?? 50) >= 2);
  await page.getByLabel("本轮礼品").selectOption(fixedGift.id);
  await page.getByLabel("本轮人数", { exact: true }).fill("2");
  await page.getByTestId("host-start").click();
  await stage.locator('.stage[data-phase="rolling"]').waitFor();
  await stage.locator('[data-testid="stage-portrait-strip"][data-running="true"]').waitFor();
  await page.getByTestId("host-stop").click();
  await stage.locator('.stage[data-phase="revealed"]').waitFor();
  assert.equal((await state()).summary.winnerCount, 3);
  assert.ok((await state()).rounds[0].winners.every(winner => winner.giftId === fixedGift.id));
  await stage.screenshot({ path: "test-results/v2-batch.png", fullPage: true });
  // Rehearsal is isolated from official records/inventory.
  const before = await state();
  await page.getByRole("button", { name: "独立彩排", exact: true }).click();
  const rehearsal = page.getByRole("dialog", { name: "独立彩排", exact: true });
  await rehearsal.waitFor();
  await rehearsal.getByLabel("彩排来宾").selectOption({ index: 1 });
  const run = rehearsal.getByRole("button", { name: "开始彩排", exact: false });
  if (await run.count()) {
    await run.click();
    await page.waitForTimeout(4800);
  }
  assert.deepEqual((await state()).rounds, before.rounds);
  await page.getByRole("button", { name: "关闭", exact: true }).first().click();
  await page.getByRole("button", { name: "现场自检", exact: true }).click();
  await page.getByText("待人工确认，不能自动判定", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭", exact: true }).first().click();
  // Claim and reversal keep inventory unchanged and require a reason.
  await page.getByRole("button", { name: "中奖记录", exact: true }).click();
  await page
    .getByRole("button", { name: "确认领取", exact: true })
    .first()
    .click();
  await page
    .getByRole("button", { name: "撤销核销", exact: true })
    .first()
    .waitFor();
  assert.equal(
    (await state()).rounds.flatMap((r) => r.winners).filter((w) => w.claimed)
      .length,
    1,
  );
  page.once("dialog", (d) => d.accept("测试撤销"));
  await page
    .getByRole("button", { name: "撤销核销", exact: true })
    .first()
    .click();
  await page.getByText("已撤销领取核销", { exact: true }).waitFor();
  assert.equal((await state()).summary.remainingCount, 9);
  await page.getByRole("button", { name: "抽奖控制台", exact: true }).click();
  // Drop successful start response; retry after reload reuses original request.
  assert.equal(await page.getByTestId("host-next").count(), 0);
  // 顶栏左上角模式切换器可直接切换模式并同步进入抽奖控制台
  await page.getByTestId("topbar-mode-switcher").getByRole("button", { name: /按人抽礼品/ }).click();
  await page.locator(".host-selection").getByRole("button", { name: "按人抽礼品", exact: true }).waitFor();
  const next = (await state()).people.find((p) => !p.won);
  await page.getByLabel("查找来宾", { exact: true }).fill(next.name);
  let startResponseDropped;
  const responseDropped = new Promise(resolve => { startResponseDropped = resolve; });
  await page.route("**/api" + base + "/stage-command", async (route) => {
    if (route.request().postDataJSON()?.action === "start") {
      await route.fetch();
      await route.abort("failed");
      startResponseDropped();
    } else await route.continue();
  });
  await page.getByTestId("host-start").click();
  await page
    .getByRole("button", { name: "查询并恢复本轮结果", exact: true })
    .waitFor();
  const requestId = await page.evaluate(
    (id) => JSON.parse(sessionStorage.getItem("stage-pending-" + id)).requestId,
    id,
  );
  await responseDropped;
  await page.unroute("**/api" + base + "/stage-command");
  page.once("dialog", (d) => d.accept());
  await page.reload();
  await page.getByRole("button", { name: "抽奖控制台", exact: true }).click();
  await page
    .getByRole("button", { name: "查询并恢复本轮结果", exact: true })
    .click();
  await page.waitForFunction(
    (id) => !sessionStorage.getItem("stage-pending-" + id),
    id,
  );
  assert.equal(
    (await state()).rounds.filter((r) => r.requestId === requestId).length,
    1,
  );
  await page.getByTestId("host-skip").click();
  await stage.locator('.stage[data-phase="revealed"]').waitFor();
  // Page sync, PNG export, persistent scenes.
  const availableStock = (await state()).gifts
    .filter((g) => g.enabled && g.singleEnabled)
    .reduce((sum, g) => sum + g.remaining, 0);
  assert.ok(availableStock >= 5, "测试需要至少 5 份可抽奖库存");
  await command("start", { selection: { mode: "batch", count: 5 } });
  await command("skip");
  await page
    .locator(".host-bar small")
    .filter({ hasText: "版本 " + (await view()).session.version + " ·" })
    .waitFor();
  await page.getByTestId("scene-winners").click();
  await stage.locator('[data-scene="winners"]').waitFor();
  await command("page", { page: 1 });
  await stage
    .getByText("第 2 / 2 页 · 由主持台同步翻页", { exact: true })
    .waitFor();
  const [download] = await Promise.all([
    stage.waitForEvent("download"),
    stage.getByRole("button", { name: /导出.*结果图/ }).click(),
  ]);
  assert.ok(download.suggestedFilename().endsWith(".png"));
  await page
    .locator(".host-bar small")
    .filter({ hasText: "版本 " + (await view()).session.version + " ·" })
    .waitFor();
  assert.equal(
    await page.locator(".host-result tbody tr").count(),
    1,
    "中奖墙第二页主持预览应与大屏显示同一个结果",
  );
  await page.screenshot({ path: "test-results/v2-host.png", fullPage: true });
  await page.getByTestId("scene-end").click();
  await stage.locator('[data-scene="end"]').waitFor();
  await stage.reload();
  await stage.locator('[data-scene="end"]').waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/v2-mobile-host.png",
    fullPage: true,
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  const annual = await req("/activities", "POST", { name: "年会主持验收" });
  const annualBase = "/activities/" + annual.id;
  const annualBook = new ExcelJS.Workbook();
  const annualSheet = annualBook.addWorksheet("名单");
  annualSheet.addRow(["姓名", "电话", "门店名称", "照片文件名"]);
  annualSheet.addRow(["年会甲", "ANNUAL-01", "年会门店", "IMG_3821.png"]);
  annualSheet.addRow(["年会乙", "ANNUAL-02", "年会门店"]);
  const desktop = await browser.newContext({ storageState: await context.storageState() });
  const annualAdmin = await desktop.newPage();
  await annualAdmin.addInitScript(value => localStorage.setItem("lottery-activity", value), annual.id);
  await annualAdmin.goto(origin);
  await annualAdmin.getByRole("button", { name: "参与名单", exact: true }).click();
  await annualAdmin.locator('input[type="file"][accept=".xlsx"]').setInputFiles({
    name: "年会名单.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(await annualBook.xlsx.writeBuffer()),
  });
  await annualAdmin.getByRole("button", { name: "确认导入 2 人" }).click();
  await annualAdmin.getByText("名单已全部导入").waitFor();
  await annualAdmin.getByRole("button", { name: "批量匹配照片" }).click();
  const portrait = await sharp({ create: { width: 64, height: 80, channels: 3, background: "#cd5942" } }).png().toBuffer();
  await annualAdmin.getByLabel("选择照片").setInputFiles({ name: "IMG_3821.png", mimeType: "image/png", buffer: portrait });
  await annualAdmin.getByText("1/1 张已匹配", { exact: false }).waitFor();
  await annualAdmin.getByRole("button", { name: "上传并绑定已匹配照片" }).click();
  await annualAdmin.getByText(/已绑定 1 张照片/).waitFor();
  const attachedPerson = (await req(annualBase)).people.find(person => person.phone === "ANNUAL-01");
  assert.ok(attachedPerson.photo);
  assert.equal(attachedPerson.drawChances, 1);
  await annualAdmin.getByRole("button", { name: "关闭", exact: true }).click();
  await annualAdmin.getByRole("button", { name: "抽奖控制台", exact: true }).click();
  await annualAdmin.getByRole("button", { name: "手机主持台", exact: true }).click();
  assert.equal((await desktop.request.get(origin + "/api" + annualBase + "/host-qr")).headers()["content-type"], "image/png");
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mobile = await mobileContext.newPage();
  mobile.on("pageerror", e => errors.push(e.message));
  await mobile.goto(origin + "/host/" + annual.id);
  await mobile.getByLabel("登录密码").fill("test-e2e-password-123");
  await mobile.getByRole("button", { name: "登录工作台" }).click();
  await mobile.getByRole("heading", { name: "年会主持验收", exact: true }).waitFor();
  await mobile.getByRole("button", { name: "添加礼品", exact: true }).click();
  await mobile.getByLabel("礼品名称").fill("手机测试礼品");
  await mobile.getByLabel("数量", { exact: true }).fill("2");
  await mobile.getByLabel("礼品照片").setInputFiles({ name: "gift.png", mimeType: "image/png", buffer: portrait });
  await mobile.getByRole("button", { name: "保存礼品", exact: true }).click();
  await mobile.getByText("已添加 手机测试礼品 · 2 份").waitFor();
  const annualGift = (await req(annualBase)).gifts.find(gift => gift.name === "手机测试礼品");
  await annualAdmin.getByRole("button", { name: "关闭", exact: true }).click();
  await annualAdmin.getByRole("button", { name: "活动设置", exact: true }).click();
  await annualAdmin.getByRole("button", { name: "抽奖轮次", exact: true }).click();
  for (const [name, number] of [["一等奖提前安排", "1"], ["二等奖提前安排", "2"]]) {
    await annualAdmin.getByRole("button", { name: "新增轮次", exact: true }).click();
    const editor = annualAdmin.getByRole("dialog", { name: "新增抽奖轮次" });
    await editor.getByLabel("轮次名称").fill(name);
    await editor.getByLabel("本轮奖项").selectOption(annualGift.id);
    await editor.getByLabel("本轮人数").fill(number);
    await editor.getByLabel("指定人员").selectOption(attachedPerson.id);
    await editor.getByRole("button", { name: "添加指定人员" }).click();
    await editor.getByRole("button", { name: "保存轮次" }).click();
    await annualAdmin.getByRole("heading", { name, exact: true }).waitFor();
  }
  const savedPlans = (await req(annualBase + "/host-stage")).plans;
  assert.equal(savedPlans.length, 2);
  assert.ok(savedPlans.every(plan => plan.assignedPersonIds[0] === attachedPerson.id));
  await annualAdmin.screenshot({ path: "test-results/annual-round-settings.png", fullPage: true });
  await annualAdmin.getByRole("button", {name: "舞台与展示", exact: true}).click();
  await annualAdmin.getByLabel("欢迎语", {exact: true}).fill("年会欢迎各位");
  await annualAdmin.getByRole("button", {name: "保存设置", exact: true}).click();
  await annualAdmin.getByText("舞台与展示设置已保存").waitFor();
  assert.equal((await req(annualBase + "/stage")).config.welcomeText, "年会欢迎各位");
  await stage.goto(origin + "/stage/" + annual.id);
  const readyVersion = (await req(annualBase + "/stage")).session.version;
  await mobile.getByText(new RegExp(`版本\\s+${readyVersion}\\s*·`)).waitFor();
  await mobile.getByTestId("scene-gifts").click();
  await stage.locator('[data-scene="gifts"]').waitFor();
  await mobile.getByRole("button", { name: "按奖项抽人", exact: true }).click();
  await mobile.getByLabel("选用已保存轮次").selectOption(savedPlans[1].id);
  await mobile.getByRole("button", { name: "保存下一轮草稿" }).click();
  await mobile.getByRole("button", { name: "载入已保存草稿" }).waitFor();
  const hostView = await req(annualBase + "/host-stage");
  assert.equal(hostView.hostDraft.planId, savedPlans[1].id);
  assert.ok(!JSON.stringify(await req(annualBase + "/stage")).includes("assignments"));
  assert.ok(!JSON.stringify(await req(annualBase + "/stage")).includes("assignedPersonIds"));
  mobile.on("dialog", dialog => dialog.accept());
  await mobile.getByTestId("host-start").click();
  await stage.getByTestId("stage-portrait-strip").waitFor();
  await mobile.getByTestId("stage-portrait-strip").waitFor();
  assert.equal(await stage.getByText("指定名额", { exact: false }).count(), 0);
  await mobile.getByTestId("host-stop").click();
  await stage.locator('.stage[data-phase="revealed"]').waitFor();
  await stage.locator(`.winner-person img[src="${attachedPerson.photo}"]`).waitFor();
  assert.equal((await req(annualBase)).rounds[0].winners.filter(w => w.assignment === "assigned").length, 1);
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mobile.screenshot({ path: "test-results/annual-mobile-host.png", fullPage: true });
  await stage.screenshot({ path: "test-results/annual-draw-reveal.png", fullPage: true });
  await mobileContext.close();
  await desktop.close();
  // A real 10k roster stays server-side; names renderer uses a bounded sample.
  const large = await req("/activities", "POST", { name: "万人名单显示验证" }),
    lb = "/activities/" + large.id;
  await req(lb + "/people", "POST", {
    rows: Array.from({ length: 10000 }, (_, i) => ({
      name: "规模来宾" + i,
      phone: "18" + String(i).padStart(9, "0"),
      company: "测试公司",
      store: "测试门店",
    })),
  });
  const lg = await req(lb + "/gifts", "POST", {
    name: "规模验证礼品",
    total: 1,
  });
  let lv = await req(lb + "/stage");
  await req(lb + "/stage-command", "POST", {
    requestId: crypto.randomUUID(),
    expectedVersion: lv.session.version,
    action: "config",
    config: { animation: "names" },
  });
  lv = await req(lb + "/stage");
  await req(lb + "/stage-command", "POST", {
    requestId: crypto.randomUUID(),
    expectedVersion: lv.session.version,
    action: "start",
    selection: { mode: "batch", giftId: lg.id, count: 1 },
  });
  const started = Date.now();
  await stage.goto(origin + "/stage/" + large.id);
  await stage.locator('[data-testid="stage-portrait-strip"][data-running="true"]').waitFor();
  assert.equal(await stage.locator(".stage-portrait-card").count(), 5);
  assert.equal((await req(lb + "/stage")).participants.length, 120);
  console.log(
    "10000人浏览器显示验证：人物卡片5张、接口样本120人，页面加载到显示 " +
      (Date.now() - started) +
      "ms（非现场帧率验收）。",
  );
  await stage.screenshot({
    path: "test-results/v2-10000-names.png",
    fullPage: true,
  });
  // Dedicated test activity tools are available even when a formal activity exists.
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.getByRole("button", { name: "新建测试活动", exact: true }).click();
  const toolbox = page.getByRole("region", { name: "测试模式工具箱" });
  await page.locator(".test-tools").waitFor();
  await page
    .getByRole("button", { name: "一键准备测试数据", exact: true })
    .click();
  await page
    .getByText("已添加 100 位测试来宾、6 种测试礼品", { exact: true })
    .waitFor();
  const tid = await page.getByLabel("当前活动").inputValue();
  assert.notEqual(tid, id);
  let ts = await req("/activities/" + tid);
  assert.equal(ts.testMode, true);
  assert.equal(ts.people.length, 100);
  assert.equal(ts.gifts.length, 6);
  await page.getByRole("button", { name: "添加测试礼品", exact: true }).click();
  await page.getByText(/已有测试礼品不会重复添加/).waitFor();
  assert.equal((await req("/activities/" + tid)).gifts.length, 6);
  await page.getByLabel("测试人数", { exact: true }).selectOption("20");
  await page.getByRole("button", { name: "添加测试人员", exact: true }).click();
  await page
    .getByText("已添加 20 位测试来宾、0 种测试礼品", { exact: true })
    .waitFor();
  ts = await req("/activities/" + tid);
  assert.equal(ts.people.length, 120);
  await req("/activities/" + tid + "/draw", "POST", {
    requestId: crypto.randomUUID(),
    mode: "single",
    personId: ts.people[0].id,
  });
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "清空测试结果", exact: true }).click();
  await page
    .getByText("测试结果已清空，库存和中奖资格已恢复", { exact: true })
    .waitFor();
  ts = await req("/activities/" + tid);
  assert.equal(ts.rounds.length, 0);
  assert.equal(ts.people.length, 120);
  assert.ok(ts.gifts.every((g) => g.remaining === g.total));
  assert.equal((await state()).summary.winnerCount, 9, "测试活动不改变原活动");
  await page.screenshot({
    path: "test-results/testing-tools.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  // Self-service: isolated activity, anonymous phone, lost response and queued 12-person pages.
  const selfActivity = await req("/activities", "POST", {
    name: "自主抽奖浏览器测试",
  });
  const sb = "/activities/" + selfActivity.id;
  await req(sb + "/people", "POST", {
    rows: Array.from({ length: 26 }, (_, i) => ({
      name: "测试客户" + i,
      phone: "SELF-" + i,
      store: "滨江测试门店" + i,
    })),
  });
  await req(sb + "/gifts", "POST", {
    name: "幸运礼品",
    total: 30,
    singleEnabled: true,
  });
  await req(sb + "/self", "PUT", {
    enabled: true,
    startsAt: new Date(Date.now() - 60000).toISOString(),
    endsAt: new Date(Date.now() + 3600000).toISOString(),
  });
  const codes = await req(sb + "/self/codes", "POST", {});
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.reload();
  await page.getByLabel("当前活动").selectOption(selfActivity.id);
  await page.getByRole("button", { name: "活动设置", exact: true }).click();
  await page.getByRole("button", { name: "自主抽奖", exact: true }).click();
  await page
    .getByRole("heading", { name: "用户自主抽奖", exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("用户抽奖链接").inputValue(),
    origin + "/participate/" + selfActivity.id,
  );
  await page
    .getByRole("button", { name: "保存自主抽奖设置", exact: true })
    .click();
  await page.getByText("开放时间已保存", { exact: true }).waitFor();
  const codeDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "生成 / 导出个人抽奖码", exact: true })
    .click();
  assert.equal((await codeDownload).suggestedFilename(), "个人抽奖码.csv");
  await page.screenshot({
    path: "test-results/self-settings.png",
    fullPage: true,
  });
  const phoneContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const phone = await phoneContext.newPage();
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.goto(origin + "/participate/" + selfActivity.id);
  await phone.getByLabel("我的抽奖码").fill(codes[0].code);
  await phone.getByRole("button", { name: "验证抽奖码" }).click();
  await phone.getByRole("button", { name: "开始抽奖" }).waitFor();
  const selfApi = "**/api/participate/" + selfActivity.id + "/draw";
  await phone.route(selfApi, async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await phone.getByRole("button", { name: "开始抽奖" }).click();
  await phone.getByRole("button", { name: "恢复本次抽奖" }).waitFor();
  const selfBefore = (await req(sb)).rounds.length;
  await phone.unroute(selfApi);
  await phone.reload();
  await phone.getByRole("button", { name: "恢复本次抽奖" }).click();
  await phone.getByRole("button", { name: "停止揭晓", exact: true }).waitFor();
  assert.equal(
    await phone.locator(".prize-machine.machine-running").count(),
    1,
  );
  assert.equal(await phone.locator(".reel-window").count(), 3);
  assert.equal(await phone.locator(".self-outcome").count(), 0);
  assert.equal(
    (await req(sb + "/self/stage")).winners.length,
    0,
    "用户停止前不提前公开结果",
  );
  await phone.screenshot({
    path: "test-results/self-mobile-rolling.png",
    fullPage: true,
  });
  await phone.getByRole("button", { name: "停止揭晓", exact: true }).click();
  await phone.getByText("恭喜中奖", { exact: true }).waitFor();
  assert.equal(
    await phone.locator(".prize-machine.machine-running").count(),
    0,
  );
  assert.equal((await req(sb + "/self/stage")).winners.length, 1);

  assert.equal((await req(sb)).rounds.length, selfBefore);
  assert.equal(
    await phone.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await phone.screenshot({
    path: "test-results/self-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  const live = await context.newPage();
  live.on("pageerror", (e) => errors.push(e.message));
  await live.setViewportSize({ width: 1920, height: 1080 });
  await live.goto(origin + "/self-stage/" + selfActivity.id);
  await live.getByTestId("self-winner").waitFor();
  await live.getByRole("button", { name: "暂停翻页" }).click();
  const firstName = await live.getByTestId("self-winner").first().innerText();
  const startedSelf = Date.now();
  const many = await Promise.all(
    codes.slice(1, 26).map(async (code) => {
      const login = await fetch(
        origin + "/api/participate/" + selfActivity.id + "/login",
        {
          method: "POST",
          headers: {
            Origin: origin,
            "X-Requested-With": "lottery",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ code: code.code }),
        },
      );
      assert.equal(login.status, 200);
      const clientRequestId = crypto.randomUUID();
      const response = await fetch(
        origin + "/api/participate/" + selfActivity.id + "/draw",
        {
          method: "POST",
          headers: {
            Origin: origin,
            "X-Requested-With": "lottery",
            "Content-Type": "application/json",
            Cookie: login.headers.get("set-cookie").split(";")[0],
          },
          body: JSON.stringify({ requestId: clientRequestId }),
        },
      );
      assert.equal(response.status, 200);
      const reveal = await fetch(
        origin + "/api/participate/" + selfActivity.id + "/reveal",
        {
          method: "POST",
          headers: {
            Origin: origin,
            "X-Requested-With": "lottery",
            "Content-Type": "application/json",
            Cookie: login.headers.get("set-cookie").split(";")[0],
          },
          body: JSON.stringify({ requestId: clientRequestId }),
        },
      );
      assert.equal(reveal.status, 200);
      return response.json();
    }),
  );
  assert.equal(many.length, 25);
  console.log(
    "自主抽奖本机25人并发请求完成：" +
      (Date.now() - startedSelf) +
      "ms（非线上容量承诺）。",
  );
  await live.getByText("已中奖 26 人次", { exact: true }).waitFor();
  await live.getByTestId("self-spotlight").waitFor();
  const highlighted = await live
    .getByTestId("self-spotlight")
    .getAttribute("data-winner-id");
  assert.equal(
    await live.getByTestId("self-winner").count(),
    1,
    "先放大，不先加入小卡片",
  );
  assert.equal(
    await live.getByTestId("self-winner").first().innerText(),
    firstName,
  );
  await live.screenshot({
    path: "test-results/self-stage-spotlight.png",
    fullPage: true,
  });
  await live.waitForTimeout(1000);
  assert.equal(
    await live.getByTestId("self-spotlight").getAttribute("data-winner-id"),
    highlighted,
    "放大停留至少1秒",
  );
  await live.waitForFunction(
    (id) =>
      document
        .querySelector('[data-testid="self-spotlight"]')
        ?.getAttribute("data-winner-id") !== id,
    highlighted,
  );
  assert.equal(
    await live
      .locator(
        '[data-testid="self-winner"][data-winner-id="' + highlighted + '"]',
      )
      .count(),
    1,
    "2秒后归入小卡片",
  );
  await live.waitForFunction(
    () => !document.querySelector('[data-testid="self-spotlight"]'),
    {},
    { timeout: 90000 },
  );
  assert.equal(
    await live.getByTestId("self-winner").count(),
    2,
    "最后一页保留新中奖结果",
  );
  await live.getByRole("button", { name: "下一页" }).click();
  assert.equal(await live.getByTestId("self-winner").count(), 12);
  const cards = await live.getByTestId("self-winner").allInnerTexts();
  assert.ok(cards.every((v) => v.includes("*") && v.includes("幸运礼品")));
  const geometry = await live.getByTestId("self-winner").evaluateAll((nodes) =>
    nodes.map((n) => {
      const r = n.getBoundingClientRect();
      return { x: r.x, y: r.y, bottom: r.bottom };
    }),
  );
  assert.equal(new Set(geometry.map((r) => r.x)).size, 3);
  assert.equal(new Set(geometry.map((r) => r.y)).size, 4);
  assert.ok(geometry.every((r) => r.bottom < 1080));
  await live.screenshot({
    path: "test-results/self-stage-12.png",
    fullPage: true,
  });
  await live.reload();
  await live.getByTestId("self-winner").first().waitFor();
  assert.deepEqual(
    await live.getByTestId("self-winner").allInnerTexts(),
    cards,
  );
  await live.getByRole("button", { name: "暂停翻页" }).click();
  await live.getByRole("button", { name: "下一页" }).click();
  assert.equal(await live.getByTestId("self-winner").count(), 12);
  await live.getByRole("button", { name: "下一页" }).click();
  assert.equal(await live.getByTestId("self-winner").count(), 2);
  // A participant still cannot read administrator endpoints.
  assert.equal(
    (await phoneContext.request.get(origin + "/api/activities")).status(),
    401,
  );
  await phoneContext.close();
  console.log(
    "自主抽奖验收通过：匿名手机凭码、丢失响应刷新恢复、25人并发、12人分页、打码和刷新恢复。",
  );
  assert.deepEqual(errors, []);
  console.log(
    "V2双窗验收通过：场景同步、单人/批量、真实礼品滚轴、停止/重播、键盘保护、彩排隔离、核销撤销、断线同请求恢复、PNG、刷新与手机布局。",
  );
} catch (e) {
  console.error(logs, e);
  await browser
    ?.contexts()[0]
    ?.pages()[0]
    ?.screenshot({ path: "test-results/failure.png", fullPage: true })
    .catch(() => {});
  throw e;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((r) => (server.exitCode !== null ? r() : server.on("exit", r))),
    new Promise((r) =>
      setTimeout(() => {
        server.kill("SIGKILL");
        r();
      }, 4000),
    ),
  ]);
  await rm(dir, { recursive: true, force: true });
}
