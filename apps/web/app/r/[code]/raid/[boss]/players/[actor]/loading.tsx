export default function Loading() {
  return (
    <div className="mx-auto max-w-md pt-16 text-center" role="status">
      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-line border-t-accent" />
      <p className="mt-4 text-fg/85">Going through the night's pulls…</p>
      <p className="mt-1 text-sm text-muted">Deaths, damage taken and damage done for each pull. The first time can take a while on a long night; after that it's cached.</p>
    </div>
  );
}
