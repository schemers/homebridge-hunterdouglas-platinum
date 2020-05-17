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
   * Creates an instance of BlindAccessory.
   * @param {string} name
   * @param {string} blindId
   * @param {string} roomId
   * @param {string} shadeTypeId
   * @param {HunterDouglasPlatinumPlatform} platform
   * @memberof BlindAccessory
   */
  constructor(name, blindId, roomId, shadeTypeId, platform) {
    // name and uuid_base required by homebridge
    this.name = name
    this.blindId = blindId
    this.roomId = roomId
    this.uuid_base = uuid.generate(platform.device_id + ':' + roomId + ':' + blindId)
    this.shadeTypeId = shadeTypeId
    this.platform = platform
    this.log = platform.log

    // Default feature is bottom-up - Feature ID: "04"
    this.shadeFeatureId = '04'

    // Special handling for top-down-bottom-up shades, which can be detected from the room's shadeTypeId

    // For top-down-bottom-up shades (shadeTypeId 02 or 13), use the top-down feature - Feature ID: "18"
    if (this.shadeTypeId == '02' || this.shadeTypeId == '13') {
      if (platform.config.topDownBottomUpBehavior == 'topDown') {
        this.shadeFeatureId = '18'
      }
    }

    platform.log.debug(
      'BA.constructor for blind named:',
      this.name,
      '- blindId:',
      this.blindId,
      '- roomId:',
      this.roomId,
      '- shadeTypeId:',
      this.shadeTypeId,
      '- shadeFeatureId:',
      this.shadeFeatureId
    )

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

    let shouldSetBlind = context !== this
    platform.log.debug(
      'BA._setTargetPosition(' + (shouldSetBlind ? 'remote' : 'local') + '):',
      this.name,
      this.blindId,
      newValue
    )

    if (shouldSetBlind) {
      platform.setTargetPosition(this.blindId, this.shadeFeatureId, newValue)
      platform.log.debug('BA._setTargetPosition(updated):', this.name, newValue)
      callback(null)
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
