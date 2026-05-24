// Packages
const express = require('express')
const GitHubCache = require('./cache/github')
const ForgejoCache = require('./cache/forgejo')

const startTime = Date.now()

const {
  INTERVAL: interval,
  ACCOUNT: account,
  REPOSITORY: repository,
  PRE: pre,
  TOKEN: token,
  REPO_PLATFORM: repo_platform,
  INSTANCE_URL: instance_url,
  URL: PRIVATE_BASE_URL,
  VERCEL_URL
} = process.env

const url = VERCEL_URL || PRIVATE_BASE_URL

const app = express()

let cache = null

const config = {
  interval,
  account,
  repository,
  pre,
  token,
  repo_platform,
  instance_url,
  url
}

switch (config.repo_platform) {
  case 'github':
    cache = new GitHubCache(config)
    break
  case 'forgejo':
    if (!instance_url) {
      const error = new Error(
        'INSTANCE_URL needs to be set when using Forgejo/Gitea'
      )
      error.code = 'missing_configuration_properties'
      throw error
    }
    cache = new ForgejoCache(config)
    break
  default:
    const error = new Error(
      'Invalid platform in env file (needs to be "github" or "forgejo")'
    )
    error.code = 'invalid_configuration_property'
    throw error
}

const routes = require('./routes')({ cache, config })

// Define a route for every relevant path
app.get('/', (req, res) => routes.overview(req, res))
app.get('/download', (req, res) => routes.download(req, res))
app.get('/download/:platform', (req, res) => routes.downloadPlatform(req, res))
app.get('/download/latest/:file', (req, res) => routes.downloadLatest(req, res))
app.get('/update/:platform/:version', (req, res) => routes.update(req, res))
app.get('/update/win32/:version/RELEASES', (req, res) =>
  routes.releases(req, res)
)
app.get('/update/electronUpdater/:version/:file', (req, res) =>
  routes.electronUpdater(req, res)
)
app.get('/api/uptime', (req, res) =>
  res.send({ uptime: (Date.now() - startTime) / 1000 })
)
app.get('/api/latest', async (req, res) => {
  const latest = await cache.loadCache()
  res.send({ latest: latest.version })
})

const server = app.listen(process.env.PORT || 3000, () => {
  const port = server.address().port
  console.log(`Listening on port ${port}`)
})
