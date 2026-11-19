import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../server/db.ts";
import { createApp } from "../server/app.ts";
import { createActivity, addPeople, saveGift } from "../server/domain.ts";
import { configureSelf, generateCodes } from "../server/self-service.ts";
test("参与者会话仅可查询本人，管理与图片隔离，换码吊销会话", async () => {
  const db = await createDb(),
    dir = await mkdtemp(join(tmpdir(), "lottery-self-api-"));
  const a = await createActivity(db, { name: "手机抽奖" });
  await addPeople(db, a.id, [
    { name: "甲客户", phone: "private-phone", store: "甲门店" },
    { name: "乙客户", phone: "other-private" },
  ]);
  const filename = randomUUID() + ".webp";
  await writeFile(
    join(dir, filename),
    await sharp({
      create: { width: 20, height: 20, channels: 3, background: "red" },
    })
      .webp()
      .toBuffer(),
  );
  await saveGift(db, a.id, {
    name: "测试奖",
    total: 2,
    image: "/api/images/" + filename,
  });
  await configureSelf(db, a.id, {
    enabled: true,
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: "2027-01-01T00:00:00Z",
  });
  const codes = await generateCodes(db, a.id),
    origin = "http://localhost:3000";
  const server = createApp(db, {
    adminUser: "admin",
    adminPassword: "test-password-1234",
    appOrigin: origin,
    uploadDir: dir,
    secureCookies: false,
  }).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`,
    path = "/participate/" + a.id;
  let cookie = "";
  const req = (p: string, method = "GET", body?: unknown, source = origin) =>
    fetch(base + p, {
      method,
      headers: {
        Origin: source,
        "X-Requested-With": "lottery",
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    assert.equal((await req(path + "/me")).status, 401);
    assert.equal(
      (
        await req(
          path + "/login",
          "POST",
          { code: codes[0].code },
          "http://evil.test",
        )
      ).status,
      403,
    );
    assert.equal(
      (await req(path + "/login", "POST", { code: "bad" })).status,
      401,
    );
    const login = await req(path + "/login", "POST", { code: codes[0].code });
    assert.equal(login.status, 200);
    cookie = login.headers.get("set-cookie")!.split(";")[0];
    const me = await (await req(path + "/me")).json();
    assert.equal(me.name, "甲客户");
    assert.equal(JSON.stringify(me).includes("private"), false);
    assert.equal((await req("/activities")).status, 401);
    assert.equal((await req("/images/fake.webp")).status, 401);
    assert.equal((await req(path + "/images/unknown")).status, 404);
    const result = await req(path + "/draw", "POST", {
      requestId: "self-api-request",
    });
    assert.equal(result.status, 200);
    const winners = await result.json();
    assert.equal(JSON.stringify(winners).includes("phone"), false);
    const image = await req(winners[0].giftImage.slice(4));
    assert.equal(image.status, 200);
    assert.match(image.headers.get("content-type")!, /image\/webp/);
    const firstCookie = cookie;
    const otherLogin = await req(path + "/login", "POST", {
      code: codes[1].code,
    });
    cookie = otherLogin.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await req(winners[0].giftImage.slice(4))).status, 404);
    const otherResult = await (
      await req(path + "/draw", "POST", { requestId: "self-api-request" })
    ).json();
    assert.notEqual(otherResult[0].id, winners[0].id);
    assert.equal(otherResult[0].personName, "乙客户");
    cookie = firstCookie;
    await generateCodes(db, a.id, codes[0].personId);
    assert.equal((await req(path + "/me")).status, 401);
    let lastStatus = 0;
    for (let i = 0; i < 21; i++)
      lastStatus = (await req(path + "/login", "POST", { code: codes[1].code }))
        .status;
    assert.equal(lastStatus, 429, "有效码反复创建会话也应限流");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
