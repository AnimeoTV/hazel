// Packages
const fetch = require('node-fetch')
const retry = require('async-retry')
const convertStream = require('stream-to-string')
const ms = require('ms')
const YAML = require('yaml')
const Cache = require('./cache')

// Utilities
const checkPlatform = require('../platform')

module.exports = class GitHubCache extends Cache {
  async cacheReleaseList(url) {
    const { token } = this.config
    const { body } = await this.fetchFileFromAPI(url, token)

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
    const { body } = await this.fetchFileFromAPI(url, token)

    let content = await convertStream(body)
    const matches = content.match(/[^ ]*\.(exe|deb|rpm|AppImage|dmg)/gim)

    if (matches.length === 0) {
      throw new Error(
        `Tried to cache electron-updater .yml file, but failed. latest.yml doesn't contain any files.`
      )
    }

    const data = YAML.parse(content)
    const files = data.files

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const url = file.url

      const newName = `${this.config.url}/download/latest/` + url
      file.url = file.url.replace(url, newName)
    }

    content = YAML.stringify(data)

    return content
  }

  async refreshCache() {
    const { account, repository, pre, token } = this.config
    const repo = account + '/' + repository
    const url = `https://api.github.com/repos/${repo}/releases?per_page=100`

    const data = await this.fetchJSONFromAPI(url, token)

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
          this.latest.files.electronUpdater[name] = await this.cacheYmlReleases(
            url
          )
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
}
