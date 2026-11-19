import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { template, parseWorkbook } from "../server/workbooks.ts";
test("所有有数据的工作表都按表头读取并保留来源", async () => {
  const book = new ExcelJS.Workbook();
  const a = book.addWorksheet("一区");
  a.addRow(["姓名", "电话", "门店名称"]);
  a.addRow(["张三", "001", "门店A"]);
  const b = book.addWorksheet("二区");
  b.addRow(["电话", "姓名", "门店名称"]);
  b.addRow(["001", "张三", "门店A"]);
  book.addWorksheet("空白");
  const rows = await parseWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(r => [r.name, r.phone, r.sheet, r.row]), [["张三", "001", "一区", 2], ["张三", "001", "二区", 2]]);
});
test("拒绝伪造 ZIP 条目数绕过限额", async () => {
  const b = await template();
  const end = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  b.writeUInt16LE(0, end + 8);
  b.writeUInt16LE(0, end + 10);
  await assert.rejects(parseWorkbook(b), /压缩|格式|条目/);
});
test("实际解压输出超过上限时，即使伪造声明尺寸也拒绝", async () => {
  const zip = await JSZip.loadAsync(await template());
  zip.file("padding.bin", Buffer.alloc(31 * 1024 * 1024, 65));
  const b = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  const end = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let pos = b.readUInt32LE(end + 16);
  while (pos < end && b.readUInt32LE(pos) === 0x02014b50) {
    const name = b
      .subarray(pos + 46, pos + 46 + b.readUInt16LE(pos + 28))
      .toString();
    if (name === "padding.bin") b.writeUInt32LE(0, pos + 24);
    pos +=
      46 +
      b.readUInt16LE(pos + 28) +
      b.readUInt16LE(pos + 30) +
      b.readUInt16LE(pos + 32);
  }
  await assert.rejects(parseWorkbook(b), /解压|压缩|格式/);
});
test('部门列优先，部门工作表名作为缺省部门', async () => {
  const book = new ExcelJS.Workbook();
  const a = book.addWorksheet('一部'); a.addRow(['姓名','电话','门店名称']); a.addRow(['张三','001','门店']);
  const b = book.addWorksheet('普通名单'); b.addRow(['姓名','电话','门店名称','部门']); b.addRow(['李四','002','门店','二部']);
  const c = book.addWorksheet('其他'); c.addRow(['姓名','电话','门店名称']); c.addRow(['王五','003','门店']);
  const rows = await parseWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
  assert.deepEqual(rows.map(r => r.department), ['一部','二部','']);
});
