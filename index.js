const yaml = require('js-yaml')
const octokit = require('@octokit/rest')()
const got = require('got')
const fs = require('fs')
const {promisify} = require('util')
const readFile = promisify(fs.readFile)
const writeFile = promisify(fs.writeFile)
const mkdir = promisify(fs.mkdir)
const utils = require('./utils.js')
const glob = require('fast-glob')
const path = require('path')
const Pipeline = require('./pipeline.js')
const asyncChunks = require('async-chunks')

const pipeline = new Pipeline([
  getConfig,
  authenticateGithub,
  createStatsFolder,
  listGithubLanguages,
  listLanguages,
  listRepositories,
  skipKnownRepositories,
  deleteRepository,
  downloadRepository,
  makeRepositoryStats,
  saveRepositoryStats,
  deleteRepository
], 10)

pipeline.put({}, './config.yml')

async function getConfig (data, configPath) {
  data.config = yaml.safeLoad(await readFile(configPath, 'UTF-8'))
  console.log('Configuration acquired')
  return data
}

async function authenticateGithub (data) {
  octokit.authenticate({
    type: 'oauth',
    key: data.config.githubId,
    secret: data.config.githubSecret
  })

  console.log('Github initiated')
  return data
}

async function createStatsFolder (data) {
  try {
    await mkdir(data.config.statsDirectory)
  } catch (e) {
    // don't care if the folder already exists
  }

  console.log('Created the stats folder')

  return data
}

async function listGithubLanguages (data) {
  const response = await got(data.config.githubLanguagesUri)
  const githubLanguages = yaml.safeLoad(response.body)
  console.log('Github-supported languages acquired')
  return [data, githubLanguages]
}

async function * listLanguages (data, githubLanguages) {
  const searchedLanguages = data.config.languages.map(lang => lang.toLowerCase())

  yield * Object.keys(githubLanguages)
    .map(name => ({...githubLanguages[name], name: name}))
    .filter(lang => lang.searchable === undefined || !lang.searchable)
    .filter(lang => lang.extensions !== undefined)
    .filter(lang => searchedLanguages.includes(lang.name.toLowerCase()))
    .map(lang => [data, {name: lang.name, extensions: lang.extensions}])
}

async function * listRepositories (data, lang) {
  async function * generator () {
    let res
    try {
      res = await octokit.search.repos({
        q: `language:"${lang.name.replace(/\+/g, '\\+')}"`,
        sort: 'stars',
        order: 'desc'
      })
    } catch (e) {
      console.log(lang.name, `language:"${lang.name}"`, e)
      return
    }
    console.log(`=== ${lang.name} ===`)
    yield * res.data.items

    while (octokit.hasNextPage(res)) {
      res = await octokit.getNextPage(res)
      yield * res.data.items
    }
  }

  const reposDir = data.config.repositoriesDirectory.trimRight('/')
  let n = data.config.repositoriesPerLanguage
  for await (let repo of generator()) {
    console.log(repo.full_name)
    yield [data, {
      name: repo.full_name,
      url: repo.clone_url,
      language: lang,
      path: `${reposDir}/${repo.full_name.replace('/', '.')}`
    }]
    if (--n <= 0) return
  }
}

async function skipKnownRepositories (data, repo) {
  const statsPath = path.join(data.config.statsDirectory, repo.name.replace('/', '.') + '.json')

  let stats
  try {
    stats = JSON.parse(await readFile(statsPath, 'UTF-8'))
  } catch (e) {
    // don't skip
    return [data, repo]
  }

  // don't skip as there is a problem somewhere
  if (stats.name !== repo.name) {
    return [data, repo]
  }
}

async function deleteRepository (data, repo) {
  await utils.deleteDirectory(repo.path)
  console.log(`${repo.language.name}: ${repo.name}: directory deleted`)
  return [data, repo]
}

async function downloadRepository (data, repo) {
  console.log(`${repo.language.name}: ${repo.name}: started cloning ======`)
  await utils.spawnChildProcess(`git clone --depth=1 ${repo.url} ${repo.path}`)
  console.log(`${repo.language.name}: ${repo.name}: finished cloning -----`)
  return [data, repo]
}

async function makeRepositoryStats (data, repo) {
  async function * fileContentGenerator () {
    const patterns = repo.language.extensions.map(ext => path.join(repo.path, '**/*' + ext))

    for await (let path of asyncChunks(glob.stream(patterns, { followSymlinkedDirectories: false }))) {
      yield (await readFile(path, 'UTF-8')).trim('\n')
    }
  }

  console.log(`${repo.language.name}: ${repo.name}: started statistics`)

  // 'files', 'lines', 'empty', 'notIndented', '\t', 1, 2, 3, 4, etc...
  const stats = new utils.DefaultMap(0)

  for await (let fileContent of fileContentGenerator()) {
    stats.increment('files')

    const lines = fileContent.split('\n')
    stats.increment('lines', lines.length)

    lines.forEach(line => {
      if (line.trim().length === 0) {
        stats.increment('empty')
      } else if (line[0] === '\t') {
        stats.increment('\t')
      } else if (line[0] === ' ') {
        stats.increment(utils.countLeftRepetitiveChars(line))
      } else {
        stats.increment('notIndented')
      }
    })
  }

  console.log(`${repo.language.name}: ${repo.name}: finished statistics`)

  repo.stats = stats
  return [data, repo]
}

async function saveRepositoryStats (data, repo) {
  const statsData = {
    name: repo.name,
    language: repo.language.name,
    path: repo.path,
    stats: [...repo.stats]
  }

  const statsPath = path.join(data.config.statsDirectory, repo.name.replace('/', '.') + '.json')
  await writeFile(statsPath, JSON.stringify(statsData), 'UTF-8')

  console.log(`${repo.language.name}: ${repo.name}: statistics saved`)

  return [data, repo]
}
