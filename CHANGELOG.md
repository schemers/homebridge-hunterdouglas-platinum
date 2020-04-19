# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

...

## V1.2.2 - 2020-4-19

### Fixed

- raise socket timeout back to from 30s

## V1.2.1 - 2020-4-19

### Fixed

- don't throw an error if the first line we read isn't `HunterDouglas Shade Controller`

- lower socket timeout from 30s to 15s

- don't add pollingInterval to backoff when retrying so we retry quicker on errors

- set max backoff to pollingInterval instead of pollingInterval\*20

## V1.2.0 - 2020-4-18

### Fixed

- make sure to call `connection.close()` in async convenience functions

- finally (hopefully) fix #1. Since we are using a shared Promise, make sure to have a `.catch` handler when also setting up the `.finally`

## V1.1.9 - 2020-4-11

### Fixed

- call `socket.destroy()` instead of `socket.end()`

- wrap `_pollForStatus` in a domain to see if unhandled error/exception is at the root cause of the crashing

## V1.1.8 - 2020-4-9

### Fixed

- replace `throw new BridgeError` with `this.emit('error', ...)` when handling unexpected hello response

- call `socket.end()` before emitting an error in `_handleError` (just in case)

### Added

- dump out read lines when debug is on

## V1.1.7 - 2020-1-19

### Fixed

- `_updateAccessories` `status` is null when there is an error, so add instanceof check

## V1.1.6 - 2020-1-17

### Fixed

- change `.once('error')` to `.on('error')`, otherwise if multiple errors are emitted the second one will crash node as an unhandled error

- don't start polling if no accessories are found

## V1.1.5 - 2020-1-14

### Fixed

- shouldn’t need to block during pending set

- set `Characteristic.PositionState` to `PositionState.STOPPED`

## V1.1.4 - 2020-1-12

### Fixed

- have `_command` use `_readUntil` which pull lines from buffer first instead of returning each buffered line via async

## V1.1.3 - 2020-1-12

### Added

- config `"visibleBlindNames"` Comma-seperated list of blind names (prefixed with room name) to make visible. All other blinds are ignored. Only used when `createDiscreteBlinds` is true.

- use the average of all blind positions in the room for the value of the virtual room
  blind

### Fixed

- don't log at info level in BlindAccessory

## V1.1.2 - 2020-1-12

### Fixed

- pass in log to Controller constructor

## V1.1.1 - 2020-1-12

### Fixed

- properly apply default values from config

## V1.1.0 - 2020-1-12

### Added

- config `"createVirtualRoomBlind"` Creates a virtual blind for each room that contains all the blinds in the room. Default is true. Changing this blind will change all blinds in the room.

- config `"createDiscreteBlinds"` Creates a blind for each real blind. Default is true. You might want to turn this off if you want only the virtual room blind.

- config `"prefixRoomNameToBlindName"` Prefix the room name to each discrete blind name. Default is true.

## v1.0.0 - 2020-1-4

### Added

- initial check in
