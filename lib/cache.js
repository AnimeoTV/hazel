// Packages
const fetch = require('node-fetch')
const retry = require('async-retry')
const convertStream = require('stream-to-string')
const ms = require('ms')
const YAML = require('yaml')

// Utilities
const checkPlatform = require('./platform')

module.exports = class Cache {
  constructor(config) {
    const { account, repository, token, url } = config
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

  async cacheReleaseList(url) {
    const { token } = this.config
    const headers = { Accept: 'application/octet-stream' }

    if (token && typeof token === 'string' && token.length > 0) {
      headers.Authorization = `token ${token}`
    }

    const { body } = await retry(
      async () => {
        const response = await fetch(url, { headers, redirect: 'manual' })

        if (response.status === 302) {
          return Promise.resolve(fetch(response.headers.get('location')))
        }

        if (response.status !== 200) {
          throw new Error(
            `Tried to cache RELEASES, but failed fetching ${url}, status ${
              response.status
            }`
          )
        }

        return response
      },
      { retries: 3 }
    )

    let content = await convertStream(body)
    const matches = content.match(/[^ ]*\.nupkg/gim)

    if (matches.length === 0) {
      throw new Error(
        `Tried to cache RELEASES, but failed. RELEASES content doesn't contain nupkg`
      )
    }

    content = content.replace(
      matches[0],
      `${this.config.url}/download/latest/${matches[0]}`
    )
    console.log('content', content)

    return content
  }

  async cacheYmlReleases(url) {
    const { token } = this.config
    const headers = { Accept: 'application/octet-stream' }

    if (token && typeof token === 'string' && token.length > 0) {
      headers.Authorization = `token ${token}`
    }

    const { body } = await retry(
      async () => {
        const response = await fetch(url, { headers, redirect: 'manual' })

        if (response.status === 302) {
          return Promise.resolve(fetch(response.headers.get('location')))
        }

        if (response.status !== 200) {
          throw new Error(
            `Tried to cache electron-updater .yml file, but failed fetching ${url}, status ${
              response.status
            }`
          )
        }

        return response
      },
      { retries: 3 }
    )

    let content = await convertStream(body)
    const matches = content.match(/[^ ]*\.(exe|deb|rpm|AppImage|dmg)/gim)

    if (matches.length === 0) {
      throw new Error(
        `Tried to cache electron-updater .yml file, but failed. latest.yml doesn't contain any files.`
      )
    }

    const data = YAML.parse(content);
    const files = data.files;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const url = file.url;

      const newName = `${this.config.url}/download/latest/` + url;
      file.url = file.url.replace(url, newName);
    }

    content = YAML.stringify(data);

    return content
  }

  async refreshCache() {
    const { account, repository, pre, token } = this.config
    const repo = account + '/' + repository
    const url = `https://api.github.com/repos/${repo}/releases?per_page=100`
    const headers = { Accept: 'application/vnd.github.preview' }

    if (token && typeof token === 'string' && token.length > 0) {
      headers.Authorization = `token ${token}`
    }

    const response = await retry(
      async () => {
        const response = await fetch(url, { headers })

        if (response.status !== 200) {
          throw new Error(
            `GitHub API responded with ${response.status} for url ${url}`
          )
        }

        return response
      },
      { retries: 3 }
    )

    const data = await response.json()

    if (!Array.isArray(data) || data.length === 0) {
      return
    }

    const isReleaseValid = item => {
      const wantPreReleases = Boolean(pre)
      const isPrerelease = Boolean(item.prerelease)
      const isDraft = Boolean(item.draft)
      if (isDraft) return false
      return !(isPrerelease && !wantPreReleases)
    }
    const release = data.find(isReleaseValid)

    if (!release || !release.assets || !Array.isArray(release.assets)) {
      return
    }

    const { tag_name } = release

    if (this.latest.version === tag_name) {
      console.log('Cached version is the same as latest')
      this.lastUpdate = Date.now()
      return
    }

    console.log(`Caching version ${tag_name}...`)

    this.latest.version = tag_name
    this.latest.notes = release.body
    this.latest.pub_date = release.published_at
    this.latest.files = {}
    this.latest.files.electronUpdater = {}

    // Clear list of download links
    this.latest.platforms = {}

    for (const asset of release.assets) {
      const { name, browser_download_url, url, content_type, size } = asset

      if (name === 'RELEASES') {
        try {
          this.latest.files.RELEASES = await this.cacheReleaseList(url)
        } catch (err) {
          console.error(err)
        }
        continue
      }

      if (name.match(/latest(-mac|-linux(-arm64)*)*\.yml/gim)) {
        try {
          this.latest.files.electronUpdater[name] = await this.cacheYmlReleases(url)
        } catch (err) {
          console.error(err)
        }
        continue
      }

      const platform = checkPlatform(name)

      if (!platform) {
        continue
      }

      const entry = {
        name,
        api_url: url,
        url: browser_download_url,
        content_type,
        size: Math.round(size / 1000000 * 10) / 10
      }

      this.latest.platforms[platform] = entry
      this.latest.files[entry.name] = entry
    }

    console.log(`Finished caching version ${tag_name}`)
    this.lastUpdate = Date.now()
  }

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
