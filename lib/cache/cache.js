// Packages
const fetch = require('node-fetch')
const retry = require('async-retry')
const ms = require('ms')

// Utilities
const checkPlatform = require('../platform')

module.exports = class Cache {
  constructor(config) {
    const {
      account,
      repository,
      token,
      url,
      repo_platform,
      instance_url
    } = config
    this.config = config

    if (!account || !repository) {
      const error = new Error('Neither ACCOUNT, nor REPOSITORY are defined')
      error.code = 'missing_configuration_properties'
      throw error
    }

    if (token && !url) {
      const error = new Error(
        'Neither VERCEL_URL, nor URL are defined, which are mandatory for private repo mode'
      )
      error.code = 'missing_configuration_properties'
      throw error
    }

    this.latest = {}
    this.lastUpdate = null

    this.cacheReleaseList = this.cacheReleaseList.bind(this)
    this.refreshCache = this.refreshCache.bind(this)
    this.loadCache = this.loadCache.bind(this)
    this.isOutdated = this.isOutdated.bind(this)
  }

  async fetchFileFromAPI(url, token) {
    const headers = { Accept: 'application/octet-stream' }

    if (token && typeof token === 'string' && token.length > 0) {
      headers.Authorization = `token ${token}`
    }

    const response = await retry(
      async () => {
        const response = await fetch(url, { headers, redirect: 'manual' })

        if (response.status === 302) {
          return Promise.resolve(fetch(response.headers.get('location')))
        }

        if (response.status !== 200) {
          throw new Error(`Failed fetching ${url}, status ${response.status}`)
        }

        return response
      },
      { retries: 3 }
    )

    return response
  }

  async fetchJSONFromAPI(url, token) {
    const headers = { Accept: 'application/json' }

    if (token && typeof token === 'string' && token.length > 0) {
      headers.Authorization = `token ${token}`
    }

    const response = await retry(
      async () => {
        const response = await fetch(url, { headers })

        if (response.status !== 200) {
          throw new Error(`Failed fetching ${url}, status ${response.status}`)
        }

        return response
      },
      { retries: 3 }
    )

    const data = await response.json()

    return data
  }

  async cacheReleaseList() {}

  async cacheYmlReleases() {}

  async refreshCache() {}

  isOutdated() {
    const { lastUpdate, config } = this
    const { interval = 15 } = config

    if (lastUpdate && Date.now() - lastUpdate > ms(`${interval}m`)) {
      return true
    }

    return false
  }

  // This is a method returning the cache
  // because the cache would otherwise be loaded
  // only once when the index file is parsed
  async loadCache() {
    const { latest, refreshCache, isOutdated, lastUpdate } = this

    if (!lastUpdate || isOutdated()) {
      await refreshCache().catch(error => console.error(error))
    }

    return Object.assign({}, latest)
  }
}
