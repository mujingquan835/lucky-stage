import ExcelJS from "exceljs";
import { inflateRawSync } from "node:zlib";
import { AppError } from "./domain.ts";
const headers = ["姓名", "公司", "电话", "门店名称", "对应销售", "部门", "照片文件名"];
export async function workbook(columns: string[], rows: (string | number)[][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("活动名单");
  ws.addRow(columns);
  rows.forEach((row) => ws.addRow(row));
  ws.columns.forEach((c, i) => {
    c.width = i === 0 ? 18 : 28;
    c.numFmt = "@";
  });
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFB82935" },
  };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
export const template = () =>
  workbook(headers.filter(h => h !== "公司"), [
    ["示例参与者", "13800000000", "示例门店（请替换此行）", "示例销售", "示例部门"],
  ]);
function checkZip(buffer: Buffer) {
  const invalid = () => {
    throw new AppError("Excel 压缩格式无效，请使用名单模板");
  };
  if (buffer.length < 22) invalid();
  let end = -1;
  for (
    let i = buffer.length - 22;
    i >= Math.max(0, buffer.length - 65557);
    i--
  ) {
    if (
      buffer.readUInt32LE(i) === 0x06054b50 &&
      i + 22 + buffer.readUInt16LE(i + 20) === buffer.length
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) invalid();
  const count = buffer.readUInt16LE(end + 10),
    start = buffer.readUInt32LE(end + 16),
    size = buffer.readUInt32LE(end + 12);
  if (
    buffer.readUInt16LE(end + 4) !== 0 ||
    buffer.readUInt16LE(end + 6) !== 0 ||
    count !== buffer.readUInt16LE(end + 8) ||
    count < 1 ||
    count > 2000 ||
    start + size !== end
  )
    invalid();
  let pos = start,
    seen = 0,
    total = 0;
  const max = 30 * 1024 * 1024;
  while (pos < end) {
    if (pos + 46 > end || buffer.readUInt32LE(pos) !== 0x02014b50) invalid();
    const flags = buffer.readUInt16LE(pos + 8),
      method = buffer.readUInt16LE(pos + 10),
      compressed = buffer.readUInt32LE(pos + 20),
      declared = buffer.readUInt32LE(pos + 24),
      local = buffer.readUInt32LE(pos + 42);
    const next =
      pos +
      46 +
      buffer.readUInt16LE(pos + 28) +
      buffer.readUInt16LE(pos + 30) +
      buffer.readUInt16LE(pos + 32);
    if (
      next > end ||
      flags & 1 ||
      ![0, 8].includes(method) ||
      local + 30 > start ||
      buffer.readUInt32LE(local) !== 0x04034b50 ||
      buffer.readUInt16LE(local + 8) !== method
    )
      invalid();
    const data =
      local +
      30 +
      buffer.readUInt16LE(local + 26) +
      buffer.readUInt16LE(local + 28);
    if (data + compressed > start) invalid();
    if (declared > max - total) throw new AppError("Excel 解压内容超过 30 MB");
    let actual: number;
    try {
      actual =
        method === 0
          ? compressed
          : inflateRawSync(buffer.subarray(data, data + compressed), {
              maxOutputLength: Math.max(1, max - total),
            }).length;
    } catch {
      throw new AppError("Excel 解压内容超过限制或压缩格式损坏");
    }
    total += actual;
    if (total > max) throw new AppError("Excel 解压内容超过 30 MB");
    if (actual !== declared) invalid();
    seen++;
    if (seen > 2000) invalid();
    pos = next;
  }
  if (pos !== end || seen !== count) invalid();
}
export async function parseWorkbook(buffer: Buffer, photosOnly = false) {
  checkZip(buffer);
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as any);
  } catch {
    throw new AppError("无法读取 Excel，请使用 .xlsx 模板");
  }
  if (!wb.worksheets.length) throw new AppError("工作表为空");
  const rows: any[] = [], errors: string[] = [];
  for (const ws of wb.worksheets) {
  if (!ws.actualRowCount) continue;
  if (ws.rowCount > 10001 || ws.columnCount > 30)
    throw new AppError(`工作表 ${ws.name} 超过 10000 行或列数过多`);
  const first = ws.getRow(1);
  const cols = headers.map((h) => {
    let index = 0;
    first.eachCell((c, i) => {
      if (c.text.trim() === h) index = i;
    });
    const requiredHeaders = photosOnly ? ["姓名", "电话", "照片文件名"] : ["姓名", "电话", "门店名称"];
    if (!index && requiredHeaders.includes(h)) throw new AppError(`工作表 ${ws.name} 缺少列：${h}`);
    return index;
  });
  for (let i = 2; i <= ws.rowCount; i++) {
    const row = ws.getRow(i);
    if (!row.hasValues) continue;
    const values = cols.map((c) => {
      if (!c) return "";
      const cell = row.getCell(c);
      if (
        cell.type === ExcelJS.ValueType.Formula ||
        cell.type === ExcelJS.ValueType.Hyperlink
      ) {
        errors.push(`工作表 ${ws.name} 第 ${i} 行请使用普通文本，不要使用公式或链接`);
        return "";
      }
      return cell.text.trim();
    });
    if (values.every((v) => !v)) continue;
    rows.push({
      name: values[0],
      company: values[1],
      phone: values[2],
      store: values[3],
      salesperson: values[4],
      department: values[5] || (/^[一二三四五六七八九十百0-9]+部$/.test(ws.name.trim()) ? ws.name.trim() : ""),
      ...(values[6] ? { photoFilename: values[6] } : {}),
      sheet: ws.name,
      row: i,
    });
    if (rows.length > 10000) throw new AppError("所有工作表合计不能超过 10000 行");
  }
  }
  if (errors.length) throw new AppError(errors.slice(0, 20).join("；"));
  if (!rows.length) throw new AppError("Excel 没有名单数据");
  return rows;
}
