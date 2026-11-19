import { useEffect, useMemo, useState } from "react";
import type { Person } from "../../server/domain";
import { api } from "./api";
import { Modal } from "./components";

type Mapping = Pick<Person, "name" | "phone" | "photoFilename">;
type Entry = {
  file: File;
  preview: string;
  personId: string;
  saved?: string;
  error?: string;
};
const normalized = (value: string) =>
  value.trim().normalize("NFC").toLowerCase();
const identity = (person: Mapping) =>
  JSON.stringify([person.name, person.phone]);

function group<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    const existing = groups.get(value);
    if (existing) existing.push(item);
    else groups.set(value, [item]);
  }
  return groups;
}

export function matchPhotos(
  files: File[],
  people: Person[],
  mapping: Mapping[],
) {
  const filesByName = group(files, (file) => normalized(file.name));
  const peopleByName = group(people, (person) => normalized(person.name));
  const mappingByIdentity = group(
    mapping.filter((row) => row.photoFilename),
    identity,
  );
  const byFile = new Map<string, Set<string>>();
  const configured = new Set<string>();
  const ambiguous = new Set<string>();
  for (const person of people) {
    const rows = mappingByIdentity.get(identity(person));
    const filenames = new Set(
      rows?.map((row) => normalized(row.photoFilename!)) ??
        (person.photoFilename ? [normalized(person.photoFilename)] : []),
    );
    if (filenames.size) configured.add(person.id);
    if (filenames.size > 1) ambiguous.add(person.id);
    for (const filename of filenames) {
      const matches = byFile.get(filename) ?? new Set<string>();
      matches.add(person.id);
      byFile.set(filename, matches);
    }
  }
  return files.map((file) => {
    const name = normalized(file.name);
    if (filesByName.get(name)!.length > 1) return "";
    const exact = byFile.get(name);
    if (exact?.size === 1) {
      const [person] = exact;
      return ambiguous.has(person) ? "" : person;
    }
    if (exact?.size) return "";
    const byName = peopleByName.get(name.replace(/\.[^.]+$/, ""));
    return byName?.length === 1 && !configured.has(byName[0].id)
      ? byName[0].id
      : "";
  });
}

export default function PersonPhotos({
  path,
  people,
  refresh,
  onClose,
}: {
  path: string;
  people: Person[];
  refresh: () => Promise<void>;
  onClose: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [mapping, setMapping] = useState<Mapping[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [matchQuery, setMatchQuery] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 30;
  const peopleById = useMemo(
    () => new Map(people.map((person) => [person.id, person])),
    [people],
  );
  useEffect(() => {
    const matches = matchPhotos(files, people, mapping);
    const next = files.map((file, i) => ({
      file,
      preview: URL.createObjectURL(file),
      personId: matches[i],
    }));
    setEntries(next);
    setPage(0);
    return () => next.forEach((item) => URL.revokeObjectURL(item.preview));
    // Keep the preview assignments stable across background refreshes.
  }, [files, mapping]);
  const matched = entries.filter((item) => item.personId);
  const duplicate =
    new Set(matched.map((item) => item.personId)).size !== matched.length;
  const options = people
    .filter((person) =>
      [person.name, person.store, person.phone]
        .join(" ")
        .includes(matchQuery.trim()),
    )
    .slice(0, 100);
  const attached = people.filter(
    (person) =>
      person.photo &&
      [person.name, person.store, person.phone]
        .join(" ")
        .includes(query.trim()),
  );
  async function save() {
    if (busy || duplicate || !matched.length) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const queue = [...matched];
      const rows: { personId: string; photo: string }[] = [];
      const updates = new Map<File, { saved?: string; error?: string }>();
      async function uploadNext() {
        while (queue.length) {
          const entry = queue.shift()!;
          try {
            if (entry.file.size > 5 * 1024 * 1024)
              throw new Error("照片超过 5 MB");
            const photo =
              entry.saved ??
              (
                await api<{ url: string }>(
                  "/images?portrait=1",
                  "POST",
                  entry.file,
                )
              ).url;
            updates.set(entry.file, { saved: photo });
            rows.push({ personId: entry.personId, photo });
          } catch (e) {
            updates.set(entry.file, { error: (e as Error).message });
          }
        }
      }
      await Promise.all(Array.from({ length: 3 }, uploadNext));
      setEntries((current) =>
        current.map((entry) =>
          updates.has(entry.file)
            ? {
                ...entry,
                saved: undefined,
                error: undefined,
                ...updates.get(entry.file),
              }
            : entry,
        ),
      );
      if (rows.length) {
        await api(path + "/person-photos", "POST", { rows });
        setEntries((current) =>
          current.filter((entry) => !updates.get(entry.file)?.saved),
        );
        setPage(0);
        await refresh();
      }
      setNotice(
        `已绑定 ${rows.length} 张照片，${matched.length - rows.length} 张上传失败，${entries.length - matched.length} 张待匹配`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="批量匹配人物照片"
      error={error}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="photo-matching">
        <p>
          一次选择多张照片。优先按名单的照片文件名匹配，也可用唯一姓名命名，例如「王小明.jpg」。
        </p>
        <label>
          选择照片
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={busy}
            onChange={(e) => {
              setFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </label>
        <label>
          照片映射表（可选）
          <input
            type="file"
            accept=".xlsx"
            disabled={busy}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setBusy(true);
              setError("");
              try {
                const rows = await api<Mapping[]>(
                  path + "/photo-mapping",
                  "POST",
                  new Blob([file], { type: "application/octet-stream" }),
                );
                setMapping(rows);
                const unmatched = rows.filter(
                  (row) =>
                    row.photoFilename &&
                    !people.some(
                      (person) =>
                        person.name === row.name && person.phone === row.phone,
                    ),
                ).length;
                setNotice(
                  unmatched
                    ? `${unmatched} 行映射无法匹配名单中的姓名和电话`
                    : "已载入照片映射表",
                );
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        <p aria-live="polite">{notice}</p>
        {entries.length > 0 && (
          <>
            <p>
              {matched.length}/{entries.length} 张已匹配 · 当前{" "}
              {people.filter((person) => !person.photo).length} 人缺照片
            </p>
            <label>
              搜索人员以手动匹配
              <input
                value={matchQuery}
                onChange={(e) => setMatchQuery(e.target.value)}
                placeholder="姓名、门店或电话"
              />
            </label>
            {duplicate && (
              <p role="alert">同一人匹配了多张照片，请调整后再保存。</p>
            )}
            {entries
              .slice(page * pageSize, (page + 1) * pageSize)
              .map((entry) => (
                <div className="photo-match-row" key={entry.preview}>
                  <img src={entry.preview} alt="" loading="lazy" />
                  <label>
                    {entry.file.name}
                    <select
                      aria-label={`${entry.file.name} 对应人员`}
                      value={entry.personId}
                      disabled={busy}
                      onChange={(e) => {
                        const personId = e.target.value;
                        setEntries((current) =>
                          current.map((item) =>
                            item === entry ? { ...item, personId } : item,
                          ),
                        );
                      }}
                    >
                      <option value="">待匹配 / 暂不处理</option>
                      {[
                        ...(entry.personId &&
                        !options.some(
                          (person) => person.id === entry.personId,
                        ) &&
                        peopleById.has(entry.personId)
                          ? [peopleById.get(entry.personId)!]
                          : []),
                        ...options,
                      ].map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name} ·{" "}
                          {person.store || person.company || "来宾"} ·{" "}
                          {person.phone.slice(-4)}
                        </option>
                      ))}
                    </select>
                    {entry.error && <small role="alert">{entry.error}</small>}
                    {peopleById.get(entry.personId)?.photo && (
                      <small>保存后替换现有照片</small>
                    )}
                  </label>
                </div>
              ))}
            {entries.length > pageSize && (
              <div>
                <button
                  className="button small"
                  disabled={!page}
                  onClick={() => setPage(page - 1)}
                >
                  上一页
                </button>
                <span>
                  {" "}
                  {page + 1}/{Math.ceil(entries.length / pageSize)}{" "}
                </span>
                <button
                  className="button small"
                  disabled={(page + 1) * pageSize >= entries.length}
                  onClick={() => setPage(page + 1)}
                >
                  下一页
                </button>
              </div>
            )}
            <button
              className="button primary"
              disabled={busy || duplicate || !matched.length}
              onClick={() => void save()}
            >
              {busy ? "处理中…" : "上传并绑定已匹配照片"}
            </button>
          </>
        )}
        {people.some((person) => person.photo) && (
          <details>
            <summary>管理已绑定照片</summary>
            <label>
              搜索来宾
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="姓名、门店或电话"
              />
            </label>
            {attached.slice(0, 30).map((person) => (
              <div className="photo-match-row" key={person.id}>
                <img src={person.photo} alt="" loading="lazy" />
                <span>
                  {person.name} · {person.store || person.phone.slice(-4)}
                </span>
                <button
                  className="button small"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                      await api(path + "/person-photos", "POST", {
                        rows: [{ personId: person.id, photo: "" }],
                      });
                      await refresh();
                      setNotice(`已移除 ${person.name} 的照片`);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  移除
                </button>
              </div>
            ))}
          </details>
        )}
      </div>
    </Modal>
  );
}
