/**
 * Without this, a missing route falls through to Next's built-in 404, which
 * paints its own dark card that ignores the warm paper ground the rest of the
 * app is set in. This renders inside the root layout instead, so the header and
 * the palette are the ones the reader already knows.
 */
export default function NotFound() {
  return (
    <main className="narrow">
      <h1>找不到頁面</h1>
      <p className="subtitle">這個網址沒有對應的內容，可能是文章已被刪除，或連結有誤。</p>
      <p className="back">
        <a href="/library">← 回到文章庫</a>
      </p>
    </main>
  );
}
