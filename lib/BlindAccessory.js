'use strict'

let Accessory, Service, Characteristic, uuid

module.exports = function(exportedTypes) {
  if (exportedTypes && !Accessory) {
    Accessory = exportedTypes.Accessory
    Service = exportedTypes.Service
    Characteristic = exportedTypes.Characteristic
    uuid = exportedTypes.uuid
  }

  return BlindAccessory
}

class BlindAccessory {
  /**
   *Creates an instance of BlindAccessory.
   * @param {string} name
   * @param {string} blindId
   * @param {string} roomId
   * @param {HunterDouglasPlatinumPlatform} platform
   * @memberof BlindAccessory
   */
  constructor(name, blindId, roomId, platform) {
    // name and uuid_base required by homebridge
    this.name = name
    this.blindId = blindId
    this.roomId = roomId
    this.uuid_base = uuid.generate(platform.device_id + ':' + roomId + ':' + blindId)
    this.platform = platform
    this.log = platform.log

    this.windowCoveringService = new Service.WindowCovering(this.name)

    // ask platform to refresh accessories when someone gets our value.
    platform.bindCharacteristicGet(this.windowCoveringService, Characteristic.CurrentPosition)

    // ask platform to set current position
    this.windowCoveringService
      .getCharacteristic(Characteristic.TargetPosition)
      .on('set', this._setTargetPosition.bind(this))

    this.informationService = platform.getAccessoryInformationService()
  }

  _setTargetPosition(newValue, callback, context) {
    const platform = this.platform

    platform.log.debug('BA._setTargetPosition:', this.name, this.blindId, ':', newValue)

    if (context !== this) {
      platform.log.debug('from click')
      platform
        .setTargetPosition(this.blindId, newValue)
        .then(_unused => {
          platform.log.info('BA._setTargetPosition:', this.name, 'updated:', newValue)
          callback(null, newValue)
        })
        .catch(err => {
          platform.log.error('BA._setTargetPosition:', this.name, 'err:', err)
          callback(err, null)
        })
    } else {
      callback(null, newValue)
    }
  }
  /** homebridge: Respond to identify request */
  identify(callback) {
    this.log(this.name, 'Identify')
    callback()
  }

  /** homebridge: Get suppported services for this accessory */
  getServices() {
    return [this.informationService, this.windowCoveringService]
  }

  set currentPosition(value) {
    this.log.debug(this.name, 'set currentPosition', value)
    this.windowCoveringService.getCharacteristic(Characteristic.CurrentPosition).setValue(value)
  }

  get currentPosition() {
    return this.windowCoveringService.getCharacteristic(Characteristic.CurrentPosition).value
  }

  set targetPosition(value) {
    this.log.debug(this.name, 'set targetPosition', value)
    this.windowCoveringService
      .getCharacteristic(Characteristic.TargetPosition)
      .setValue(value, null, this)
  }

  get targetPosition() {
    return this.windowCoveringService.getCharacteristic(Characteristic.TargetPosition).value
  }

  set positionState(value) {
    this.log.debug(this.name, 'set positionState', value)
    this.windowCoveringService.getCharacteristic(Characteristic.PositionState).setValue(value)
  }

  get positionState() {
    return this.windowCoveringService.getCharacteristic(Characteristic.PositionState).value
  }

  set statusFault(value) {
    this.windowCoveringService.getCharacteristic(Characteristic.StatusFault).setValue(value)
  }

  get statusFault() {
    return this.windowCoveringService.getCharacteristic(Characteristic.StatusFault).value
  }
}
