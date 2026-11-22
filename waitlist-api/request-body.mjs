const maxBodyBytes = 2048;

export async function readJsonBody(request) {
  if (Number(request.headers.get("Content-Length")) > maxBodyBytes) {
    return { status: 413, error: "body_too_large" };
  }
  if (!request.body) return { status: 400, error: "invalid_request" };

  const bytes = new Uint8Array(maxBodyBytes);
  const reader = request.body.getReader();
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > bytes.length - length) {
        await reader.cancel();
        return { status: 413, error: "body_too_large" };
      }
      bytes.set(value, length);
      length += value.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
    return { data: JSON.parse(text) };
  } catch {
    return { status: 400, error: "invalid_request" };
  } finally {
    reader.releaseLock();
  }
}
