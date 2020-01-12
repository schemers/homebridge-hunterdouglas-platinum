# homebridge-hunterdouglas-platinum

Hunter Douglas Platinum plug-in for [Homebridge](https://github.com/nfarina/homebridge)

**Note: This plugin is still in early development**

# Installation

<!-- 2. Clone (or pull) this repository from github into the same path Homebridge lives (usually `/usr/local/lib/node_modules`). Note: the code currently on GitHub is in beta, and is newer than the latest published version of this package on `npm` -->

1. Install homebridge using: `npm install -g homebridge`
2. Install this plug-in using: `npm install -g homebridge-hunterdouglas-platinum`
3. Update your configuration file. See example `config.json` snippet below.

# Configuration

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

* `"setPositionDelayMsecs"` time in msecs to delay setting blind positions. This smooths things out when you are dragging slider. Default is 2500 msecs.

* `"createVirtualRoomBlind"` Creates a virtual blind for each room that contains all the blinds in the room. Default is true. Changing this blind will change all blinds in the room. Position is set to the average position of all blinds in the room.

* `"createDiscreteBlinds"` Creates a blind for each real blind. Default is true. You might want to turn this off if you want only the virtual room blind.

* `"prefixRoomNameToBlindName"` Prefix the room name to each discrete blind name. Default is true.

* `"visibleBlindNames"` Comma-seperated list of blind names (prefixed with room name) to make visible. All other blinds are ignored. Only used when `createDiscreteBlinds` is true.

# Implemented HomeKit Accessory Types

## WindowCovering

- creates a _WindowCovering_ accessory for each discovered blind if `createDiscreteBlinds` is true

- creates a _WindowCovering_ accessory for each discovered room if `createVirtualRoomBlind` is true
