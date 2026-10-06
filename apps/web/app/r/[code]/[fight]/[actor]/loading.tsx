export default function Loading() {
  return (
    <div className="mx-auto max-w-md pt-16 text-center" role="status">
      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
      <p className="mt-4 font-medium text-white">Analyzing your pull…</p>
      <p className="mt-1 text-sm text-slate-400">
        Fetching deaths and damage taken from Warcraft Logs and comparing them with top players. The first time takes a few seconds.
      </p>
    </div>
  );
}
