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
          this.log.info('connected!')
          connection.getConfig()
        })
        .once('config', config => {
          resolve(config)
          connection.close()
        })
      connection.connect()
    })
  }

  // async _getConfig() {
  //   const connection = new Connection(this.config.port, this.config.ip_address)

  //   try {
  //     await connection.connect()
  //     return await connection.getConfig()
  //   } finally {
  //     connection.close()
  //   }
  // }

  async _getConnection() {
    let connection = Connection(this.config.port, this.config.ip_address)
    return connection
  }
}

// these are declared outside the class due to eslint
Controller.connectError = Error('unable to connect')
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
      .on('error', err => this._handleError(err))
      .on('data', data => this._handleData(data))
      .once('connect', () => this._handleConnect())
  }

  /**
   * starts things in motion to eventually emit a `connected` event on success.
   */
  connect() {
    this.socket.connect(this.port || DEFAULT_PORT, this.ip_address)
  }

  /** starts things in motion to eventually emit a `config` event on success */
  getConfig() {
    this._command(CMD_GET_DATA, CMD_GET_DATA_TERM)
      .then(lines => {
        this.log.info('read lines!!!', lines)
      })
      .catch(err => this._handleError(err))
  }

  async _command(cmd, terminator) {
    this.socket.write(cmd, err => {
      if (err) {
        this._handleError(err)
      }
    })

    var lines = []
    var line = ''
    while ((line = await this._readLine()) != null) {
      if (line.endsWith(terminator)) {
        return lines
      }
      lines.push(line)
    }
  }

  /** keeps reading lines until a line ending with token is found. returns array of lines found, not included line with token */
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
    this.log.info('_handleConnect')

    this._readLine().then(line => {
      if (line.endsWith(EXPECTED_HELLO)) {
        this.emit('connected')
      } else {
        throw Controller.unexpectedHelloError
      }
    })
  }

  _handleError(err) {
    this.log.info('_handleError:', err)

    this.emit('error', err)
    this.socket.end()
  }

  _handleData(data) {
    this.data += data
    this.log.info('handleData:', util.inspect(data))
    if (this.readLineResolver) {
      this.log.info('handleData: resolver')

      const line = this._popLineFromData()
      if (line != null) {
        this.readLineResolver(line)
        this.readLineResolver = null
      }
    } else {
      this.log.info('handleData: no resolver')
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

class Config {
  constructor() {
    this.softwareVersion = '2018' // $firm02-2018-HD gateway 2.18
    this.serialNumber = '' // 1 $MAC0x000B3C606C71-
    this.ledBrightness = 0 // 1 $LEDl008-
  }
}

class Status {
  constructor() {}
}

module.exports = {
  Controller,
  Config,
  Status
}
