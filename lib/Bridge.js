'use strict'

const net = require('net')
const util = require('util')
const EventEmitter = require('events')

const DEFAULT_PORT = 522

/**
 * config options:
 * 1. find unit by static IP address.
 *   config = {
 *     ip_address: "n.n.n.n",
 *     port: 522 // optional port
 *   }
 */
class Controller {
  constructor(config, log) {
    this.config = config
    this.log = log || console
  }

  getConfig() {
    return new Promise((resolve, reject) => {
      const connection = new Connection(this.config.port, this.config.ip_address, this.log)
      connection
        .once('error', err => reject(err))
        .once('connected', () => {
          this.log.debug('connected!')
          connection.getConfig()
        })
        .once('config', config => {
          resolve(config)
          connection.close()
        })
      connection.connect()
    })
  }

  getStatus() {
    return new Promise((resolve, reject) => {
      const connection = new Connection(this.config.port, this.config.ip_address, this.log)
      connection
        .once('error', err => reject(err))
        .once('connected', () => {
          this.log.debug('connected!')
          connection.getStatus()
        })
        .once('status', status => {
          resolve(status)
          connection.close()
        })
      connection.connect()
    })
  }
}

// these are declared outside the class due to eslint
Controller.connectError = Error('unable to connect')
Controller.timeoutError = Error('timeout')
Controller.unexpectedHelloError = Error('unexpected hello response from bridge')

const EXPECTED_HELLO = 'HunterDouglas Shade Controller'

const CMD_GET_DATA = '$dat'
const CMD_GET_DATA_TERM = '$upd01-'

/** hunter douglas prefixes each line with a number followed by a space.
 * The number appears to be the number of active connections to the bridge and
 * is consistent throughout a given connection.
 */
const HD_PROTOCOL_PREFIX = /^\d+ /

/** ugh */
const HD_PROTOCOL_LINE_TERM = '\n\r'

/**
 * `connected` emitted when we successfully connect and get expected hello from bridge.
 */
class Connection extends EventEmitter {
  constructor(port, ip_address, log) {
    super()
    this.port = port || DEFAULT_PORT
    this.ip_address = ip_address
    this.log = log
    this.data = ''
    this.dataFromIndex = 0
    this.readLineResolver = null

    this.socket = new net.Socket()
    this.socket
      .setEncoding('utf8')
      .setTimeout(30000)
      .on('error', err => this._handleError(err))
      .on('data', data => this._handleData(data))
      .on('close', hadError => this._handleClose(hadError))
      .on('timeout', () => this._handleTimeout())
      .once('connect', () => this._handleConnect())
  }

  /**
   * starts things in motion to eventually emit a `connected` event on success.
   */
  connect() {
    this.socket.connect(this.port || DEFAULT_PORT, this.ip_address)
  }

  close() {
    this.socket.end()
  }

  /** starts things in motion to eventually emit a `config` event on success */
  getConfig() {
    this._command(CMD_GET_DATA, CMD_GET_DATA_TERM)
      .then(lines => {
        this.emit('config', new Config(lines))
      })
      .catch(err => this._handleError(err))
  }

  /** starts things in motion to eventually emit a `status` event on success */
  getStatus() {
    this._command(CMD_GET_DATA, CMD_GET_DATA_TERM)
      .then(lines => {
        this.emit('status', new Status(lines))
      })
      .catch(err => this._handleError(err))
  }

  async _command(cmd, terminator) {
    this.socket.write(cmd)

    var lines = []
    var line = ''
    while ((line = await this._readLine()) != null) {
      if (line.endsWith(terminator)) {
        return lines
      }
      lines.push(line)
    }
  }

  /** keeps reading lines until a line ending with token is found.
   * returns array of lines found, not included line with token.
   */
  async _readUntil(token) {
    var lines = []
    var line = ''
    while ((line = await this._readLine()) != null) {
      if (line.endsWith(token)) {
        return lines
      }
      lines.push(line)
    }
  }

  async _readLine() {
    return new Promise((resolve, _reject) => {
      // lets see if a line is already available, and just return it
      const line = this._popLineFromData()
      if (line != null) {
        resolve(line)
      } else {
        // set ourselves as the current resolver
        // _dataHandler will call us when a line is available
        this.readLineResolver = resolve
      }
    })
  }

  _handleConnect() {
    this.log.debug('_handleConnect')

    this._readLine().then(line => {
      if (line.endsWith(EXPECTED_HELLO)) {
        this.emit('connected')
      } else {
        throw Controller.unexpectedHelloError
      }
    })
  }

  _handleClose(_hadError) {
    this.socketClosed = true
  }

  _handleTimeout() {
    this.socket.end()
    this.emit('error', Controller.timeoutError)
  }

  _handleError(err) {
    this.log.error('_handleError:', err)
    this.emit('error', err)
    this.socket.end()
  }

  _handleData(data) {
    this.data += data
    //this.log.debug('handleData:', util.inspect(data))
    if (this.readLineResolver) {
      const line = this._popLineFromData()
      if (line != null) {
        this.readLineResolver(line)
        this.readLineResolver = null
      }
    } else {
      this.log.debug('handleData: no resolver')
    }
  }

  /** attempts to read a line from data and either returns trimmed line or null if no data available */
  _popLineFromData() {
    const endIndex = this.data.indexOf(HD_PROTOCOL_LINE_TERM, this.dataFromIndex)
    if (endIndex == -1) {
      return null
    } else {
      const result = this.data.slice(this.dataFromIndex, endIndex)
      const newFromIndex = endIndex + HD_PROTOCOL_LINE_TERM.length
      if (newFromIndex >= this.data.length) {
        this.data = ''
        this.dataFromIndex = 0
      } else {
        this.dataFromIndex = newFromIndex
      }
      // return result with protocol prefix striped off
      return result.replace(HD_PROTOCOL_PREFIX, '')
    }
  }
}

const FIRM_RE = /^\$firm\d+-(.*)$/
const MAC_RE = /^\$MAC0x(.*)-$/
const LED_RE = /^\$LEDl(\d\d\d)-$/
const ROOM_RE = /^\$cr(\d\d)-[^-]+-[^-]+-(.*)$/
const SHADE_RE = /^\$cs(\d\d)-(\d\d)-[^-]+-(.*)$/
const SHADE_POS_RE = /^\$cp(\d\d)-\d\d-(\d\d\d)-$/

class Config {
  constructor(lines) {
    var match
    this.softwareVersion = '2018'
    this.serialNumber = 'F1A2A170-A2B8-4B03-A05B-65AC70435C27' // default value
    this.rooms = new Map()
    this.shades = new Map()

    for (const line of lines) {
      if ((match = FIRM_RE.exec(line))) {
        this.softwareVersion = match[1]
      } else if ((match = MAC_RE.exec(line))) {
        this.serialNumber = match[1]
      } else if ((match = LED_RE.exec(line))) {
        this.ledBrightness = Number(match[1])
      } else if ((match = LED_RE.exec(line))) {
        this.homeName = match[1]
      } else if ((match = ROOM_RE.exec(line))) {
        const id = match[1]
        const name = match[2]
        this.rooms[id] = { id: id, name: name, shadeIds: [] }
      } else if ((match = SHADE_RE.exec(line))) {
        const id = match[1]
        const roomId = match[2]
        const name = match[3]
        this.shades[id] = { id: id, roomId: roomId, name: name }
        this.rooms[roomId].shadeIds.push(id)
      } else if ((match = SHADE_POS_RE.exec(line))) {
        const id = match[1]
        const state = match[2]
        this.shades[id].state = Number(state)
      }
    }
  }
}

class Status {
  constructor(lines) {
    this.shades = new Map()
    var match
    for (const line of lines) {
      if ((match = SHADE_POS_RE.exec(line))) {
        const id = match[1]
        const state = match[2]
        this.shades[id] = Number(state)
      }
    }
  }
}

module.exports = {
  Controller,
  Config,
  Status
}
