const {exec} = require('child_process')
const rimraf = require('rimraf')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function isGenerator (fn) {
  return fn.constructor.name === 'GeneratorFunction' ||
    fn.constructor.name === 'AsyncGeneratorFunction'
}

function spawnChildProcess (cmd, opts = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, opts, (err, stdout, stderr) => {
      if (err) return reject(err)
      resolve({ stdout, stderr })
    })
  })
}

function deleteDirectory (path) {
  return new Promise((resolve, reject) => {
    rimraf(path, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })
}

class DefaultMap extends Map {
  constructor (defaultValue = undefined) {
    super()
    this._defaultValue = defaultValue
  }

  get (key) {
    const res = super.get(key)
    return res !== undefined ? res : this._defaultValue
  }

  increment (key, by = 1) {
    const val = this.get(key)
    if (typeof val === 'number') this.set(key, val + by)
    return this
  }
}

function countLeftRepetitiveChars (s) {
  let i
  for (i = 0; i < s.length && s[i] === s[0]; i++) {}
  return i
}

module.exports = {
  sleep,
  isGenerator,
  deleteDirectory,
  spawnChildProcess,
  DefaultMap,
  countLeftRepetitiveChars
}
