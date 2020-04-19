'use strict'

const net = require('net')
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

  /**
   * returns the `Config` object on success
   */
  async getConfig() {
    return new Promise((resolve, reject) => {
      const connection = new Connection(this.config.port, this.config.ip_address, this.log)
      connection
        .on('error', err => {
          connection.close()
          reject(err)
        })
        .on('connected', () => {
          connection.getConfig()
        })
        .on('config', config => {
          connection.close()
          resolve(config)
        })
      connection.connect()
    })
  }

  /***
   * returns the `Status` object on success
   */
  async getStatus() {
    return new Promise((resolve, reject) => {
      const connection = new Connection(this.config.port, this.config.ip_address, this.log)
      connection
        .on('error', err => {
          connection.close()
          reject(err)
        })
        .on('connected', () => {
          connection.getStatus()
        })
        .on('status', status => {
          connection.close()
          resolve(status)
        })
      connection.connect()
    })
  }

  /**
   * set the specified shades (which should be an array of shadeIds) to the position (0-255).
   * returns `()` on success
   */
  async setPosition(shadeIds, position) {
    return new Promise((resolve, reject) => {
      const connection = new Connection(this.config.port, this.config.ip_address, this.log)
      connection
        .on('error', err => {
          connection.close()
          reject(err)
        })
        .on('connected', () => {
          connection.setPosition(shadeIds, position)
        })
        .on('set_position', () => {
          connection.close()
          resolve()
        })
      connection.connect()
    })
  }
}

const CMD_GET_DATA = '$dat'
const CMD_GET_DATA_TERM = /^\$upd01-$/

function CMD_POS_SET(shadeId, position) {
  return '$pss' + String(shadeId).padStart(2, '0') + '-04-' + String(position).padStart(3, '0')
}

const CMD_POS_SET_TERM = /^\$done$/

const CMD_SET = '$rls'
const CMD_SET_TERM = /^\$act00-00-$/

/** hunter douglas prefixes each line with a number followed by a space.
 * The number appears to be related to recent number of connections to the bridge and
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
      .once('ready', () => this._handleReady())
  }

  /**
   * starts things in motion to eventually emit a `connected` event on success.
   */
  connect() {
    this.socket.connect(this.port || DEFAULT_PORT, this.ip_address)
  }

  close() {
    this.socket.destroy()
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

  /** starts things in motion to eventually emit a `set_position` event on success */
  setPosition(shadeIds, position) {
    this._setPosition(shadeIds, position)
      .then(() => {
        this.emit('set_position')
      })
      .catch(err => this._handleError(err))
  }

  /**
   *
   *
   * @param {Array} shadeIds
   * @param {number} position
   * @memberof Connection
   */
  async _setPosition(shadeIds, position) {
    for (var shadeId of shadeIds) {
      this.log.debug(`Connection._setPosition: ${shadeId} to ${position}`)
      await this._command(CMD_POS_SET(shadeId, position), CMD_POS_SET_TERM)
    }
    await this._command(CMD_SET, CMD_SET_TERM)
  }

  /**
   * sends specifed command and waits for terminator.
   * returns all the lines, excluding the terminator.
   *
   * @param {string} cmd
   * @param {RegExp} terminator
   * @returns [string]
   * @memberof Connection
   */
  async _command(cmd, terminator) {
    this.socket.write(cmd)
    this.log.debug('_command: WRITE:', cmd)

    return await this._readUntil(terminator)
  }

  /** keeps reading lines until a line ending with token is found.
   * returns array of lines found, not included line with token.
   */
  async _readUntil(terminator) {
    var lines = []
    var line = ''

    // try to read what we already have buffered first
    while ((line = this._popLineFromData()) != null) {
      if (terminator.test(line)) {
        return lines
      }
      lines.push(line)
    }

    // if we've exhausted what is buffered, wait for new data
    while ((line = await this._readLine()) != null) {
      if (terminator.test(line)) {
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
        this.log.debug('_command: READ:', line)
        resolve(line)
      } else {
        // set ourselves as the current resolver
        // _dataHandler will call us when a line is available
        this.readLineResolver = resolve
      }
    })
  }

  _handleReady() {
    this.log.debug('_handleReady')
    this.emit('connected')
  }

  _handleClose(_hadError) {
    this.socketClosed = true
  }

  _handleTimeout() {
    this.socket.destroy()
    this.emit('error', new BridgeError('timeout'))
  }

  _handleError(err) {
    this.log.error('_handleError:', err)
    this.socket.destroy()
    this.emit('error', err)
  }

  _handleData(data) {
    this.data += data
    //this.log.debug('handleData:', util.inspect(data))
    if (this.readLineResolver) {
      const line = this._popLineFromData()
      if (line != null) {
        this.log.debug('_command: READ:', line)
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

class BridgeError extends Error {}

const CONTROLLER_RE = /^HunterDouglas Shade Controller$/
const FIRM_RE = /^\$firm\d+-(.*)$/
const MAC_RE = /^\$MAC0x(.*)-$/
const LED_RE = /^\$LEDl(\d\d\d)-$/
const ROOM_RE = /^\$cr(\d\d)-[^-]+-[^-]+-(.*)$/
const SHADE_RE = /^\$cs(\d\d)-(\d\d)-[^-]+-(.*)$/
const SHADE_POS_RE = /^\$cp(\d\d)-\d\d-(\d\d\d)-$/

class Config {
  constructor(lines) {
    var match
    this.hello = ''
    this.softwareVersion = '2018'
    this.serialNumber = 'F1A2A170-A2B8-4B03-A05B-65AC70435C27' // default value
    this.rooms = new Map()
    this.shades = new Map()

    for (const line of lines) {
      if ((match = CONTROLLER_RE.exec(line))) {
        this.hello = line
      } else if ((match = FIRM_RE.exec(line))) {
        this.softwareVersion = match[1]
      } else if ((match = MAC_RE.exec(line))) {
        this.serialNumber = match[1]
      } else if ((match = LED_RE.exec(line))) {
        this.ledBrightness = Number(match[1])
      } else if ((match = LED_RE.exec(line))) {
        this.homeName = match[1]
      } else if ((match = ROOM_RE.exec(line))) {
        const id = String(match[1]).padStart(2, '0')
        const name = match[2]
        this.rooms.set(id, { id: id, name: name, shadeIds: [] })
      } else if ((match = SHADE_RE.exec(line))) {
        const id = String(match[1]).padStart(2, '0')
        const roomId = String(match[2]).padStart(2, '0')
        const name = match[3]
        this.shades.set(id, { id: id, roomId: roomId, name: name })
        this.rooms.get(roomId).shadeIds.push(id)
      } else if ((match = SHADE_POS_RE.exec(line))) {
        const id = String(match[1]).padStart(2, '0')
        const state = match[2]
        this.shades.get(id).state = Number(state)
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
        this.shades.set(id, Number(state))
      }
    }
  }
}

module.exports = {
  Controller,
  Config,
  Status,
  BridgeError
}
