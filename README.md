# homebridge-screenlogic

Hunter Douglas Platinum plug-in for [Homebridge](https://github.com/nfarina/homebridge)

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

...

# Implemented HomeKit Accessory Types

## Air Temperature

- _TemperatureSensor_ accessory (Air) indicating the ambient temperature where thee screenlogic hardware is located

## Pool

- _TemperatureSensor_ accessory (Pool) indicating the ambient temperature of the pool (last known temperature if pool isn't running)

## Spa

- _TemperatureSensor_ accessory (Spa) indicating the ambient temperature of the Spa (last known temperature if pool isn't running)

## WindowCovering

- creates a _WindowCovering_ accessory for each discovered blind
