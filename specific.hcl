# Raid Log Coach infrastructure. Run `specific docs` for reference.
# Phase 0: just the web app. Postgres, Redis, the worker and the benchmark cron arrive in Phase 1–2.

# Create a client at https://www.warcraftlogs.com/api/clients (redirect URL can be anything for now).
secret "wcl_client_id" {}
secret "wcl_client_secret" {}

build "web" {
  base    = "node"
  command = "npm run build"
}

service "web" {
  build   = build.web
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
