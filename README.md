# homebridge-hunterdouglas-platinum

[![NPM version](https://img.shields.io/npm/v/homebridge-hunterdouglas-platinum)](https://npmjs.org/package/homebridge-hunterdouglas-platinum)
![License](https://img.shields.io/npm/l/homebridge-hunterdouglas-platinum)
[![Downloads](https://img.shields.io/npm/dm/homebridge-hunterdouglas-platinum.svg)](https://npmjs.org/package/homebridge-hunterdouglas-platinum)

## Hunter Douglas Platinum plug-in for [Homebridge](https://github.com/nfarina/homebridge)

<img src="https://user-images.githubusercontent.com/249172/86522462-ee9a4d80-be12-11ea-8cb2-14f7385bf7ab.jpg" width="300">

## Requirements

This plugin was recently rewritten in Typescript to use the latest capabilities of Homebridge 1.x, so it requires at a minimum:

1. Homebridge >= 1.0.0
2. Node >= 10.17.0

## Installation

<!-- 2. Clone (or pull) this repository from github into the same path Homebridge lives (usually `/usr/local/lib/node_modules`). Note: the code currently on GitHub is in beta, and is newer than the latest published version of this package on `npm` -->

1. Install homebridge using: `npm install -g homebridge`
1. Install this plug-in using: `npm install -g homebridge-hunterdouglas-platinum`
1. Update your configuration file. See example `config.json` snippet below.

## Configuration

Configuration samples (edit `~/.homebridge/config.json`):

### Direct connection via IP Address

Use this when you know the local static IP address.

```
"platforms": [
        {
            "platform": "HunterDouglasPlatinum",
            "ip_address": "192.168.0.100"
        }
    ],
```

## Optional fields:

- `"statusPollingSeconds"` time in seconds to poll for blind positions. Default is 60 seconds.

* `"setPositionDelayMsecs"` time in msecs to delay actuually setting a blind position after it has changed. This smooths things out when you are dragging slider for a given slide. Default is 2500 msecs.

* `"setPositionThrottleRateMsecs"` rate limits how often we send set position commands to the gateway. Default is 5000 msecs.

* `"createVirtualRoomBlind"` Creates a virtual blind for each room that contains all the blinds in the room. Default is true. Changing this blind will change all blinds in the room. Position is set to the average position of all blinds in the room.

* `"createDiscreteBlinds"` Creates a blind for each real blind. Default is true. You might want to turn this off if you want only the virtual room blind.

* `"prefixRoomNameToBlindName"` Prefix the room name to each discrete blind name. Default is true.

* `"visibleBlindNames"` Comma-seperated list of blind names (prefixed with room name) to make visible. All other blinds are ignored. Only used when `createDiscreteBlinds` is true.

* `"topDownBottomUpBehavior"` Choose the desired behavior for Top-Down / Bottom-Up blinds. If `"topDown"` is specified, the slider will control the middle rail, and the blind will open downward. If `"bottomUp"` is specified, the slider will control the bottom rail, and the blind will open upward. Default is `"topDown"`. This setting has no effect on standard blinds (i.e., blinds with only "Bottom-Up" functionality).

# Implemented HomeKit Accessory Types

## WindowCovering

- creates a _WindowCovering_ accessory for each discovered blind if `createDiscreteBlinds` is true

- creates a _WindowCovering_ accessory for each discovered room if `createVirtualRoomBlind` is true
