export default function Loading() {
  return (
    <div className="mx-auto max-w-md pt-16 text-center" role="status">
      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
      <p className="mt-4 text-fg/85">Loading report from Warcraft Logs…</p>
    </div>
  );
}
