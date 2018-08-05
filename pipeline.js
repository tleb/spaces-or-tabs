const { isGenerator } = require('./utils.js')

class Pipe {
  constructor (task, maxConcurrentTasks = 0, onOutput = () => {}) {
    // task is a function: generator or not, async or not
    this.task = task
    this.onOutput = onOutput
    // zero means +inf
    this.maxConcurrentTasks = maxConcurrentTasks || Number.POSITIVE_INFINITY
    this.runningTasksNb = 0
    this.queue = []
  }

  put (...inputData) {
    this.queue.push(inputData)
    this._call()
  }

  async _call () {
    // no data waiting or max concurrent tasks reached
    if (this.queue[0] === undefined || this.maxConcurrentTasks <= this.runningTasksNb) return

    this.runningTasksNb++

    let outputData
    let inputData = this.queue.shift()
    if (!Array.isArray(inputData)) inputData = [inputData]

    // TODO: what should we do if it throws an error?
    // don't catch it? catch it to make it disappear ?
    outputData = await this.task(...inputData)

    if (outputData !== undefined) {
      // we turn outputData into an array (iterable) so that it's compatible
      // with the for await loop
      if (!isGenerator(this.task)) outputData = [outputData]
      for await (let data of outputData) {
        if (!Array.isArray(data)) data = [data]
        this.onOutput(...data)
      }
    }

    this.runningTasksNb--

    this._call()
  }
}

class Pipeline {
  constructor (pipes) {
    this.pipes = pipes

    // send the output of a pipe to the input of the next one
    pipes.forEach((pipe, i) => {
      // we will link i-1 to i
      if (i === 0) return
      pipes[i - 1].onOutput = (...data) => pipe.put(...data)
    })
  }

  static fromTasks (tasks, maxConcurrentTasks = []) {
    const pipes = tasks.map((el, i) => new Pipe(el, maxConcurrentTasks[i] || Number.POSITIVE_INFINITY))
    return new this(pipes)
  }

  put (...data) {
    this.pipes[0].put(...data)
  }
}

module.exports = {
  Pipe,
  Pipeline
}
