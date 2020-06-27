import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
  CharacteristicSetCallback,
} from 'homebridge'

import { HunterDouglasPlatform } from './platform'

export type ShadeAccessoryContext = Record<
  'displayName' | 'shadeId' | 'roomId' | 'shadeFeatureId',
  string
>

/**
 * Shade Accessory
 */
export class ShadeAccessory {
  private service: Service

  static generateUUID(platform: HunterDouglasPlatform, context: ShadeAccessoryContext): string {
    return platform.generateUUID(context.roomId + ':' + context.shadeId)
  }

  public static sameContext(a: ShadeAccessoryContext, b: ShadeAccessoryContext): boolean {
    return (
      a.displayName === b.displayName &&
      a.shadeId === b.shadeId &&
      a.roomId === b.roomId &&
      a.shadeFeatureId === b.shadeFeatureId
    )
  }

  constructor(
    private readonly platform: HunterDouglasPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // set accessory information
    const accessoryInfo = platform.accessoryInfo()
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, accessoryInfo.manufacturer)
      .setCharacteristic(this.platform.Characteristic.Model, accessoryInfo.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessoryInfo.serialNumber)

    // get the WindowCovering service if it exists, otherwise create a new WindowCovering service
    this.service =
      this.accessory.getService(this.platform.Service.WindowCovering) ||
      this.accessory.addService(this.platform.Service.WindowCovering)

    // set the service name, this is what is displayed as the default name on the Home app
    this.service.setCharacteristic(this.platform.Characteristic.Name, this.context.displayName)

    this.platform.triggersRefreshIfNeded(this.service, this.platform.Characteristic.CurrentPosition)

    // register handlers for the TargetPosition Characteristic
    this.service
      .getCharacteristic(this.platform.Characteristic.TargetPosition)
      .on('set', this.setTargetPosition.bind(this))

    // update position state to stopped (and leave it there)
    this.service.updateCharacteristic(
      this.platform.Characteristic.PositionState,
      this.platform.Characteristic.PositionState.STOPPED,
    )
  }

  public get UUID(): string {
    return this.accessory.UUID
  }

  private get context(): ShadeAccessoryContext {
    return this.accessory.context
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  private setTargetPosition(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.platform.log.debug('setTargetPosition:', value, this.context.shadeId)
    this.platform.setTargetPosition(this.context, value as number)
    callback(null, value)
  }

  public updateCurrentPosition(position: number) {
    this.platform.log.debug('updateCurrentPosition:', position, this.context.shadeId)
    this.service.updateCharacteristic(this.platform.Characteristic.CurrentPosition, position)
  }

  public updateTargetPosition(position: number) {
    this.platform.log.debug('updateTargetPosition:', position, this.context.shadeId)
    this.service.updateCharacteristic(this.platform.Characteristic.TargetPosition, position)
  }
}
