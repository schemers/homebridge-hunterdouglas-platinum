import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge'

import { PLATFORM_NAME, PLUGIN_NAME } from './settings'
import { ShadeAccessory, ShadeAccessoryContext } from './shadeAccessory'

import { Controller, ControllerConfig, ShadeStatus } from './controller'

import pThrottle from 'p-throttle'

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

  // this is used to track active shade accessories
  private shadeAccessories = new Map<string, ShadeAccessory>()

  private controller: Controller

  // fetched config
  private controllerConfig?: ControllerConfig

  // last polled shade status
  private shadeStatus?: ShadeStatus

  // for throttling set requests
  private _setTargetPositionThrottled: pThrottle.ThrottledFunction<[string, string, number], void>

  private pendingRefreshPromise?: Promise<null>
  private pendingSetTimer = new Map<string, NodeJS.Timeout>()

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform', PLATFORM_NAME)

    this.applyConfigDefaults(config)

    this.controller = new Controller({
      log: this.log,
      ip_address: this.config.ip_address,
      port: this.config.port,
    })

    this._setTargetPositionThrottled = pThrottle(
      (shadeId: string, shadeFeatureId: string, nativePosition: number) => {
        return this.controller.setPosition(shadeId.split(','), shadeFeatureId, nativePosition)
      },
      1, // LIMIT to 1 call within interval
      config.setPositionThrottleRateMsecs,
    )

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback')
      // run the method to discover / register your devices as accessories
      this.discoverDevices(0)
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

  discoverDevices(retryAttempt: number) {
    // test
    this.log.info('discoverDevices')

    const pollingInterval = 60 // TODO: get from config

    this.controller
      .getConfig()
      .then(config => {
        this.controllerConfig = config
        this.log.debug('got shade config', this.controllerConfig)
        this.log.info(
          `discoverDevices connected: ${this.controllerConfig.deviceId} ${this.controllerConfig.softwareVersion}`,
        )
        this.setupDiscoveredAccessories(this.controllerConfig)
      })
      .catch(err => {
        // on error, start another timeout with backoff
        const timeout = this.backoff(retryAttempt, pollingInterval)
        this.log.error(
          `discoverDevices retryAttempt: ${retryAttempt} timeout: ${timeout} error: ${err}`,
        )
        setTimeout(() => this.discoverDevices(retryAttempt + 1), timeout * 1000)
      })
  }

  setupDiscoveredAccessories(controllerConfig: ControllerConfig) {
    // discrete shades first
    if (this.config.createDiscreteBlinds) {
      const prefixName = this.config.prefixRoomNameToBlindName

      // show only visible shades
      const visibleNames = this.config.visibleBlindNames || ''
      const visibleShades = new Set(
        visibleNames ? visibleNames.split(',').map(item => item.trim()) : [],
      )

      for (const [shadeId, shade] of controllerConfig.shades) {
        const room = controllerConfig.rooms.get(shade.roomId)
        if (room === undefined) {
          continue
        }

        if (visibleNames && !visibleShades.has((room.name + ' ' + shade.name).trim())) {
          continue
        }

        this.shadeAccessories.set(
          shadeId,
          this.configureShadeAccessory({
            displayName: prefixName ? room.name + ' ' + shade.name : shade.name,
            shadeId: shadeId,
            roomId: room.id,
            shadeFeatureId: this.getShadeFeatureId(room.shadeType),
          }),
        )
      }
    }

    // virtual room shades
    if (this.config.createVirtualRoomBlind) {
      for (const [roomId, room] of controllerConfig.rooms) {
        // only create virtual room shades if more than one shade in the room
        if (room.shadeIds.length > 1) {
          const shadeId = room.shadeIds.sort().join(',')
          this.shadeAccessories.set(
            shadeId,
            this.configureShadeAccessory({
              displayName: room.name,
              shadeId: shadeId,
              roomId: roomId,
              shadeFeatureId: this.getShadeFeatureId(room.shadeType),
            }),
          )
        }
      }
    }

    // nuke orphan accessories
    const activeIds = Array.from(this.shadeAccessories.values()).map(accessory => accessory.UUID)
    const staleAccessories = this.restoredAccessories.filter(
      accessory => !activeIds.includes(accessory.UUID),
    )

    if (staleAccessories.length) {
      const staleNames = staleAccessories.map(accessory => accessory.displayName)
      this.log.info('unregistering accessories', staleNames)
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, staleAccessories)
    }

    // if we found any accessories,  start polling for status
    if (this.shadeAccessories.size) {
      this._pollForStatus(0)
    }
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

  configureShadeAccessory(context: ShadeAccessoryContext): ShadeAccessory {
    // generate a unique id for this shade based on context
    const uuid = ShadeAccessory.generateUUID(this, context)

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingAccessory = this.restoredAccessories.find(accessory => accessory.UUID === uuid)

    if (existingAccessory) {
      // the accessory already exists
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName)

      // update the context if it has changed
      if (!ShadeAccessory.sameContext(context, existingAccessory.context)) {
        existingAccessory.context = context
        this.log.info('Updating existing accessory:', context.displayName)
        this.api.updatePlatformAccessories([existingAccessory])
      }
      // create the accessory handler for the restored accessory
      // this is imported from `platformAccessory.ts`
      return new ShadeAccessory(this, existingAccessory)
    } else {
      // the accessory does not yet exist, so we need to create it
      this.log.info('Adding new accessory:', context.displayName)

      // create a new accessory
      const accessory = new this.api.platformAccessory(context.displayName, uuid)

      // store a copy of the device object in the `accessory.context`
      accessory.context = context

      // create the accessory handler for the newly create accessory
      const shadeAccessory = new ShadeAccessory(this, accessory)

      // link the accessory to platform
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])

      return shadeAccessory
    }
  }

  /** start polling process with truncated exponential backoff: https://cloud.google.com/storage/docs/exponential-backoff */
  _pollForStatus(retryAttempt: number) {
    const pollingInterval = this.config.statusPollingSeconds

    this._refreshAccessoryValues()
      .then(() => {
        // on success, start another timeout at normal pollingInterval
        this.log.debug('_pollForStatus success, retryAttempt:', retryAttempt)
        setTimeout(() => this._pollForStatus(0), pollingInterval * 1000)
      })
      .catch(err => {
        // on error, start another timeout with backoff
        const timeout = this.backoff(retryAttempt, pollingInterval)
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
      this.shadeStatus = await this.controller.getStatus()
      this.log.debug('connected:', this.controllerConfig?.deviceId, '(getStatus)')
      // update all values
      for (const [shadeId, accessory] of this.shadeAccessories) {
        const position = this.getShadeCurrentHomeKitPosition(shadeId)
        if (position !== undefined) {
          accessory.updateCurrentPosition(position)
          accessory.updateTargetPosition(position)
        }
      }
      return null
    } catch (err) {
      this.shadeStatus = undefined
      throw err
    }
  }

  getShadeCurrentHomeKitPosition(shadeId: string): number | undefined {
    if (this.shadeStatus === undefined) {
      this.log.warn('getShadeCurrentHomeKitPosition no shade status found')
      return undefined
    }
    const shadeIds = shadeId.split(',')
    const sum = shadeIds
      .map(id => this.shadeStatus?.shadeState.get(id) ?? 0)
      .reduce((sum, value) => sum + value, 0)
    return this.toHomeKitPosition(sum / shadeIds.length)
  }

  setTargetPosition(context: ShadeAccessoryContext, position: number) {
    this.log.debug('setTargetPosition ', context.shadeId, context.shadeFeatureId, position)
    let handle = this.pendingSetTimer.get(context.shadeId)
    if (handle) {
      clearTimeout(handle)
    }

    handle = setTimeout(async () => {
      try {
        // delete ourselves from pendingSetTimer
        this.pendingSetTimer.delete(context.shadeId)
        const nativePosition = this.toNativePosition(position)
        this.log.debug('setTargetPosition:', position, context)
        await this._setTargetPositionThrottled(
          context.shadeId,
          context.shadeFeatureId,
          nativePosition,
        )

        // trigger refresh after setting. call _refreshStatus
        // instead of _refreshAccessories so we definitely fetch fresh values
        await this._refreshStatus()
      } catch (err) {
        this.log.error('unable to set blind position', err)
      }
    }, this.config.setPositionDelayMsecs)
    this.pendingSetTimer.set(context.shadeId, handle)
  }

  getShadeFeatureId(shadeTypeId: string) {
    // Default feature is bottom-up - Feature ID: "04"
    let shadeFeatureId = '04'
    // Special handling for top-down-bottom-up shades, which can be detected from the room's shadeTypeId
    // For top-down-bottom-up shades (shadeTypeId 02 or 13), use the top-down feature - Feature ID: "18"
    if (shadeTypeId === '02' || shadeTypeId === '13') {
      if (this.config.topDownBottomUpBehavior === 'topDown') {
        shadeFeatureId = '18'
      }
    }
    return shadeFeatureId
  }

  generateUUID(accessorySalt: string) {
    if (this.controllerConfig !== undefined) {
      return this.api.hap.uuid.generate(this.controllerConfig.deviceId + ':' + accessorySalt)
    } else {
      this.log.error('controllerConfig is undefined')
      return ''
    }
  }

  /**
   * convert native shade position (0-255) to HomeKit (0-100)
   */
  toHomeKitPosition(pos: number): number {
    return Math.round((pos / 255) * 100)
  }

  /**
   * convert HomeKit (0-100) to native shade position (0-255)
   *
   * @param {number} pos
   * @memberof HunterDouglasPlatinumPlatform
   */
  toNativePosition(pos: number): number {
    return Math.round((pos / 100) * 255)
  }

  backoff(retryAttempt: number, maxTime: number): number {
    retryAttempt = Math.max(retryAttempt, 1)
    return Math.min(Math.pow(retryAttempt - 1, 2) + Math.random(), maxTime)
  }

  accessoryInfo(): {
    manufacturer: string
    model: string
    serialNumber: string
  } {
    if (this.controllerConfig) {
      return {
        manufacturer: 'HunterDouglas',
        // store software version in model, since it doesn't follow
        // proper n.n.n format Apple requires and model is a string
        model: this.controllerConfig.softwareVersion,
        serialNumber: this.controllerConfig.deviceId,
      }
    } else {
      this.log.error('controllerConfig is null getting accessoryInfo')
      return {
        manufacturer: 'unknown',
        model: 'unknown',
        serialNumber: '',
      }
    }
  }
}
