const httpProxy = require('http-proxy')

module.exports = (asset, req, res, token) => {
  httpProxy.createProxyServer().web(req, res, {
    target: asset.api_url,
    changeOrigin: true,
    ignorePath: true,
    headers: { Authorization: `Bearer ${token}` }
  })
}
