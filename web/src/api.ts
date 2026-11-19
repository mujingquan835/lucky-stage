export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const raw = body instanceof File || body instanceof Blob;
  let response: Response;
  let data: any;
  try {
    response = await fetch("/api" + path, {
      method,
      signal: AbortSignal.timeout(15000),
      headers: {
        "X-Requested-With": "lottery",
        ...(body === undefined
          ? {}
          : {
              "Content-Type": raw
                ? body.type || "application/octet-stream"
                : "application/json",
            }),
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    data = await response.json();
  } catch (e) {
    if (["TimeoutError", "AbortError"].includes((e as Error).name))
      throw new ApiError("请求超时，请查询并恢复本轮结果", 0);
    if ((e as Error).name === "SyntaxError")
      throw new ApiError("服务返回异常，请保留本轮请求并重试", 502);
    throw new ApiError("网络连接中断，请检查网络后重试", 0);
  }
  if (!response.ok)
    throw new ApiError(data.error ?? "操作失败", response.status);
  return data;
}
export const upload = async (file: File) =>
  (await api<{ url: string }>("/images", "POST", file)).url;
export async function download(path: string, name: string) {
  const r = await fetch("/api" + path, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new ApiError((await r.json()).error, r.status);
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
