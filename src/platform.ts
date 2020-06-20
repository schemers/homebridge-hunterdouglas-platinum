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
import { ExamplePlatformAccessory } from './platformAccessory'
import { BlindAccessory, BlindAccessoryContext } from './blindAccessory'

import { Controller, Config, Room, Shade } from './controller'

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

  // this is used to track active virtual room blind accessories
  private virtualRoomAccessories = new Map<string, BlindAccessory>()

  private controller: Controller
  private blindConfig?: Config

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name)

    this.applyConfigDefaults(config)
    this.controller = new Controller(this.log, this.config.ip_address, this.config.port)

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
      this.setupAccessories(this.blindConfig)
    } catch (err) {
      // TODO: retry
      this.log.error('unable to get blind config', err)
    }
  }

  setupAccessories(blindConfig: Config) {
    // discreate blinds first
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
        if (room.shadeIds.length > 1) {
          const blindId = room.shadeIds.sort().join(',')
          const context: BlindAccessoryContext = {
            displayName: room.name,
            blindId: blindId,
            roomId: roomId,
            shadeTypeId: room.shadeType,
          }
          this.virtualRoomAccessories.set(blindId, this.configureBlindAccessory(context))
        }
      }
    }

    // if we found any accessories,  start polling for status
    if (this.virtualRoomAccessories.size || this.blindAccessories.size) {
      this._pollForStatus(0)
    }
  }

  /** start polling process with truncated exponential backoff: https://cloud.google.com/storage/docs/exponential-backoff */
  _pollForStatus(retryAttempt: number) {
    //
    this.log.info('poll for status', retryAttempt)
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
