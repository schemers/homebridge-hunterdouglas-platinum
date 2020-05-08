'use strict'

const Bridge = require('./lib/Bridge')
const pThrottle = require('p-throttle')

let Accessory, Service, Characteristic, uuid
let BlindAccessory

module.exports = function(homebridge) {
  Accessory = homebridge.hap.Accessory
  Service = homebridge.hap.Service
  Characteristic = homebridge.hap.Characteristic
  uuid = homebridge.hap.uuid

  // eslint-disable-next-line no-unused-vars
  const exportedTypes = {
    Accessory: Accessory,
    Service: Service,
    Characteristic: Characteristic,
    uuid: uuid
  }

  BlindAccessory = require('./lib/BlindAccessory')(exportedTypes)

  homebridge.registerPlatform(
    'homebridge-hunterdouglas-platinum',
    'HunterDouglasPlatinum',
    HunterDouglasPlatinumPlatform
  )
}

const DEFAULT_STATUS_POLLING_SECONDS = 60
const DEFAULT_SET_POSITION_DELAY_MSECS = 2500
const DEFAULT_SET_POSITION_THROTTLE_RATE_MSECS = 5000
const DEFAULT_CREATE_VIRTUAL_ROOM_BLIND = true
const DEFAULT_CREATE_DISCRETE_BLINDS = true
const DEFAULT_PREFIX_ROOM_NAME_TO_BLIND_NAME = true
const DEFAULT_TOP_DOWN_BOTTOM_UP_BEHAVIOR = "topDown"

class HunterDouglasPlatinumPlatform {
  constructor(log, config) {
    this.log = log
    this.config = config

    // apply defaults
    this.config.statusPollingSeconds = configDefault(
      config.statusPollingSeconds,
      DEFAULT_STATUS_POLLING_SECONDS
    )
    this.config.setPositionDelayMsecs = configDefault(
      config.setPositionDelayMsecs,
      DEFAULT_SET_POSITION_DELAY_MSECS
    )
    this.config.setPositionThrottleRateMsecs = configDefault(
      config.setPositionThrottleRateMsecs,
      DEFAULT_SET_POSITION_THROTTLE_RATE_MSECS
    )
    this.config.createVirtualRoomBlind = configDefault(
      config.createVirtualRoomBlind,
      DEFAULT_CREATE_VIRTUAL_ROOM_BLIND
    )
    this.config.createDiscreteBlinds = configDefault(
      config.createDiscreteBlinds,
      DEFAULT_CREATE_DISCRETE_BLINDS
    )
    this.config.prefixRoomNameToBlindName = configDefault(
      config.prefixRoomNameToBlindName,
      DEFAULT_PREFIX_ROOM_NAME_TO_BLIND_NAME
    )
    this.config.topDownBottomUpBehavior = configDefault(
      config.topDownBottomUpBehavior,
      DEFAULT_TOP_DOWN_BOTTOM_UP_BEHAVIOR
    )

    this.blindAccessories = new Map()
    this.roomBlindAccessories = new Map()

    this.pendingRefreshPromise = null
    this.blindController = new Bridge.Controller(config, log)
    // map from blind id to pending timer that will ultimately set position
    this.pendingSetTimer = new Map()

    this._setTargetPositionThrottled = pThrottle(
      (blindId, shadeFeatureId, nativePosition) => {
        return this.blindController.setPosition(blindId.split(','), shadeFeatureId, nativePosition)
      },
      1,
      this.config.setPositionThrottleRateMsecs
    )
  }

  /** Homebridge requirement that will fetch all the discovered accessories */
  accessories(callback) {
    this.log.info('Fetching Blind Info...')

    this._accessories()
      .then(foundAccessories => {
        this.log.info('found', foundAccessories.length, 'accessories')
        callback(foundAccessories)
      })
      .catch(err => {
        this.log.error('unable to get blind config:', err)
        callback([])
      })
  }

  async _accessories() {
    this.blindConfig = await this.blindController.getConfig()

    this.device_id = this.blindConfig.serialNumber

    this.log.info(
      'connected:',
      this.blindConfig.serialNumber,
      this.blindConfig.softwareVersion,
      '(getBlindConfig)'
    )

    var accessories = []

    if (this.config.createDiscreteBlinds) {
      const prefixName = this.config.prefixRoomNameToBlindName

      // show only visible blinds
      const visibleNames = this.config.visibleBlindNames || ''
      const visibleBlinds = new Set(
        visibleNames ? visibleNames.split(',').map(item => item.trim()) : []
      )

      for (const [_shadeId, shade] of this.blindConfig.shades) {
        const room = this.blindConfig.rooms.get(shade.roomId)

        if (visibleNames && !visibleBlinds.has((room.name + ' ' + shade.name).trim())) {
          continue
        }

        const name = prefixName ? room.name + ' ' + shade.name : shade.name

        const blind = new BlindAccessory(name.trim(), shade.id, shade.roomId, room.shadeTypeId, this)
        this.blindAccessories.set(shade.id, blind)
        accessories.push(blind)
      }
    }

    if (this.config.createVirtualRoomBlind) {
      for (const [_roomId, room] of this.blindConfig.rooms) {
        const shadeIds = room.shadeIds.sort().join(',')
        const blind = new BlindAccessory(room.name, shadeIds, room.id, room.shadeTypeId, this)
        this.roomBlindAccessories.set(shadeIds, blind)
        accessories.push(blind)
      }
    }

    // if we found any accessories,  start polling for status
    if (accessories.length) {
      this._pollForStatus(0)
    }

    return accessories
  }

  /** start polling process with truncated exponential backoff: https://cloud.google.com/storage/docs/exponential-backoff */
  _pollForStatus(retryAttempt) {
    let backoff = function(retryAttempt, maxTime) {
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
        // otherwise we'd get an unhandled promise rejection error.
        .catch(err => {
          this.log.error('_refreshAccessoryValues', err)
        })
        .finally(() => {
          this.log.debug('clearing pendingRefreshPromise')
          this.pendingRefreshPromise = null
        })
    }
    return this.pendingRefreshPromise
  }

  /** gets status,  updates accessories, and resolves */
  async _refreshStatus() {
    try {
      const blindStatus = await this.blindController.getStatus()
      this.log.debug('connected:', this.blindConfig.serialNumber, '(getStatus)')
      this._updateAccessories(blindStatus, null)
      return null
    } catch (err) {
      this.log.error('_refreshStatus error getting blind status', err)
      this._updateAccessories(null, err)
      throw err
    }
  }

  /**
   * updates all accessory data with latest values after a refresh.
   */
  _updateAccessories(status, err) {
    const fault = err ? true : false

    // update any discrete blinds
    for (const [_key, accessory] of this.blindAccessories) {
      accessory.faultStatus = fault
      accessory.positionState = Characteristic.PositionState.STOPPED
      // status is null if there was an error, so check
      if (status instanceof Bridge.Status) {
        let position = this.posToHomeKit(status.shades.get(accessory.blindId))
        accessory.currentPosition = position
        accessory.targetPosition = position
      }
    }

    // update any virtual room blinds
    for (const [_key, accessory] of this.roomBlindAccessories) {
      accessory.faultStatus = fault
      accessory.positionState = Characteristic.PositionState.STOPPED
      // status is null if there was an error, so check
      if (status instanceof Bridge.Status) {
        // take average of all blinds
        let blindIds = accessory.blindId.split(',')
        let sum = blindIds.map(id => status.shades.get(id)).reduce((sum, value) => sum + value, 0)
        let position = this.posToHomeKit(sum / blindIds.length)
        accessory.currentPosition = position
        accessory.targetPosition = position
      }
    }
  }

  /**
   * set a new target position on the specified blind and returns immediately.
   * internally sets a timer (clearing existing one if needed), that will set
   * the physical blind position and refresh values upon firing.
   *
   * @param {*} blindId the blindId we are updating
   * @param {*} shadeFeatureId the shadeFeature (e.g., top-down, bottom-up) we are updating
   * @param {*} position the new position
   * @memberof HunterDouglasPlatinumPlatform
   */
  setTargetPosition(blindId, shadeFeatureId, position) {
    let handle = this.pendingSetTimer.get(blindId)
    if (handle) {
      clearTimeout(handle)
    }

    handle = setTimeout(async () => {
      try {
        // delete ourselves from pendingSetTimer
        this.pendingSetTimer.delete(blindId)
        const nativePosition = this.homeKitToPos(position)
        this.log.debug('platform.setTargetPosition:', blindId, shadeFeatureId, position, nativePosition)
        await this._setTargetPositionThrottled(blindId, shadeFeatureId, nativePosition)
        this.log.debug('did send ->', blindId, position)
        // trigger refresh after setting. call _refreshStatus
        // instead of _refreshAccessories so we definitely fetch fresh values
        await this._refreshStatus()
        this.log.debug('did refresh after set ->', blindId, position)
      } catch (err) {
        this.log.error('unable to set blind position', err)
      }
    }, this.config.setPositionDelayMsecs)
    this.pendingSetTimer.set(blindId, handle)
  }

  /** convenience method for accessories */
  getAccessoryInformationService() {
    var informationService = new Service.AccessoryInformation()
    informationService
      .setCharacteristic(Characteristic.Manufacturer, 'HunterDouglas')
      .setCharacteristic(Characteristic.FirmwareRevision, '')
      // store software version in model, since it doesn't follow
      // proper n.n.n format Apple requires and model is a string
      .setCharacteristic(Characteristic.Model, this.blindConfig.softwareVersion)
      .setCharacteristic(Characteristic.SerialNumber, this.device_id)
    return informationService
  }

  /** convenience function to add an `on('get')` handler which refreshes accessory values  */
  bindCharacteristicGet(service, characteristic) {
    const platform = this
    service.getCharacteristic(characteristic).on('get', function(callback) {
      platform
        ._refreshAccessoryValues()
        .then(() => callback(null, this.value))
        .catch(err => callback(err, null))
    })
  }

  /**
   * convert native blind position (0-255) to HomeKit (0-100)
   *
   * @param {number} pos
   * @memberof HunterDouglasPlatinumPlatform
   */
  posToHomeKit(pos) {
    return Math.round((pos / 255) * 100)
  }

  /**
   * convert native blind position (0-255) to HomeKit (0-100)
   *
   * @param {number} pos
   * @memberof HunterDouglasPlatinumPlatform
   */
  homeKitToPos(pos) {
    return Math.round((pos / 100) * 255)
  }

  /**
   * normalizes native blind position so it always matches the value
   * that is returned from homeKitToPos.
   *
   * @param {number} pos
   * @memberof HunterDouglasPlatinumPlatform
   */
  normalizedPos(pos) {
    return this.homeKitToPos(this.posToHomeKit(pos))
  }
}

function configDefault(value, defaultValue) {
  return value === null || value === undefined ? defaultValue : value
}
