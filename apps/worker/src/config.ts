const num = (value: string | undefined, fallback: number) => (value ? Number(value) : fallback);

export const config = {
  /** WCL zone ID of the current raid tier. */
  zoneId: num(process.env.RAID_ZONE_ID, 53),
  /**
   * The crawler pauses once the WCL client has spent this many points in the current hour.
   * The budget is shared with the website, so the rest of the hourly limit is left for users.
   */
  crawlPointLimit: num(process.env.CRAWL_POINT_LIMIT, 450),
  /** How many top players per spec, boss and difficulty to benchmark against. */
  topN: num(process.env.BENCHMARK_TOP_N, 15),
};
