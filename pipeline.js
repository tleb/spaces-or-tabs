const { isGenerator } = require('./utils.js')
const Deque = require('double-ended-queue')

module.exports = class Pipeline {
  // Has a max amount of workers which aim is to finish as quickly as possible began tasks
  // tasks near the end get done first so that we don't fill the waiting list
  // A pulling Pipeline
  // TODO: only pull on generators when we want data, have them as kinds of todo

  constructor (tasks, maxConcurrentTasks = Math.POSITIVE_INFINITY) {
    // tasks are functions, async or not, generators or not
    this.tasks = tasks
    this.maxConcurrentTasks = maxConcurrentTasks
    this.currentConcurrentTasks = 0
    this.todo = []

    for (let i = 0; i < tasks.length; i++) {
      this.todo[i] = new Deque()
    }
  }

  put (...data) {
    this.todo[0].enqueue(data)
    this._call()
  }

  async _call () {
    // too many tasks already running
    if (this.currentConcurrentTasks >= this.maxConcurrentTasks) return

    const taskId = this._findTodoTaskId()
    if (taskId === undefined) return

    this.currentConcurrentTasks++
    const task = this.tasks[taskId]
    const inputData = this.todo[taskId].dequeue()
    let output = await task(...inputData)

    let outputedResultsCount = 0
    if (output !== undefined && taskId < this.tasks.length - 1) {
      if (isGenerator(task)) {
        for await (let data of output) {
          if (!Array.isArray(data)) data = [data]
          this.todo[taskId + 1].enqueue(data)
          outputedResultsCount++
        }
      } else {
        if (!Array.isArray(output)) output = [output]
        this.todo[taskId + 1].enqueue(output)
        outputedResultsCount++
      }
    }

    this.currentConcurrentTasks--
    for (let i = 0; i < (outputedResultsCount || 1); i++) this._call()
  }

  _findTodoTaskId () {
    for (let i = this.todo.length - 1; i >= 0; i--) {
      if (this.todo[i].length !== 0) return i
    }
  }
}
