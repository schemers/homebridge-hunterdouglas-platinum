# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Unreleased

...

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
