import assert from "node:assert/strict";
import { test } from "node:test";
import type { Person } from "../server/domain.ts";
import { matchPhotos } from "../web/src/PersonPhotos.tsx";

const person = (id: string, name: string, photoFilename?: string): Person => ({
  id,
  name,
  phone: id,
  company: "",
  store: "",
  enabled: true,
  photoFilename,
});
const files = (...names: string[]) =>
  names.map((name) => new File(["photo"], name));

test("人物照片优先按映射文件名匹配，同名人员由电话区分", () => {
  const people = [
    person("01", "张伟", "CAMERA_1.JPG"),
    person("02", "张伟"),
    person("03", "李明"),
  ];
  assert.deepEqual(
    matchPhotos(
      files("camera_1.jpg", "002.jpg", "李明.jpg", "张伟.jpg"),
      people,
      [{ name: "张伟", phone: "02", photoFilename: "002.jpg" }],
    ),
    ["01", "02", "03", ""],
  );
});

test("重复文件名或有冲突的映射保留待手动匹配", () => {
  const people = [person("01", "李明", "IMG.jpg"), person("02", "陈佳")];
  assert.deepEqual(
    matchPhotos(files("IMG.jpg", "img.JPG", "a.png", "b.png"), people, [
      { name: "陈佳", phone: "02", photoFilename: "a.png" },
      { name: "陈佳", phone: "02", photoFilename: "b.png" },
    ]),
    ["", "", "", ""],
  );
});
