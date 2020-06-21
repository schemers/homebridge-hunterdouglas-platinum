import { Logger } from 'homebridge'

import { Socket } from 'net'
import { EventEmitter } from 'events'

/**
 * config options:
 * 1. find unit by static IP address.
 *   config = {
 *     ip_address: "n.n.n.n",
 *     port: 522 // optional port
 *   }
 */
export class Controller {
  static DEFAULT_PORT = 522

  constructor(
    private readonly log: Logger,
    private readonly ip_address: string,
    private readonly port: number = Controller.DEFAULT_PORT,
  ) {
    // test
  }

  /**
   * returns the `Config` object on success
   */
  public async getConfig(): Promise<ControllerConfig> {
    return new Promise((resolve, reject) => {
      const connection = new Connection(this.log, this.ip_address, this.port)
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
  public async getStatus(): Promise<ShadeStatus> {
    return new Promise((resolve, reject) => {
      const connection = new Connection(this.log, this.ip_address, this.port)
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
  public async setPosition(
    shadeIds: string[],
    shadeFeatureId: string,
    position: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const connection = new Connection(this.log, this.ip_address, this.port)
      connection
        .on('error', err => {
          connection.close()
          reject(err)
        })
        .on('connected', () => {
          connection.setPosition(shadeIds, shadeFeatureId, position)
        })
        .on('set_position', () => {
          connection.close()
          resolve()
        })
      connection.connect()
    })
  }
}

const EXPECTED_HELLO = 'HunterDouglas Shade Controller'

const CMD_GET_DATA = '$dat'
const CMD_GET_DATA_TERM = /^\$upd01-$/

function CMD_POS_SET(shadeId: string, shadeFeatureId: string, position: number) {
  return (
    '$pss' +
    shadeId.padStart(2, '0') +
    '-' +
    shadeFeatureId.padStart(2, '0') +
    '-' +
    String(position).padStart(3, '0')
  )
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
  private socket: Socket
  private data = ''
  private dataFromIndex = 0
  private readLineResolver?: (value?: string | PromiseLike<string>) => void

  constructor(
    private readonly log: Logger,
    private readonly ip_address: string,
    private readonly port: number = Controller.DEFAULT_PORT,
  ) {
    super()

    this.data = ''
    this.dataFromIndex = 0
    this.readLineResolver = undefined

    this.socket = new Socket()
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
    this.socket.connect(this.port, this.ip_address)
  }

  close() {
    this.socket.destroy()
  }

  /** starts things in motion to eventually emit a `config` event on success */
  getConfig() {
    this._command(CMD_GET_DATA, CMD_GET_DATA_TERM)
      .then(lines => {
        this.emit('config', new ControllerConfig(lines))
      })
      .catch(err => this._handleError(err))
  }

  /** starts things in motion to eventually emit a `status` event on success */
  getStatus() {
    this._command(CMD_GET_DATA, CMD_GET_DATA_TERM)
      .then(lines => {
        this.emit('status', new ShadeStatus(lines))
      })
      .catch(err => this._handleError(err))
  }

  /** starts things in motion to eventually emit a `set_position` event on success */
  setPosition(shadeIds, shadeFeatureId, position) {
    this._setPosition(shadeIds, shadeFeatureId, position)
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
  async _setPosition(shadeIds: string[], shadeFeatureId: string, position: number) {
    for (const shadeId of shadeIds) {
      this.log.debug(`Connection._setPosition: ${shadeId} to ${position}`)
      await this._command(CMD_POS_SET(shadeId, shadeFeatureId, position), CMD_POS_SET_TERM)
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
  async _command(cmd: string, terminator: RegExp): Promise<string[]> {
    this.socket.write(cmd)
    this.log.debug('_command: WRITE:', cmd)

    return await this._readUntil(terminator)
  }

  /** keeps reading lines until a line ending with token is found.
   * returns array of lines found, not included line with token.
   */
  async _readUntil(terminator): Promise<string[]> {
    const lines = Array<string>()
    let line: string | undefined = ''

    // try to read what we already have buffered first
    while ((line = this._popLineFromData()) !== undefined) {
      if (terminator.test(line)) {
        return lines
      }
      lines.push(line)
    }

    // if we've exhausted what is buffered, wait for new data
    while ((line = await this._readLine()) !== undefined) {
      if (terminator.test(line)) {
        return lines
      }
      lines.push(line)
    }

    // hum, this should never be called but is required
    return lines
  }

  async _readLine(): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    return new Promise<string>((resolve, _reject) => {
      // lets see if a line is already available, and just return it
      const line = this._popLineFromData()
      if (line !== undefined) {
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
    this._readLine().then(line => {
      if (!line.endsWith(EXPECTED_HELLO)) {
        this.log.warn('_handleReady unexpected hello', line)
      }
      this.emit('connected')
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _handleClose(_hadError: boolean) {
    //this.socketClosed = true
  }

  _handleTimeout() {
    this.socket.destroy()
    this.emit('error', new BridgeError('timeout'))
  }

  _handleError(err: Error) {
    this.log.error('_handleError:', err)
    this.socket.destroy()
    this.emit('error', err)
  }

  _handleData(data: Buffer) {
    this.data += data
    //this.log.debug('handleData:', util.inspect(data))
    if (this.readLineResolver) {
      const line = this._popLineFromData()
      if (line !== undefined) {
        this.log.debug('_command: READ:', line)
        this.readLineResolver(line)
        this.readLineResolver = undefined
      }
    } else {
      this.log.debug('handleData: no resolver')
    }
  }

  /** attempts to read a line from data and either returns trimmed line or null if no data available */
  _popLineFromData(): string | undefined {
    const endIndex = this.data.indexOf(HD_PROTOCOL_LINE_TERM, this.dataFromIndex)
    if (endIndex === -1) {
      return undefined
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
const HOME_RE = /^\$ct(.*)$/
const LED_RE = /^\$LEDl(\d\d\d)-$/
const ROOM_RE = /^\$cr(\d\d)-(\d\d)-[^-]+-(.*)$/
const SHADE_RE = /^\$cs(\d\d)-(\d\d)-[^-]+-(.*)$/
const SHADE_POS_RE = /^\$cp(\d\d)-\d\d-(\d\d\d)-$/

export class Shade {
  _state = 0

  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly roomId: string,
  ) {}

  public get state(): number {
    return this._state
  }
}

export class Room {
  constructor(
    public readonly id: string,
    public readonly shadeType: string,
    public readonly name: string,
    public readonly shadeIds: Array<string>,
  ) {}
}

export class ControllerConfig {
  public readonly softwareVersion = '2018'
  public readonly deviceId = 'F1A2A170-A2B8-4B03-A05B-65AC70435C27' // default value
  public readonly ledBrightness: number
  public readonly homeName: string
  public readonly rooms = new Map<string, Room>()
  public readonly shades = new Map<string, Shade>()

  constructor(lines: string[]) {
    let match
    this.ledBrightness = 0
    this.homeName = ''

    for (const line of lines) {
      if ((match = FIRM_RE.exec(line))) {
        this.softwareVersion = match[1]
      } else if ((match = MAC_RE.exec(line))) {
        this.deviceId = match[1]
      } else if ((match = LED_RE.exec(line))) {
        this.ledBrightness = Number(match[1])
      } else if ((match = HOME_RE.exec(line))) {
        this.homeName = match[1].trim()
      } else if ((match = ROOM_RE.exec(line))) {
        const id = String(match[1]).padStart(2, '0')
        const shadeTypeId = String(match[2]).padStart(2, '0')
        const name = match[3].trim()
        const room = new Room(id, shadeTypeId, name, Array<string>())
        this.rooms.set(id, room)
      } else if ((match = SHADE_RE.exec(line))) {
        const id = String(match[1]).padStart(2, '0')
        const roomId = String(match[2]).padStart(2, '0')
        const name = match[3].trim()
        const shade = new Shade(id, name, roomId)
        this.shades.set(id, shade)
        const room = this.rooms.get(roomId)
        if (room) {
          room.shadeIds.push(id)
        }
      } else if ((match = SHADE_POS_RE.exec(line))) {
        const id = String(match[1]).padStart(2, '0')
        const state = match[2]
        const shade = this.shades.get(id)
        if (shade) {
          shade._state = Number(state)
        }
      }
    }
  }
}

export class ShadeStatus {
  public readonly shadeState = new Map<string, number>()
  constructor(private readonly lines: string[]) {
    let match
    for (const line of lines) {
      if ((match = SHADE_POS_RE.exec(line))) {
        const id = match[1]
        const state = match[2]
        this.shadeState.set(id, Number(state))
      }
    }
  }
}

export class BridgeError extends Error {}
