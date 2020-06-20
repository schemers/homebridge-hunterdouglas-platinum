import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
  CharacteristicSetCallback,
} from 'homebridge'

import { PLATFORM_NAME, PLUGIN_NAME } from './settings'
import { BlindAccessory, BlindAccessoryContext } from './blindAccessory'

import { Controller, Config, Status, Room, Shade } from './controller'

import pThrottle = require('p-throttle')
import pDebounce = require('p-debounce')

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class HunterDouglasPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic

  // this is used to track restored cached accessories
  private restoredAccessories: PlatformAccessory[] = []

  // this is used to track active blind accessories
  private blindAccessories = new Map<string, BlindAccessory>()

  private controller: Controller

  // fetched config
  private blindConfig?: Config

  // last polled blind
  private blindStatus?: Status

  // for throttling set requests
  private _setTargetPositionThrottled: pThrottle.ThrottledFunction<[string, string, number], void>

  // for debouncing set attempts on the same blindId
  private debouncedSet = new Map<
    string,
    (shadeIds: string, shadeFeatureId: string, position: number) => Promise<void>
  >()

  private pendingRefreshPromise?: Promise<null>

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name)

    this.applyConfigDefaults(config)
    this.controller = new Controller(this.log, this.config.ip_address, this.config.port)

    this._setTargetPositionThrottled = pThrottle(
      (blindId: string, shadeFeatureId: string, nativePosition: number) => {
        return this.controller.setPosition(blindId.split(','), shadeFeatureId, nativePosition)
      },
      1,
      config.setPositionThrottleRateMsecs,
    )

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback')
      // run the method to discover / register your devices as accessories
      this.discoverDevices()
    })
  }

  applyConfigDefaults(config: PlatformConfig) {
    const DEFAULT_STATUS_POLLING_SECONDS = 60
    const DEFAULT_SET_POSITION_DELAY_MSECS = 2500
    const DEFAULT_SET_POSITION_THROTTLE_RATE_MSECS = 5000
    const DEFAULT_CREATE_VIRTUAL_ROOM_BLIND = true
    const DEFAULT_CREATE_DISCRETE_BLINDS = true
    const DEFAULT_PREFIX_ROOM_NAME_TO_BLIND_NAME = true
    const DEFAULT_TOP_DOWN_BOTTOM_UP_BEHAVIOR = 'topDown'

    // apply defaults
    config.statusPollingSeconds = config.statusPollingSeconds ?? DEFAULT_STATUS_POLLING_SECONDS
    config.setPositionDelayMsecs = config.setPositionDelayMsecs ?? DEFAULT_SET_POSITION_DELAY_MSECS
    config.setPositionThrottleRateMsecs =
      config.setPositionThrottleRateMsecs ?? DEFAULT_SET_POSITION_THROTTLE_RATE_MSECS
    config.createVirtualRoomBlind =
      config.createVirtualRoomBlind ?? DEFAULT_CREATE_VIRTUAL_ROOM_BLIND
    config.createDiscreteBlinds = config.createDiscreteBlinds ?? DEFAULT_CREATE_DISCRETE_BLINDS
    config.prefixRoomNameToBlindName =
      config.prefixRoomNameToBlindName ?? DEFAULT_PREFIX_ROOM_NAME_TO_BLIND_NAME
    config.topDownBottomUpBehavior =
      config.topDownBottomUpBehavior ?? DEFAULT_TOP_DOWN_BOTTOM_UP_BEHAVIOR
    config.port = config.port ?? Controller.DEFAULT_PORT

    this.log.debug('config', this.config)
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName)

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.restoredAccessories.push(accessory)
  }

  async discoverDevices() {
    // test
    this.log.info('discoverDevices called')

    try {
      this.blindConfig = await this.controller.getConfig()
      this.log.debug('got blind config', this.blindConfig)

      this.log.info(
        'connected:',
        this.blindConfig.deviceId,
        this.blindConfig.softwareVersion,
        '(discoverDevices)',
      )
      this.setupDiscoveredAccessories(this.blindConfig)
    } catch (err) {
      // TODO: retry
      this.log.error('unable to get blind config', err)
    }
  }

  setupDiscoveredAccessories(blindConfig: Config) {
    // discrete blinds first
    if (this.config.createDiscreteBlinds) {
      const prefixName = this.config.prefixRoomNameToBlindName

      // show only visible blinds
      const visibleNames = this.config.visibleBlindNames || ''
      const visibleBlinds = new Set(
        visibleNames ? visibleNames.split(',').map(item => item.trim()) : [],
      )

      for (const [blindId, shade] of blindConfig.shades) {
        const room = blindConfig.rooms.get(shade.roomId)
        if (room === undefined) {
          continue
        }

        if (visibleNames && !visibleBlinds.has((room.name + ' ' + shade.name).trim())) {
          continue
        }

        const name = prefixName ? room.name + ' ' + shade.name : shade.name

        const context: BlindAccessoryContext = {
          displayName: name,
          blindId: blindId,
          roomId: room.id,
          shadeTypeId: room.shadeType,
        }

        this.blindAccessories.set(blindId, this.configureBlindAccessory(context))
      }
    }

    // virtual room blinds
    if (this.config.createVirtualRoomBlind) {
      for (const [roomId, room] of blindConfig.rooms) {
        // only create virtual room blind if more than one blind in the room
        if (room.shadeIds.length > 1) {
          const blindId = room.shadeIds.sort().join(',')
          const context: BlindAccessoryContext = {
            displayName: room.name,
            blindId: blindId,
            roomId: roomId,
            shadeTypeId: room.shadeType,
          }
          this.blindAccessories.set(blindId, this.configureBlindAccessory(context))
        }
      }
    }

    // TODO: need to nuke orphan accessories

    // if we found any accessories,  start polling for status
    if (this.blindAccessories.size) {
      this._pollForStatus(0)
    }
  }

  /** start polling process with truncated exponential backoff: https://cloud.google.com/storage/docs/exponential-backoff */
  _pollForStatus(retryAttempt: number) {
    const backoff = function(retryAttempt, maxTime) {
      retryAttempt = Math.max(retryAttempt, 1)
      return Math.min(Math.pow(retryAttempt - 1, 2) + Math.random(), maxTime)
    }

    const pollingInterval = this.config.statusPollingSeconds

    this._refreshAccessoryValues()
      .then(() => {
        // on success, start another timeout at normal pollingInterval
        this.log.debug('_pollForStatus success, retryAttempt:', retryAttempt)
        setTimeout(() => this._pollForStatus(0), pollingInterval * 1000)
      })
      .catch(err => {
        // on error, start another timeout with backoff
        const timeout = backoff(retryAttempt, pollingInterval)
        this.log.error('_pollForStatus retryAttempt:', retryAttempt, 'timeout:', timeout, err)
        setTimeout(() => this._pollForStatus(retryAttempt + 1), timeout * 1000)
      })
  }

  // refresh all accessories
  async _refreshAccessoryValues() {
    // if there already is a pending promise, just return it
    if (this.pendingRefreshPromise) {
      this.log.debug('re-using existing pendingRefreshPromise')
    } else {
      this.log.debug('creating new pendingRefreshPromise')
      this.pendingRefreshPromise = this._refreshStatus()
      this.pendingRefreshPromise
        // this catch is needed since we have a finally,
        // without the catch we'd get an unhandled promise rejection error
        .catch(err => {
          // log at debug level since we are logging at error in another location
          this.log.debug('_refreshAccessoryValues', err)
        })
        .finally(() => {
          this.log.debug('clearing pendingRefreshPromise')
          this.pendingRefreshPromise = undefined
        })
    }
    return this.pendingRefreshPromise
  }

  /** gets status,  updates accessories, and resolves */
  async _refreshStatus() {
    try {
      this.blindStatus = await this.controller.getStatus()
      this.log.debug('connected:', this.blindConfig?.deviceId, '(getStatus)')
      // update all values
      for (const [blindId, accessory] of this.blindAccessories) {
        const position = this.getBlindCurrentHomeKitPosition(blindId)
        if (position !== undefined) {
          accessory.updateCurrentPosition(position)
          accessory.updateTargetPosition(position)
        }
      }
      return null
    } catch (err) {
      this.blindStatus = undefined
      throw err
    }
  }

  getBlindCurrentHomeKitPosition(blindId: string): number | undefined {
    if (this.blindStatus === undefined) {
      this.log.warn('homeKitBlindPosition no blind status found')
      return undefined
    }
    const blindIds = blindId.split(',')
    const sum = blindIds
      .map(id => this.blindStatus?.shadeState.get(id) ?? 0)
      .reduce((sum, value) => sum + value, 0)
    return this.toHomeKitPosition(sum / blindIds.length)
  }

  setTargetPosition(
    blindId: string,
    shadeFeatureId: string,
    position: number,
    callback: CharacteristicSetCallback,
  ) {
    this.log.debug('setTargetPosition ', blindId, shadeFeatureId, position)

    const nativePosition = this.toNativePosition(position)

    let debouncedSet = this.debouncedSet.get(blindId)
    if (debouncedSet === undefined) {
      debouncedSet = pDebounce(
        async (shadeIds: string, shadeFeatureId: string, nativePosition: number) => {
          return this._setTargetPositionThrottled(shadeIds, shadeFeatureId, nativePosition)
        },
        this.config.setPositionDelayMsecs,
      )
      this.debouncedSet.set(blindId, debouncedSet)
    }
    debouncedSet(blindId, shadeFeatureId, nativePosition)
      .then(() => {
        callback(null, position)
        // update target/current position
        this.updateBlindAccessoryState(blindId, position)
      })
      .catch(err => {
        this.log.error('setTargetPosition error:', err)
        callback(err)
      })
  }

  updateBlindAccessoryState(blindId: string, position: number | undefined) {
    const shadeAccessory = this.blindAccessories.get(blindId)
    if (shadeAccessory !== undefined) {
      if (position !== undefined) {
        shadeAccessory.updateTargetPosition(position)
        shadeAccessory.updateCurrentPosition(position)
      }
      // see if we are updating a virtual room blind, if so update all of them
      if (blindId.includes(',')) {
        const blindIds = blindId.split(',')
        for (const id in blindIds) {
          this.updateBlindAccessoryState(id, position)
        }
      }
    } else {
      this.log.warn('unable to updateBlindAccessoryState', blindId)
    }
  }

  configureBlindAccessory(context: BlindAccessoryContext): BlindAccessory {
    // generate a unique id for this blind based on context
    const uuid = BlindAccessory.generateUUID(this, context)

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.restoredAccessories.find(accessory => accessory.UUID === uuid)

    if (existingAccessory) {
      // the accessory already exists
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName)

      // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
      // existingAccessory.context.device = device;
      // this.api.updatePlatformAccessories([existingAccessory]);

      // create the accessory handler for the restored accessory
      // this is imported from `platformAccessory.ts`
      return new BlindAccessory(this, existingAccessory)
    } else {
      // the accessory does not yet exist, so we need to create it
      this.log.info('Adding new accessory:', context.displayName)

      // create a new accessory
      const accessory = new this.api.platformAccessory(context.displayName, uuid)

      // store a copy of the device object in the `accessory.context`
      accessory.context = context

      // create the accessory handler for the newly create accessory
      const blindAccessory = new BlindAccessory(this, accessory)

      // link the accessory to platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])

      return blindAccessory
    }
  }

  generateUUID(accessorySalt: string) {
    if (this.blindConfig !== undefined) {
      return this.api.hap.uuid.generate(this.blindConfig.deviceId + ':' + accessorySalt)
    } else {
      this.log.error('blindConfig is undefined')
      return ''
    }
  }

  /**
   * convert native blind position (0-255) to HomeKit (0-100)
   */
  toHomeKitPosition(pos: number): number {
    return Math.round((pos / 255) * 100)
  }

  /**
   * convert HomeKit (0-100) to native blind position (0-255)
   *
   * @param {number} pos
   * @memberof HunterDouglasPlatinumPlatform
   */
  toNativePosition(pos: number): number {
    return Math.round((pos / 100) * 255)
  }

  infoManufacturer(): string {
    return 'HunterDouglas'
  }

  infoModel(): string {
    if (this.blindConfig) {
      return this.blindConfig.softwareVersion
    } else {
      this.log.error('blindConfig is null getting model')
      return ''
    }
  }

  accessoryInfo(): {
    manufacturer: string
    model: string
    serialNumber: string
  } {
    if (this.blindConfig) {
      return {
        manufacturer: 'HunterDouglas',
        // store software version in model, since it doesn't follow
        // proper n.n.n format Apple requires and model is a string
        model: this.blindConfig.softwareVersion,
        serialNumber: this.blindConfig.deviceId,
      }
    } else {
      this.log.error('blindConfig is null getting accessoryInfo')
      return {
        manufacturer: 'unknown',
        model: 'unknown',
        serialNumber: '',
      }
    }
  }
}
