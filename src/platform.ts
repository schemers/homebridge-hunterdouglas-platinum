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
import { Controller, Config, Room, Shade } from './controller'

const DEFAULT_STATUS_POLLING_SECONDS = 60
const DEFAULT_SET_POSITION_DELAY_MSECS = 2500
const DEFAULT_SET_POSITION_THROTTLE_RATE_MSECS = 5000
const DEFAULT_CREATE_VIRTUAL_ROOM_BLIND = true
const DEFAULT_CREATE_DISCRETE_BLINDS = true
const DEFAULT_PREFIX_ROOM_NAME_TO_BLIND_NAME = true
const DEFAULT_TOP_DOWN_BOTTOM_UP_BEHAVIOR = 'topDown'

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class HunterDouglasPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = []

  private controller: Controller
  private blindConfig?: Config

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name)

    // apply defaults
    this.config.statusPollingSeconds = config.statusPollingSeconds ?? DEFAULT_STATUS_POLLING_SECONDS
    this.config.setPositionDelayMsecs =
      config.setPositionDelayMsecs ?? DEFAULT_SET_POSITION_DELAY_MSECS
    this.config.setPositionThrottleRateMsecs =
      config.setPositionThrottleRateMsecs ?? DEFAULT_SET_POSITION_THROTTLE_RATE_MSECS
    this.config.createVirtualRoomBlind =
      config.createVirtualRoomBlind ?? DEFAULT_CREATE_VIRTUAL_ROOM_BLIND
    this.config.createDiscreteBlinds = config.createDiscreteBlinds ?? DEFAULT_CREATE_DISCRETE_BLINDS
    this.config.prefixRoomNameToBlindName =
      config.prefixRoomNameToBlindName ?? DEFAULT_PREFIX_ROOM_NAME_TO_BLIND_NAME
    this.config.topDownBottomUpBehavior =
      config.topDownBottomUpBehavior ?? DEFAULT_TOP_DOWN_BOTTOM_UP_BEHAVIOR
    this.config.port = config.port ?? Controller.DEFAULT_PORT

    this.log.debug('config', this.config)

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

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName)

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory)
  }

  async discoverDevices() {
    // test
    this.log.info('discoverDevices called')

    try {
      this.blindConfig = await this.controller.getConfig()
      this.log.debug('got blind config', this.blindConfig)
    } catch (err) {
      this.log.error('unable to get blind config', err)
    }
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */
  sampleDiscoverDevices() {
    this.log.info('sampleDiscoverDevices called')

    // EXAMPLE ONLY
    // A real plugin you would discover accessories from the local network, cloud services
    // or a user-defined array in the platform config.
    const exampleDevices = [
      {
        exampleUniqueId: 'ABCD',
        exampleDisplayName: 'Bedroom',
      },
      {
        exampleUniqueId: 'EFGH',
        exampleDisplayName: 'Kitchen',
      },
    ]

    // loop over the discovered devices and register each one if it has not already been registered
    for (const device of exampleDevices) {
      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(device.exampleUniqueId)

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid)

      if (existingAccessory) {
        // the accessory already exists
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName)

        // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
        // existingAccessory.context.device = device;
        // this.api.updatePlatformAccessories([existingAccessory]);

        // create the accessory handler for the restored accessory
        // this is imported from `platformAccessory.ts`
        new ExamplePlatformAccessory(this, existingAccessory)
      } else {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', device.exampleDisplayName)

        // create a new accessory
        const accessory = new this.api.platformAccessory(device.exampleDisplayName, uuid)

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device

        // create the accessory handler for the newly create accessory
        // this is imported from `platformAccessory.ts`
        new ExamplePlatformAccessory(this, accessory)

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory])
      }

      // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
      // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
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
}
