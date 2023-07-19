// Native
const path = require('path')
const fs = require('fs')
const { promisify } = require('util')

// Packages
const Handlebars = require('handlebars')
const H = require('just-handlebars-helpers')

module.exports = async () => {
  const viewPath = path.normalize(path.join(__dirname, '/../views/index.hbs'))
  const viewContent = await promisify(fs.readFile)(viewPath, 'utf8')

  H.registerHelpers(Handlebars)

  return Handlebars.compile(viewContent)
}
