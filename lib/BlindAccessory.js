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
  constructor(name, blindId, platform) {
    // name and uuid_base required by homebridge
    this.name = name
    this.blindId = blindId
    this.uuid_base = uuid.generate(platform.device_id + ':' + blindId)
    this.platform = platform
    this.log = platform.log

    // initialize temperature sensor
    this.windowCoveringService = new Service.WindowCovering(this.name)

    // ask platform to refresh accessories when someone gets our value.
    platform.bindCharacteristicGet(this.temperatureService, Characteristic.CurrentPosition)
    this.informationService = platform.getAccessoryInformationService()
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
    this.windowCoveringService.getCharacteristic(Characteristic.CurrentTemperature).setValue(value)
  }

  get currentPosition() {
    return this.windowCoveringService.getCharacteristic(Characteristic.CurrentTemperature).value
  }

  set targetPosition(value) {
    this.log.debug(this.name, 'set targetPosition', value)
    this.windowCoveringService.getCharacteristic(Characteristic.TargetPosition).setValue(value)
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
