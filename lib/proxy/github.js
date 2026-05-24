const fetch = require('node-fetch')

module.exports = (asset, req, res, token) => {
  const redirect = 'manual'
  const headers = { Accept: 'application/octet-stream' }
  const options = { headers, redirect }
  const { api_url: rawUrl } = asset
  const finalUrl = rawUrl.replace(
    'https://api.github.com/',
    `https://${token}@api.github.com/`
  )

  fetch(finalUrl, options).then(assetRes => {
    res.setHeader('Location', assetRes.headers.get('Location'))
    res.status(302).end()
  })
}
