export function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-live="polite">
      <span className="route-fallback-spinner" aria-hidden="true" />
      <p>جارٍ تحميل الصفحة…</p>
    </div>
  )
}
