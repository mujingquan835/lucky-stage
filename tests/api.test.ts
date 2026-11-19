import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { createDb } from "../server/db.ts";
import { createApp } from "../server/app.ts";
import { mutate } from "../server/domain.ts";
const origin = "http://localhost:3000";
test("后台登录、来源保护、名单礼品、导入导出、图片、归档全流程", async () => {
  const db = await createDb(),
    dir = await mkdtemp(join(tmpdir(), "lottery-api-"));
  const app = createApp(db, {
    adminUser: "admin",
    adminPassword: "test-password-1234",
    appOrigin: origin,
    uploadDir: dir,
    secureCookies: false,
    trustProxy: true,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  const port = (server.address() as any).port;
  let cookie = "";
  const req = (
    path: string,
    method = "GET",
    body?: any,
    headers: Record<string, string> = {},
  ) =>
    fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: {
        Origin: origin,
        "X-Requested-With": "lottery",
        ...(body instanceof Uint8Array
          ? { "Content-Type": "application/octet-stream" }
          : { "Content-Type": "application/json" }),
        Cookie: cookie,
        ...headers,
      },
      body:
        body === undefined
          ? undefined
          : body instanceof Uint8Array
            ? new Blob([Buffer.from(body)])
            : JSON.stringify(body),
    });
  try {
    assert.equal((await req("/activities")).status, 401);
    assert.equal((await req("/gift-library")).status, 401);
    assert.equal((await req("/gift-library/images/0")).status, 401);
    assert.equal(
      (await req("/auth/login", "POST", { username: "admin", password: "bad" }))
        .status,
      401,
    );
    let r = await req("/auth/login", "POST", {
      username: "admin",
      password: "test-password-1234",
    });
    assert.equal(r.status, 200);
    cookie = r.headers.get("set-cookie")!.split(";")[0];
    const library = await (await req("/gift-library")).json() as {name:string; image:string}[];
    assert.equal(library.length, 10);
    assert.ok(library.some(g => g.name === "桌面暖风机"));
    assert.equal((await fetch(`http://127.0.0.1:${port}${library[0].image}`, {headers: {cookie}})).status, 200);
    assert.equal((await req("/gift-library/images/999")).status, 404);
    assert.equal(
      (
        await req(
          "/activities",
          "POST",
          { name: "测试" },
          { Origin: "https://evil.invalid" },
        )
      ).status,
      403,
    );
    const ta = (await (
      await req("/testing/activities", "POST", {})
    ).json()) as any;
    const seed = { action: "all", count: 20, requestId: crypto.randomUUID() };
    assert.equal(
      (await req(`/activities/${ta.id}/testing`, "POST", seed)).status,
      200,
    );
    await req(`/activities/${ta.id}/testing`, "POST", seed);
    const seeded = (await (await req(`/activities/${ta.id}`)).json()) as any;
    assert.equal(seeded.people.length, 20);
    assert.equal(seeded.gifts.length, 6);
    assert.equal(seeded.testMode, true);
    const clearRequest = {requestId:"api-clear-people-001",peopleVersion:seeded.peopleVersion};
    assert.equal((await req(`/activities/${ta.id}/people/clear`, "POST", clearRequest)).status,200);
    assert.equal((await req(`/activities/${ta.id}/people/clear`, "POST", clearRequest)).status,200);
    const cleared = await (await req(`/activities/${ta.id}`)).json() as any;
    assert.equal(cleared.people.length,0);
    assert.equal(cleared.gifts.length,6);
    const a = (await (
      await req("/activities", "POST", { name: "年度活动" })
    ).json()) as any;
    assert.equal(
      (await req(`/activities/${a.id}/testing`, "POST", seed)).status,
      403,
    );
    assert.equal(
      (
        await req(`/activities/${a.id}/people`, "POST", {
          rows: [
            {
              name: "小王",
              phone: "00001",
              company: "示例公司",
              store: "示例门店",
              department: "一部",
              salesperson: "顾问甲",
            },
          ],
        })
      ).status,
      200,
    );
    const gift = (await (
      await req(`/activities/${a.id}/gifts`, "POST", {
        name: "幸运奖",
        total: 2,
      })
    ).json()) as any;
    const command = {
      requestId: "api-scene-command",
      expectedVersion: 0,
      action: "scene",
      scene: "gifts",
    };
    assert.equal(
      (await req(`/activities/${a.id}/stage-command`, "POST", command)).status,
      200,
    );
    assert.equal((await req(`/activities/${a.id}/stage`)).status, 200);
    assert.equal(
      (
        await req("/audio", "POST", new TextEncoder().encode("not audio"), {
          "Content-Type": "audio/mpeg",
        })
      ).status,
      400,
    );
    const wav = Buffer.alloc(48);
    wav.write("RIFF");
    wav.writeUInt32LE(40, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(4, 40);
    const uploaded = await req("/audio", "POST", wav, {
      "Content-Type": "audio/wav",
    });
    assert.equal(uploaded.status, 200);
    const music = ((await uploaded.json()) as any).url;
    assert.equal((await req(music.slice(4))).status, 200);
    const configResponse = await req(
      `/activities/${a.id}/stage-command`,
      "POST",
      {
        requestId: "api-audio-config",
        expectedVersion: 1,
        action: "config",
        config: { music },
      },
    );
    assert.equal(configResponse.status, 200);
    const state = (await (await req(`/activities/${a.id}`)).json()) as any;
    const draw = await req(`/activities/${a.id}/draw`, "POST", {
      requestId: "api-draw-0001",
      mode: "single",
      personId: state.people[0].id,
    });
    assert.equal(draw.status, 200);
    const stage = (await (
      await req(`/activities/${a.id}/stage`)
    ).json()) as any;
    assert.ok(!JSON.stringify(stage).includes("00001"));
    r = await req("/images", "POST", new TextEncoder().encode("not image"), {
      "Content-Type": "image/png",
    });
    assert.equal(r.status, 400);
    r = await req(`/activities/${a.id}/export/winners`);
    assert.equal(r.status, 200);
    assert.ok(r.headers.get("content-type")!.includes("spreadsheetml"));
    const winnerBook = new ExcelJS.Workbook();
    await winnerBook.xlsx.load(Buffer.from(await r.arrayBuffer()) as any);
    const sheet = winnerBook.worksheets[0];
    const cols = sheet.getRow(1).values as string[];
    assert.equal(sheet.getRow(2).getCell(cols.indexOf("部门")).text, "一部");
    assert.equal(sheet.getRow(2).getCell(cols.indexOf("销售顾问")).text, "顾问甲");
    await req(`/activities/${a.id}/people/${state.people[0].id}`, "PATCH", { department: "二部", salesperson: "顾问乙" });
    const snapshotBook = new ExcelJS.Workbook();
    await snapshotBook.xlsx.load(Buffer.from(await (await req(`/activities/${a.id}/export/winners`)).arrayBuffer()) as any);
    assert.equal(snapshotBook.worksheets[0].getRow(2).getCell(cols.indexOf("部门")).text, "一部");
    assert.equal(snapshotBook.worksheets[0].getRow(2).getCell(cols.indexOf("销售顾问")).text, "顾问甲");
    await mutate(db, a.id, activity => { delete activity.rounds[0].winners[0].department; delete activity.rounds[0].winners[0].salesperson; });
    const legacyBook = new ExcelJS.Workbook();
    await legacyBook.xlsx.load(Buffer.from(await (await req(`/activities/${a.id}/export/winners`)).arrayBuffer()) as any);
    assert.equal(legacyBook.worksheets[0].getRow(2).getCell(cols.indexOf("部门")).text, "二部");
    assert.equal(legacyBook.worksheets[0].getRow(2).getCell(cols.indexOf("销售顾问")).text, "顾问乙");
    r = await req("/template");
    assert.equal(r.status, 200);
    const template = await r.arrayBuffer();
    r = await req(
      `/activities/${a.id}/import-preview`,
      "POST",
      new Uint8Array(template),
    );
    assert.equal(r.status, 200);
    const preview = (await r.json()) as any;
    assert.equal(preview.rows.length, 1);
    const book = new ExcelJS.Workbook();
    for (const title of ["第一批", "第二批"]) {
      const sheet = book.addWorksheet(title);
      sheet.addRow(["姓名", "电话", "门店名称"]);
      sheet.addRow(["小王", "00001", "示例门店"]);
    }
    const mp = await req(`/activities/${a.id}/import-preview`, "POST", new Uint8Array(await book.xlsx.writeBuffer()));
    assert.equal(mp.status, 200);
    const multi = await mp.json() as any;
    assert.equal(multi.sheets.length, 2);
    assert.equal(multi.rows[0].addChances, 2);
    assert.equal(multi.rows[0].totalChances, 3);
    const request = {rows:multi.entries, requestId:"api-import-request-001", planToken:multi.planToken};
    assert.equal((await req(`/activities/${a.id}/import-confirm`, "POST", request)).status, 200);
    assert.equal((await req(`/activities/${a.id}/import-confirm`, "POST", request)).status, 200);
    const postImport = await (await req(`/activities/${a.id}`)).json() as any;
    assert.equal(postImport.people.find((p:any) => p.phone === "00001").drawChances, 3);
    assert.equal(
      (await req(`/activities/${a.id}`, "PATCH", { archived: true })).status,
      200,
    );
    assert.equal(
      (
        await req(`/activities/${a.id}/gifts`, "POST", {
          name: "不允许",
          total: 1,
        })
      ).status,
      400,
    );
    for (let i = 0; i < 10; i++)
      assert.equal(
        (
          await req(
            "/auth/login",
            "POST",
            { username: "admin", password: "bad" },
            { "X-Forwarded-For": "198.51.100.10" },
          )
        ).status,
        401,
      );
    assert.equal(
      (
        await req(
          "/auth/login",
          "POST",
          { username: "admin", password: "test-password-1234" },
          { "X-Forwarded-For": "198.51.100.11" },
        )
      ).status,
      200,
    );
    assert.equal((await req("/auth/logout", "POST", {})).status, 200);
    assert.equal((await req("/activities")).status, 401);
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
