export async function api(path, body) {
  const abort = new AbortController();
  const timeout = setTimeout(function() { abort.abort(); }, 8000);
  const options = { signal: abort.signal };
  if (body !== undefined) {
    options.method = "POST";
    options.headers = { "Content-Type": "application/json" };
    options.body = JSON.stringify(body);
  }
  try {
    const response = await fetch(path, options);
    let result;
    try { result = await response.json(); } catch { throw new Error("Backend returned an unreadable response"); }
    if (!response.ok) throw new Error(result.message || "API request failed (" + response.status + ")");
    return result;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("Backend request timed out; displayed data may be stale");
    throw error;
  } finally { clearTimeout(timeout); }
}
