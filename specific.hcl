# Raid Log Coach infrastructure. Run `specific docs` for reference.

# Create a client at https://www.warcraftlogs.com/api/clients (leave "Public Client" unchecked).
secret "wcl_client_id" {}
secret "wcl_client_secret" {}

# WCL zone ID of the current raid tier (53 = The Venomous Abyss).
config "raid_zone_id" {
  default = "53"
}

# The benchmark crawler pauses once the WCL client has used this many points in the current hour.
# WCL's limit is 720/hour and the website shares it, so keep this well below 720.
config "crawl_point_limit" {
  default = "450"
}

# Top N players per spec, boss and difficulty that benchmarks use (medians over these).
config "benchmark_top_n" {
  default = "15"
}

postgres "main" {}

build "app" {
  base    = "node"
  command = "npm run build"
}

service "web" {
  build   = build.app
  command = "npm start -w apps/web"

  endpoint {
    public = true
    health_check {
      path = "/api/health"
    }
  }

  env = {
    PORT              = port
    WCL_CLIENT_ID     = secret.wcl_client_id
    WCL_CLIENT_SECRET = secret.wcl_client_secret
  }

  dev {
    command = "npm run dev -w apps/web"
  }
}

# Background crawler: works through the job queue in Postgres within the API point budget.
service "worker" {
  build   = build.app
  command = "npm start -w apps/worker"

  env = {
    DATABASE_URL      = postgres.main.url
    WCL_CLIENT_ID     = secret.wcl_client_id
    WCL_CLIENT_SECRET = secret.wcl_client_secret
    RAID_ZONE_ID      = config.raid_zone_id
    CRAWL_POINT_LIMIT = config.crawl_point_limit
    BENCHMARK_TOP_N   = config.benchmark_top_n
  }

  pre_deploy {
    command = "npm run migrate -w packages/db"
  }

  dev {
    command = "npm run dev -w apps/worker"
  }
}

# Weekly benchmark snapshot. Wednesday 06:00 UTC, after both the US (Tue) and EU (Wed) resets.
cron "weekly-snapshot" {
  build    = build.app
  command  = "npm run snapshot:start -w apps/worker"
  schedule = "0 6 * * 3"

  env = {
    DATABASE_URL      = postgres.main.url
    WCL_CLIENT_ID     = secret.wcl_client_id
    WCL_CLIENT_SECRET = secret.wcl_client_secret
    RAID_ZONE_ID      = config.raid_zone_id
    BENCHMARK_TOP_N   = config.benchmark_top_n
  }
}
